import { Agent } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import {
  AnalyzeIngestionPlanResponseSchema,
  type PmoCapability,
  type PmoGoalInterpretation,
  PmoGoalInterpretationSchema,
  type PmoGoalType,
  type PmoIngestionPlanMemory,
  PmoIngestionPlanMemorySchema,
  type PmoSuggestedPlan,
  type PmoValidationDepth,
} from '../../contracts.ts';
import { pmoDb } from '../db/client.ts';
import { ingestionPlanDrafts, ingestionSessions } from '../db/schema.ts';
import { PMO_CANONICAL_SCHEMA } from '../ingestion/canonical-schema.ts';
import { detectSheetRoles } from '../ingestion/detect-sheet-role.ts';
import { parseWorkbook } from '../ingestion/parse-workbook.ts';
import { profileColumns } from '../ingestion/profile-columns.ts';
import { createS3FileStore } from '../ingestion/s3-file-store.ts';

const GOAL_PARSE_SYSTEM_PROMPT = `You are a goal understanding component for a PMO workbook ingestion system.

Your only job is to convert a natural-language user goal into strict structured JSON for a deterministic ingestion planner.

Do not execute ingestion.
Do not inspect workbook cells deeply.
Do not generate DB changes.
Do not publish data.
Do not invent capabilities outside the allowed enum.
Do not invent goal types outside the allowed enum.

Be conservative:
- If goal is ambiguous, set requires_clarification=true.
- If confidence is low, set requires_clarification=true and ask concise clarification questions.
- If user asks to publish or write DB changes, set publish_intent=publish_required.
- If request is read-only, set publish_intent=none or preview_only.

Return only structured JSON that matches the schema.`;

const GOAL_REVISION_SYSTEM_PROMPT = `You revise an already interpreted PMO ingestion goal using user feedback.

Rules:
- Keep output strictly in schema.
- Preserve intent unless feedback clearly changes it.
- Never invent unsupported goal types or capabilities.
- Mark requires_clarification=true when feedback is contradictory or ambiguous.
- Keep rationale concise and practical.`;

const GoalRevisionSchema = PmoGoalInterpretationSchema.extend({
  revision_summary: PmoGoalInterpretationSchema.shape.rationale,
});

const GOAL_TYPES = new Set<PmoGoalType>([
  'prepare_for_ra_calculation',
  'full_ingestion_publish',
  'validate_only',
  'check_missing_data',
  'mapping_review_only',
  'db_change_review_only',
  'timesheet_only_ingestion',
  'ra_only_ingestion',
  'preview_report_only',
  'unknown',
]);

const WRITE_LIKE_GOALS = new Set<PmoGoalType>([
  'prepare_for_ra_calculation',
  'full_ingestion_publish',
  'timesheet_only_ingestion',
  'ra_only_ingestion',
]);

const ALL_DATASET_IDS = PMO_CANONICAL_SCHEMA.tables.map((table) => table.id);

type StepCode = PmoSuggestedPlan['steps'][number]['code'];

type PlanMode = PmoSuggestedPlan['mode'];

const STEP_TITLES: Record<StepCode, string> = {
  inspect_workbook: 'Inspect workbook structure',
  coverage_check: 'Check canonical dataset coverage',
  schema_mapping: 'Generate schema mapping candidates',
  data_validation: 'Run deterministic data validation',
  db_change_review: 'Review projected DB changes',
  publish: 'Publish approved changes',
  dataset_versioning: 'Create dataset version snapshot',
  ra_readiness: 'Evaluate RA calculation readiness',
  summary_report: 'Generate ingestion summary report',
};

const CAPABILITY_TO_STEP: Partial<Record<PmoCapability, StepCode>> = {
  coverage_check: 'coverage_check',
  schema_mapping: 'schema_mapping',
  data_validation: 'data_validation',
  db_change_review: 'db_change_review',
  publish: 'publish',
  ra_calculation: 'ra_readiness',
  timesheet_comparison: 'ra_readiness',
  overbook_idle_detection: 'ra_readiness',
  kpi_readiness: 'ra_readiness',
  dataset_versioning: 'dataset_versioning',
  summary_reporting: 'summary_report',
};

