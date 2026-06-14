import { Button, PageChrome } from '@seta/shared-ui';
import { CheckCircle2, Download, FileSpreadsheet, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { type AnalyzeIngestionPlanResponse, type PlanStepStatus, pmoApi } from '../api/client';

const DEFAULT_FLOW_STEPS: Array<{
  id: number;
  label: string;
  status: 'completed' | 'current' | 'pending';
}> = [
  { id: 1, label: 'Inspect workbook structure', status: 'pending' },
  { id: 2, label: 'Check canonical coverage', status: 'pending' },
  { id: 3, label: 'Plan execution', status: 'pending' },
];

const REVIEW_CASES = [
  {
    tone: 'danger' as const,
    label: 'Blocking',
    title: 'Conflicting Member_ID already exists in dim_time',
    bullets: ['Existing active member_id: 101234', 'Source contains 3 rows with same ID'],
    primary: 'Resolve conflict',
    secondary: 'Ask agent why',
  },
  {
    tone: 'warning' as const,
    label: 'Ambiguity',
    title: "'Effort' may mean logged_hours or allocation_pct",
    bullets: [
      'Appears in both RA and Timesheet sheets',
      'Correlates 93% with logged_hours',
      'Values range 0-1.00 in 43% of rows',
    ],
    primary: 'Choose another mapping',
    secondary: 'Ask agent why',
  },
  {
    tone: 'info' as const,
    label: 'Low confidence',
    title: 'Missing Leave Records support sheet',
    bullets: [
      'Limits exception-aware analysis',
      'RA mismatch may overstate under-logging',
      'Downstream dashboards could be incomplete',
    ],
    primary: 'Upload sheet',
    secondary: 'Proceed anyway',
  },
];

const MAPPING_PREVIEW_ROWS = [
  {
    source: 'Allocation_pct',
    sheet: 'DS01_RESOURCE_ALLOCATION',
    target: 'dim_resource_allocation.allocation_pct',
    confidence: '94%',
    status: 'Auto-resolved',
    evidence: 'High match (0.94)',
  },
  {
    source: 'Effort',
    sheet: 'DS01_RESOURCE_ALLOCATION',
    target: 'dim_timesheet.logged_hours',
    confidence: '58%',
    status: 'Ambiguity',
    evidence: 'Matched 0.93 with logged_hours',
  },
  {
    source: 'Member_ID',
    sheet: 'DS01_RESOURCE_ALLOCATION',
    target: 'dim_resource_allocation.member_id',
    confidence: '99%',
    status: 'Auto-resolved',
    evidence: 'Exact match',
  },
  {
    source: 'Weekly_planned_hours',
    sheet: 'DS02_TIMESHEET_LOG',
    target: 'dim_resource_allocation.weekly_planned_hours',
    confidence: '86%',
    status: 'Low confidence',
    evidence: 'High null rate',
  },
  {
    source: 'Log_category',
    sheet: 'DS02_TIMESHEET_LOG',
    target: 'dim_timesheet.log_category',
    confidence: '95%',
    status: 'Auto-resolved',
    evidence: 'Exact match',
  },
];

const ACTIVITY_LOG = [
  '09:35 Agent started analysis',
  '09:35 Workbook uploaded',
  '09:36 Workbook structure analyzed',
  '09:37 Coverage check completed',
  '09:38 Generated initial plan',
  '09:39 Detected DB conflict',
  '09:40 Found mapping ambiguity',
];

function planStatusTone(status: PlanStepStatus): string {
  if (status === 'completed') return 'text-success-ink';
  if (status === 'running') return 'text-primary-ink';
  if (status === 'blocked') return 'text-warning-ink';
  return 'text-ink-subtle';
}

function planStatusLabel(status: PlanStepStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'running') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  return 'Pending';
}

function toFlowStepStatus(status: PlanStepStatus): 'completed' | 'current' | 'pending' {
  if (status === 'completed') return 'completed';
  if (status === 'running' || status === 'blocked') return 'current';
  return 'pending';
}

function stepTone(status: 'completed' | 'current' | 'pending'): {
  dot: string;
  text: string;
  label: string;
} {
  if (status === 'completed') {
    return {
      dot: 'border-success bg-success-tint text-success-ink',
      text: 'text-success-ink',
      label: 'Completed',
    };
  }

  if (status === 'current') {
    return {
      dot: 'border-primary bg-primary-tint text-primary-ink',
      text: 'text-primary-ink',
      label: 'In progress',
    };
  }

  return {
    dot: 'border-hairline bg-surface-1 text-ink-subtle',
    text: 'text-ink-subtle',
    label: 'Pending',
  };
}

