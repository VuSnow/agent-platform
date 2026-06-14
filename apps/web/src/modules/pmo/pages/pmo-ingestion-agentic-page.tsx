import { Button, PageChrome } from '@seta/shared-ui';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

const QUICK_GOALS = [
  'Full ingestion',
  'Validate only',
  'Check missing sheets',
  'Mapping review only',
];

const FLOW_STEPS: Array<{
  id: number;
  label: string;
  status: 'completed' | 'current' | 'pending';
}> = [
  { id: 1, label: 'Understand workbook', status: 'completed' },
  { id: 2, label: 'Check coverage', status: 'completed' },
  { id: 3, label: 'Resolve ambiguities', status: 'current' },
  { id: 4, label: 'Validate data', status: 'pending' },
  { id: 5, label: 'Review DB changes', status: 'pending' },
  { id: 6, label: 'Publish recommendation', status: 'pending' },
];

const SUGGESTED_PLAN: Array<{ step: string; status: 'Completed' | 'In progress' | 'Pending' }> = [
  { step: 'Inspect workbook', status: 'Completed' },
  { step: 'Detect required and missing sheets', status: 'Completed' },
  { step: 'Propose mappings', status: 'In progress' },
  { step: 'Validate staging data', status: 'Pending' },
  { step: 'Review DB changes', status: 'Pending' },
  { step: 'Recommend publish', status: 'Pending' },
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

function statusTone(status: 'Completed' | 'In progress' | 'Pending'): string {
  if (status === 'Completed') return 'text-success-ink';
  if (status === 'In progress') return 'text-primary-ink';
  return 'text-ink-subtle';
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
              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <div className="flex min-w-max gap-3 xl:min-w-0 xl:grid xl:grid-cols-12">
                    <article className="w-[360px] shrink-0 rounded-lg border border-hairline bg-surface-1 p-3 xl:col-span-5 xl:w-auto xl:shrink">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                        <FileSpreadsheet className="size-4 text-primary-ink" />
                        Current goal
                      </div>
                      <p className="mt-1 text-caption text-ink-subtle">
                        PMO_02_RA_Timesheet_Monitoring.xlsx
                      </p>
                      <p className="text-caption text-ink-subtle">
                        Uploaded 14/06/2026, 09:32 • 2.1 MB
                      </p>
                      <div className="mt-2 rounded-lg border border-hairline bg-canvas px-3 py-2 text-body-sm text-ink">
                        Ingest this workbook for 2025-W35 and prepare data for RA calculation.
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {QUICK_GOALS.map((goal) => (
                          <span
                            key={goal}
                            className="rounded-full border border-hairline bg-canvas px-2 py-1 text-[11px] font-medium text-ink-subtle"
                          >
                            {goal}
                          </span>
                        ))}
                      </div>
                    </article>

                    <article className="w-[300px] shrink-0 rounded-lg border border-hairline bg-surface-1 p-3 xl:col-span-3 xl:w-auto xl:shrink">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                        <Bot className="size-4 text-primary-ink" />
                        Agent status
                      </div>
                      <p className="mt-1 text-body-sm font-semibold text-success-ink">Analyzing</p>
                      <p className="mt-1 text-caption text-ink-subtle">
                        Inspecting workbook structure, checking data coverage, and creating a plan.
                      </p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full w-[55%] rounded-full bg-primary" />
                      </div>
                      <p className="mt-1 text-[11px] text-ink-subtle">Progress 55%</p>
                      <button
                        type="button"
                        className="mt-2 text-caption font-medium text-primary-ink"
                      >
                        View agent reasoning
                      </button>
                    </article>

                    <article className="w-[280px] shrink-0 rounded-lg border border-hairline bg-surface-1 p-3 xl:col-span-2 xl:w-auto xl:shrink">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                        <AlertTriangle className="size-4 text-warning-ink" />
                        Next best action
                      </div>
                      <p className="mt-1 text-body-sm font-semibold text-danger-ink">
                        Review 1 blocking issue
                      </p>
                      <p className="mt-1 text-caption text-ink-subtle">
                        A DB conflict must be resolved before we can generate publish
                        recommendation.
                      </p>
                      <Button type="button" size="sm" variant="secondary" className="mt-3 w-full">
                        Review blocking issue
                      </Button>
                    </article>

                    <article className="w-[280px] shrink-0 rounded-lg border border-hairline bg-surface-1 p-3 xl:col-span-2 xl:w-auto xl:shrink">
                      <div className="flex items-center gap-2 text-body-sm font-semibold text-ink">
                        <Sparkles className="size-4 text-success-ink" />
                        Overall readiness
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="relative size-16 rounded-full bg-[conic-gradient(#10b981_0_280deg,#e5e7eb_280deg_360deg)]">
                          <div className="absolute inset-2 grid place-items-center rounded-full bg-canvas">
                            <span className="text-caption font-semibold text-ink">78%</span>
                          </div>
                        </div>
                        <div className="space-y-1 text-[11px]">
                          <p className="text-success-ink">Auto-resolved: 14</p>
                          <p className="text-warning-ink">Needs input: 6</p>
                          <p className="text-danger-ink">Blocking: 1</p>
                          <p className="text-ink">Ready to publish: 9</p>
                        </div>
                      </div>
                    </article>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-hairline bg-canvas p-3 shadow-sm">
                <div className="-mx-1 overflow-x-auto px-1 pb-1">
                  <ol className="flex min-w-max gap-2">
                    {FLOW_STEPS.map((step) => {
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
              </section>

              <section className="-mx-1 overflow-x-auto px-1 pb-1">
                <div className="flex min-w-max gap-3 xl:min-w-0 xl:grid xl:grid-cols-3">
                  <article className="w-[320px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm xl:w-auto xl:shrink">
                    <h3 className="text-body-sm font-semibold text-ink">Suggested plan</h3>
                    <p className="mt-1 text-caption text-ink-subtle">AI generated</p>
                    <ol className="mt-3 space-y-2">
                      {SUGGESTED_PLAN.map((item, index) => (
                        <li
                          key={item.step}
                          className="flex items-center justify-between gap-2 text-caption"
                        >
                          <span className="text-ink">
                            {index + 1}. {item.step}
                          </span>
                          <span className={`font-medium ${statusTone(item.status)}`}>
                            {item.status}
                          </span>
                        </li>
                      ))}
                    </ol>
                    <button
                      type="button"
                      className="mt-3 text-caption font-medium text-primary-ink"
                    >
                      View detailed plan
                    </button>
                  </article>

                  <article className="w-[320px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm xl:w-auto xl:shrink">
                    <h3 className="text-body-sm font-semibold text-ink">Workbook coverage</h3>
                    <p className="mt-1 text-caption text-success-ink">Found (3)</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-success-tint px-2 py-1 text-[11px] text-success-ink">
                        Resource Allocation
                      </span>
                      <span className="rounded-full bg-success-tint px-2 py-1 text-[11px] text-success-ink">
                        Timesheet
                      </span>
                      <span className="rounded-full bg-success-tint px-2 py-1 text-[11px] text-success-ink">
                        Rules Config
                      </span>
                    </div>

                    <p className="mt-3 text-caption text-warning-ink">
                      Missing but recommended (2)
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-warning-tint px-2 py-1 text-[11px] text-warning-ink">
                        Leave Records
                      </span>
                      <span className="rounded-full bg-warning-tint px-2 py-1 text-[11px] text-warning-ink">
                        Holiday Calendar
                      </span>
                    </div>

                    <div className="mt-3 rounded-lg border border-warning-border bg-warning-tint/60 px-2.5 py-2 text-caption text-warning-ink">
                      Dataset can be ingested, but exception-aware analysis may be limited.
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

                  <article className="w-[320px] shrink-0 rounded-xl border border-hairline bg-canvas p-3 shadow-sm xl:w-auto xl:shrink">
                    <h3 className="text-body-sm font-semibold text-ink">Data snapshot</h3>
                    <dl className="mt-3 space-y-2 text-caption">
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Sheets found</dt>
                        <dd className="font-semibold text-ink">3</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Required sheets</dt>
                        <dd className="font-semibold text-ink">3 / 5</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Columns detected</dt>
                        <dd className="font-semibold text-ink">87</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Rows</dt>
                        <dd className="font-semibold text-ink">125,430</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Data coverage</dt>
                        <dd className="font-semibold text-ink">91%</dd>
                      </div>
                      <div className="flex items-center justify-between">
                        <dt className="text-ink-subtle">Quality score</dt>
                        <dd className="font-semibold text-success-ink">86%</dd>
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
