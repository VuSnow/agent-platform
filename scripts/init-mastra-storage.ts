#!/usr/bin/env -S pnpm -F @seta/cli exec tsx
/**
 * One-shot: create Mastra memory/workflow tables in agent.* when missing.
 * Normally runs automatically on server boot; use after db:reset if chat hangs.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentMastraStorage, initAgentMastraStorage } from '@seta/agent/register';
import { closePools, getPool, initPools } from '@seta/shared-db';

async function main(): Promise<void> {
  try {
    process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), '../.env'));
  } catch {
    // optional
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  initPools({ databaseUrl });
  const storage = createAgentMastraStorage({ pool: getPool('worker') });
  await initAgentMastraStorage(storage);

  const tables = await getPool('worker').query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'agent' ORDER BY tablename`,
  );
  console.log(
    JSON.stringify({
      ok: true,
      tables: tables.rows.map((r) => r.tablename),
    }),
  );
  await closePools();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