const STEP_ORDER: StepCode[] = [
  'inspect_workbook',
  'coverage_check',
  'schema_mapping',
  'data_validation',
  'db_change_review',
  'dataset_versioning',
  'ra_readiness',
  'publish',
  'summary_report',
];

function resolvePlanningModel(): MastraModelConfig {
  const explicit = process.env.PMO_GOAL_MODEL?.trim();
  if (explicit) return explicit as unknown as MastraModelConfig;

  const fromCatalog = process.env.AGENT_MODELS?.split(',')[0]?.trim();
  if (fromCatalog) {
    const key = fromCatalog.split(':')[0]?.trim();
    if (key && key !== 'auto') return key as unknown as MastraModelConfig;
  }

  const defaultKey = process.env.AGENT_MODEL_DEFAULT?.trim();
  if (defaultKey && defaultKey !== 'auto') return defaultKey as unknown as MastraModelConfig;

  return 'openai/gpt-4.1-mini' as unknown as MastraModelConfig;
}

function normalizeGoalText(goalText?: string): string {
  const trimmed = goalText?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Full ingestion';
}

function inferCapabilitiesByGoalType(goalType: PmoGoalType): PmoCapability[] {
  switch (goalType) {
    case 'prepare_for_ra_calculation':
      return [
        'coverage_check',
        'schema_mapping',
        'data_validation',
        'db_change_review',
        'dataset_versioning',
        'ra_calculation',
        'summary_reporting',
      ];
    case 'full_ingestion_publish':
      return [
        'coverage_check',
        'schema_mapping',
        'data_validation',
        'db_change_review',
        'publish',
        'dataset_versioning',
        'summary_reporting',
      ];
    case 'validate_only':
      return ['coverage_check', 'data_validation', 'summary_reporting'];
    case 'check_missing_data':
      return ['coverage_check', 'summary_reporting'];
    case 'mapping_review_only':
      return ['coverage_check', 'schema_mapping', 'summary_reporting'];
    case 'db_change_review_only':
      return ['coverage_check', 'schema_mapping', 'db_change_review', 'summary_reporting'];
    case 'timesheet_only_ingestion':
      return [
        'coverage_check',
        'schema_mapping',
        'data_validation',
        'db_change_review',
        'dataset_versioning',
        'summary_reporting',
      ];
    case 'ra_only_ingestion':
      return [
        'coverage_check',
        'schema_mapping',
        'data_validation',
        'db_change_review',
        'dataset_versioning',
        'ra_calculation',
        'summary_reporting',
      ];
    case 'preview_report_only':
      return ['coverage_check', 'summary_reporting'];
    case 'unknown':
      return ['coverage_check', 'summary_reporting'];
    default:
      return ['coverage_check', 'summary_reporting'];
  }
}

function inferValidationDepth(goalType: PmoGoalType): PmoValidationDepth {
  if (goalType === 'full_ingestion_publish') return 'strict';
  if (goalType === 'prepare_for_ra_calculation') return 'strict';
  if (goalType === 'validate_only') return 'standard';
  return 'minimal';
}

