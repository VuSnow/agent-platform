# Copilot agent architecture

*The assistant that catches duplicate tasks, suggests assignees, and routes every write through a human approval.*

---

## TL;DR

```mermaid
graph LR
    U[User]
    A[Copilot]
    P[Platform data]

    U -->|asks| A
    A -->|proposes| U
    U -->|decides| A
    A -->|writes| P
    P -.signals.-> A

    style A fill:#0047FF,color:#fff
```

**One sentence:** the agent proposes, the user decides, the platform records.

| What ships in v1 | Value |
|---|---|
| Chat over all platform data (Work / People / Self / Meta) | One surface, no context switching |
| **Dedup at task creation** — vector similarity + approval card | Cuts duplicate noise at the source |
| **Skill-match assignee suggestions** — skills + load + capacity + tz | Assignment is one click, not a meeting |
| HITL approval on every write | Audit trail by construction, no surprises |
| Built on [Mastra](https://mastra.ai) | ~80% of the runtime is bought, not built |

---

## What the user sees

```mermaid
journey
    title Who should take this task
    section Ask
      User asks in chat: 5: User
      Assistant routes: 3: Copilot
    section Suggest
      Find candidates: 3: Copilot
      Score and rank: 3: Copilot
      Show top-5 card: 5: Copilot
    section Decide
      Pick assignee: 5: User
    section Record
      Assign and audit: 5: Platform
```

```mermaid
journey
    title Create a task with dedup catch
    section Draft
      Type title: 5: User
    section Check
      Vector search: 3: Copilot
      Classify match: 3: Copilot
    section Decide
      Show duplicates card: 5: Copilot
      Pick comment on existing: 5: User
    section Record
      Post comment and audit: 5: Platform
```

Both flows share the same contract — **propose, decide, record** — and the same approval card surface.

---

## Topology

```mermaid
graph TD
    User[User]
    Top["<b>Top Supervisor</b><br/>routes by domain"]

    Work["Work"]
    People["People"]
    Self["Self"]
    Meta["Meta"]

    Planner["planner"]
    Identity["identity"]
    SelfSpec["self"]
    MetaSpec["meta"]

    DedupWF["dedupOnCreate"]
    AssignWF["assignBySkill"]

    User --> Top
    Top --> Work
    Top --> People
    Top --> Self
    Top --> Meta

    Work --> Planner
    Work --> DedupWF
    Work --> AssignWF

    People --> Identity
    Self --> SelfSpec
    Meta --> MetaSpec

    classDef domain fill:#0047FF,color:#fff;
    classDef spec fill:#E6EEFF,color:#003;
    classDef wf fill:#FFC107,color:#000;
    class Top,Work,People,Self,Meta domain;
    class Planner,Identity,SelfSpec,MetaSpec spec;
    class DedupWF,AssignWF wf;
```

| Layer | Job | Why |
|---|---|---|
| **Top Supervisor** | Pick a *domain* | Routing accuracy collapses past ~10 options. Domain layer keeps it small forever. |
| **Domain Supervisor** | Pick a specialist or invoke a workflow | Module-level coordination without polluting the top router |
| **Module Specialist** | Run module-specific tools | Owns its writes. Reads across modules through a shared registry. |
| **Workflow** | Multi-step deterministic flows (e.g. dedup, assign) | Reasoning is for chat; ordered side-effects belong in a workflow |

**Design rule:** *writes are private, reads are shared.* A specialist can read timesheet capacity without bouncing the request back to a timesheet specialist — one delegation hop, clean audit trail.

### Why hierarchical, not flat

```mermaid
graph TB
    subgraph "❌ Flat — collapses at N≈10"
        S1[Supervisor]
        S1 --> A1[planner]
        S1 --> B1[identity]
        S1 --> C1[timesheet]
        S1 --> D1[pmo]
        S1 --> E1[hr]
        S1 --> F1[finance]
        S1 --> G1[knowledge]
        S1 --> H1[...8+]
    end

    subgraph "✅ Two-level — scales to dozens"
        S2[Top]
        S2 --> W2[Work]
        S2 --> P2[People]
        S2 --> M2[Money]
        S2 --> K2[Knowledge]
        W2 --> a2[planner]
        W2 --> b2[timesheet]
        W2 --> c2[pmo]
        P2 --> d2[identity]
        P2 --> e2[hr]
    end

    style S1 fill:#ffcccc,color:#900
    style S2 fill:#cce5ff,color:#003
```

| | Flat | Hierarchical |
|---|---|---|
| Routing prompt size | grows linearly with modules | stays small forever |
| Routing accuracy at N=15 | ~70% | ~95% |
| Adding a module | tunes the whole prompt | adds a sub-agent under its domain |

### Tool taxonomy

```mermaid
flowchart TD
    Tool[Tool]
    Tool --> W["<b>Write</b><br/>always HITL<br/>owning specialist only"]
    Tool --> R["<b>Read</b><br/>no approval<br/>owning specialist only"]
    Tool --> X["<b>Cross-module read</b><br/>published to registry<br/>any specialist can consume<br/>RBAC re-checked at callee"]

    style W fill:#FFC107
    style R fill:#E6EEFF
    style X fill:#CCE5FF
```

| Category | HITL | Visibility | Example |
|---|---|---|---|
| Write | ✅ | Owning specialist | `planner_assignTask`, `identity_updateMyDisplayName` |
| Read | — | Owning specialist | `planner_getTask`, `identity_whoAmI` |
| Cross-module read | — | Any specialist (RBAC-gated) | `timesheet_getCapacityThisWeek`, `identity_getTimezoneForUser` |

---

## How a request travels

### Read path (no approval)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant T as Top Supervisor
    participant D as Work Supervisor
    participant S as planner specialist
    participant DB as Postgres

    U->>T: "show task #142"
    T->>D: route to Work
    D->>S: delegate to planner
    S->>DB: SELECT
    DB-->>S: row
    S-->>U: streamed answer
```

### Write path (with HITL)

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant T as Top Supervisor
    participant W as workflow
    participant DB as Postgres
    participant C as Approval card

    U->>T: "create task X"
    T->>W: invoke dedupOnCreate
    W->>DB: vector search
    DB-->>W: candidates
    W->>C: suspend · emit card
    C-->>U: render
    U->>C: pick action
    C->>W: resume with chosen args
    W->>DB: INSERT · emit event
    W-->>U: confirmation
```

Same shape regardless of depth: any write-tool, anywhere in the tree, suspends to a card and resumes on the user's decision.

---

## Two flagship workflows

### 🪣 Dedup on create

```mermaid
flowchart LR
    Draft[New task draft] --> Embed[Embed + vector search]
    Embed --> Score{Similarity}
    Score -- "no match" --> Create[Create directly]
    Score -- "maybe / likely dup" --> Card[Approval card]
    Card -- Create anyway --> Create
    Card -- "Comment on #N" --> Comment[Comment, no new task]
    Card -- "Related to #N" --> Related[Create as related]
    Card -- "Sub-task of #N" --> Sub[Create as sub-task]
    Card -- Cancel --> Stop[End]

    style Card fill:#FFC107
    style Create fill:#E6EEFF
    style Comment fill:#E6EEFF
    style Related fill:#E6EEFF
    style Sub fill:#E6EEFF
```

| Aspect | Behavior |
|---|---|
| **Why it exists** | Duplicate tickets are silent tax: same triage three times, fragmented context, lopsided backlogs |
| **Thresholds** | Per-tenant tunable. Loose for consulting (many similar client tickets), strict for product teams |
| **Bulk import** | Same logic, log-only mode — no approval cards on a 1,000-row CSV |
| **Cost** | Reads only; embedding is in-memory until the user decides |

### 🎯 Skill-match assignment

```mermaid
flowchart TD
    Task[Task needing assignee]
    Task --> Exact["<b>Exact branch</b><br/>SQL: skills ∩ tags<br/>filtered by availability"]
    Task --> Vector["<b>Vector branch</b><br/>user-profile embedding match"]

    Exact --> Merge[Merge by user_id]
    Vector --> Merge

    Merge --> Enrich["<b>Enrich (parallel reads)</b><br/>open task count · capacity · timezone"]
    Enrich --> Rank["<b>Rank</b><br/>weighted score, per-tenant tunable"]
    Rank --> Card[Top-5 approval card]
    Card --> Assign[Assign · Override · Leave unassigned]

    style Card fill:#FFC107
    style Assign fill:#E6EEFF
```

**Candidate signal sources** — every candidate carries at most five signals:

```mermaid
graph LR
    U[Candidate user]
    U --> S1["⚡ exact skill overlap<br/>(SQL)"]
    U --> S2["🧭 vector similarity<br/>(pgvector)"]
    U --> S3["📊 current load<br/>(planner read)"]
    U --> S4["⏱ free hours this week<br/>(timesheet read)"]
    U --> S5["🌐 timezone match<br/>(identity read)"]

    S1 --> Score["weighted sum<br/>per-tenant weights"]
    S2 --> Score
    S3 --> Score
    S4 --> Score
    S5 --> Score

    Score --> Final[final score]

    style Score fill:#FFC107
    style Final fill:#0047FF,color:#fff
```

**Cross-module reads in action** — the workflow doesn't know which module supplied which signal:

```mermaid
graph TB
    WF["assignBySkill workflow"]
    R1["planner_getOpenTaskCountForUser"]
    R2["timesheet_getCapacityThisWeek<br/><i>(optional · future)</i>"]
    R3["identity_getTimezoneForUser"]

    WF -->|"by tool id, via registry"| R1
    WF -->|"by tool id, via registry"| R2
    WF -->|"by tool id, via registry"| R3

    R1 --> M1[planner module]
    R2 --> M2[timesheet module]
    R3 --> M3[identity module]

    classDef workflow fill:#FFC107
    classDef read fill:#CCE5FF
    classDef module fill:#E6EEFF
    class WF workflow
    class R1,R2,R3 read
    class M1,M2,M3 module
```

| Aspect | Behavior |
|---|---|
| **Triggers** | Chat ("who should take #142"), auto-suggest after creation, planner UI button |
| **Signals used** | Exact tag overlap · vector similarity · current load · free hours · timezone overlap |
| **Tunable per tenant** | Score weights between the five signals |
| **Auto-assign** | Never. Agent suggests, user assigns. Non-negotiable. |
| **Graceful degradation** | Timesheet absent → capacity column shows `?`. No embedding → exact overlap still works. No tags → vector carries via description. |

---

## The HITL guarantee

> **Every write tool in the system requires explicit user approval. No exceptions, no "low-risk" bypasses.**

```mermaid
stateDiagram-v2
    [*] --> Running
    Running --> Suspended: write tool reached
    Suspended --> Suspended: card visible · state persisted
    Suspended --> Approved: user confirms (optionally overriding args)
    Suspended --> Declined: user rejects
    Suspended --> Expired: TTL elapsed (default 72h)
    Approved --> Running
    Declined --> [*]
    Expired --> [*]
    Running --> [*]
```

**Anatomy of an approval card:**

```mermaid
graph TB
    Card["<b>Approval card</b>"]
    Card --> H["<b>Header</b><br/>intent · risk badge · summary"]
    Card --> B["<b>Body (one of):</b>"]
    Card --> A["<b>Actions</b><br/>primary · alternates · decline"]

    B --> L1["Text"]
    B --> L2["Key-value table"]
    B --> L3["Candidate list ★"]
    B --> L4["Diff"]
    B --> L5["Checklist"]

    style Card fill:#FFC107
    style H fill:#fff3cd
    style B fill:#fff3cd
    style A fill:#fff3cd
```

| Card layout | Used by |
|---|---|
| **Text** | Simple confirmations |
| **Key-value table** | Field changes |
| **Candidate list** ★ | Dedup duplicates, assignment suggestions |
| **Diff** | Edits to existing entities |
| **Confirmation checklist** | Destructive operations |

**How alternates work** — picking "Assign to Bob" instead of the top suggestion just patches the tool's arguments:

```mermaid
sequenceDiagram
    participant U as User
    participant C as Card
    participant T as Tool (suspended)
    Note over T: original args:<br/>{ assigneeId: "alice" }
    U->>C: clicks "Assign to Bob"
    C->>T: resume(modifiedArgs={ assigneeId: "bob" })
    Note over T: runs with patched args
```

**Persistence**: cards survive refreshes, logouts, restarts. The user can act tomorrow morning on a card from this afternoon. Auto-decline after 72h with an audit row.

**Audit**: every approval, decline, override, and expiry writes to the same outbox the domain events use. One unified history.

---

## Built on Mastra

We didn't write the runtime. [Mastra](https://mastra.ai) ships hierarchical supervisors, tool calling, suspension/resume for HITL, workflow orchestration, vector retrieval, and conversation memory as TypeScript primitives.

```mermaid
graph LR
    Modules["packages/&lt;module&gt;<br/>(planner, identity, …)"]
    Registry["@seta/copilot-sdk<br/>(registry)"]
    Engine["@seta/copilot<br/>(supervisor builder)"]

    subgraph Mastra
        MCore["Agent · Tool · Workflow"]
        MRag["Vector retrieval"]
        MStore["Postgres adapter<br/>(vectors + memory)"]
    end

    Modules --> Registry
    Engine --> Registry
    Engine --> MCore
    Engine --> MStore
    Modules --> MCore
    Modules --> MRag
    MRag --> MStore

    classDef ours fill:#0047FF,color:#fff
    classDef mastra fill:#FFC107,color:#000
    class Modules,Registry,Engine ours
    class MCore,MRag,MStore mastra
```

| What we get from Mastra | What we add |
|---|---|
| Agent hierarchy + delegation | Domain ↔ module mapping rules |
| Native HITL suspend/resume | Typed approval card schema |
| Workflow engine | Two flagship workflows + their tunables |
| Vector retrieval + reranker | Per-tenant weights |
| Conversation memory persistence | Module-owned registry seam |
| OpenTelemetry traces | Dashboards + per-workflow quality metrics |

**Boundary in one line:** modules speak to the registry, the engine reads the registry and builds Mastra agents. Neither imports the other.

---

## Retrieval — vectors for one thing only

```mermaid
flowchart LR
    Q[Query: title + description]
    F["SQL pre-filter<br/>(tenant · status · date)"]
    V[pgvector ANN]
    R[Mastra reranker]
    Top[Top-N candidates]

    Q --> F --> V --> R --> Top

    style R fill:#FFC107
```

**Vectors are a derived index, never the source of truth.** Anything that admits an exact match (IDs, status, dates, RBAC, exact tags) stays in Postgres. We use vectors for *fuzzy match that exact match would miss* — "Safari login broken" ≈ "OAuth redirect Safari", "auth experience" ≈ "OAuth specialist".

**Hybrid always.** SQL filter is pushed into the same pgvector call, then Mastra's reranker produces the final order. No hand-written scoring formulas.

**Sync is event-driven** — source of truth never gets out of step with the index:

```mermaid
sequenceDiagram
    autonumber
    participant API as planner.createTask
    participant Tx as transaction
    participant Tbl as planner.tasks
    participant Out as core.events<br/>(outbox)
    participant W as embedding worker
    participant Emb as task_embeddings

    API->>Tx: open
    Tx->>Tbl: INSERT
    Tx->>Out: append task.created
    Tx-->>API: commit
    Out-->>W: notify (or 2s poll)
    W->>W: skip if source_hash unchanged
    W->>Emb: upsert vector + model_id + hash
```

| Property | How |
|---|---|
| **Idempotent** | Keyed on event id; safe to redeliver |
| **Skip-when-unchanged** | `source_hash` comparison before re-embed |
| **Model-upgrade safe** | `model_id` column → backfill filters on stale rows only |
| **Delete safe** | Source delete → cascade to embedding row |

---

## Operational story

### Observability — measured at every layer

```mermaid
graph TB
    Top[Top Supervisor]
    Dom[Domain Supervisor]
    Spec[Specialist]
    WF[Workflow step]
    Tool[Tool call]
    DB[(Postgres / pgvector)]

    Top --> Dom --> Spec
    Spec --> Tool
    Spec --> WF
    WF --> Tool
    Tool --> DB

    Top -.metric.-> OTel[OpenTelemetry → Grafana]
    Dom -.metric.-> OTel
    Spec -.metric.-> OTel
    WF -.metric.-> OTel
    Tool -.metric.-> OTel

    style OTel fill:#FFC107
```

Every box reports latency + token cost. When "the assistant feels slow", we can name the layer.

### Audit — one chronological tape

```mermaid
timeline
    title Audit tape — core.events
    User asks find someone : chat.message.received
    Workflow suspends with card : copilot.workflow.suspended
    User picks Carol : copilot.approval.granted
    Tool runs : planner.task.assigned
    Subscriber re-embeds : planner.task.assigned consumed
```

| Concern | How we handle it |
|---|---|
| **Audit** | Every approval, tool call, and workflow run → `core.events`. Same outbox as domain events. |
| **Resilience** | Conversation + suspended runs persist in Postgres. No in-memory state lost to restarts. |
| **Safety rails** | Delegation depth cap (≤4 hops), loop detection, per-tenant step budget. Runaway → structured error, never wall-clock timeout. |
| **Evaluation** | Three layers: tool integration tests · workflow golden-trace replays · agent routing + e2e evals. Merge-gating + nightly. |

### Eval bar (merge-gating)

```mermaid
graph LR
    T["<b>Tools</b><br/>integration tests<br/>real Postgres"]
    W["<b>Workflows</b><br/>golden-trace replays<br/>dedup P≥0.90, R≥0.80"]
    A["<b>Agents</b><br/>routing 50 prompts ≥95%<br/>e2e 20 flows ≥90%"]

    T --> Merge[merge gate]
    W --> Merge
    A --> Merge

    style Merge fill:#0047FF,color:#fff
```

---

## How this absorbs the next module

```mermaid
graph LR
    M["new module<br/>(e.g. timesheet)"]
    R["registry"]
    S["supervisor tree"]

    M -->|"<b>1.</b> register specialist"| R
    M -->|"<b>2.</b> publish cross-module reads"| R
    R -->|"<b>3.</b> rebuild on next boot"| S

    style M fill:#0047FF,color:#fff
    style R fill:#E6EEFF
    style S fill:#FFC107
```

Three actions, none of them touch the copilot package. The new specialist appears under its domain on the next process restart; existing specialists immediately gain access to whatever reads the new module published. This is the property that lets the platform grow without a coordination tax on the copilot team.

---

## What's deferred

| Item | Why | Un-defer when |
|---|---|---|
| Dedup on **update** | Noisy signal — every keystroke would fire a card | Duplicate-create rate stays above zero after v1 |
| **Knowledge domain** (RAG over docs / wiki) | Substantial separate slice (chunking, ingestion, graph-RAG) | Roadmap M3; will use Mastra's `MDocument` + `createGraphRAGTool` |
| **Learning loop** (retune weights from accept/reject) | Needs LLM-as-judge eval infrastructure first | Eval infra lands in M3 |
| **Slack / email approval surfaces** | In-app card pattern needs to bed in first | After v1 launches with steady usage |
| **Auto-assignment** | Policy decision — agent suggests, user assigns | Never |

Full deferred table: [`docs/superpowers/specs/2026-05-25-supervisor-refactor-umbrella-design.md`](superpowers/specs/2026-05-25-supervisor-refactor-umbrella-design.md) §12.

---

## References

- **Spec**: [`docs/superpowers/specs/2026-05-25-supervisor-refactor-umbrella-design.md`](superpowers/specs/2026-05-25-supervisor-refactor-umbrella-design.md)
- **Implementation plans**: `docs/superpowers/plans/2026-05-25-supervisor-refactor-pr{1,2,3}-*.md`
- **Mastra**: [supervisor agents](https://mastra.ai/docs/agents/supervisor-agents) · [approval propagation](https://mastra.ai/docs/agents/agent-approval) · [vector query tool](https://mastra.ai/reference/tools/vector-query-tool)
- **Repo-wide**: [`architecture.md`](architecture.md) · [`creating-modules.md`](creating-modules.md)
