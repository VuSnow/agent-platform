import type { ZodTypeAny } from 'zod';
import type { ModelTier } from '../model-registry.ts';
import type { CopilotTool } from '../tools/_types.ts';

export interface AgentSpec {
  name: string;
  label: string;
  description: string;
  instructions: string;
  tools: ReadonlyArray<CopilotTool<ZodTypeAny>>;
  delegates?: ReadonlyArray<string>;
  defaultTier?: ModelTier;
}

export type AgentSpecs = ReadonlyArray<AgentSpec>;

export function listAgentNames(specs: AgentSpecs): string[] {
  return specs.map((s) => s.name);
}

export function findSpec(specs: AgentSpecs, name: string): AgentSpec | undefined {
  return specs.find((s) => s.name === name);
}
