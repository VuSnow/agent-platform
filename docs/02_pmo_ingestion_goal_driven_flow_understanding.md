# PMO Ingestion Goal-Driven Flow Understanding

## 1. What This Flow Is Meant To Do
This flow turns PMO workbook ingestion from fixed-step processing into goal-driven adaptive ingestion.

Core idea:
- Same workbook can produce different plans depending on user goal.
- Workflow still executes deterministic tools.
- System asks user only for uncertainty that matters to the requested goal.

## 2. Inputs
Primary inputs:
- User goal text (free text or quick-goal shortcut).
- Uploaded workbook file.
- Canonical PMO contract (BTC PMO02 as reference, not strict requirement).

Reality constraints:
- User workbook may have renamed sheets, shifted headers, mixed formats, missing/extra sheets, Vietnamese names, merged cells.
- Template mismatch is expected and must be handled.

## 3. High-Level Runtime Behavior

```text
User goal + workbook reality + canonical contract
-> parse goal
-> build initial deterministic plan
-> inspect workbook evidence
-> refine plan
-> execute tool steps
-> create review cases for uncertainty
-> user resolves required cases
-> continue or stop based on goal
-> publish only with explicit approval
```

## 4. Goal Understanding Layer
Goal parser classifies free-text intent into structured goal type.

Examples:
- "chi kiem tra thieu sheet" -> check_missing_data
- "validate truoc, khong publish" -> validate_only
- "chi ingest timesheet" -> timesheet_only_ingestion
- "prepare for RA calculation" -> prepare_for_ra_calculation

Important boundary:
- Parser does not execute ingestion.
- Parser does not decide data correctness.
- Parser does not publish.

## 5. Plan Is Goal-Dependent
The plan is not static.

Examples:
- check_missing_data: stop after coverage report.
- validate_only: stop after validation report.
- mapping_review_only: stop after mapping report.
- prepare_for_ra_calculation: include normalize, DB changes, publish gate, downstream readiness.

Same file, different goal, different stop condition.

## 6. Workbook Understanding
After upload and goal parse, workflow inspects workbook and identifies:
- sheet inventory and structure
- candidate headers
- template match status: exact, partial, unknown
- sheet role candidates by evidence
- canonical coverage by detected data, not exact sheet names

Answer_Key behavior:
- Always ignored when present.

## 7. Coverage and Goal Policy
Coverage evaluation is goal-aware.

For prepare_for_ra_calculation:
- required: resource_allocation, timesheet
- recommended: member_master, project_master, leave_holiday_records, calendar_weeks, rules_config, kpi_norms

Behavior:
- Missing required canonical data -> blocking or needs-input case.
- Missing support data -> warning and limited downstream readiness.

## 8. Mapping and Validation
Mapping uses hybrid deterministic scoring:
- template fast path (when applicable)
- synonyms
- value patterns
- sheet context
- cross-sheet overlap

Validation distinguishes:
- ingestion blockers (required field missing, type mismatch, invalid structure)
- non-blocking downstream findings (for example overbook/idle risk)

## 9. Review Cases Are The Control Mechanism
Uncertainty is represented as cases, not silent failure.

Typical case types:
- SHEET_ROLE_AMBIGUITY
- MISSING_CANONICAL_DATA
- MAPPING_AMBIGUITY
- MISSING_REQUIRED_FIELD
- TYPE_MISMATCH
- LOW_CONFIDENCE_MAPPING
- DATA_QUALITY_ISSUE
- DB_CONFLICT
- PUBLISH_BLOCKER

Each case carries:
- evidence
- confidence
- recommended action
- allowed actions
- affected sheets and columns

## 10. User Interaction Model
User resolves only what matters for current goal.

Examples:
- choose sheet role
- choose mapping
- continue with warning
- upload missing data
- approve DB update decision
- block publish

After each resolution, planner re-evaluates whether to continue, re-plan, or stop.

## 11. Publish Behavior
Publish is goal- and readiness-dependent.

Rules:
- No auto-publish in this flow.
- Explicit user approval required before publish.
- For non-publish goals, workflow ends with report output instead of DB write.

## 12. Downstream Readiness Output
Final output should state capability readiness, for example:
- ra_calculation: ready
- timesheet_comparison: ready
- exception_analysis: limited
- recommendation: limited

Limitations are explicit and tied to missing/accepted data gaps.

## 13. UI Mapping (PMO Ingestion Page)
Current goal card:
- goal text + interpreted goal type + confidence.

Agent status card:
- current workflow state + template status message.

Suggested plan card:
- real generated plan and current progress.

Workbook coverage card:
- canonical found/missing with impact by goal.

Review cases section:
- real open cases from case store.

Mapping preview:
- source to target candidates, confidence, evidence, resolution source.

Next best action:
- highest-priority unresolved case action.

Copilot panel:
- deterministic explanation from current state and cases.

## 14. What Makes This Agentic (Without Letting LLM Drive Execution)
- LLM interprets intent only.
- Deterministic planner chooses allowed steps.
- Deterministic tools produce evidence.
- Planner adapts to workbook reality.
- Human resolves meaningful uncertainty.
- Sensitive actions remain human-approved.

This is the intended balance between flexibility and operational safety.
