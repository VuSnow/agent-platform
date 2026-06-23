import { eq } from 'drizzle-orm';
import {
  type CleaningSummary,
  computeCleaningSummary,
} from '../../../scripts/lib/mock-cleaning-outcomes.ts';
import { ensureFactsComputed } from '../analytics/ensure-facts-computed.ts';
import { analyzeMembers } from '../analytics/findings.ts';
import { loadReportEvidence } from '../analytics/load-report-evidence.ts';
import { generatePmoReport } from '../analytics/report.ts';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions, stagingChanges } from '../db/schema.ts';
import { detectSchema } from '../ingestion/detect-schema.ts';
import { normalizeRows } from '../ingestion/normalize-rows.ts';
import { parseWorkbook } from '../ingestion/parse-workbook.ts';
import { PMO_DOMAIN_CONFIG } from '../ingestion/pmo-domain-config.ts';
import { PMO_INGESTION_ADAPTER } from '../ingestion/pmo-ingestion-adapter.ts';
import { classifyRows, type StagedRow } from '../ingestion/stage-changes.ts';
import { loadRecommendationEvidence } from '../reporting/recommendations/load-evidence.ts';
import { syncRecommendationProjectionsFromDemoCsv } from '../reporting/recommendations/sync-from-demo-csv.ts';
import { timed } from './timing.ts';
import type { AnswerKeyCase, DeterministicPipelineOutput, EvalStageTiming } from './types.ts';

const STAGING_TABLE_ORDER = [
  'calendar_weeks',
  'member_master',
  'project_master',
  'overbook_idle_config',
  'kpi_norms',
  'resource_allocation',
  'timesheet',
  'leave',
] as const;

async function ensureIngestionSession(input: {
  ingestionSessionId: string;
  tenantId: string;
  workbookName: string;
  workbookConfidence: number;
}): Promise<void> {
  const db = pmoDb();
  await db
    .insert(ingestionSessions)
    .values({
      id: input.ingestionSessionId,
      tenant_id: input.tenantId,
      status: 'approved_plan',
      source_kind: 'workbook',
      source_file_name: input.workbookName,
      mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      reporting_period_key: 'eval',
      created_by: '00000000-0000-0000-0000-0000000000ee',
      workbook_confidence: input.workbookConfidence,
    })
    .onConflictDoNothing();
}

async function persistStagingRows(input: {
  ingestionSessionId: string;
  stagedRows: StagedRow[];
}): Promise<void> {
  const db = pmoDb();
  await db
    .delete(stagingChanges)
    .where(eq(stagingChanges.ingestion_session_id, input.ingestionSessionId));

  const values = input.stagedRows.map((row) => ({
    ingestion_session_id: input.ingestionSessionId,
    table_id: row.tableId,
    natural_key_hash: row.naturalKeyHash,
    change_type: row.changeType,
    new_values: row.values,
  }));

  if (values.length > 0) {
    await db.insert(stagingChanges).values(values);
  }
}

function stageNormalizedTables(input: {
  tenantId: string;
  normalizedTables: Record<string, import('../ingestion/normalize-rows.ts').NormalizedRow[]>;
}): { stagedRows: StagedRow[]; duplicateInUploadCount: number } {
  const stagedRows: StagedRow[] = [];
  for (const tableId of STAGING_TABLE_ORDER) {
    const rows = input.normalizedTables[tableId];
    if (!rows || rows.length === 0) continue;
    stagedRows.push(...classifyRows(tableId, input.tenantId, rows, [], PMO_DOMAIN_CONFIG));
  }
  const duplicateInUploadCount = stagedRows.filter(
    (row) => row.changeType === 'duplicate_in_upload',
  ).length;
  return { stagedRows, duplicateInUploadCount };
}

