# Connection Pool Hardening — Design Spec

**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** `packages/shared-db`, `packages/copilot`, `packages/planner`, `packages/identity`

---

## Problem

`shared-db` already centralizes all connection pools (3 named pools: `web`, `worker`, `mastraState`) — modules do not create their own pools. The remaining gaps are:

1. **No observability.** There are no metrics on pool utilization. Pool saturation is invisible until an incident.
2. **`worker` pool is undersized.** Max 10 connections shared across 4 heavy modules (`copilot`, `planner`, `identity`, `knowledge`). At autoscale (1–4 `seta-worker` pods), this exhausts quickly.
3. **No safety timeouts.** `connectionTimeoutMillis` and `idleTimeoutMillis` are unset — a slow Postgres causes requests to queue indefinitely rather than fail fast.
4. **Inconsistent module client caching.** `copilotDb()`, `plannerDb()`, `identityDb()` create a new Drizzle wrapper on every call. `coreDb()`, `knowledgeDb()`, `integrationsDb()`, `notificationsDb()` cache correctly. The inconsistency is a footgun for future middleware and logging hooks.

---

## Goals

- OTEL pool gauges + connection-wait histogram so sizing decisions are data-driven
- Correct `worker` pool size with inline formula documentation
- Safety timeouts on all pools
- Standardized cached factory pattern across all module clients
- `getPoolStats()` export for `/healthz` endpoint

## Non-Goals

- PgBouncer / RDS Proxy (deferred to Scale tier per `docs/hosting/aws.md §7`)
- Per-module connection budgets (not needed; 3 workload-typed pools are the right boundary)
- Merging `mastraState` into `worker` (kept separate for future statement-timeout tuning)

---

## Architecture

Three files change in `shared-db`; three module `db/index.ts` files are standardized. No consumer API changes.

```
packages/shared-db/src/
  pools.ts            modified — harden config, call instrumentPool(), export getPoolStats()
  instrumentation.ts  NEW — OTEL observable gauges + connect() histogram wrapper
  index.ts            modified — export getPoolStats()

packages/copilot/src/backend/db/index.ts   modified — standardize caching
packages/planner/src/backend/db/index.ts   modified — standardize caching
packages/identity/src/backend/db/index.ts  modified — standardize caching
```

No new npm dependencies. The codebase already uses `@opentelemetry/api` with `metrics.getMeter()`. OTEL SDK is initialized before anything else in both `apps/server/src/otel.ts` and `apps/worker/src/otel.ts`.

---

## Section 1: OTEL Instrumentation (`instrumentation.ts`)

### Metrics

| Metric name | Type | Unit | Description |
|---|---|---|---|
| `db_pool_connections_total` | ObservableGauge | `{connection}` | Total connections currently in pool |
| `db_pool_connections_idle` | ObservableGauge | `{connection}` | Idle connections available for checkout |
| `db_pool_connections_waiting` | ObservableGauge | `{connection}` | Client requests waiting for a free connection |
| `db_pool_connection_wait_ms` | Histogram | `ms` | Time elapsed waiting for a connection to become available |

All metrics carry a `{ pool: 'web' | 'worker' | 'mastraState' }` attribute.

### Implementation

```ts
// packages/shared-db/src/instrumentation.ts
import { metrics } from '@opentelemetry/api';
import type { Pool } from 'pg';

const meter = metrics.getMeter('@seta/shared-db');

const totalGauge   = meter.createObservableGauge('db_pool_connections_total',   { unit: '{connection}', description: 'Total connections in pool' });
const idleGauge    = meter.createObservableGauge('db_pool_connections_idle',    { unit: '{connection}', description: 'Idle connections available' });
const waitingGauge = meter.createObservableGauge('db_pool_connections_waiting', { unit: '{connection}', description: 'Requests waiting for a connection' });
const waitHistogram = meter.createHistogram('db_pool_connection_wait_ms',       { unit: 'ms',           description: 'Connection acquisition wait time' });

export function instrumentPool(pool: Pool, poolName: string): void {
  totalGauge.addCallback(result   => result.observe(pool.totalCount,   { pool: poolName }));
  idleGauge.addCallback(result    => result.observe(pool.idleCount,    { pool: poolName }));
  waitingGauge.addCallback(result => result.observe(pool.waitingCount, { pool: poolName }));

  // Only the Promise form of pool.connect() is used across this codebase.
  // The callback overload is not wrapped — passing a callback would bypass timing.
  const orig = pool.connect.bind(pool) as () => Promise<import('pg').PoolClient>;
  (pool as unknown as { connect: () => Promise<import('pg').PoolClient> }).connect = async () => {
    const start = performance.now();
    const client = await orig();
    waitHistogram.record(performance.now() - start, { pool: poolName });
    return client;
  };
}
```

### Key signals

| Question | Metric to watch |
|---|---|
| Is the pool saturated right now? | `connections_total` == configured `max` |
| Are requests queuing? | `connections_waiting` > 0 |
| How severe is saturation? | `connection_wait_ms` P95 / P99 |
| Is `worker` actually undersized? | `worker.connections_waiting` sustained > 0 |

`db_pool_connection_wait_ms` P95 > 50 ms under normal load is the primary alarm threshold.

---

## Section 2: Pool Hardening (`pools.ts`)

### Updated pool configuration

