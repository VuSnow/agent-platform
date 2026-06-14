interface ApiErrorBody {
  error?: string;
  message?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}) as ApiErrorBody)) as ApiErrorBody;
    throw Object.assign(new Error(body.message ?? res.statusText), {
      status: res.status,
      code: body.error,
    });
  }
  return (await res.json()) as T;
}

export interface UploadWorkbookResponse {
  ingestion_session_id: string;
  s3_key: string;
  status: string;
  filename?: string;
  message?: string;
}

export interface StartIngestWorkflowInput {
  ingestionSessionId: string;
  fileKey: string;
  reportingPeriodKey?: string;
}

export interface StartIngestWorkflowResponse {
  runId: string;
}

export type PlanStepStatus = 'planned' | 'running' | 'completed' | 'blocked';

export interface SuggestedPlanStep {
  code:
    | 'inspect_workbook'
    | 'coverage_check'
    | 'schema_mapping'
    | 'data_validation'
    | 'db_change_review'
    | 'publish'
    | 'dataset_versioning'
    | 'ra_readiness'
    | 'summary_report';
  title: string;
  status: PlanStepStatus;
  note?: string;
}

export interface GoalInterpretation {
  inferred_goal_text: string;
  goal_type:
    | 'prepare_for_ra_calculation'
    | 'full_ingestion_publish'
    | 'validate_only'
    | 'check_missing_data'
    | 'mapping_review_only'
    | 'db_change_review_only'
    | 'timesheet_only_ingestion'
    | 'ra_only_ingestion'
    | 'preview_report_only'
    | 'unknown';
  capabilities: string[];
  validation_depth: 'minimal' | 'standard' | 'strict';
  publish_intent: 'none' | 'preview_only' | 'publish_required';
  requires_clarification: boolean;
  clarification_questions: string[];
  confidence: number;
  rationale: string[];
}

export interface WorkbookSummary {
  sheet_count: number;
  excluded_sheet_count: number;
  total_rows: number;
  sheets: Array<{
    name: string;
    row_count: number;
    column_count: number;
  }>;
  likely_datasets: string[];
  missing_canonical_datasets: string[];
  parse_errors: string[];
}

export interface SuggestedPlan {
  mode: 'clarification_required' | 'auto_run_read_only' | 'approval_required';
  requires_approval: boolean;
  required_approvals: string[];
  risks: string[];
  steps: SuggestedPlanStep[];
}

export interface AnalyzeIngestionPlanResponse {
  plan_id: string;
  ingestion_session_id: string;
  interpreted_goal: GoalInterpretation;
  suggested_plan: SuggestedPlan;
  workbook_summary: WorkbookSummary;
}

export interface ModifyIngestionPlanResponse extends AnalyzeIngestionPlanResponse {
  revision_count: number;
}

export interface ApproveIngestionPlanResponse {
  plan_id: string;
  ingestion_session_id: string;
  status: 'approved' | 'clarification_required';
  start_payload: {
    ingestionSessionId: string;
    fileKey: string;
    reportingPeriodKey?: string;
  } | null;
}

export const pmoApi = {
  async uploadWorkbook(file: File, reportingPeriodKey?: string): Promise<UploadWorkbookResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (reportingPeriodKey) {
      formData.append('reporting_period_key', reportingPeriodKey);
    }

    const res = await fetch('/api/pmo/v1/upload', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    return jsonOrThrow<UploadWorkbookResponse>(res);
  },

  async startIngestWorkflow(input: StartIngestWorkflowInput): Promise<StartIngestWorkflowResponse> {
    const res = await fetch('/api/agent/v1/workflows/runs/pmo.ingestData/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      credentials: 'include',
    });
    return jsonOrThrow<StartIngestWorkflowResponse>(res);
  },

  async analyzeGoalPlan(input: {
    ingestionSessionId: string;
    goalText?: string;
  }): Promise<AnalyzeIngestionPlanResponse> {
    const res = await fetch('/api/pmo/v1/ingestion/plans/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingestion_session_id: input.ingestionSessionId,
        goal_text: input.goalText,
      }),
      credentials: 'include',
    });
    return jsonOrThrow<AnalyzeIngestionPlanResponse>(res);
  },

  async modifyGoalPlan(input: {
    planId: string;
    feedbackText: string;
  }): Promise<ModifyIngestionPlanResponse> {
    const res = await fetch(`/api/pmo/v1/ingestion/plans/${input.planId}/modify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback_text: input.feedbackText }),
      credentials: 'include',
    });
    return jsonOrThrow<ModifyIngestionPlanResponse>(res);
  },

  async approveGoalPlan(input: { planId: string }): Promise<ApproveIngestionPlanResponse> {
    const res = await fetch(`/api/pmo/v1/ingestion/plans/${input.planId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    return jsonOrThrow<ApproveIngestionPlanResponse>(res);
  },
};
