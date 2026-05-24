import type { APIRequestContext } from '@playwright/test';

// Names referenced by specs in this suite; keep stable.
const GROUP_NAME = 'Engineering';
const PLAN_NAME = 'Q2 Infrastructure';
const BUCKET_NAMES = ['To do', 'In progress', 'Review', 'Done'] as const;

interface GroupRow {
  id: string;
  name: string;
}
interface PlanRow {
  id: string;
  name: string;
  group_id: string;
}
interface BucketRow {
  id: string;
  name: string;
}
interface TaskRow {
  id: string;
  title: string;
}

async function getJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const res = await request.get(url);
  if (!res.ok()) throw new Error(`${url} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await request.post(url, { data: body });
  if (!res.ok()) throw new Error(`POST ${url} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function ensureGroup(request: APIRequestContext): Promise<string> {
  const { groups } = await getJson<{ groups: GroupRow[] }>(request, '/api/planner/v1/groups');
  const existing = groups.find((g) => g.name === GROUP_NAME);
  if (existing) return existing.id;
  const created = await postJson<GroupRow>(request, '/api/planner/v1/groups', {
    name: GROUP_NAME,
    description: 'E2E fixture group',
    theme: 'blue',
    visibility: 'private',
    default_role: 'member',
  });
  return created.id;
}

async function ensurePlan(request: APIRequestContext, groupId: string): Promise<string> {
  const { plans } = await getJson<{ plans: PlanRow[] }>(
    request,
    `/api/planner/v1/plans?group_id=${groupId}`,
  );
  const existing = plans.find((p) => p.name === PLAN_NAME);
  if (existing) return existing.id;
  const created = await postJson<PlanRow>(request, '/api/planner/v1/plans', {
    group_id: groupId,
    name: PLAN_NAME,
  });
  return created.id;
}

async function ensureBuckets(request: APIRequestContext, planId: string): Promise<BucketRow[]> {
  const { buckets } = await getJson<{ buckets: BucketRow[] }>(
    request,
    `/api/planner/v1/plans/${planId}/buckets`,
  );
  if (buckets.length >= BUCKET_NAMES.length) return buckets;
  const present = new Set(buckets.map((b) => b.name));
  for (const name of BUCKET_NAMES) {
    if (present.has(name)) continue;
    await postJson<BucketRow>(request, '/api/planner/v1/buckets', {
      plan_id: planId,
      name,
    });
  }
  const refreshed = await getJson<{ buckets: BucketRow[] }>(
    request,
    `/api/planner/v1/plans/${planId}/buckets`,
  );
  return refreshed.buckets;
}

const TASK_DEFS = [
  { title: 'Set up CI/CD pipeline', bucket: 'To do', priority: 5 as const },
  { title: 'Implement auth service', bucket: 'In progress', priority: 3 as const },
  { title: 'Review database migration PR', bucket: 'Review', priority: 5 as const },
  { title: 'Deploy API gateway to production', bucket: 'Done', priority: 1 as const },
  { title: 'Add observability dashboards', bucket: 'To do', priority: 5 as const },
  { title: 'Ship M3 spec', bucket: 'In progress', priority: 3 as const },
];

async function ensureTasks(
  request: APIRequestContext,
  planId: string,
  buckets: BucketRow[],
): Promise<void> {
  const { tasks } = await getJson<{ tasks: TaskRow[] }>(
    request,
    `/api/planner/v1/tasks?plan_id=${planId}`,
  );
  const present = new Set(tasks.map((t) => t.title));
  const bucketByName = new Map(buckets.map((b) => [b.name, b.id]));
  for (const def of TASK_DEFS) {
    if (present.has(def.title)) continue;
    const bucket_id = bucketByName.get(def.bucket);
    if (!bucket_id) throw new Error(`fixture bucket "${def.bucket}" missing`);
    await postJson<TaskRow>(request, '/api/planner/v1/tasks', {
      plan_id: planId,
      bucket_id,
      title: def.title,
      priority_number: def.priority,
    });
  }
}

// Idempotent: ensures the sandbox tenant has a stable "Engineering" / "Q2 Infrastructure"
// plan with four buckets and a handful of tasks so the planner-* specs can resolve
// fixed names without a global database seed.
export async function ensurePlannerFixtures(request: APIRequestContext): Promise<void> {
  const groupId = await ensureGroup(request);
  const planId = await ensurePlan(request, groupId);
  const buckets = await ensureBuckets(request, planId);
  await ensureTasks(request, planId, buckets);
}
