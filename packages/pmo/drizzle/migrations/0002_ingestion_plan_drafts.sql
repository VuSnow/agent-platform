-- Limitation: hand-written migration because this agent session cannot run drizzle-kit generate safely.
CREATE TABLE IF NOT EXISTS pmo.ingestion_plan_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingestion_session_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  memory_json jsonb NOT NULL,
  created_by uuid NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE INDEX IF NOT EXISTS ingestion_plan_drafts_tenant_session
  ON pmo.ingestion_plan_drafts (tenant_id, ingestion_session_id);

CREATE INDEX IF NOT EXISTS ingestion_plan_drafts_tenant_status
  ON pmo.ingestion_plan_drafts (tenant_id, status);