function caseTone(tone: 'danger' | 'warning' | 'info'): {
  frame: string;
  badge: string;
  primary: 'primary' | 'secondary';
} {
  if (tone === 'danger') {
    return {
      frame: 'border-danger-border bg-danger-tint/40',
      badge: 'bg-danger-tint text-danger-ink',
      primary: 'primary',
    };
  }

  if (tone === 'warning') {
    return {
      frame: 'border-warning-border bg-warning-tint/40',
      badge: 'bg-warning-tint text-warning-ink',
      primary: 'secondary',
    };
  }

  return {
    frame: 'border-primary-border bg-primary-tint/30',
    badge: 'bg-primary-tint text-primary-ink',
    primary: 'secondary',
  };
}

function mappingStatusTone(status: string): string {
  if (status === 'Auto-resolved') return 'bg-success-tint text-success-ink';
  if (status === 'Ambiguity') return 'bg-warning-tint text-warning-ink';
  if (status === 'Low confidence') return 'bg-danger-tint text-danger-ink';
  return 'bg-surface-2 text-ink-subtle';
}

export function PmoIngestionAgenticPage() {
  const [goalText, setGoalText] = useState('Full ingestion');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedSessionId, setUploadedSessionId] = useState<string | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [analyzeResult, setAnalyzeResult] = useState<AnalyzeIngestionPlanResponse | null>(null);
  const [modifyFeedback, setModifyFeedback] = useState('');
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isModifying, setIsModifying] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const normalizedGoalText = goalText.trim().length > 0 ? goalText.trim() : 'Full ingestion';

  const flowSteps: Array<{
    id: number;
    label: string;
    status: 'completed' | 'current' | 'pending';
  }> =
    analyzeResult?.suggested_plan.steps.map((step, index) => ({
      id: index + 1,
      label: step.title,
      status: toFlowStepStatus(step.status),
    })) ?? DEFAULT_FLOW_STEPS;

  function handleWorkbookPicked(file: File | null): void {
    setSelectedFile(file);
    setUploadedSessionId(null);
    setUploadedFileName(file?.name ?? null);
    setAnalyzeResult(null);
    setModifyFeedback('');
    setWorkflowRunId(null);
    setErrorMessage(null);
    setSuccessMessage(
      file ? 'Workbook selected. Click Analyze goal to generate a suggested plan.' : null,
    );
  }

  async function ensureUploadedSession(): Promise<string | null> {
    if (uploadedSessionId) return uploadedSessionId;
    if (!selectedFile) {
      setErrorMessage('Please select an Excel workbook before analyzing the goal.');
      return null;
    }

    setIsUploading(true);
    try {
      const uploaded = await pmoApi.uploadWorkbook(selectedFile);
      setUploadedSessionId(uploaded.ingestion_session_id);
      setUploadedFileName(uploaded.filename ?? selectedFile.name);
      return uploaded.ingestion_session_id;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to upload workbook.');
      return null;
    } finally {
      setIsUploading(false);
    }
  }

  async function handleAnalyzeGoal() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!goalText.trim()) {
      setGoalText('Full ingestion');
    }

    const sessionId = await ensureUploadedSession();
    if (!sessionId) return;

    setIsAnalyzing(true);
    try {
      const result = await pmoApi.analyzeGoalPlan({
        ingestionSessionId: sessionId,
        goalText: normalizedGoalText,
      });
      setAnalyzeResult(result);
      setWorkflowRunId(null);
      setSuccessMessage(
        'Suggested plan generated. Review, modify if needed, then approve to execute.',
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to analyze goal.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleModifyPlan() {
    if (!analyzeResult) {
      setErrorMessage('Analyze goal first to create a plan before modifying.');
      return;
    }

    const feedback = modifyFeedback.trim();
    if (!feedback) {
      setErrorMessage('Please enter plan feedback before clicking Modify plan.');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsModifying(true);
    try {
      const result = await pmoApi.modifyGoalPlan({
        planId: analyzeResult.plan_id,
        feedbackText: feedback,
      });
      setAnalyzeResult(result);
      setModifyFeedback('');
      setSuccessMessage('Plan modified successfully.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to modify plan.');
    } finally {
      setIsModifying(false);
    }
  }

  async function handleApprovePlan() {
    if (!analyzeResult) {
      setErrorMessage('Analyze goal first to generate a plan.');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsApproving(true);
    try {
      const approved = await pmoApi.approveGoalPlan({ planId: analyzeResult.plan_id });
      if (approved.status === 'clarification_required' || !approved.start_payload) {
        setSuccessMessage('Plan needs clarification before execution.');
        return;
      }

      const started = await pmoApi.startIngestWorkflow(approved.start_payload);
      setWorkflowRunId(started.runId);
      setSuccessMessage(`Plan approved and execution started (run ${started.runId.slice(0, 8)}).`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to approve plan.');
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <PageChrome
      breadcrumb={['Work', 'PMO']}
      title="PMO Ingestion"
      subtitle="Goal-driven ingestion workflow"
      actions={
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
          <Button type="button" size="sm" variant="secondary">
            <Download className="size-4" />
            Download report
          </Button>
        </div>
      }
    >
      <div className="min-h-full bg-surface-1 px-4 py-5 pb-8 sm:px-6">
        <div className="mx-auto max-w-[1380px]">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <main className="space-y-4">
              <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-sm">
                <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                  <FileSpreadsheet className="size-4 text-primary-ink" />
                  Current goal
                </div>
                <p className="mt-1 text-caption text-ink-subtle">
                  Upload your workbook and tell us your goal. We&apos;ll analyze it and recommend
                  the best next steps.
                </p>

                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-caption font-semibold text-ink">Workbook file</p>
                    <label
                      htmlFor="pmo-workbook-input"
                      className="mt-1 block w-full cursor-pointer rounded-lg border border-hairline bg-canvas px-3 py-4 text-center text-caption text-ink-subtle hover:bg-surface-1"
                    >
                      {selectedFile
                        ? `Selected: ${selectedFile.name}`
                        : 'Drag and drop your Excel workbook here, or click to browse'}
                    </label>
                    <input
                      id="pmo-workbook-input"
                      type="file"
                      accept=".xlsx,.xlsm"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        handleWorkbookPicked(file);
                      }}
                    />
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      Supports .xlsx files up to 50MB
                    </p>
                    {uploadedFileName && uploadedSessionId ? (
                      <p className="mt-1 text-[11px] text-success-ink">
                        Uploaded as session {uploadedSessionId.slice(0, 8)} for file{' '}
                        {uploadedFileName}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <label htmlFor="goal-input" className="text-caption font-semibold text-ink">
                      Goal
                    </label>
                    <input
                      id="goal-input"
                      type="text"
                      value={goalText}
                      onChange={(event) => setGoalText(event.target.value)}
                      className="mt-1 w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-body-sm text-ink"
                      placeholder="Full ingestion"
                    />
                    <p className="mt-1 text-[11px] text-ink-subtle">
                      If you leave this blank, we will use the default goal: Full ingestion.
                    </p>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={handleAnalyzeGoal}
                      disabled={isUploading || isAnalyzing || isModifying || isApproving}
                    >
                      {isUploading
                        ? 'Uploading workbook...'
                        : isAnalyzing
                          ? 'Analyzing goal...'
                          : 'Analyze goal'}
                    </Button>
                  </div>

                  {errorMessage ? (
                    <div className="rounded-md border border-danger-border bg-danger-tint/40 px-3 py-2 text-caption text-danger-ink">
                      {errorMessage}
                    </div>
                  ) : null}

                  {successMessage ? (
                    <div className="rounded-md border border-success-border bg-success-tint/40 px-3 py-2 text-caption text-success-ink">
                      {successMessage}
                    </div>
                  ) : null}

                  {analyzeResult ? (
                    <div className="rounded-md border border-hairline bg-surface-1 px-3 py-2 text-caption">
                      <p className="font-semibold text-ink">Interpreted goal</p>
                      <p className="mt-1 text-ink">
                        {analyzeResult.interpreted_goal.inferred_goal_text}
                      </p>
                      <div className="mt-2 grid gap-1 text-[11px] text-ink-subtle sm:grid-cols-3">
                        <p>Type: {analyzeResult.interpreted_goal.goal_type}</p>
                        <p>
                          Confidence: {(analyzeResult.interpreted_goal.confidence * 100).toFixed(0)}
                          %
                        </p>
                        <p>Mode: {analyzeResult.suggested_plan.mode}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                  <div>
                    <p className="text-body-sm font-semibold text-ink">Flow steps</p>
                    <p className="text-[11px] text-ink-subtle">
                      Analyze goal creates plan only. Execution starts after plan approval.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleModifyPlan}
                      disabled={!analyzeResult || isModifying || isAnalyzing || isApproving}
                    >
                      {isModifying ? 'Modifying...' : 'Modify plan'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={handleApprovePlan}
                      disabled={!analyzeResult || isAnalyzing || isModifying || isApproving}
                    >
                      {isApproving
                        ? 'Approving...'
                        : analyzeResult?.suggested_plan.requires_approval
                          ? 'Approve plan'
                          : 'Start plan'}
                    </Button>
                  </div>
                </div>

                <div className="mb-3 px-1">
                  <label htmlFor="modify-plan-input" className="text-[11px] font-semibold text-ink">
                    Plan feedback
                  </label>
                  <input
                    id="modify-plan-input"
                    type="text"
                    value={modifyFeedback}
                    onChange={(event) => setModifyFeedback(event.target.value)}
                    placeholder="Example: remove publish and keep only validation preview"
                    className="mt-1 w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-caption text-ink"
                  />
                </div>

                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <ol className="flex min-w-max gap-2">
                    {flowSteps.map((step) => {
                      const tone = stepTone(step.status);

                      return (
                        <li
                          key={step.id}
                          className="w-[180px] shrink-0 rounded-lg border border-hairline bg-surface-1 p-2.5"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={`mt-0.5 flex size-5 items-center justify-center rounded-full border text-[11px] font-semibold ${tone.dot}`}
                            >
                              {step.status === 'completed' ? (
                                <CheckCircle2 className="size-3.5" />
                              ) : (
                                step.id
                              )}
                            </span>
                            <div>
                              <p className="text-caption font-semibold text-ink">{step.label}</p>
                              <p className={`text-[11px] ${tone.text}`}>{tone.label}</p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {workflowRunId ? (
                  <p className="mt-2 px-1 text-[11px] text-success-ink">
                    Workflow execution started with run ID {workflowRunId}.
                  </p>
                ) : null}
              </section>

              <section className="-mx-1 overflow-x-auto px-1 pb-1">
                <div className="flex min-w-max gap-3">
                  <article className="w-[340px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                    <h3 className="text-body-sm font-semibold text-ink">Suggested plan</h3>
                    <p className="mt-1 text-caption text-ink-subtle">
                      {analyzeResult
                        ? `Mode: ${analyzeResult.suggested_plan.mode}`
                        : 'Analyze goal to generate a suggested plan'}
                    </p>

                    {analyzeResult ? (
                      <>
                        <ol className="mt-3 space-y-2">
                          {analyzeResult.suggested_plan.steps.map((step, index) => (
                            <li
                              key={`${step.code}-${step.title}`}
                              className="flex items-center justify-between gap-2 text-caption"
                            >
                              <span className="text-ink">
                                {index + 1}. {step.title}
                              </span>
                              <span className={`font-medium ${planStatusTone(step.status)}`}>
                                {planStatusLabel(step.status)}
                              </span>
                            </li>
                          ))}
                        </ol>

                        {analyzeResult.suggested_plan.risks.length > 0 ? (
                          <div className="mt-3 rounded-lg border border-warning-border bg-warning-tint/40 px-2.5 py-2 text-[11px] text-warning-ink">
                            {analyzeResult.suggested_plan.risks[0]}
                          </div>
                        ) : null}

                        {analyzeResult.interpreted_goal.requires_clarification ? (
                          <div className="mt-3 rounded-lg border border-danger-border bg-danger-tint/40 px-2.5 py-2 text-[11px] text-danger-ink">
                            Clarification required:{' '}
                            {analyzeResult.interpreted_goal.clarification_questions[0]}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-3 text-caption text-ink-subtle">No plan generated yet.</p>
                    )}
                  </article>

                  <article className="w-[340px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                    <h3 className="text-body-sm font-semibold text-ink">Workbook coverage</h3>
                    <p className="mt-1 text-caption text-success-ink">
                      Found ({analyzeResult?.workbook_summary.likely_datasets.length ?? 0})
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(analyzeResult?.workbook_summary.likely_datasets ?? [])
                        .slice(0, 4)
                        .map((dataset) => (
                          <span
                            key={dataset}
                            className="rounded-full bg-success-tint px-2 py-1 text-[11px] text-success-ink"
                          >
                            {dataset}
                          </span>
                        ))}
                    </div>

                    <p className="mt-3 text-caption text-warning-ink">
                      Missing but recommended (
                      {analyzeResult?.workbook_summary.missing_canonical_datasets.length ?? 0})
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(analyzeResult?.workbook_summary.missing_canonical_datasets ?? [])
                        .slice(0, 4)
                        .map((dataset) => (
                          <span
                            key={dataset}
                            className="rounded-full bg-warning-tint px-2 py-1 text-[11px] text-warning-ink"
                          >
                            {dataset}
                          </span>
                        ))}
                    </div>

                    <div className="mt-3 rounded-lg border border-warning-border bg-warning-tint/60 px-2.5 py-2 text-caption text-warning-ink">
                      {analyzeResult
                        ? 'Coverage generated from workbook inspection. Missing datasets may limit downstream analysis.'
                        : 'Analyze goal first to compute workbook coverage.'}
                    </div>

                    <div className="mt-3 flex gap-2">
                      <Button type="button" size="sm" variant="secondary" className="flex-1">
                        Continue with warning
                      </Button>
                      <Button type="button" size="sm" variant="primary" className="flex-1">
                        Upload missing sheets
                      </Button>
                    </div>
                  </article>

                  <article className="w-[340px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                    <h3 className="text-body-sm font-semibold text-ink">Data snapshot</h3>
                    <dl className="mt-3 space-y-2 text-caption">
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Sheets found</dt>
                        <dd className="font-semibold text-ink">
                          {analyzeResult?.workbook_summary.sheet_count ?? 0}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Required sheets</dt>
                        <dd className="font-semibold text-ink">
                          {analyzeResult
                            ? `${analyzeResult.workbook_summary.likely_datasets.length} / ${
                                analyzeResult.workbook_summary.likely_datasets.length +
                                analyzeResult.workbook_summary.missing_canonical_datasets.length
                              }`
                            : '0 / 0'}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Columns detected</dt>
                        <dd className="font-semibold text-ink">
                          {analyzeResult
                            ? analyzeResult.workbook_summary.sheets.reduce(
                                (acc, sheet) => acc + sheet.column_count,
                                0,
                              )
                            : 0}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Rows</dt>
                        <dd className="font-semibold text-ink">
                          {analyzeResult?.workbook_summary.total_rows ?? 0}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Data coverage</dt>
                        <dd className="font-semibold text-ink">
                          {analyzeResult
                            ? `${Math.round(
                                (analyzeResult.workbook_summary.likely_datasets.length /
                                  Math.max(
                                    1,
                                    analyzeResult.workbook_summary.likely_datasets.length +
                                      analyzeResult.workbook_summary.missing_canonical_datasets
                                        .length,
                                  )) *
                                  100,
                              )}%`
                            : '0%'}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Quality score</dt>
                        <dd className="font-semibold text-success-ink">
                          {analyzeResult
                            ? `${Math.max(50, Math.round(analyzeResult.interpreted_goal.confidence * 100))}%`
                            : 'N/A'}
                        </dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      className="mt-3 text-caption font-medium text-primary-ink"
                    >
                      View details
                    </button>
                  </article>
                </div>
              </section>

              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-body-sm font-semibold text-ink">Review cases</h3>
                    <p className="text-caption text-ink-subtle">
                      Agent identified issues that need your review.
                    </p>
                  </div>
                  <span className="rounded-full bg-primary-tint px-2 py-1 text-[11px] font-medium text-primary-ink">
                    3 open cases
                  </span>
                </div>

                <div className="grid gap-3 xl:grid-cols-3">
                  {REVIEW_CASES.map((reviewCase) => {
                    const tone = caseTone(reviewCase.tone);

                    return (
                      <article
                        key={reviewCase.title}
                        className={`rounded-lg border p-3 ${tone.frame}`}
                      >
                        <span
                          className={`rounded-full px-2 py-1 text-[11px] font-medium ${tone.badge}`}
                        >
                          {reviewCase.label}
                        </span>
                        <h4 className="mt-2 text-body-sm font-semibold text-ink">
                          {reviewCase.title}
                        </h4>
                        <ul className="mt-2 space-y-1 text-caption text-ink-subtle">
                          {reviewCase.bullets.map((bullet) => (
                            <li key={bullet}>- {bullet}</li>
                          ))}
                        </ul>
                        <div className="mt-3 flex gap-2">
                          <Button type="button" size="sm" variant={tone.primary} className="flex-1">
                            {reviewCase.primary}
                          </Button>
                          <Button type="button" size="sm" variant="secondary" className="flex-1">
                            {reviewCase.secondary}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-body-sm font-semibold text-ink">
                      Mapping preview (agent suggestions)
                    </h3>
                    <p className="text-caption text-ink-subtle">
                      AI suggested mappings with confidence scores.
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="secondary">
                    Export mappings
                  </Button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-caption">
                    <thead className="border-b border-hairline text-ink-subtle">
                      <tr>
                        <th className="px-2 py-1.5">Source column</th>
                        <th className="px-2 py-1.5">Sheet</th>
                        <th className="px-2 py-1.5">Suggested target</th>
                        <th className="px-2 py-1.5">Confidence</th>
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5">Evidence</th>
                        <th className="px-2 py-1.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MAPPING_PREVIEW_ROWS.map((row) => (
                        <tr
                          key={`${row.sheet}-${row.source}`}
                          className="border-b border-hairline last:border-b-0"
                        >
                          <td className="px-2 py-1.5 font-medium text-ink">{row.source}</td>
                          <td className="px-2 py-1.5 text-ink-subtle">{row.sheet}</td>
                          <td className="px-2 py-1.5 text-primary-ink">{row.target}</td>
                          <td className="px-2 py-1.5 text-ink">{row.confidence}</td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${mappingStatusTone(row.status)}`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-ink-subtle">{row.evidence}</td>
                          <td className="px-2 py-1.5">
                            <Button type="button" size="sm" variant="secondary">
                              View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </main>

            <aside className="space-y-4">
              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-body-sm font-semibold text-ink">Copilot / Investigation</h3>
                  <span className="rounded-full bg-primary-tint px-2 py-0.5 text-[11px] font-medium text-primary-ink">
                    AI
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  <article className="rounded-lg border border-hairline bg-surface-1 p-3">
                    <p className="text-caption font-semibold text-ink">What I found</p>
                    <ul className="mt-2 space-y-1 text-caption text-ink-subtle">
                      <li>- Checked 3 sheets and 87 columns</li>
                      <li>- Found 1 DB conflict (blocking)</li>
                      <li>- Found 1 mapping ambiguity</li>
                      <li>- Missing 2 support sheets</li>
                      <li>- Data coverage is 91%</li>
                    </ul>
                  </article>

                  <article className="rounded-lg border border-warning-border bg-warning-tint/60 p-3">
                    <p className="text-caption font-semibold text-warning-ink">
                      Why I am asking for input
                    </p>
                    <p className="mt-1 text-caption text-warning-ink">
                      I need your decision on the blocking conflict and the Effort mapping to
                      proceed safely.
                    </p>
                  </article>

                  <article className="rounded-lg border border-primary-border bg-primary-tint/30 p-3">
                    <p className="text-caption font-semibold text-primary-ink">
                      Recommended next step
                    </p>
                    <p className="mt-1 text-caption text-primary-ink">
                      Resolve the DB conflict to continue.
                    </p>
                    <Button type="button" size="sm" variant="primary" className="mt-2 w-full">
                      Review blocking issue
                    </Button>
                  </article>

                  <article className="rounded-lg border border-hairline bg-surface-1 p-3">
                    <p className="text-caption font-semibold text-ink">Questions for you (2)</p>
                    <button
                      type="button"
                      className="mt-2 flex w-full items-center justify-between rounded-md border border-hairline bg-canvas px-2 py-2 text-left text-caption text-ink hover:bg-surface-1"
                    >
                      Which mapping should Effort use?
                      <span className="text-ink-subtle">&gt;</span>
                    </button>
                    <button
                      type="button"
                      className="mt-1.5 flex w-full items-center justify-between rounded-md border border-hairline bg-canvas px-2 py-2 text-left text-caption text-ink hover:bg-surface-1"
                    >
                      Continue without Leave Records sheet?
                      <span className="text-ink-subtle">&gt;</span>
                    </button>
                  </article>

                  <article className="rounded-lg border border-hairline bg-surface-1 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-caption font-semibold text-ink">Activity log</p>
                      <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-ink">
                        Live
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 text-caption text-ink-subtle">
                      {ACTIVITY_LOG.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="mt-2 text-caption font-medium text-primary-ink"
                    >
                      View full activity log
                    </button>
                  </article>
                </div>
              </section>

              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                  <ShieldAlert className="size-4 text-primary-ink" />
                  Agent mode
                  <span className="rounded-full bg-success-tint px-2 py-0.5 text-[11px] font-medium text-success-ink">
                    On
                  </span>
                </div>
                <p className="mt-2 text-caption text-ink-subtle">
                  Autonomous analysis and smart recommendations are active for this workspace.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </PageChrome>
  );
}
