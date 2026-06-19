import { afterEach, describe, expect, it, vi } from 'vitest';
import { pmoApi } from '@/modules/pmo/api/client';

interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

afterEach(() => vi.restoreAllMocks());

describe('pmoApi', () => {
  it('uploadWorkbook posts multipart to the server-side upload endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const progress: number[] = [];
    const sent: { url?: string; body?: FormData; withCredentials?: boolean } = {};

    class FakeXHR {
      upload: { onprogress?: (e: ProgressEventLike) => void } = {};
      status = 0;
      responseText = '';
      withCredentials = false;
      onload: (() => void) | undefined = undefined;
      onerror: (() => void) | undefined = undefined;

      open(method: string, url: string) {
        expect(method).toBe('POST');
        sent.url = url;
      }

      send(body: FormData) {
        sent.body = body;
        sent.withCredentials = this.withCredentials;
        this.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 4 });
        this.status = 200;
        this.responseText = JSON.stringify({
          ingestion_session_id: 'session-1',
          s3_key: 'tenant/pmo/session-1/book.xlsx',
          status: 'uploaded',
        });
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);

    const file = new File(['workbook'], 'book.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const out = await pmoApi.uploadWorkbook(
      file,
      {
        reportingPeriodKey: '2026-W25',
        chatThreadId: '11111111-1111-4111-8111-111111111111',
      },
      (p) => progress.push(p),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent.url).toBe('/api/pmo/v1/upload');
    expect(sent.withCredentials).toBe(true);
    expect(sent.body?.get('file')).toBe(file);
    expect(sent.body?.get('reporting_period_key')).toBe('2026-W25');
    expect(sent.body?.get('chat_thread_id')).toBe('11111111-1111-4111-8111-111111111111');
    expect(progress).toEqual([0.5]);
    expect(out).toMatchObject({
      ingestion_session_id: 'session-1',
      s3_key: 'tenant/pmo/session-1/book.xlsx',
      status: 'uploaded',
      filename: 'book.xlsx',
      file_size_bytes: file.size,
    });
  });
});
