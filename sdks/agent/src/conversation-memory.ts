import type { AgentMemoryHandle } from './request-context.ts';

// Process-local holder for the thread-scoped conversation-entities Memory.
//
// This MUST NOT travel on the Mastra RequestContext. Mastra serializes the
// RequestContext (`requestContext.toJSON()`) and rebuilds it
// (`new RequestContext(Object.entries(...))`) around every tool/step execution
// — for AI-tracing spans and cross-process resume. A live `Memory` class
// instance survives `JSON.stringify` (it is serializable) but the rebuilt copy
// is a plain object whose prototype methods (`getWorkingMemory`,
// `updateWorkingMemory`) are gone, so calling them throws
// "getWorkingMemory is not a function".
//
// The entities Memory is a process-wide singleton (one instance bound to the
// shared store; thread isolation is the `threadId` argument), so a module-level
// holder set once at the composition root is the correct channel. The recorder
// and resolver still read the serializable `thread_id` from the RequestContext.
let handle: AgentMemoryHandle | undefined;

/** Register the process-wide conversation-entities memory. Called once at the
 *  composition root (agent register). Pass `undefined` to clear (tests). */
export function setConversationMemory(next: AgentMemoryHandle | undefined): void {
  handle = next;
}

/** The conversation-entities memory handle, or undefined in contexts that never
 *  set it (workflow/cron runs). Recorder/resolver no-op when absent. */
export function getConversationMemory(): AgentMemoryHandle | undefined {
  return handle;
}
