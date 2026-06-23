import { describe, expect, it } from 'vitest';
import {
  buildAgentEvalTasks,
  classifyEvalPrompt,
  expectedToolsForPromptClass,
} from '../../../src/backend/eval/agent-harness.ts';
import { loadAnswerKeyCases } from '../../../src/backend/eval/load-answer-key.ts';
import { scoreFindings } from '../../../src/backend/eval/score-findings.ts';

describe('PMO eval scorers', () => {
  it('scores findings with precision/recall', () => {
    const score = scoreFindings(
      [
        { memberId: 'EMP-001', issueType: 'overbook', severity: 'High' },
        { memberId: 'EMP-005', issueType: 'idle', severity: 'Medium' },
      ],
      [
        { memberId: 'EMP-001', issueType: 'overbook', severity: 'High' },
        { memberId: 'EMP-008', issueType: 'idle', severity: 'Medium' },
      ],
    );
    expect(score.recall).toBe(0.5);
    expect(score.precision).toBe(0.5);
    expect(score.f1).toBe(0.5);
  });
});

describe('PMO agent eval harness', () => {
  it('builds 3 tasks per answer-key case with tool expectations', () => {
    const cases = loadAnswerKeyCases();
    const tasks = buildAgentEvalTasks();
    expect(tasks.length).toBe(cases.length * 3);
    expect(tasks.every((task) => task.expectedTools.length > 0)).toBe(true);
  });

  it('classifies prompts into ingest/report/recommend', () => {
    expect(classifyEvalPrompt('Generate an overbook report')).toBe('report');
    expect(classifyEvalPrompt('Recommend rebalance options')).toBe('recommend');
    expect(classifyEvalPrompt('Ingest baseline workbook')).toBe('ingest');
    expect(expectedToolsForPromptClass('recommend')).toContain('pmo_recommendRebalance');
  });
});
