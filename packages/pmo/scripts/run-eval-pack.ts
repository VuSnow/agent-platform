/**
 * Run PMO eval pack (8 workbooks) through the deterministic pipeline and write reports.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm pmo:eval
 *   DATABASE_URL=postgres://... pnpm pmo:eval -- --case 01_baseline
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closePools, initPools } from '@seta/shared-db';
import { resetPmoDb } from '../src/backend/db/client.ts';
import {
  evaluateAnswerKeyCase,
  formatEvalPackMarkdown,
  loadAnswerKeyCases,
  loadEvalWorkbookBuffer,
  summarizeEvalPack,
} from '../src/backend/eval/index.ts';

function parseCaseFilter(argv: string[]): string | null {
  const index = argv.indexOf('--case');
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run PMO eval pack');
  }

  const caseFilter = parseCaseFilter(process.argv.slice(2));
  const cases = loadAnswerKeyCases().filter((item) =>
    caseFilter ? item.caseId === caseFilter : true,
  );
  if (cases.length === 0) {
    throw new Error(caseFilter ? `Unknown eval case: ${caseFilter}` : 'No eval cases found');
  }

  resetPmoDb();
  initPools({ databaseUrl });

  const results = [];
  try {
    for (const evalCase of cases) {
      const tenantId = crypto.randomUUID();
      const ingestionSessionId = crypto.randomUUID();
      const workbookBuffer = loadEvalWorkbookBuffer(evalCase.workbook);
      console.log(`Evaluating ${evalCase.caseId} (${evalCase.workbook})...`);
      const result = await evaluateAnswerKeyCase({
        evalCase,
        workbookBuffer,
        tenantId,
        ingestionSessionId,
      });
      results.push(result);
      console.log(
        `  schema=${result.schema.pass ? 'pass' : 'fail'} findings_f1=${result.findings.f1.toFixed(3)} total_ms=${result.totalDurationMs}`,
      );
    }
  } finally {
    await closePools();
  }

  const summary = summarizeEvalPack(results);
  const reportsDir = resolve(import.meta.dirname, '../reports');
  mkdirSync(reportsDir, { recursive: true });
  const stamp = summary.runAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(reportsDir, `eval-pack-${stamp}.json`);
  const mdPath = resolve(reportsDir, `eval-pack-${stamp}.md`);
  const baselinePath = resolve(reportsDir, 'eval-pack-baseline.json');

  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(mdPath, formatEvalPackMarkdown(summary));
  const baselinePayload = {
    runAt: summary.runAt,
    caseCount: summary.caseCount,
    schemaPassRate: summary.schemaPassRate,
    findingsPrecision: summary.findingsPrecision,
    findingsRecall: summary.findingsRecall,
    findingsF1: summary.findingsF1,
    recommendationHitRate: summary.recommendationHitRate,
    stageLatency: summary.stageLatency,
    totalPipelineP50Ms: summary.totalPipelineP50Ms,
    totalPipelineP95Ms: summary.totalPipelineP95Ms,
  };
  writeFileSync(baselinePath, `${JSON.stringify(baselinePayload, null, 2)}\n`);

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Updated baseline ${baselinePath}`);
  console.log(
    `Summary: schema=${(summary.schemaPassRate * 100).toFixed(1)}% findings_f1=${summary.findingsF1.toFixed(3)} recommend_hit=${(summary.recommendationHitRate * 100).toFixed(1)}%`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