function heuristicInterpretation(goalText: string): PmoGoalInterpretation {
  const lower = goalText.toLowerCase();

  let goalType: PmoGoalType = 'unknown';
  if (lower.includes('publish') || lower.includes('db')) goalType = 'full_ingestion_publish';
  else if (lower.includes('ra')) goalType = 'prepare_for_ra_calculation';
  else if (lower.includes('validate')) goalType = 'validate_only';
  else if (lower.includes('missing') || lower.includes('coverage')) goalType = 'check_missing_data';
  else if (lower.includes('mapping')) goalType = 'mapping_review_only';
  else if (lower.includes('timesheet')) goalType = 'timesheet_only_ingestion';
  else if (lower.includes('preview') || lower.includes('report')) goalType = 'preview_report_only';

  const capabilities = inferCapabilitiesByGoalType(goalType);
  const publishIntent =
    goalType === 'full_ingestion_publish'
      ? 'publish_required'
      : goalType === 'prepare_for_ra_calculation'
        ? 'preview_only'
        : 'none';

  return {
    inferred_goal_text: goalText,
    goal_type: goalType,
    capabilities,
    validation_depth: inferValidationDepth(goalType),
    publish_intent: publishIntent,
    requires_clarification: goalType === 'unknown',
    clarification_questions:
      goalType === 'unknown'
        ? ['Do you want read-only validation or write/publish ingestion?']
        : [],
    confidence: goalType === 'unknown' ? 0.45 : 0.72,
    rationale: ['Heuristic fallback applied because structured LLM parse was unavailable.'],
  };
}

function normalizeInterpretation(raw: PmoGoalInterpretation): PmoGoalInterpretation {
  const goalType = GOAL_TYPES.has(raw.goal_type) ? raw.goal_type : 'unknown';
  const capabilities =
    raw.capabilities.length > 0 ? raw.capabilities : inferCapabilitiesByGoalType(goalType);

  let publishIntent = raw.publish_intent;
  if (WRITE_LIKE_GOALS.has(goalType) && publishIntent === 'none') {
    publishIntent = 'preview_only';
  }
  if (goalType === 'full_ingestion_publish') {
    publishIntent = 'publish_required';
  }

  const confidence = Math.max(0, Math.min(1, raw.confidence));
  const clarificationByConfidence = confidence < 0.6;
  const requiresClarification =
    raw.requires_clarification || clarificationByConfidence || goalType === 'unknown';

  const clarificationQuestions =
    requiresClarification && raw.clarification_questions.length === 0
      ? ['Please clarify whether this should be read-only or include DB write/publish steps.']
      : raw.clarification_questions;

  return {
    ...raw,
    goal_type: goalType,
    capabilities,
    publish_intent: publishIntent,
    confidence,
    requires_clarification: requiresClarification,
    clarification_questions: clarificationQuestions,
  };
}

async function parseGoalWithLlm(args: {
  goalText: string;
  workbookSummary: z.infer<typeof PmoIngestionPlanMemorySchema.shape.workbook_summary>;
}): Promise<PmoGoalInterpretation> {
  const agent = new Agent({
    id: 'pmo.ingestion.goalParser',
    name: 'PMO Ingestion Goal Parser',
    instructions: GOAL_PARSE_SYSTEM_PROMPT,
    model: resolvePlanningModel(),
  });

  const prompt = [
    `User goal: ${args.goalText}`,
    `Workbook summary: ${JSON.stringify(args.workbookSummary)}`,
    'Return strict JSON only.',
  ].join('\n');

  const result = await agent.generate(prompt, {
    structuredOutput: { schema: PmoGoalInterpretationSchema },
  });

  if (!result.object) {
    throw new Error('goal_parser_empty_output');
  }

  return PmoGoalInterpretationSchema.parse(result.object);
}

async function reviseGoalWithLlm(args: {
  current: PmoGoalInterpretation;
  feedbackText: string;
}): Promise<PmoGoalInterpretation> {
  const agent = new Agent({
    id: 'pmo.ingestion.goalRevision',
    name: 'PMO Ingestion Goal Revision',
    instructions: GOAL_REVISION_SYSTEM_PROMPT,
    model: resolvePlanningModel(),
  });

  const prompt = [
    `Current interpretation: ${JSON.stringify(args.current)}`,
    `User feedback: ${args.feedbackText}`,
    'Revise the interpretation accordingly.',
  ].join('\n');

  const result = await agent.generate(prompt, {
    structuredOutput: { schema: GoalRevisionSchema },
  });

  if (!result.object) {
    throw new Error('goal_revision_empty_output');
  }

  return PmoGoalInterpretationSchema.parse(result.object);
}

