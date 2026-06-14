import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { SessionEnv } from '@seta/core';
import { buildTenantKey, presignedUploadUrl } from '@seta/shared-storage';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  AnalyzeIngestionPlanRequestSchema,
  ApproveIngestionPlanRequestSchema,
  ModifyIngestionPlanRequestSchema,
} from '../../contracts.ts';
import {
  analyzeIngestionPlan,
  approveIngestionPlan,
  modifyIngestionPlan,
  PmoPlanServiceError,
} from '../agentic/planning-service.ts';
import { pmoDb } from '../db/client.ts';
import { ingestionSessions } from '../db/schema.ts';

// ── Types ────────────────────────────────────────────────────────────────────

const UploadRequestSchema = z.object({
  filename: z.string().min(1),
  mime_type: z
    .string()
    .default('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  reporting_period_key: z.string().optional(),
});

// ── Routes ───────────────────────────────────────────────────────────────────

export function buildPmoRoutes(): Hono<SessionEnv> {
  const app = new Hono<SessionEnv>();

  function handlePlanError(err: unknown): { status: number; body: Record<string, unknown> } {
    if (err instanceof PmoPlanServiceError) {
      return {
        status: err.status,
        body: { error: err.code, message: err.message },
      };
    }

    return {
      status: 500,
      body: {
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'Unexpected error',
      },
    };
  }

  // POST /api/pmo/v1/upload-url
  // Returns a presigned S3 URL for the client to upload the Excel file,
  // plus an ingestion_session_id to track the upload.
  app.post('/api/pmo/v1/upload-url', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = UploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    }

    const { filename, mime_type, reporting_period_key } = parsed.data;
    const sessionId = crypto.randomUUID();

    // Build S3 key
    const s3Key = buildTenantKey({
      tenant_id: session.tenant_id,
      domain: 'pmo',
      file_id: sessionId,
      filename,
    });

    // Insert ingestion session
    const db = pmoDb();
    await db.insert(ingestionSessions).values({
      id: sessionId,
      tenant_id: session.tenant_id,
      status: 'uploaded',
      source_file_key: s3Key,
      source_file_name: filename,
      mime_type,
      reporting_period_key: reporting_period_key ?? null,
      created_by: session.user_id,
    });

    // Generate presigned upload URL
    const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
    const upload_url = await presignedUploadUrl({
      bucket,
      key: s3Key,
      contentType: mime_type,
      expiresInSeconds: 15 * 60,
    });

    return c.json({
      ingestion_session_id: sessionId,
      upload_url,
      s3_key: s3Key,
      filename,
    });
  });

  // POST /api/pmo/v1/upload-complete
  // Called after client uploads file to S3. Returns canonical payload to start
  // pmo.ingestData via /api/agent/v1/workflows/runs/pmo.ingestData/start.
  app.post('/api/pmo/v1/upload-complete', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { ingestion_session_id } = body as { ingestion_session_id?: string };

    if (!ingestion_session_id) {
      return c.json({ error: 'ingestion_session_id required' }, 400);
    }

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
          eq(ingestionSessions.id, ingestion_session_id),
          eq(ingestionSessions.tenant_id, session.tenant_id),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'not_found', message: 'ingestion session not found' }, 404);
    }

    return c.json({
      status: 'uploaded',
      ingestion_session_id: row.id,
      file_key: row.source_file_key,
      reporting_period_key: row.reporting_period_key,
      start_payload: {
        ingestionSessionId: row.id,
        fileKey: row.source_file_key,
        reportingPeriodKey: row.reporting_period_key ?? undefined,
      },
      message:
        'Upload recorded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
    });
  });

  // POST /api/pmo/v1/upload
  // Proxy upload: client sends file as multipart, server uploads to S3.
  // Bypasses CORS issues with direct-to-S3 presigned URLs.
  app.post('/api/pmo/v1/upload', async (c) => {
    try {
      const session = c.get('user');
      const body = await c.req.parseBody();
      const file = body.file;

      if (!file || !(file instanceof File)) {
        return c.json({ error: 'file field required (multipart)' }, 400);
      }

      const filename = file.name || 'upload.xlsx';
      const reportingPeriodKey = (body.reporting_period_key as string) || undefined;
      const sessionId = crypto.randomUUID();
      const mime_type =
        file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      // Build S3 key
      const s3Key = buildTenantKey({
        tenant_id: session.tenant_id,
        domain: 'pmo',
        file_id: sessionId,
        filename,
      });

      // Upload to S3
      const bucket = process.env.S3_BUCKET ?? 'hackathon-team-2-assets-033484686020';
      const region = process.env.S3_REGION ?? 'ap-southeast-1';
      const s3 = new S3Client({ region });
      const buffer = Buffer.from(await file.arrayBuffer());
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: buffer,
          ContentType: mime_type,
        }),
      );

      // Insert ingestion session
      const db = pmoDb();
      await db.insert(ingestionSessions).values({
        id: sessionId,
        tenant_id: session.tenant_id,
        status: 'uploaded',
        source_file_key: s3Key,
        source_file_name: filename,
        mime_type,
        reporting_period_key: reportingPeriodKey ?? null,
        created_by: session.user_id,
      });

      return c.json({
        ingestion_session_id: sessionId,
        s3_key: s3Key,
        status: 'uploaded',
        start_payload: {
          ingestionSessionId: sessionId,
          fileKey: s3Key,
          reportingPeriodKey: reportingPeriodKey,
        },
        message:
          'File uploaded. Start workflow via /api/agent/v1/workflows/runs/pmo.ingestData/start.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[pmo/upload] error:', message, err);
      return c.json({ error: 'upload_failed', message }, 500);
    }
  });

  // POST /api/pmo/v1/ingestion/plans/analyze
  // Parse goal + inspect workbook lightly + produce suggested plan (no execution).
  app.post('/api/pmo/v1/ingestion/plans/analyze', async (c) => {
    const session = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = AnalyzeIngestionPlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    try {
      const result = await analyzeIngestionPlan({
        ingestionSessionId: parsed.data.ingestion_session_id,
        goalText: parsed.data.goal_text,
        tenantId: session.tenant_id,
        userId: session.user_id,
      });
      return c.json(result);
    } catch (err) {
      const handled = handlePlanError(err);
      c.status(handled.status as 400 | 404 | 500);
      return c.json(handled.body);
    }
  });

  // POST /api/pmo/v1/ingestion/plans/:planId/modify
  // Revise interpreted goal and regenerate deterministic suggested plan.
  app.post('/api/pmo/v1/ingestion/plans/:planId/modify', async (c) => {
    const session = c.get('user');
    const planId = c.req.param('planId');
    if (!z.string().uuid().safeParse(planId).success) {
      return c.json({ error: 'invalid_request', message: 'planId must be UUID' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = ModifyIngestionPlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    try {
      const result = await modifyIngestionPlan({
        planId,
        feedbackText: parsed.data.feedback_text,
        tenantId: session.tenant_id,
        userId: session.user_id,
      });
      return c.json(result);
    } catch (err) {
      const handled = handlePlanError(err);
      c.status(handled.status as 400 | 404 | 500);
      return c.json(handled.body);
    }
  });

  // POST /api/pmo/v1/ingestion/plans/:planId/approve
  // Gate execution start: returns canonical start_payload only after approval.
  app.post('/api/pmo/v1/ingestion/plans/:planId/approve', async (c) => {
    const session = c.get('user');
    const planId = c.req.param('planId');
    if (!z.string().uuid().safeParse(planId).success) {
      return c.json({ error: 'invalid_request', message: 'planId must be UUID' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = ApproveIngestionPlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', details: parsed.error.issues }, 400);
    }

    try {
      const result = await approveIngestionPlan({
        planId,
        tenantId: session.tenant_id,
        userId: session.user_id,
      });
      return c.json(result);
    } catch (err) {
      const handled = handlePlanError(err);
      c.status(handled.status as 400 | 404 | 500);
      return c.json(handled.body);
    }
  });

  return app;
}
