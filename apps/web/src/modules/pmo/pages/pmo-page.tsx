import { Button, Dropzone, Input, Label, PageChrome, toast } from '@seta/shared-ui';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, Loader2, MoveUpRight, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useStartPmoIngest } from '../hooks/use-start-pmo-ingest';

const ACCEPT = '.xlsx,.xlsm';
const MAX_BYTES = 50 * 1024 * 1024;

export function PmoPage() {
  const navigate = useNavigate();
  const [reportingPeriodKey, setReportingPeriodKey] = useState('');
  const startIngest = useStartPmoIngest();

  const uploadError =
    startIngest.isError && startIngest.error
      ? startIngest.error instanceof Error
        ? startIngest.error.message
        : String(startIngest.error)
      : null;

  function onFile(file: File) {
    const period = reportingPeriodKey.trim();
    startIngest.mutate(
      {
        file,
        reportingPeriodKey: period.length > 0 ? period : undefined,
      },
      {
        onSuccess: (out) => {
          toast.success('PMO workflow started', {
            description: 'Review mapping and publish decisions in the workflow run page.',
          });
          void navigate({
            to: '/agent/workflows/runs/$runId',
            params: { runId: out.runId },
            search: {},
          });
        },
        onError: (err) => {
          toast.error("Couldn't start PMO workflow", {
            description: err instanceof Error ? err.message : String(err),
          });
        },
      },
    );
  }

  return (
    <PageChrome
      breadcrumb={['Work']}
      title="PMO Ingestion"
      subtitle="Upload workbook and trigger staged review workflow"
    >
      <div className="min-h-full bg-surface-1 px-4 py-6 pb-10 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <section className="rounded-lg border border-hairline bg-canvas p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 rounded-md bg-primary-tint p-2 text-primary">
                <Workflow className="size-5" />
              </span>
              <div>
                <h2 className="text-body-sm font-semibold text-ink">Workflow path</h2>
                <p className="mt-1 text-body-sm text-ink-subtle">
                  Upload workbook, confirm inferred table mappings, review staged changes, then
                  publish.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="reporting-period-key">Reporting period key (optional)</Label>
            <Input
              id="reporting-period-key"
              value={reportingPeriodKey}
              onChange={(e) => setReportingPeriodKey(e.target.value)}
              placeholder="e.g. 2025-W35"
              disabled={startIngest.isPending}
            />
          </section>

          <Dropzone
            accept={ACCEPT}
            maxBytes={MAX_BYTES}
            label="Drop PMO workbook here, or click to choose"
            hint="XLSX / XLSM · up to 50 MB"
            pendingLabel="Uploading and starting workflow…"
            tooLargeMessage="That file is over 50 MB. Try a smaller workbook."
            isPending={startIngest.isPending}
            error={uploadError}
            onFile={onFile}
          />

          {startIngest.isPending ? (
            <div className="flex items-center gap-2 text-body-sm text-ink-subtle">
              <Loader2 className="size-4 animate-spin" />
              Creating ingestion session and starting PMO workflow…
            </div>
          ) : null}

          {startIngest.data ? (
            <section className="rounded-lg border border-primary-border bg-primary-tint p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-body-sm font-medium text-primary-ink">
                    Workflow run ready: {startIngest.data.runId.slice(0, 8)}
                  </p>
                  <p className="text-caption text-primary-ink/80">
                    Session {startIngest.data.ingestionSessionId.slice(0, 8)} started.
                  </p>
                </div>
                <Link
                  to="/agent/workflows/runs/$runId"
                  params={{ runId: startIngest.data.runId }}
                  search={{}}
                >
                  <Button size="sm" variant="secondary" type="button">
                    <FileSpreadsheet className="size-4" />
                    Open run
                    <MoveUpRight className="size-3" />
                  </Button>
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </PageChrome>
  );
}
