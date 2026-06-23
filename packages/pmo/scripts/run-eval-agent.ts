/**
 * Agent E2E eval harness scaffold for PMO eval prompts.
 *
 * Usage:
 *   pnpm pmo:eval:agent
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAgentEvalPlan } from '../src/backend/eval/agent-harness.ts';

async function main() {
  const payload = buildAgentEvalPlan();
  const reportsDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = payload.runAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(reportsDir, `eval-agent-${stamp}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${jsonPath} (${payload.taskCount} tasks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
