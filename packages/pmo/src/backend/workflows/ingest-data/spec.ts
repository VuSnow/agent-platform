import { createStep } from '@mastra/core/workflows';
import { createWorkflow } from '@mastra/core/workflows/evented';
import type { WorkflowSpec } from '@seta/agent-sdk';
import type { z } from 'zod';
import { detectSchema } from '../../ingestion/detect-schema.ts';
import { normalizeRows } from '../../ingestion/normalize-rows.ts';
import { parseWorkbook } from '../../ingestion/parse-workbook.ts';
import { createS3FileStore } from '../../ingestion/s3-file-store.ts';
import {
  type ActiveRecord,
  aggregateTimesheetRows,
  classifyRows,
  type StagedRow,
  shouldBlockDuplicateInUpload,
} from '../../ingestion/stage-changes.ts';
import { buildMappingReviewCard, buildPublishReviewCard } from './cards.ts';
import {
  ConfirmOutputSchema,
  DetectOutputSchema,
  IngestInputSchema,
  MappingCardSchema,
  MappingDecisionSchema,
  PublishDecisionSchema,
  PublishOutputSchema,
  PublishReviewCardSchema,
  StagingOutputSchema,
} from './schemas.ts';

function resolveCardIdentity(requestContext: { get: (key: string) => unknown }): {
  tenantId: string;
  userId: string;
} {
  const actor = requestContext.get('actor') as { user_id?: string } | undefined;
  const tenantId = (requestContext.get('tenant_id') as string | undefined) ?? '';
  const userId = actor?.user_id ?? '';
  return { tenantId, userId };
}

// ── Step 1: Detect schema ────────────────────────────────────────────────────

const detectStep = createStep({
  id: 'pmo.ingest.detect',
  description: 'Parses workbook, profiles columns, detects sheet roles, maps columns, validates.',
  inputSchema: IngestInputSchema,
  outputSchema: DetectOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore =
      (requestContext.get(
        'pmoFileStore',
      ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
      createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
    const buffer = await fileStore.getBuffer(inputData.fileKey);

    const result = await detectSchema(buffer);

    return {
      ingestionSessionId: inputData.ingestionSessionId,
      fileKey: inputData.fileKey,
      tableMappings: result.tables.map((t) => ({
        tableId: t.tableId,
        sourceSheet: t.sourceSheet,
        headerRow: t.headerRow,
        tableConfidence: t.tableConfidence,
        mappings: t.mappings.map((m) => ({
          sourceColumn: m.sourceColumn,
          canonicalField: m.canonicalField,
          confidence: m.confidence,
          status: m.status,
        })),
        unmappedRequired: t.unmappedRequired,
        ambiguous: t.ambiguous,
      })),
      validationStatus: result.validation.status,
      workbookConfidence: result.validation.workbookConfidence,
    };
  },
});

// ── Step 2: Confirm mapping (HITL gate 1) ────────────────────────────────────

const confirmMappingStep = createStep({
  id: 'pmo.ingest.confirmMapping',
  description:
    'Auto-passes high confidence mappings; suspends for PMO review if needs_review/blocked.',
  inputSchema: DetectOutputSchema,
  outputSchema: ConfirmOutputSchema,
  suspendSchema: MappingCardSchema,
  resumeSchema: MappingDecisionSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext, runId }) => {
    if (!resumeData) {
      if (inputData.validationStatus === 'confirmed') {
        return {
          ingestionSessionId: inputData.ingestionSessionId,
          fileKey: inputData.fileKey,
          confirmedMappings: inputData.tableMappings,
        };
      }

      const allowApprove = inputData.validationStatus !== 'blocked';
      return suspend(
        buildMappingReviewCard({
          ingestionSessionId: inputData.ingestionSessionId,
          workbookConfidence: inputData.workbookConfidence,
          validationStatus: inputData.validationStatus,
          tableMappings: inputData.tableMappings,
          allowApprove,
          identity: resolveCardIdentity(requestContext),
          toolCallId: `workflow:${runId}:pmo_confirmMapping`,
        }),
      );
    }

    if (resumeData.decision === 'reject') {
      throw new Error('rejected_by_user');
    }
    if (inputData.validationStatus === 'blocked') {
      throw new Error('cannot_approve_blocked_mapping');
    }

    return {
      ingestionSessionId: inputData.ingestionSessionId,
      fileKey: inputData.fileKey,
      confirmedMappings: inputData.tableMappings,
    };
  },
});

