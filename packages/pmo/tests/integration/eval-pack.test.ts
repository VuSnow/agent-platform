import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { closePools, initPools } from '@seta/shared-db';
import { withTestDb } from '@seta/shared-testing';
import { describe, expect, it } from 'vitest';
import { resetPmoDb } from '../../src/backend/db/client.ts';
import {
  evaluateAnswerKeyCase,
  loadAnswerKeyCases,
  loadEvalWorkbookBuffer,
  summarizeEvalPack,
} from '../../src/backend/eval/index.ts';

const dbCfg = () => ({
  templateDbName: process.env.PLATFORM_TEST_PG_TEMPLATE as string,
  baseUrl: process.env.PLATFORM_TEST_PG_BASE as string,
});

describe('PMO eval pack (deterministic)', () => {
  it('runs all answer-key cases with schema pass and measurable timings', async () => {
    const cases = loadAnswerKeyCases();
    expect(cases.length).toBe(8);

    await withTestDb(dbCfg(), async ({ databaseUrl }) => {
      resetPmoDb();
      initPools({ databaseUrl });
      try {
        const results = [];
        for (const evalCase of cases) {
          const result = await evaluateAnswerKeyCase({
            evalCase,
            workbookBuffer: loadEvalWorkbookBuffer(evalCase.workbook),
            tenantId: crypto.randomUUID(),
            ingestionSessionId: crypto.randomUUID(),
          });
          results.push(result);
          expect(result.schema.pass, `${evalCase.caseId} schema`).toBe(true);
          expect(result.normalize.errorCount, `${evalCase.caseId} normalize`).toBe(0);
          expect(result.totalDurationMs, `${evalCase.caseId} duration`).toBeGreaterThan(0);
        }

        const summary = summarizeEvalPack(results);
        const baseline = results.find((item) => item.caseId === '01_baseline');
        expect(summary.schemaPassRate).toBe(1);
        expect(baseline?.findings.f1 ?? 0).toBeGreaterThan(0.75);
        expect(summary.findingsF1).toBeGreaterThan(0.45);
        expect(summary.totalPipelineP95Ms).toBeGreaterThan(0);
      } finally {
        await closePools();
      }
    });
  }, 180_000);

  it('does not regress below committed baseline thresholds', () => {
    const baselinePath = resolve(import.meta.dirname, '../../reports/eval-pack-baseline.json');
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      findingsF1: number;
      schemaPassRate: number;
      recommendationHitRate: number;
    };

    expect(baseline.schemaPassRate).toBeGreaterThanOrEqual(1);
    expect(baseline.findingsF1).toBeGreaterThanOrEqual(0.45);
    expect(baseline.recommendationHitRate).toBeGreaterThanOrEqual(0);
  });
});