function derivePlanMode(interpretation: PmoGoalInterpretation): PlanMode {
  if (interpretation.requires_clarification || interpretation.goal_type === 'unknown') {
    return 'clarification_required';
  }

  const hasWriteSignal =
    WRITE_LIKE_GOALS.has(interpretation.goal_type) ||
    interpretation.publish_intent === 'publish_required' ||
    interpretation.capabilities.includes('publish') ||
    interpretation.capabilities.includes('dataset_versioning') ||
    interpretation.capabilities.includes('db_change_review');

  return hasWriteSignal ? 'approval_required' : 'auto_run_read_only';
}

function buildSuggestedPlan(args: {
  interpretation: PmoGoalInterpretation;
  workbookSummary: z.infer<typeof PmoIngestionPlanMemorySchema.shape.workbook_summary>;
}): PmoSuggestedPlan {
  const mode = derivePlanMode(args.interpretation);

  const stepSet = new Set<StepCode>();
  stepSet.add('inspect_workbook');

  for (const capability of args.interpretation.capabilities) {
    const code = CAPABILITY_TO_STEP[capability];
    if (code) stepSet.add(code);
  }

  if (args.interpretation.goal_type === 'prepare_for_ra_calculation') {
    stepSet.add('ra_readiness');
    stepSet.add('dataset_versioning');
  }

  if (args.interpretation.goal_type === 'preview_report_only') {
    stepSet.add('summary_report');
  }

  if (mode === 'approval_required' && !stepSet.has('db_change_review')) {
    stepSet.add('db_change_review');
  }

  const steps = STEP_ORDER.filter((code) => stepSet.has(code)).map((code) => ({
    code,
    title: STEP_TITLES[code],
    status: 'planned' as const,
  }));

  if (steps.length === 0) {
    steps.push({
      code: 'inspect_workbook',
      title: STEP_TITLES.inspect_workbook,
      status: 'planned',
    });
  }

  const risks: string[] = [];
  if (args.workbookSummary.parse_errors.length > 0) {
    risks.push('Workbook has parse errors; inspect parsing diagnostics before execution.');
  }
  if (args.workbookSummary.missing_canonical_datasets.length > 0) {
    risks.push(
      `Missing canonical datasets: ${args.workbookSummary.missing_canonical_datasets.join(', ')}.`,
    );
  }
  if (args.interpretation.requires_clarification) {
    risks.push('Goal interpretation requires clarification before deterministic execution.');
  }

  const requiredApprovals =
    mode === 'approval_required'
      ? [
          'approve_plan_execution',
          ...(args.interpretation.capabilities.includes('publish') ? ['approve_publish'] : []),
        ]
      : [];

  return {
    mode,
    requires_approval: mode === 'approval_required',
    required_approvals: requiredApprovals,
    risks,
    steps,
  };
}

async function inspectWorkbook(fileKey: string) {
  const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
  const fileStore = createS3FileStore(bucket);
  const buffer = await fileStore.getBuffer(fileKey);
  const parsed = await parseWorkbook(buffer);

  const profiles = parsed.sheets.map((sheet) => profileColumns(sheet));
  const roleDetections = detectSheetRoles(profiles, PMO_CANONICAL_SCHEMA);
  const likelyDatasets = Array.from(
    new Set(
      roleDetections
        .map((item) => item.topCandidate?.candidateRole)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const missingCanonicalDatasets = ALL_DATASET_IDS.filter((id) => !likelyDatasets.includes(id));

  const totalRows = parsed.sheets.reduce((acc, sheet) => acc + sheet.rowCount, 0);

  return {
    sheet_count: parsed.sheets.length,
    excluded_sheet_count: parsed.excludedSheets.length,
    total_rows: totalRows,
    sheets: parsed.sheets.map((sheet) => ({
      name: sheet.name,
      row_count: sheet.rowCount,
      column_count: sheet.colCount,
    })),
    likely_datasets: likelyDatasets,
    missing_canonical_datasets: missingCanonicalDatasets,
    parse_errors: parsed.parseErrors,
  };
}

export class PmoPlanServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PmoPlanServiceError';
  }
}

