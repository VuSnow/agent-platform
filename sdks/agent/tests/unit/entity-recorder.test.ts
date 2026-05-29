import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetMutexesForTests, recordEntityExposure } from '../../src/entity-recorder.ts';
import {
  type ConversationEntities,
  EMPTY_ENTITIES,
  parseEntities,
  serializeEntities,
} from '../../src/working-memory-schema.ts';

function buildCtx(initial: ConversationEntities | null, threadId: string | undefined = 'conv-1') {
  let stored: string | null = initial ? serializeEntities(initial) : null;
  const memory = {
    getWorkingMemory: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 0)); // force task-queue yield → interleaves callers
      return stored;
    }),
    updateWorkingMemory: vi.fn(async ({ workingMemory }: { workingMemory: string }) => {
      await new Promise((r) => setTimeout(r, 0)); // yield so both reads land before either write
      stored = workingMemory;
    }),
  };
  return {
    ctx: {
      // ctx.agent carries Mastra's randomized sub-thread id — deliberately
      // different from the real chat thread id, to prove we do NOT use it.
      agent: { threadId: 'mangled-subthread', resourceId: 'user-x-work-planner' },
      requestContext: {
        get: (k: string) => {
          if (k === 'thread_id') return threadId;
          if (k === '__seta_agent_memory__') return { memory, memoryConfig: {} };
          return undefined;
        },
      },
    } as never,
    memory,
    read: () => (stored ? parseEntities(stored) : null),
  };
}

const T1 = { taskId: '00000000-0000-4000-8000-000000000001', title: 'A' };
const T2 = { taskId: '00000000-0000-4000-8000-000000000002', title: 'B' };

describe('recordEntityExposure', () => {
  beforeEach(() => {
    __resetMutexesForTests();
  });

  it('keys writes on the real chat thread id, not ctx.agent.threadId', async () => {
    const { ctx, memory } = buildCtx(null, 'conv-42');
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(memory.getWorkingMemory).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-42' }),
    );
    expect(memory.updateWorkingMemory).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'conv-42' }),
    );
  });

  it('seeds recentTasks on empty memory', async () => {
    const { ctx, read } = buildCtx(null);
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(read()?.recentTasks).toMatchObject([{ taskId: T1.taskId, title: 'A' }]);
  });

  it('merges-by-taskId, refreshes lastSeenAt, sorts desc, keeps unique', async () => {
    const { ctx, read } = buildCtx({
      ...EMPTY_ENTITIES,
      recentTasks: [{ taskId: T1.taskId, title: 'A-old', lastSeenAt: '2020-01-01T00:00:00.000Z' }],
    });
    await recordEntityExposure(ctx, { recentTasks: [T2, T1] });
    const tasks = read()?.recentTasks ?? [];
    expect(tasks.map((t) => t.taskId)).toEqual([T2.taskId, T1.taskId]);
    expect(tasks.at(1)?.title).toBe('A'); // title refreshed
  });

  it('truncates to 10 most recent', async () => {
    const { ctx, read } = buildCtx(null);
    const batch = Array.from({ length: 12 }, (_, i) => ({
      taskId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `T${i}`,
    }));
    await recordEntityExposure(ctx, { recentTasks: batch });
    expect(read()?.recentTasks).toHaveLength(10);
  });

  it('patches scalar entity fields without touching recentTasks', async () => {
    const { ctx, read } = buildCtx({
      ...EMPTY_ENTITIES,
      recentTasks: [{ ...T1, lastSeenAt: '2020-01-01T00:00:00.000Z' }],
    });
    await recordEntityExposure(ctx, { lastDiscussedTaskId: T1.taskId });
    const e = read();
    expect(e?.lastDiscussedTaskId).toBe(T1.taskId);
    expect(e?.recentTasks).toHaveLength(1);
  });

  it('is a no-op when RC_AGENT_MEMORY is absent', async () => {
    const ctx = {
      requestContext: { get: (k: string) => (k === 'thread_id' ? 'conv-1' : undefined) },
    } as never;
    await expect(recordEntityExposure(ctx, { recentTasks: [T1] })).resolves.toBeUndefined();
  });

  it('is a no-op when no chat thread id is present', async () => {
    const updateWorkingMemory = vi.fn();
    const memory = { getWorkingMemory: vi.fn(), updateWorkingMemory };
    const ctx = {
      requestContext: {
        get: (k: string) =>
          k === '__seta_agent_memory__' ? { memory, memoryConfig: {} } : undefined,
      },
    } as never;
    await recordEntityExposure(ctx, { recentTasks: [T1] });
    expect(updateWorkingMemory).not.toHaveBeenCalled();
  });

  it('serializes concurrent writes per conversation (no lost updates)', async () => {
    const { ctx, read } = buildCtx(null);
    await Promise.all([
      recordEntityExposure(ctx, { recentTasks: [T1] }),
      recordEntityExposure(ctx, { recentTasks: [T2] }),
    ]);
    const ids = (read()?.recentTasks ?? []).map((t) => t.taskId).sort();
    expect(ids).toEqual([T1.taskId, T2.taskId].sort());
  });
});
