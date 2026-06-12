import { afterEach, describe, expect, it, vi } from 'vitest';
import { setConversationMemory } from '../../src/conversation-memory.ts';
import { resolveTaskRef } from '../../src/task-ref-resolver.ts';
import { EMPTY_ENTITIES, serializeEntities } from '../../src/working-memory-schema.ts';

const UUID_A = '66be2be2-394d-4184-b106-c412289fd1e1';
const UUID_B = '499f9898-2133-4ba3-82b5-83d9fb1996fc';

// The conversation memory lives in a process-local holder, NOT on the
// RequestContext — Mastra serializes the RequestContext around tool execution,
// which would strip a live Memory instance's prototype methods. The ctx only
// carries the serializable thread_id.
function buildCtx(recentTaskIds: Array<{ taskId: string; title: string }>) {
  const now = new Date().toISOString();
  const entities = {
    ...EMPTY_ENTITIES,
    recentTasks: recentTaskIds.map((t) => ({ ...t, lastSeenAt: now })),
  };
  setConversationMemory({
    memory: { getWorkingMemory: vi.fn(async () => serializeEntities(entities)) },
    memoryConfig: {},
  } as never);
  return {
    // ctx.agent carries Mastra's randomized sub-thread — resolver must ignore it
    // and read the real chat thread id from RC_THREAD_ID instead.
    agent: { threadId: 'mangled-subthread', resourceId: 'r-1' },
    requestContext: {
      get: (k: string) => (k === 'thread_id' ? 'conv-1' : undefined),
    },
  } as never;
}

afterEach(() => setConversationMemory(undefined));

describe('resolveTaskRef', () => {
  it('resolves via the process-local holder, not a RequestContext-carried Memory', async () => {
    // Regression: Mastra round-trips the RequestContext through JSON, so a live
    // Memory placed on it loses its methods. Even when the RequestContext carries
    // NO memory at all, resolution must still work via the holder.
    const ctx = buildCtx([{ taskId: UUID_A, title: 'A' }]);
    expect((await resolveTaskRef(ctx, 'first')).taskId).toBe(UUID_A);
  });

  it('returns UUID as-is', async () => {
    const ctx = buildCtx([{ taskId: UUID_A, title: 'A' }]);
    expect(await resolveTaskRef(ctx, UUID_A)).toEqual({ taskId: UUID_A, source: 'uuid' });
  });

  it('resolves "#1" / "1" / "first" → most recent', async () => {
    const ctx = buildCtx([
      { taskId: UUID_A, title: 'A' },
      { taskId: UUID_B, title: 'B' },
    ]);
    for (const ref of ['#1', '1', 'first', 'First', '  #1  ']) {
      expect((await resolveTaskRef(ctx, ref)).taskId).toBe(UUID_A);
    }
  });

  it('resolves "last" / "latest" / "most recent" → index 0', async () => {
    const ctx = buildCtx([
      { taskId: UUID_A, title: 'A' },
      { taskId: UUID_B, title: 'B' },
    ]);
    for (const ref of ['last', 'latest', 'most recent']) {
      expect((await resolveTaskRef(ctx, ref)).taskId).toBe(UUID_A);
    }
  });

  it('resolves "#2" / "second" → next', async () => {
    const ctx = buildCtx([
      { taskId: UUID_A, title: 'A' },
      { taskId: UUID_B, title: 'B' },
    ]);
    expect((await resolveTaskRef(ctx, '#2')).taskId).toBe(UUID_B);
    expect((await resolveTaskRef(ctx, 'second')).taskId).toBe(UUID_B);
  });

  it('throws structured error with availableTasks when ordinal out of range', async () => {
    const ctx = buildCtx([{ taskId: UUID_A, title: 'A' }]);
    await expect(resolveTaskRef(ctx, '#7')).rejects.toThrow(/no.*7/i);
  });

  it('throws structured error when memory is empty', async () => {
    const ctx = buildCtx([]);
    await expect(resolveTaskRef(ctx, 'first')).rejects.toThrow(/no recent tasks/i);
  });

  it('rejects garbage strings', async () => {
    const ctx = buildCtx([{ taskId: UUID_A, title: 'A' }]);
    await expect(resolveTaskRef(ctx, 'banana')).rejects.toThrow(/not a uuid|unrecognized/i);
  });
});