async function getIngestionSessionOrThrow(args: { ingestionSessionId: string; tenantId: string }) {
  const db = pmoDb();
  const rows = await db
    .select({
      id: ingestionSessions.id,
      source_file_key: ingestionSessions.source_file_key,
      reporting_period_key: ingestionSessions.reporting_period_key,
    })
    .from(ingestionSessions)
    .where(
      and(
        eq(ingestionSessions.id, args.ingestionSessionId),
        eq(ingestionSessions.tenant_id, args.tenantId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new PmoPlanServiceError(404, 'not_found', 'ingestion session not found');
  }
  return row;
}

function buildMemory(args: {
  goalText: string;
  interpretation: PmoGoalInterpretation;
  suggestedPlan: PmoSuggestedPlan;
  workbookSummary: z.infer<typeof PmoIngestionPlanMemorySchema.shape.workbook_summary>;
}): PmoIngestionPlanMemory {
  return {
    version: 1,
    goal_text: args.goalText,
    interpreted_goal: args.interpretation,
    suggested_plan: args.suggestedPlan,
    workbook_summary: args.workbookSummary,
    revisions: [],
    execution: {},
  };
}

export async function analyzeIngestionPlan(args: {
  ingestionSessionId: string;
  goalText?: string;
  tenantId: string;
  userId: string;
}) {
  const session = await getIngestionSessionOrThrow({
    ingestionSessionId: args.ingestionSessionId,
    tenantId: args.tenantId,
  });

  const workbookSummary = await inspectWorkbook(session.source_file_key);
  const goalText = normalizeGoalText(args.goalText);

  let interpretedGoal: PmoGoalInterpretation;
  try {
    interpretedGoal = await parseGoalWithLlm({ goalText, workbookSummary });
  } catch {
    interpretedGoal = heuristicInterpretation(goalText);
  }
  interpretedGoal = normalizeInterpretation(interpretedGoal);

  const suggestedPlan = buildSuggestedPlan({ interpretation: interpretedGoal, workbookSummary });
  const memory = buildMemory({
    goalText,
    interpretation: interpretedGoal,
    suggestedPlan,
    workbookSummary,
  });

  const db = pmoDb();
  const planId = crypto.randomUUID();
  await db.insert(ingestionPlanDrafts).values({
    id: planId,
    ingestion_session_id: args.ingestionSessionId,
    tenant_id: args.tenantId,
    status: suggestedPlan.mode === 'clarification_required' ? 'awaiting_clarification' : 'draft',
    memory_json: memory,
    created_by: args.userId,
  });

  return AnalyzeIngestionPlanResponseSchema.parse({
    plan_id: planId,
    ingestion_session_id: args.ingestionSessionId,
    interpreted_goal: interpretedGoal,
    suggested_plan: suggestedPlan,
    workbook_summary: workbookSummary,
  });
}

async function getPlanDraftOrThrow(args: { planId: string; tenantId: string }) {
  const db = pmoDb();
  const rows = await db
    .select({
      id: ingestionPlanDrafts.id,
      ingestion_session_id: ingestionPlanDrafts.ingestion_session_id,
      status: ingestionPlanDrafts.status,
      memory_json: ingestionPlanDrafts.memory_json,
    })
    .from(ingestionPlanDrafts)
    .where(
      and(
        eq(ingestionPlanDrafts.id, args.planId),
        eq(ingestionPlanDrafts.tenant_id, args.tenantId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new PmoPlanServiceError(404, 'not_found', 'plan draft not found');
  }

  const parsedMemory = PmoIngestionPlanMemorySchema.safeParse(row.memory_json);
  if (!parsedMemory.success) {
    throw new PmoPlanServiceError(500, 'invalid_plan_memory', 'stored plan memory is invalid');
  }

  return {
    row,
    memory: parsedMemory.data,
  };
}

export async function modifyIngestionPlan(args: {
  planId: string;
  feedbackText: string;
  tenantId: string;
  userId: string;
}) {
  const { row, memory } = await getPlanDraftOrThrow({
    planId: args.planId,
    tenantId: args.tenantId,
  });

  let revisedInterpretation: PmoGoalInterpretation;
  try {
    revisedInterpretation = await reviseGoalWithLlm({
      current: memory.interpreted_goal,
      feedbackText: args.feedbackText,
    });
  } catch {
    revisedInterpretation = {
      ...memory.interpreted_goal,
      rationale: [
        ...memory.interpreted_goal.rationale,
        'Fallback: feedback was recorded but structured revision fell back to existing interpretation.',
      ],
    };
  }

  revisedInterpretation = normalizeInterpretation(revisedInterpretation);
  const suggestedPlan = buildSuggestedPlan({
    interpretation: revisedInterpretation,
    workbookSummary: memory.workbook_summary,
  });

  const nowIso = new Date().toISOString();
  const revisedMemory: PmoIngestionPlanMemory = {
    ...memory,
    version: memory.version + 1,
    interpreted_goal: revisedInterpretation,
    suggested_plan: suggestedPlan,
    revisions: [
      ...memory.revisions,
      {
        version: memory.version + 1,
        feedback_text: args.feedbackText,
        revised_at: nowIso,
        revised_by: args.userId,
      },
    ],
  };

  const db = pmoDb();
  await db
    .update(ingestionPlanDrafts)
    .set({
      status: suggestedPlan.mode === 'clarification_required' ? 'awaiting_clarification' : 'draft',
      memory_json: revisedMemory,
      updated_at: new Date(),
    })
    .where(
      and(eq(ingestionPlanDrafts.id, row.id), eq(ingestionPlanDrafts.tenant_id, args.tenantId)),
    );

  return {
    plan_id: row.id,
    ingestion_session_id: row.ingestion_session_id,
    interpreted_goal: revisedInterpretation,
    suggested_plan: suggestedPlan,
    workbook_summary: revisedMemory.workbook_summary,
    revision_count: revisedMemory.revisions.length,
  };
}

export async function approveIngestionPlan(args: {
  planId: string;
  tenantId: string;
  userId: string;
}) {
  const { row, memory } = await getPlanDraftOrThrow({
    planId: args.planId,
    tenantId: args.tenantId,
  });

  if (memory.suggested_plan.mode === 'clarification_required') {
    return {
      plan_id: row.id,
      ingestion_session_id: row.ingestion_session_id,
      status: 'clarification_required' as const,
      start_payload: null,
    };
  }

  const session = await getIngestionSessionOrThrow({
    ingestionSessionId: row.ingestion_session_id,
    tenantId: args.tenantId,
  });

  const approvedAt = new Date();
  const nextMemory: PmoIngestionPlanMemory = {
    ...memory,
    execution: {
      ...memory.execution,
      approved_at: approvedAt.toISOString(),
      approved_by: args.userId,
    },
  };

  const db = pmoDb();
  await db
    .update(ingestionPlanDrafts)
    .set({
      status: 'approved',
      approved_by: args.userId,
      approved_at: approvedAt,
      updated_at: approvedAt,
      memory_json: nextMemory,
    })
    .where(
      and(eq(ingestionPlanDrafts.id, row.id), eq(ingestionPlanDrafts.tenant_id, args.tenantId)),
    );

  return {
    plan_id: row.id,
    ingestion_session_id: row.ingestion_session_id,
    status: 'approved' as const,
    start_payload: {
      ingestionSessionId: row.ingestion_session_id,
      fileKey: session.source_file_key,
      reportingPeriodKey: session.reporting_period_key ?? undefined,
    },
  };
}
