import { z } from 'zod';

export const PmoGoalTypeSchema = z.enum([
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

export const PmoCapabilitySchema = z.enum([
  'coverage_check',
  'schema_mapping',
  'data_validation',
  'db_change_review',
  'publish',
  'ra_calculation',
  'timesheet_comparison',
  'overbook_idle_detection',
  'kpi_readiness',
  'dataset_versioning',
  'summary_reporting',
]);

export const PmoValidationDepthSchema = z.enum(['minimal', 'standard', 'strict']);
export const PmoPublishIntentSchema = z.enum(['none', 'preview_only', 'publish_required']);

export const PmoPlanModeSchema = z.enum([
  'clarification_required',
  'auto_run_read_only',
  'approval_required',
]);

export const PmoPlanStepCodeSchema = z.enum([
  'inspect_workbook',
  'coverage_check',
  'schema_mapping',
  'data_validation',
  'db_change_review',
  'publish',
  'dataset_versioning',
  'ra_readiness',
  'summary_report',
]);

export const PmoPlanStepStatusSchema = z.enum(['planned', 'running', 'completed', 'blocked']);

export const PmoGoalInterpretationSchema = z.object({
  inferred_goal_text: z.string().min(1),
  goal_type: PmoGoalTypeSchema,
  capabilities: z.array(PmoCapabilitySchema).default([]),
  validation_depth: PmoValidationDepthSchema,
  publish_intent: PmoPublishIntentSchema,
  requires_clarification: z.boolean(),
  clarification_questions: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.array(z.string().min(1)).default([]),
});

export const PmoSuggestedPlanStepSchema = z.object({
  code: PmoPlanStepCodeSchema,
  title: z.string().min(1),
  status: PmoPlanStepStatusSchema.default('planned'),
  note: z.string().optional(),
});

export const PmoSuggestedPlanSchema = z.object({
  mode: PmoPlanModeSchema,
  requires_approval: z.boolean(),
  required_approvals: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  steps: z.array(PmoSuggestedPlanStepSchema).min(1),
});

export const PmoWorkbookSheetSummarySchema = z.object({
  name: z.string(),
  row_count: z.number().int().nonnegative(),
  column_count: z.number().int().nonnegative(),
});

export const PmoWorkbookSummarySchema = z.object({
  sheet_count: z.number().int().nonnegative(),
  excluded_sheet_count: z.number().int().nonnegative(),
  total_rows: z.number().int().nonnegative(),
  sheets: z.array(PmoWorkbookSheetSummarySchema),
  likely_datasets: z.array(z.string().min(1)).default([]),
  missing_canonical_datasets: z.array(z.string().min(1)).default([]),
  parse_errors: z.array(z.string()).default([]),
});

export const PmoPlanRevisionSchema = z.object({
  version: z.number().int().positive(),
  feedback_text: z.string().min(1),
  revised_at: z.string().min(1),
  revised_by: z.string().uuid(),
});

export const PmoIngestionPlanMemorySchema = z.object({
  version: z.number().int().positive(),
  goal_text: z.string().min(1),
  interpreted_goal: PmoGoalInterpretationSchema,
  suggested_plan: PmoSuggestedPlanSchema,
  workbook_summary: PmoWorkbookSummarySchema,
  revisions: z.array(PmoPlanRevisionSchema).default([]),
  execution: z
    .object({
      approved_at: z.string().optional(),
      approved_by: z.string().uuid().optional(),
      run_id: z.string().optional(),
    })
    .default({}),
});

export const AnalyzeIngestionPlanRequestSchema = z.object({
  ingestion_session_id: z.string().uuid(),
  goal_text: z.string().trim().max(2000).optional(),
});

export const AnalyzeIngestionPlanResponseSchema = z.object({
  plan_id: z.string().uuid(),
  ingestion_session_id: z.string().uuid(),
  interpreted_goal: PmoGoalInterpretationSchema,
  suggested_plan: PmoSuggestedPlanSchema,
  workbook_summary: PmoWorkbookSummarySchema,
});

export const ModifyIngestionPlanRequestSchema = z.object({
  feedback_text: z.string().trim().min(1).max(4000),
});

export const ModifyIngestionPlanResponseSchema = AnalyzeIngestionPlanResponseSchema.extend({
  revision_count: z.number().int().nonnegative(),
});

export const ApproveIngestionPlanRequestSchema = z.object({});

export const ApproveIngestionPlanResponseSchema = z.object({
  plan_id: z.string().uuid(),
  ingestion_session_id: z.string().uuid(),
  status: z.enum(['approved', 'clarification_required']),
  start_payload: z
    .object({
      ingestionSessionId: z.string().uuid(),
      fileKey: z.string().min(1),
      reportingPeriodKey: z.string().optional(),
    })
    .nullable(),
});

export type PmoGoalType = z.infer<typeof PmoGoalTypeSchema>;
export type PmoCapability = z.infer<typeof PmoCapabilitySchema>;
export type PmoValidationDepth = z.infer<typeof PmoValidationDepthSchema>;
export type PmoPublishIntent = z.infer<typeof PmoPublishIntentSchema>;
export type PmoPlanMode = z.infer<typeof PmoPlanModeSchema>;
export type PmoPlanStepCode = z.infer<typeof PmoPlanStepCodeSchema>;
export type PmoPlanStepStatus = z.infer<typeof PmoPlanStepStatusSchema>;
export type PmoGoalInterpretation = z.infer<typeof PmoGoalInterpretationSchema>;
export type PmoSuggestedPlan = z.infer<typeof PmoSuggestedPlanSchema>;
export type PmoWorkbookSummary = z.infer<typeof PmoWorkbookSummarySchema>;
export type PmoIngestionPlanMemory = z.infer<typeof PmoIngestionPlanMemorySchema>;
export type AnalyzeIngestionPlanResponse = z.infer<typeof AnalyzeIngestionPlanResponseSchema>;
