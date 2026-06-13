import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, ...rest }: React.PropsWithChildren<Record<string, unknown>>) => {
    const allowed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) {
      if (k === 'params' || k === 'to' || k === 'search') continue;
      allowed[k] = v;
    }
    return <a {...allowed}>{children}</a>;
  },
}));

import { PmoPage } from '@/modules/pmo/pages/pmo-page';

function withQuery(children: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function dropFile(file: File) {
  const dropzone = screen.getByRole('button', { name: /drop pmo workbook here/i });
  const dropEvent = new DragEvent('drop', { bubbles: true });
  Object.defineProperty(dropEvent, 'dataTransfer', {
    value: { files: [file], items: [], types: [] },
  });
  dropzone.dispatchEvent(dropEvent);
}

describe('PmoPage', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uploads workbook, starts pmo.ingestData workflow, then navigates to run page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockJsonResponse({
          ingestion_session_id: '11111111-1111-4111-8111-111111111111',
          s3_key: 'tenant/pmo/session/workbook.xlsx',
          status: 'uploaded',
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          runId: 'run-123',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    fireEvent.change(screen.getByLabelText(/reporting period key/i), {
      target: { value: '2026-W24' },
    });

    const file = new File(['sheet-data'], 'workbook.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    dropFile(file);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const uploadCall = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(uploadCall[0]).toBe('/api/pmo/v1/upload');
    expect(uploadCall[1]?.method).toBe('POST');
    const uploadBody = uploadCall[1]?.body as FormData;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect(uploadBody.get('reporting_period_key')).toBe('2026-W24');
    const sentFile = uploadBody.get('file');
    expect(sentFile).toBeInstanceOf(File);
    expect((sentFile as File).name).toBe('workbook.xlsx');

    const startCall = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
    expect(startCall[0]).toBe('/api/agent/v1/workflows/runs/pmo.ingestData/start');
    expect(startCall[1]?.method).toBe('POST');
    expect(startCall[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(startCall[1]?.body))).toEqual({
      ingestionSessionId: '11111111-1111-4111-8111-111111111111',
      fileKey: 'tenant/pmo/session/workbook.xlsx',
      reportingPeriodKey: '2026-W24',
    });

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({
        to: '/agent/workflows/runs/$runId',
        params: { runId: 'run-123' },
        search: {},
      });
    });
  });

  it('does not start workflow when upload fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'upload_failed' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(withQuery(<PmoPage />));

    const file = new File(['sheet-data'], 'workbook.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    dropFile(file);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('/api/pmo/v1/upload');
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
