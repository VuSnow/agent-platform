export type AgentName = string;

export interface AgentOption {
  name: AgentName;
  label: string;
  description: string;
  delegates?: ReadonlyArray<string>;
}

export const FALLBACK_AGENTS: ReadonlyArray<AgentOption> = [
  { name: 'supervisor', label: 'Supervisor', description: 'Routes to the right specialist' },
  { name: 'self', label: 'Self', description: 'Answers questions about your context' },
];

export function agentLabel(name: AgentName, options: ReadonlyArray<AgentOption>): string {
  return options.find((a) => a.name === name)?.label ?? name;
}