// ── Step 3: Normalize to staging ─────────────────────────────────────────────

const normalizeToStagingStep = createStep({
  id: 'pmo.ingest.normalizeToStaging',
  description:
    'Parses file again, normalizes rows, computes hashes, compares with active data, generates change summary.',
  inputSchema: ConfirmOutputSchema,
  outputSchema: StagingOutputSchema,
  execute: async ({ inputData, requestContext }) => {
    const fileStore =
      (requestContext.get(
        'pmoFileStore',
      ) as import('../../ingestion/file-store.ts').PmoFileStore) ??
      createS3FileStore(process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020');
    const sessionId = inputData.ingestionSessionId;

    const buffer = await fileStore.getBuffer(inputData.fileKey);
    const parseResult = await parseWorkbook(buffer);

    const tableMappings = inputData.confirmedMappings.map((t) => ({
      ...t,
      mappings: t.mappings.map((m) => ({
        ...m,
        evidence: '',
        scoringBreakdown: {
          headerSimilarity: 0,
          valuePattern: 0,
          dataType: 0,
          sheetContext: 0,
          crossSheet: 0,
        },
      })),
    }));
    const normResult = normalizeRows(parseResult.sheets, tableMappings);

    const { pmoDb } = await import('../../db/client.ts');
    const {
      resourceAllocations,
      timesheets,
      leaveRecords,
      memberMaster,
      projectMaster,
      overbookIdleConfig,
      calendarWeeks,
      kpiNorms,
      stagingChanges,
    } = await import('../../db/schema.ts');
    const { eq, and } = await import('drizzle-orm');
    const db = pmoDb();
    const tenantId = requestContext.get('tenant_id') as string;

    const tableToSchema: Record<
      string,
      {
        natural_key_hash: unknown;
        source_row_hash: unknown;
        tenant_id: unknown;
        is_active: unknown;
      }
    > = {
      resource_allocation: resourceAllocations as never,
      timesheet: timesheets as never,
      leave: leaveRecords as never,
      member_master: memberMaster as never,
      project_master: projectMaster as never,
      overbook_idle_config: overbookIdleConfig as never,
      calendar_weeks: calendarWeeks as never,
      kpi_norms: kpiNorms as never,
    };

    const allStaged: StagedRow[] = [];
    const changeSummary: Array<{
      tableId: string;
      counts: {
        new_records: number;
        updated_records: number;
        exact_duplicates: number;
        duplicates_in_upload: number;
      };
      sampleChanges: Array<{
        type: string;
        naturalKey: Record<string, string>;
        newValues: Record<string, unknown>;
      }>;
    }> = [];

    for (const [tableId, rows] of Object.entries(normResult.tables)) {
      const processedRows = tableId === 'timesheet' ? aggregateTimesheetRows(tenantId, rows) : rows;

      let activeRecords: ActiveRecord[] = [];
      const tableSchema = tableToSchema[tableId];
      if (tableSchema) {
        const results = await (db as never as { select: Function })
          .select({
            natural_key_hash: (tableSchema as { natural_key_hash: unknown }).natural_key_hash,
            source_row_hash: (tableSchema as { source_row_hash: unknown }).source_row_hash,
          })
          .from(tableSchema)
          .where(
            and(
              eq((tableSchema as { tenant_id: unknown }).tenant_id as never, tenantId as never),
              eq((tableSchema as { is_active: unknown }).is_active as never, true as never),
            ),
          );
        activeRecords = results as ActiveRecord[];
      }

      const staged = classifyRows(tableId, tenantId, processedRows, activeRecords);
      allStaged.push(...staged);

      const counts = {
        new_records: 0,
        updated_records: 0,
        exact_duplicates: 0,
        duplicates_in_upload: 0,
      };
      for (const s of staged) {
        counts[`${s.changeType}s` as keyof typeof counts]++;
      }

      const finalCounts = {
        new_records: counts.new_records,
        updated_records: counts.updated_records,
        exact_duplicates: counts.exact_duplicates,
        duplicates_in_upload: counts.duplicates_in_upload,
      };

      const sampleChanges = staged
        .filter((s) => s.changeType !== 'exact_duplicate')
        .slice(0, 5)
        .map((s) => ({
          type: s.changeType as 'new_record' | 'updated_record' | 'duplicate_in_upload',
          naturalKey: s.naturalKeyDisplay,
          newValues: s.values,
        }));

      changeSummary.push({ tableId, counts: finalCounts, sampleChanges });
    }

    if (allStaged.length > 0) {
      const stagingRows = allStaged.map((s) => ({
        ingestion_session_id: sessionId,
        table_id: s.tableId,
        natural_key_hash: s.naturalKeyHash,
        change_type: s.changeType,
        new_values: s.values,
        natural_key_display: s.naturalKeyDisplay,
        old_values: s.oldValues ?? null,
      }));
      await db.insert(stagingChanges).values(stagingRows);
    }

    const hasUpdates = changeSummary.some(
      (t) =>
        t.counts.updated_records > 0 ||
        (t.counts.duplicates_in_upload > 0 && shouldBlockDuplicateInUpload(t.tableId)),
    );

    return {
      ingestionSessionId: sessionId,
      changeSummary: changeSummary as z.infer<typeof StagingOutputSchema>['changeSummary'],
      hasUpdates,
      requiresReview: hasUpdates,
    };
  },
});

// ── Step 4: Review changes + publish (HITL gate 2) ───────────────────────────

const reviewChangesStep = createStep({
  id: 'pmo.ingest.reviewChanges',
  description: 'Auto-publishes if only new/exact_dup; suspends for PMO review if updates detected.',
  inputSchema: StagingOutputSchema,
  outputSchema: PublishOutputSchema,
  suspendSchema: PublishReviewCardSchema,
  resumeSchema: PublishDecisionSchema,
  execute: async ({ inputData, resumeData, suspend, requestContext, runId }) => {
    if (!resumeData) {
      if (!inputData.requiresReview) {
        const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
        const tenantId = (requestContext.get('tenant_id') as string) ?? '';
        const result = await publishUpsert(inputData.ingestionSessionId, tenantId);
        return {
          ingestionSessionId: inputData.ingestionSessionId,
          ...result,
          status: 'published' as const,
        };
      }

      const hasDuplicatesInUpload = inputData.changeSummary.some(
        (t) => t.counts.duplicates_in_upload > 0,
      );
      return suspend(
        buildPublishReviewCard({
          ingestionSessionId: inputData.ingestionSessionId,
          changeSummary: inputData.changeSummary,
          allowApprove: !hasDuplicatesInUpload,
          identity: resolveCardIdentity(requestContext),
          toolCallId: `workflow:${runId}:pmo_confirmPublish`,
        }),
      );
    }

    if (resumeData.decision === 'reject') {
      return {
        ingestionSessionId: inputData.ingestionSessionId,
        rowsWritten: {},
        rowsUpdated: {},
        rowsSkipped: {},
        status: 'rejected' as const,
      };
    }

    const hasDuplicatesInUpload = inputData.changeSummary.some(
      (t) => t.counts.duplicates_in_upload > 0,
    );
    if (hasDuplicatesInUpload) {
      throw new Error('cannot_approve_blocked_publish');
    }

    const { publishUpsert } = await import('../../ingestion/publish-upsert.ts');
    const tenantId = (requestContext.get('tenant_id') as string) ?? '';
    const result = await publishUpsert(inputData.ingestionSessionId, tenantId);
    return {
      ingestionSessionId: inputData.ingestionSessionId,
      ...result,
      status: 'published' as const,
    };
  },
});

// ── Workflow composition ─────────────────────────────────────────────────────

export const ingestDataWorkflow = createWorkflow({
  id: 'pmo.ingestData',
  inputSchema: IngestInputSchema,
  outputSchema: PublishOutputSchema,
  retryConfig: { attempts: 2, delay: 1000 },
})
  .then(detectStep)
  .then(confirmMappingStep)
  .then(normalizeToStagingStep)
  .then(reviewChangesStep)
  .commit();

export const ingestDataWorkflowSpec: WorkflowSpec = {
  domain: 'work',
  id: 'ingestData',
  description:
    'Ingests PMO workbook: detect schema, confirm mapping, normalize to staging, review changes, publish with upsert.',
  inputSchema: IngestInputSchema,
  outputSchema: PublishOutputSchema,
  workflow: ingestDataWorkflow,
  hitlSteps: ['pmo.ingest.confirmMapping', 'pmo.ingest.reviewChanges'],
};
