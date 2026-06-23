import { loadAnswerKeyCases } from './load-answer-key.ts';

export type AgentEvalPromptClass = 'ingest' | 'report' | 'recommend';

export interface AgentEvalTask {
  caseId: string;
  workbook: string;
  prompt: string;
  promptClass: AgentEvalPromptClass;
  expectedTools: string[];
  successChecks: string[];
}

export function classifyEvalPrompt(prompt: string): AgentEvalPromptClass {
  const lower = prompt.toLowerCase();
  if (lower.includes('recommend') || lower.includes('rebalance')) return 'recommend';
  if (lower.includes('report') || lower.includes('overbook') || lower.includes('idle')) {
    return 'report';
  }
  return 'ingest';
}

export function expectedToolsForPromptClass(promptClass: AgentEvalPromptClass): string[] {
  switch (promptClass) {
    case 'ingest':
      return ['pmo_startIngest'];
    case 'report':
      return ['pmo_generateReport'];
    case 'recommend':
      return ['pmo_recommendRebalance'];
  }
}

export function successChecksForPromptClass(promptClass: AgentEvalPromptClass): string[] {
  switch (promptClass) {
    case 'ingest':
      return ['ingestion_session_created', 'workflow_execution_state_present'];
    case 'report':
      return ['report_findings_present', 'date_range_matches_answer_key'];
    case 'recommend':
      return ['recommendation_groups_present_or_explicit_no_result'];
  }
}

export function buildAgentEvalTasks(): AgentEvalTask[] {
  const tasks: AgentEvalTask[] = [];
  for (const evalCase of loadAnswerKeyCases()) {
    for (const prompt of evalCase.evalPrompts) {
      const promptClass = classifyEvalPrompt(prompt);
      tasks.push({
        caseId: evalCase.caseId,
        workbook: evalCase.workbook,
        prompt,
        promptClass,
        expectedTools: expectedToolsForPromptClass(promptClass),
        successChecks: successChecksForPromptClass(promptClass),
      });
    }
  }
  return tasks;
}

export function buildAgentEvalPlan() {
  const tasks = buildAgentEvalTasks();
  return {
    runAt: new Date().toISOString(),
    mode: 'manual_or_playwright',
    taskCount: tasks.length,
    tasks,
    notes: [
      'Run against /pmo/agent with the listed workbook uploaded for the case.',
      'Record tool calls, turn latency, and successChecks in the output JSON.',
    ],
  };
}
