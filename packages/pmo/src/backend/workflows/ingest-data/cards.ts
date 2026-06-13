import type { ApprovalCard } from '@seta/agent-sdk';
import type { z } from 'zod';
import type { DetectOutputSchema, StagingOutputSchema } from './schemas.ts';

type TableMapping = z.infer<typeof DetectOutputSchema>['tableMappings'][number];
type ChangeSummaryTable = z.infer<typeof StagingOutputSchema>['changeSummary'][number];

interface CardIdentity {
  tenantId: string;
  userId: string;
}

interface MappingCardInput {
  ingestionSessionId: string;
  workbookConfidence: number;
  validationStatus: 'confirmed' | 'needs_review' | 'blocked';
  tableMappings: TableMapping[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
}

interface PublishCardInput {
  ingestionSessionId: string;
  changeSummary: ChangeSummaryTable[];
  allowApprove: boolean;
  identity: CardIdentity;
  toolCallId: string;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mappingRows(tableMappings: TableMapping[]): Array<{ k: string; v: string }> {
  return tableMappings.map((t) => {
    let autoAccept = 0;
    let needsReview = 0;
    let blocked = 0;

    for (const m of t.mappings) {
      if (m.status === 'auto_accept') autoAccept++;
      else if (m.status === 'needs_review') needsReview++;
      else blocked++;
    }

    const parts = [
      `sheet=${t.sourceSheet}`,
      `auto=${autoAccept}`,
      `review=${needsReview}`,
      `blocked=${blocked}`,
      `required_missing=${t.unmappedRequired.length}`,
      `table_conf=${percent(t.tableConfidence)}`,
    ];

    return { k: t.tableId, v: parts.join(' | ') };
  });
}

function publishRows(changeSummary: ChangeSummaryTable[]): Array<{ k: string; v: string }> {
  return changeSummary.map((t) => {
    const c = t.counts;
    return {
      k: t.tableId,
      v: `new=${c.new_records} | updated=${c.updated_records} | exact_dup=${c.exact_duplicates} | dup_in_upload=${c.duplicates_in_upload}`,
    };
  });
}

export function buildMappingReviewCard(input: MappingCardInput): ApprovalCard {
  const blockedTables = input.tableMappings.filter((t) =>
    t.mappings.some((m) => m.status === 'blocked'),
  ).length;
  const needsReviewTables = input.tableMappings.filter((t) =>
    t.mappings.some((m) => m.status === 'needs_review'),
  ).length;

  const summary = input.allowApprove
    ? `Detected ${input.tableMappings.length} table(s). ${needsReviewTables} table(s) need review before normalization.`
    : `Detected blocked mappings in ${blockedTables} table(s). Approval is disabled for this run.`;

  const checklist = input.allowApprove
    ? [
        'Headers map to expected canonical fields.',
        'Any ambiguous columns are acceptable for this reporting period.',
        'Proceed to normalization and staging.',
      ]
    : [
        'At least one required mapping is blocked.',
        'Reject this run and correct workbook headers before retrying.',
      ];

  return {
    toolCallId: input.toolCallId,
    intent: 'Confirm workbook mapping before normalization',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'Validation status', v: input.validationStatus },
          { k: 'Workbook confidence', v: percent(input.workbookConfidence) },
        ],
      },
      {
        kind: 'kvTable',
        rows: mappingRows(input.tableMappings),
      },
      {
        kind: 'confirmationChecklist',
        items: checklist,
      },
    ],
    primary: input.allowApprove
      ? {
          label: 'Approve mapping',
          argsPatch: { decision: 'approve' },
        }
      : {
          label: 'Reject blocked mapping',
          argsPatch: { decision: 'reject' },
        },
    alternates: [],
    decline: { label: 'Reject upload', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmMapping',
      ts: new Date().toISOString(),
    },
  };
}

export function buildPublishReviewCard(input: PublishCardInput): ApprovalCard {
  const totals = input.changeSummary.reduce(
    (acc, t) => {
      acc.newRecords += t.counts.new_records;
      acc.updatedRecords += t.counts.updated_records;
      acc.exactDuplicates += t.counts.exact_duplicates;
      acc.duplicatesInUpload += t.counts.duplicates_in_upload;
      return acc;
    },
    {
      newRecords: 0,
      updatedRecords: 0,
      exactDuplicates: 0,
      duplicatesInUpload: 0,
    },
  );

  const summary = input.allowApprove
    ? `Ready to publish ${totals.newRecords + totals.updatedRecords} effective change(s).`
    : `Found ${totals.duplicatesInUpload} duplicate-in-upload row(s). Publish approval is disabled.`;

  const checklist = input.allowApprove
    ? [
        'Updated rows are expected and reviewed.',
        'No conflicting duplicate-in-upload rows remain for blocked tables.',
        'Proceed with publish upsert.',
      ]
    : [
        'Duplicate rows within this upload violate table duplicate policy.',
        'Reject this run and fix duplicate rows before retrying.',
      ];

  return {
    toolCallId: input.toolCallId,
    intent: 'Review staging changes before publish',
    riskBadge: 'write',
    summary,
    details: [
      {
        kind: 'kvTable',
        rows: [
          { k: 'Ingestion session', v: input.ingestionSessionId },
          { k: 'New rows', v: String(totals.newRecords) },
          { k: 'Updated rows', v: String(totals.updatedRecords) },
          { k: 'Exact duplicates', v: String(totals.exactDuplicates) },
          { k: 'Duplicates in upload', v: String(totals.duplicatesInUpload) },
        ],
      },
      {
        kind: 'kvTable',
        rows: publishRows(input.changeSummary),
      },
      {
        kind: 'confirmationChecklist',
        items: checklist,
      },
    ],
    primary: input.allowApprove
      ? {
          label: 'Approve publish',
          argsPatch: { decision: 'approve' },
        }
      : {
          label: 'Reject blocked publish',
          argsPatch: { decision: 'reject' },
        },
    alternates: [],
    decline: { label: 'Reject publish', argsPatch: { decision: 'reject' } },
    meta: {
      tenantId: input.identity.tenantId,
      userId: input.identity.userId,
      agentPath: ['supervisor', 'work', 'pmo'],
      toolId: 'pmo_confirmPublish',
      ts: new Date().toISOString(),
    },
  };
}