export async function runDeterministicEvalPipeline(input: {
  evalCase: AnswerKeyCase;
  workbookBuffer: Buffer;
  tenantId: string;
  ingestionSessionId: string;
  seedRecommendations?: boolean;
}): Promise<DeterministicPipelineOutput & { cleaning: CleaningSummary }> {
  const timings: EvalStageTiming[] = [];
  const { evalCase, workbookBuffer, tenantId, ingestionSessionId } = input;

  const parsedTimed = await timed('parse_workbook', () => parseWorkbook(workbookBuffer));
  timings.push({
    stage: 'parse_workbook',
    durationMs: parsedTimed.durationMs,
    detail: `${parsedTimed.result.sheets.length} sheets`,
  });

  const detectedTimed = await timed('detect_schema', () =>
    detectSchema(workbookBuffer, { parsedWorkbook: parsedTimed.result }),
  );
  timings.push({
    stage: 'detect_schema',
    durationMs: detectedTimed.durationMs,
    detail: `confidence=${detectedTimed.result.validation.workbookConfidence.toFixed(3)}`,
  });

  const tableMappings = detectedTimed.result.tables.map((table) => ({
    ...table,
    mappings: table.mappings.map((mapping) => ({
      ...mapping,
      evidence: '',
      scoringBreakdown: {
        headerSimilarity: 0,
        valuePattern: 0,
        dataType: 0,
        sheetContext: 0,
        crossSheet: 0,
        llmSemantic: 0,
      },
    })),
  }));

  const normalizedTimed = await timed('normalize_rows', () =>
    Promise.resolve(normalizeRows(parsedTimed.result.sheets, tableMappings as never)),
  );
  timings.push({
    stage: 'normalize_rows',
    durationMs: normalizedTimed.durationMs,
    detail: `errors=${normalizedTimed.result.errorCount}`,
  });

  const cleaning = computeCleaningSummary(normalizedTimed.result.tables, tenantId);
  const { stagedRows, duplicateInUploadCount } = stageNormalizedTables({
    tenantId,
    normalizedTables: normalizedTimed.result.tables,
  });

  await ensureIngestionSession({
    ingestionSessionId,
    tenantId,
    workbookName: evalCase.workbook,
    workbookConfidence: detectedTimed.result.validation.workbookConfidence,
  });

  const stageTimed = await timed('stage_changes', async () =>
    persistStagingRows({ ingestionSessionId, stagedRows }),
  );
  timings.push({
    stage: 'stage_changes',
    durationMs: stageTimed.durationMs,
    detail: `rows=${stagedRows.length}, dup_in_upload=${duplicateInUploadCount}`,
  });

  const publishTimed = await timed('publish', () =>
    PMO_INGESTION_ADAPTER.publish({ ingestionSessionId, tenantId }),
  );
  timings.push({
    stage: 'publish',
    durationMs: publishTimed.durationMs,
    detail: JSON.stringify(publishTimed.result.rowsWritten),
  });

  const factsTimed = await timed('compute_facts', () =>
    ensureFactsComputed(tenantId, { force: false, sessionId: ingestionSessionId }),
  );
  timings.push({
    stage: 'compute_facts',
    durationMs: factsTimed.durationMs,
    detail: factsTimed.result.factsVersion,
  });

  if (input.seedRecommendations !== false && evalCase.expectedRecommendationGroups.length > 0) {
    await syncRecommendationProjectionsFromDemoCsv({ tenantId });
  }

  const reportStart = Date.now();
  const report = await generatePmoReport(
    {
      tenantId,
      ingestionSessionId,
      dateRange: evalCase.dateRange,
      reportTypes: ['idle_members', 'overbook_members'],
      reportSource: 'published_batch',
      recommendationCandidateCount: 3,
    },
    {
      ensureFacts: ensureFactsComputed,
      loadEvidence: loadReportEvidence,
      loadRecommendationEvidence,
      explainReport: async () => null,
    },
  );
  const reportDurationMs = Date.now() - reportStart;
  timings.push({
    stage: 'generate_report',
    durationMs: reportDurationMs,
    detail: `findings=${report.findings.length}`,
  });

  timings.push({
    stage: 'generate_recommendations',
    durationMs: 0,
    detail: `groups=${report.recommendations.length}`,
  });

  return {
    schema: detectedTimed.result,
    normalizedTables: normalizedTimed.result.tables,
    normalizeErrorCount: normalizedTimed.result.errorCount,
    duplicateInUploadCount,
    report,
    recommendations: report.recommendations,
    timings,
    cleaning,
  };
}

export async function loadPipelineEvidence(input: {
  tenantId: string;
  ingestionSessionId: string;
  dateRange: { from: string; to: string };
}) {
  const from = new Date(`${input.dateRange.from}T00:00:00.000Z`);
  const to = new Date(`${input.dateRange.to}T00:00:00.000Z`);
  return loadReportEvidence(input.tenantId, {
    dateRange: { from, to },
    ingestionSessionId: input.ingestionSessionId,
  });
}

export function buildMemberAnalysesFromEvidence(
  evidence: Awaited<ReturnType<typeof loadReportEvidence>>,
) {
  return analyzeMembers(evidence.facts, evidence.ctx);
}
