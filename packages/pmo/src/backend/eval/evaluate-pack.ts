import {
  buildMemberAnalysesFromEvidence,
  loadPipelineEvidence,
  runDeterministicEvalPipeline,
} from './run-deterministic-pipeline.ts';
import { buildActualDataQualityFlags, scoreDataQuality } from './score-data-quality.ts';
import { deriveActualFindings, scoreFindings } from './score-findings.ts';
import { recommendationHitRate, scoreRecommendations } from './score-recommendations.ts';
import { scoreSchema } from './score-schema.ts';
import { percentile } from './timing.ts';
import type { AnswerKeyCase, EvalCaseResult, EvalPackSummary, EvalStageId } from './types.ts';

export async function evaluateAnswerKeyCase(input: {
  evalCase: AnswerKeyCase;
  workbookBuffer: Buffer;
  tenantId: string;
  ingestionSessionId: string;
}): Promise<EvalCaseResult> {
  const pipeline = await runDeterministicEvalPipeline({
    evalCase: input.evalCase,
    workbookBuffer: input.workbookBuffer,
    tenantId: input.tenantId,
    ingestionSessionId: input.ingestionSessionId,
  });

  const evidence = await loadPipelineEvidence({
    tenantId: input.tenantId,
    ingestionSessionId: input.ingestionSessionId,
    dateRange: input.evalCase.dateRange,
  });
  const analyses = buildMemberAnalysesFromEvidence(evidence);
  const weeks = [...evidence.ctx.weeksById.values()];

  const actualFindings = deriveActualFindings({
    expected: input.evalCase.expectedFindings,
    reportFindings: pipeline.report.findings,
    analyses,
    memberFacts: evidence.facts,
    weeks,
    cleaning: pipeline.cleaning,
  });

  const findings = scoreFindings(input.evalCase.expectedFindings, actualFindings);
  const recommendations = scoreRecommendations(input.evalCase, pipeline.recommendations);
  const actualDataQualityFlags = buildActualDataQualityFlags({
    cleaning: pipeline.cleaning,
    recommendationGroups: pipeline.recommendations,
  });
  const dataQuality = scoreDataQuality(input.evalCase.expectedDataQuality, actualDataQualityFlags);

  const totalDurationMs = pipeline.timings.reduce((sum, timing) => sum + timing.durationMs, 0);

  return {
    caseId: input.evalCase.caseId,
    workbook: input.evalCase.workbook,
    timings: pipeline.timings,
    totalDurationMs,
    schema: scoreSchema(pipeline.schema),
    normalize: {
      pass: pipeline.normalizeErrorCount === 0,
      errorCount: pipeline.normalizeErrorCount,
      duplicateInUploadCount: pipeline.duplicateInUploadCount,
    },
    findings,
    recommendations,
    dataQuality,
    report: {
      summary: pipeline.report.summary,
      findings: pipeline.report.findings,
      recommendations: pipeline.report.recommendations,
    },
  };
}

const STAGE_IDS: EvalStageId[] = [
  'parse_workbook',
  'detect_schema',
  'normalize_rows',
  'stage_changes',
  'publish',
  'compute_facts',
  'generate_report',
  'generate_recommendations',
];

export function summarizeEvalPack(cases: EvalCaseResult[]): EvalPackSummary {
  const findingScores = cases.map((item) => item.findings);
  const recommendationScores = cases
    .map((item) => item.recommendations)
    .filter((score): score is NonNullable<typeof score> => score !== null);

  const stageLatency = Object.fromEntries(
    STAGE_IDS.map((stage) => {
      const durations = cases.flatMap((item) =>
        item.timings.filter((timing) => timing.stage === stage).map((timing) => timing.durationMs),
      );
      return [
        stage,
        {
          p50Ms: percentile(durations, 50),
          p95Ms: percentile(durations, 95),
          maxMs: durations.length > 0 ? Math.max(...durations) : 0,
        },
      ];
    }),
  ) as EvalPackSummary['stageLatency'];

  const totalDurations = cases.map((item) => item.totalDurationMs);

  return {
    runAt: new Date().toISOString(),
    caseCount: cases.length,
    schemaPassRate: cases.filter((item) => item.schema.pass).length / Math.max(cases.length, 1),
    findingsPrecision:
      findingScores.reduce((sum, score) => sum + score.precision, 0) / Math.max(cases.length, 1),
    findingsRecall:
      findingScores.reduce((sum, score) => sum + score.recall, 0) / Math.max(cases.length, 1),
    findingsF1: findingScores.reduce((sum, score) => sum + score.f1, 0) / Math.max(cases.length, 1),
    recommendationHitRate: recommendationHitRate(recommendationScores),
    stageLatency,
    totalPipelineP50Ms: percentile(totalDurations, 50),
    totalPipelineP95Ms: percentile(totalDurations, 95),
    cases,
  };
}

export function formatEvalPackMarkdown(summary: EvalPackSummary): string {
  const lines: string[] = [
    '# PMO Eval Pack Report',
    '',
    `- Run at: **${summary.runAt}**`,
    `- Cases: **${summary.caseCount}**`,
    `- Schema pass rate: **${(summary.schemaPassRate * 100).toFixed(1)}%**`,
    `- Findings F1: **${summary.findingsF1.toFixed(3)}** (P=${summary.findingsPrecision.toFixed(3)}, R=${summary.findingsRecall.toFixed(3)})`,
    `- Recommendation hit rate: **${(summary.recommendationHitRate * 100).toFixed(1)}%**`,
    `- Total pipeline p50/p95: **${summary.totalPipelineP50Ms}ms / ${summary.totalPipelineP95Ms}ms**`,
    '',
    '## Stage latency (p50 / p95 / max ms)',
    '',
    '| Stage | p50 | p95 | max |',
    '| --- | ---: | ---: | ---: |',
    ...STAGE_IDS.map((stage) => {
      const row = summary.stageLatency[stage];
      return `| ${stage} | ${row.p50Ms} | ${row.p95Ms} | ${row.maxMs} |`;
    }),
    '',
    '## Per-case results',
    '',
    '| Case | Schema | Normalize | Findings F1 | Recommend | Data quality | Total ms |',
    '| --- | --- | --- | ---: | --- | --- | ---: |',
    ...summary.cases.map((item) => {
      const rec = item.recommendations
        ? item.recommendations.statusMatch && item.recommendations.topTargetHit
          ? 'pass'
          : 'fail'
        : 'n/a';
      const dq =
        item.dataQuality.requiredFlagsMissing.length === 0 && item.dataQuality.degradedMatch
          ? 'pass'
          : 'fail';
      return `| ${item.caseId} | ${item.schema.pass ? 'pass' : 'fail'} | ${item.normalize.pass ? 'pass' : 'fail'} | ${item.findings.f1.toFixed(2)} | ${rec} | ${dq} | ${item.totalDurationMs} |`;
    }),
    '',
  ];

  for (const item of summary.cases) {
    if (item.findings.missed.length === 0 && item.findings.unexpected.length === 0) continue;
    lines.push(`### ${item.caseId} finding deltas`);
    if (item.findings.missed.length > 0) {
      lines.push(
        `- Missed: ${item.findings.missed.map((finding) => `${finding.memberId}/${finding.issueType}`).join(', ')}`,
      );
    }
    if (item.findings.unexpected.length > 0) {
      lines.push(
        `- Unexpected: ${item.findings.unexpected.map((finding) => `${finding.memberId}/${finding.issueType}`).join(', ')}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
