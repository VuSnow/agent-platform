import { RequestContext } from '@mastra/core/request-context';
import type { ToolExecutionContext } from '@mastra/core/tools';
import { noopObserve } from '@mastra/core/tools';
import type { AgentRequestContext } from './request-context.ts';

/**
 * Build a Mastra ToolExecutionContext seeded with an actor identity, for use
 * in agent-tool unit tests. Mirrors what the live agent factory passes to
 * tool.execute() at runtime.
 */
export function makeToolContext(actor: {
  user_id: string;
  type?: 'user';
  tenant_id?: string;
  permissions?: readonly string[];
  role_summary?: { roles: string[]; cross_tenant_read: boolean };
}): ToolExecutionContext<unknown, unknown, AgentRequestContext> {
  const rc = new RequestContext<AgentRequestContext>();
  rc.set('actor', { type: actor.type ?? 'user', user_id: actor.user_id });
  // Production always sets tenant_id (wrap-execute keys its circuit breaker on it),
  // so the test helper mirrors that with a stable default when no tenant is supplied.
  rc.set('tenant_id', actor.tenant_id ?? '00000000-0000-0000-0000-000000000000');
  // The route layer resolves the caller's effective permissions + role summary onto
  // the request context (see apps' chat/workflow routes); cross-module read tools
  // re-check RBAC against them. Mirror that here so wrapped tools are executable.
  if (actor.permissions) rc.set('effective_permissions', new Set(actor.permissions));
  if (actor.role_summary) rc.set('role_summary', actor.role_summary);
  return {
    requestContext: rc,
    toolCallId: 'test-call',
    messages: [],
    observe: noopObserve,
  } as ToolExecutionContext<unknown, unknown, AgentRequestContext>;
}
