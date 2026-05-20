import * as React from 'react';
import { cn } from '../lib/cn';

export interface ChatToolCallProps {
  name: string;
  status: 'running' | 'ok' | 'error';
  summary?: string;
  duration?: string;
  payload?: unknown;
  className?: string;
}

const STATUS_DOT: Record<ChatToolCallProps['status'], string> = {
  running: 'bg-primary',
  ok: 'bg-semantic-success',
  error: 'bg-destructive',
};

export function ChatToolCall({
  name,
  status,
  summary,
  duration,
  payload,
  className,
}: ChatToolCallProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn('ml-9 flex', className)} data-status={status}>
      <button
        type="button"
        onClick={() => payload != null && setOpen((v) => !v)}
        className="inline-flex items-center gap-2.5 rounded-md border border-hairline bg-surface-2 px-2.5 py-1.5 text-caption text-ink-muted hover:bg-surface-3"
      >
        <span className={cn('inline-block size-1.5 rounded-full', STATUS_DOT[status])} />
        <span className="font-mono text-body-sm text-ink">{name}</span>
        {summary && (
          <>
            <span className="text-ink-subtle">·</span>
            <span>{summary}</span>
          </>
        )}
        {duration && (
          <>
            <span className="text-ink-subtle">·</span>
            <span className="font-mono">{duration}</span>
          </>
        )}
      </button>
      {open && payload != null && (
        <pre className="ml-3 max-w-md overflow-auto rounded-md border border-hairline-tertiary bg-surface-1 p-2 text-caption">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