| Config | web | worker | mastraState | Rationale |
|---|---|---|---|---|
| `max` | 15 (unchanged) | **20** (was 10) | 5 (unchanged) | worker serves 4 modules; 10 too tight at autoscale |
| `min` | **2** | **2** | **1** | pre-warm connections; eliminate first-request latency spike |
| `connectionTimeoutMillis` | **5_000** | **10_000** | **5_000** | fail fast instead of queuing indefinitely |
| `idleTimeoutMillis` | **10_000** | **30_000** | **10_000** | release idle connections promptly |
| `statement_timeout` | 5_000 (unchanged) | 30_000 (unchanged) | 5_000 (unchanged) | workload-appropriate query limits |

### Sizing formula (inline comment in `pools.ts`)

```
max = floor(pg_max_connections / (server_tasks + worker_tasks)) − margin
Starter  (200 max / 2 tasks)  − 10 = ~90 headroom
Growth   (400 max / 6 tasks)  − 10 = ~57 headroom
Scale: use RDS Proxy — see docs/hosting/aws.md §7
Override via cfg.webMax / cfg.workerMax / cfg.mastraStateMax.
```

### `getPoolStats()` export

```ts
export function getPoolStats() {
  if (!pools) return null;
  return {
    web:         { total: pools.web.totalCount,         idle: pools.web.idleCount,         waiting: pools.web.waitingCount },
    worker:      { total: pools.worker.totalCount,      idle: pools.worker.idleCount,      waiting: pools.worker.waitingCount },
    mastraState: { total: pools.mastraState.totalCount, idle: pools.mastraState.idleCount, waiting: pools.mastraState.waitingCount },
  };
}
```

Consumed by the `/healthz` endpoint (existing endpoint, caller decides whether to surface it).

---

## Section 3: Module Client Caching

Standardize `copilotDb`, `plannerDb`, `identityDb` to the cached factory pattern used by `coreDb`, `knowledgeDb`, `integrationsDb`, `notificationsDb`.

**Before (all three):**
```ts
export const plannerDb = () => drizzle(getPool('worker'), { schema });
```

**After:**
```ts
let cached: NodePgDatabase<typeof schema> | null = null;

export function plannerDb(): NodePgDatabase<typeof schema> {
  if (!cached) cached = drizzle(getPool('worker'), { schema });
  return cached;
}

// For tests — mirrors resetCoreDb() in @seta/core/testing
export function resetPlannerDb(): void { cached = null; }
```

Same pattern applied to `copilotDb` → `resetCopilotDb()` and `identityDb` → `resetIdentityDb()`.

Each reset helper is exported from the module's `/testing` subpath, not the main entrypoint.

- `@seta/copilot/testing` → `./src/testing/fixtures.ts` (subpath already exists)
- `@seta/identity/testing` → `./src/testing/index.ts` (subpath already exists)
- `@seta/planner/testing` → **create** `./src/testing/index.ts` + add `"./testing": "./src/testing/index.ts"` to `planner/package.json` exports

---

## Section 4: Error Handling

- `connectionTimeoutMillis` causes `pool.connect()` to throw `Error: timeout exceeded when trying to connect` after the configured duration. This propagates naturally up the call stack — no special handling needed. Hono's error boundary and graphile-worker's job retry logic already handle thrown errors.
- The existing `pool.on('error', swallow)` handler in `pools.ts` is preserved — it catches idle client errors from server-side connection termination (admin shutdown, test teardown) without crashing the process.
- `instrumentPool()` wraps `pool.connect()` after the pool is constructed. If `orig()` rejects (timeout, Postgres unavailable), the histogram does **not** record — the error propagates unchanged. No silent swallowing.

---

## Section 5: Testing

| Test file | Type | What it verifies |
|---|---|---|
| `shared-db/tests/integration/pools.test.ts` (extend) | Integration | `getPoolStats()` returns correct shape; `worker.max` = 20; `connectionTimeoutMillis` set on all pools |
| `shared-db/tests/unit/instrumentation.test.ts` | Unit | `instrumentPool()` wraps `connect()` without breaking it; gauges registered with correct pool attribute; histogram records non-negative value |
| `packages/copilot/tests/unit/db.test.ts` | Unit | Same instance on repeated `copilotDb()` calls; `resetCopilotDb()` clears cache |
| `packages/planner/tests/unit/db.test.ts` | Unit | Same for `plannerDb()` / `resetPlannerDb()` |
| `packages/identity/tests/unit/db.test.ts` | Unit | Same for `identityDb()` / `resetIdentityDb()` |

No new test infrastructure. Existing `testcontainers` setup in `shared-config/vitest/setup-db-test.ts` covers integration tests. Unit tests mock the `pg` Pool with a minimal stub.

---

## Files Changed

| File | Change |
|---|---|
| `packages/shared-db/src/instrumentation.ts` | **New** |
| `packages/shared-db/src/pools.ts` | Add timeouts, bump worker max, add `min`, call `instrumentPool()`, export `getPoolStats()` |
| `packages/shared-db/src/index.ts` | Export `getPoolStats` |
| `packages/copilot/src/backend/db/index.ts` | Cached factory + `resetCopilotDb()` |
| `packages/planner/src/backend/db/index.ts` | Cached factory + `resetPlannerDb()` |
| `packages/identity/src/backend/db/index.ts` | Cached factory + `resetIdentityDb()` |
| `packages/shared-db/tests/unit/instrumentation.test.ts` | **New** |
| `packages/shared-db/tests/integration/pools.test.ts` | Extend |
| `packages/{copilot,planner,identity}/tests/unit/db.test.ts` | **New** |

No migration required. No API surface changes to consumers.
