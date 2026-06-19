import type { SessionEnv, SessionScope } from '@seta/core';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import { buildPmoRoutes } from '../../src/backend/http/routes.ts';

const s3Mock = vi.hoisted(() => ({
  send: vi.fn(async () => ({})),
}));

vi.mock('@seta/shared-storage', async () => {
  const actual =
    await vi.importActual<typeof import('@seta/shared-storage')>('@seta/shared-storage');
  return {
    ...actual,
    getS3Client: () => s3Mock,
  };
});

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const threadId = '33333333-3333-4333-8333-333333333333';

function buildSession(): SessionScope {
  return {
    session_id: crypto.randomUUID(),
    user_id: userId,
    tenant_id: tenantId,
    email: 'pmo@example.test',
    display_name: 'PMO User',
    role_summary: { roles: ['pmo.operator'], cross_tenant_read: false },
    role_summary_hash: 'test',
    permissions: new Set(['pmo.ingestion.upload']),
    accessible_group_ids: [],
    cross_tenant_read: false,
    built_at: new Date(),
    invalidated_at: null,
  };
}

function buildTestApp(): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();
  app.use('*', async (c, next) => {
    c.set('user', buildSession());
    await next();
  });
  app.route('/', buildPmoRoutes());
  return app;
}

beforeEach(() => {
  s3Mock.send.mockClear();
  process.env.S3_BUCKET = 'test-pmo-bucket';
});

afterEach(() => {
  delete process.env.S3_BUCKET;
});

describe('POST /api/pmo/v1/upload', () => {
  it('uploads the workbook through the server and records a chat-scoped ingestion session', async () => {
    await withTestDb(dbCfg(), async ({ pool, databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const form = new FormData();
        form.set(
          'file',
          new File(['workbook bytes'], 'book.xlsx', {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        );
        form.set('reporting_period_key', '2026-W25');
        form.set('chat_thread_id', threadId);

        const res = await buildTestApp().request('/api/pmo/v1/upload', {
          method: 'POST',
          body: form,
        });

        expect(res.status).toBe(200);
        expect(s3Mock.send).toHaveBeenCalledOnce();
        const body = (await res.json()) as {
          ingestion_session_id: string;
          s3_key: string;
          status: string;
          filename: string;
          file_size_bytes: number;
        };
        expect(body).toMatchObject({
          status: 'uploaded',
          filename: 'book.xlsx',
          file_size_bytes: 14,
        });
        expect(body.s3_key).toContain(`tenants/${tenantId}/pmo/`);

        const rows = await pool.query<{
          tenant_id: string;
          status: string;
          source_file_key: string;
          source_file_name: string;
          source_file_size_bytes: number;
          reporting_period_key: string;
          chat_thread_id: string;
        }>(
          `SELECT tenant_id, status, source_file_key, source_file_name, source_file_size_bytes,
                  reporting_period_key, chat_thread_id
             FROM pmo.ingestion_sessions
            WHERE id = $1`,
          [body.ingestion_session_id],
        );
        expect(rows.rows[0]).toMatchObject({
          tenant_id: tenantId,
          status: 'uploaded',
          source_file_key: body.s3_key,
          source_file_name: 'book.xlsx',
          source_file_size_bytes: 14,
          reporting_period_key: '2026-W25',
          chat_thread_id: threadId,
        });
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });

  it('rejects malformed chat thread ids before uploading to S3', async () => {
    await withTestDb(dbCfg(), async ({ databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const form = new FormData();
        form.set('file', new File(['workbook bytes'], 'book.xlsx'));
        form.set('chat_thread_id', 'not-a-uuid');

        const res = await buildTestApp().request('/api/pmo/v1/upload', {
          method: 'POST',
          body: form,
        });

        expect(res.status).toBe(400);
        expect(s3Mock.send).not.toHaveBeenCalled();
      } finally {
        resetPmoDb();
        await closePools();
      }
    });
  });
});
