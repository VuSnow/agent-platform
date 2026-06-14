# PMO Ingestion Goal-Driven Implementation Plan

## 1. Objective
Build a new PMO ingestion workflow as a goal-driven adaptive flow, separate from the current legacy PMO ingestion backend.

The new flow must:
- accept natural-language goal input;
- use a lightweight LLM only for goal parsing and optional user-facing wording;
- keep workbook inspection, mapping, validation, DB diff, publish, and readiness evaluation deterministic;
- surface uncertainty as structured review cases;
- require explicit human approval before publish;
- drive a real UI in [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx).

## 2. Repo Reality and Separation Strategy

### Existing code that stays as legacy
- The current PMO workflow at [packages/pmo/src/backend/workflows/ingest-data/spec.ts](../packages/pmo/src/backend/workflows/ingest-data/spec.ts) is a mapping-review and publish flow.
- The current operational PMO page at [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx) is wired to workflow runs, approvals, and history.
- The current agentic page at [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx) is still a static prototype.

### New architecture boundary
Do not evolve the new goal-driven flow by stretching the legacy `pmo.ingestData` workflow.

Instead:
- keep `pmo.ingestData` intact as the legacy path;
- create a new workflow family for the agentic flow;
- reuse deterministic ingestion primitives where they are still correct, such as workbook parsing, column profiling, sheet-role scoring, normalization helpers, and publish internals;
- move only reusable deterministic logic into shared helpers, never the legacy workflow control flow.

### New top-level shape
- Legacy workflow remains: `pmo.ingestData`
- New workflow should be introduced beside it, for example: `pmo.agenticIngest`
- Legacy PMO page remains: [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx)
- New agentic page becomes the primary UI for the new flow: [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx)

## 3. Non-Negotiable Rules
- LLM parses goal text into structured JSON only.
- LLM may optionally generate clarification wording and short summaries, but cannot create executable steps.
- Planner builds plans only from a fixed step enum.
- Workbook parsing, template detection, sheet-role detection, coverage detection, column profiling, mapping, validation, DB diff, publish readiness, publish, dataset versioning, and downstream readiness stay deterministic.
- `Answer_Key` is always ignored.
- Unknown template is not an immediate failure.
- Business anomalies such as overbook or underlogged are downstream findings, not ingestion blockers.
- Publish is always explicit user approval.

## 4. Target Delivery Model

```text
User goal + uploaded workbook
-> parse goal with strict JSON schema
-> create ingestion session
-> build deterministic initial plan
-> inspect workbook and detect template/coverage
-> refine plan from evidence
-> propose mappings and validations
-> create review cases
-> user resolves only goal-relevant cases
-> normalize and validate staging
-> compute DB changes
-> evaluate publish readiness
-> explicit publish approval
-> publish canonical data + dataset version
-> evaluate downstream readiness
```

## 5. Proposed New Backend Surface

### Shared contracts
Add shared types to [packages/pmo/src/contracts.ts](../packages/pmo/src/contracts.ts) and export them through `@seta/pmo/contracts`.

Add at least:
- `IngestionGoalType`
- `IngestionCapability`
- `IngestionGoalParseResult`
- `IngestionPlanStepId`
- `IngestionPlan`
- `TemplateMatchStatus`
- `SchemaStrategy`
- `ReviewCaseType`
- `ReviewCaseSeverity`
- `PublishReadiness`
- `DownstreamReadiness`
- `AgenticIngestionViewModel`

### New backend folders
Create a new flow surface under [packages/pmo/src/backend/workflows](../packages/pmo/src/backend/workflows), for example:

```text
packages/pmo/src/backend/
	agentic/
		goal-parser.ts
		planner.ts
		controller.ts
		review-cases.ts
		readiness.ts
		downstream-readiness.ts
		view-model.ts
	workflows/
		agentic-ingestion/
			schemas.ts
			spec.ts
			steps/
				parse-goal.ts
				inspect-workbook.ts
				identify-template.ts
				detect-coverage.ts
				propose-mappings.ts
				normalize-staging.ts
				compute-db-changes.ts
				publish.ts
	http/
		routes.ts
```

### New persistence needs
Extend [packages/pmo/src/backend/db/schema.ts](../packages/pmo/src/backend/db/schema.ts) with new goal-driven session metadata and case persistence.

At minimum add:
- `raw_goal_text`
- `parsed_goal_json`
- `goal_type`
- `goal_confidence`
- `goal_clarification_needed`
- `goal_user_confirmed`
- `generated_plan_json`
- `template_match_json`
- `coverage_json`
- `publish_readiness_json`
- `downstream_readiness_json`

Add new tables if needed:
- `ingestion_goal_audits`
- `ingestion_review_cases`
- `ingestion_case_resolutions`
- `approved_mappings`
- `dataset_versions`

## 6. Step-by-Step Implementation Plan

Each step below states:
- which part of the intended flow it implements;
- which backend changes are required;
- which UI changes are required;
- the exit criteria before moving on.

### Step 1. Carve out the new flow boundary
Flow coverage:
- prerequisite for all phases.

Backend:
- Create a new workflow id, for example `pmo.agenticIngest`, under a new folder beside the legacy flow.
- Keep [packages/pmo/src/backend/workflows/ingest-data/spec.ts](../packages/pmo/src/backend/workflows/ingest-data/spec.ts) untouched except for extracting reusable deterministic helpers if needed.
- Add a dedicated agentic state enum instead of reusing the legacy status machine in [packages/pmo/src/backend/domain/ingestion-session.ts](../packages/pmo/src/backend/domain/ingestion-session.ts).
- Update workflow registration so both legacy and new workflows can coexist.

UI:
- Treat [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx) as legacy UI.
- Treat [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx) as the new UI target.
- Do not share the current legacy run-view logic directly into the new page until a new view-model adapter exists.

Exit criteria:
- New workflow spec exists and is registered.
- Legacy `pmo.ingestData` still works unchanged.

### Step 2. Introduce shared contracts for goal, plan, case, readiness
Flow coverage:
- Phase 0 Step 0.1
- Phase 1 Step 1.1
- Phase 6 Step 6.1
- Phase 10 Step 10.1
- Phase 12 Step 12.1

Backend:
- Implement shared contracts in [packages/pmo/src/contracts.ts](../packages/pmo/src/contracts.ts).
- Define fixed step ids only, matching the deterministic flow:
	- `inspect_workbook`
	- `identify_template`
	- `detect_sheet_roles`
	- `detect_canonical_coverage`
	- `profile_columns`
	- `propose_mappings`
	- `validate_mapping_plan`
	- `resolve_required_cases`
	- `normalize_to_staging`
	- `validate_staging`
	- `validate_cross_sheet_references`
	- `compute_db_changes`
	- `evaluate_publish_readiness`
	- `await_publish_approval`
	- `publish_to_canonical_db`
	- `create_dataset_version`
	- `evaluate_downstream_readiness`
	- `generate_coverage_report`
	- `generate_validation_report`
	- `generate_mapping_report`
	- `generate_preview_report`

UI:
- Use the shared contracts in web code instead of redefining ad-hoc page-only types.
- Add page-level types for cards such as current goal, suggested plan, workbook coverage, review cases, mapping preview, next best action, and activity log.

Exit criteria:
- Backend and web both consume the same PMO agentic contracts through `@seta/pmo/contracts`.

### Step 3. Extend ingestion session persistence for goal-driven state
Flow coverage:
- Phase 0 Step 0.3
- Phase 1 Step 1.1
- state machine support for all later phases.

Backend:
- Extend [packages/pmo/src/backend/db/schema.ts](../packages/pmo/src/backend/db/schema.ts) for goal/plan/readiness fields.
- Add review case persistence tables and mapping approval snapshot tables.
- Add migrations through the standard Drizzle workflow.
- Add a new agentic session state enum that matches the intended state machine:
	- `uploaded`
	- `parsing_goal`
	- `goal_parsed`
	- `awaiting_goal_clarification`
	- `plan_drafted`
	- `awaiting_plan_start`
	- `inspecting_workbook`
	- `workbook_inspected`
	- `identifying_template`
	- `template_identified`
	- `detecting_sheet_roles`
	- `sheet_roles_detected`
	- `checking_canonical_coverage`
	- `coverage_checked`
	- `refining_plan`
	- `plan_ready`
	- `awaiting_coverage_resolution`
	- `profiling_columns`
	- `columns_profiled`
	- `proposing_mappings`
	- `mappings_proposed`
	- `validating_mapping_plan`
	- `mapping_plan_validated`
	- `awaiting_mapping_resolution`
	- `mapping_approved`
	- `normalizing_to_staging`
	- `staging_normalized`
	- `validating_staging`
	- `staging_validated`
	- `awaiting_data_quality_resolution`
	- `validating_cross_sheet_references`
	- `cross_sheet_validated`
	- `computing_db_changes`
	- `db_changes_computed`
	- `awaiting_db_change_resolution`
	- `evaluating_publish_readiness`
	- `publish_recommended`
	- `awaiting_publish_approval`
	- `publishing`
	- `published`
	- `dataset_version_created`
	- `evaluating_downstream_readiness`
	- `ready_for_downstream_analysis`

UI:
- Prepare the new page to render from persisted session state rather than workflow-step heuristics alone.

Exit criteria:
- One agentic session row can hold goal, plan, evidence snapshots, readiness, and UI-facing status.

### Step 4. Build goal parser with strict schema and fallback
Flow coverage:
- Phase 0 Step 0.1
- Phase 0 Step 0.2
- Phase 1 Step 1.2

Backend:
- Implement `parseIngestionGoal(goalText)` in a new goal parser service.
- Use lightweight LLM with strict JSON schema.
- Add deterministic fallback for obvious commands such as validate-only, missing-data check, timesheet-only, or publish/RA preparation.
- Persist parser source, confidence, clarification requirement, and reasoning summary.
- Add clarification-choice generation using ambiguity categories, not free-form agent output.

UI:
- Add a goal input field to [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx).
- Add a clarification state panel with structured actions when parser confidence is low or goal is ambiguous.
- Update the Current goal card to render:
	- raw user goal;
	- interpreted goal type;
	- confidence;
	- clarification state.

Exit criteria:
- Natural-language goals produce structured JSON or a required clarification prompt.
- Publish-intent goals cannot auto-start without explicit confirmation.

### Step 5. Add agentic upload/session bootstrap endpoints
Flow coverage:
- Phase 0 Step 0.3
- Phase 1 Step 1.2

Backend:
- Extend [packages/pmo/src/backend/http/routes.ts](../packages/pmo/src/backend/http/routes.ts) or add dedicated agentic endpoints.
- Support upload plus goal bootstrap in one session-creation path.
- Return session metadata needed by the new page:
	- session id;
	- file key;
	- raw goal;
	- parsed goal summary;
	- whether clarification is required;
	- whether user must explicitly start plan.

UI:
- Add new API client methods in [apps/web/src/modules/pmo/api/client.ts](../apps/web/src/modules/pmo/api/client.ts) for:
	- creating an agentic session;
	- starting an agentic plan;
	- fetching session details;
	- resolving clarification.
- Add new hooks beside [apps/web/src/modules/pmo/hooks/use-start-pmo-ingest.ts](../apps/web/src/modules/pmo/hooks/use-start-pmo-ingest.ts) for the new flow rather than overloading the legacy hook.

Exit criteria:
- User can upload a workbook and goal into a new agentic session without invoking the legacy workflow.

### Step 6. Build deterministic initial planner
Flow coverage:
- Phase 1 Step 1.1
- Phase 1 Step 1.2

Backend:
- Implement `buildIngestionPlanFromGoal(parsedGoal)` as pure deterministic logic.
- Encode policy:
	- confidence >= 0.85 and no publish -> auto-start allowed;
	- confidence >= 0.85 and publish required -> show plan preview and require Start Plan;
	- confidence 0.60 to 0.85 -> require confirm inferred goal;
	- confidence < 0.60 -> clarification.
- Persist generated plan JSON to session.

UI:
- Replace the static Suggested plan list in [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx) with live plan data.
- Add a Start Plan action that is shown only when policy requires user confirmation.

Exit criteria:
- Different goals produce different plans and stop conditions.

### Step 7. Implement workbook inspection and ignored-sheet detection
Flow coverage:
- Phase 2 Step 2.1
- Phase 2 Step 2.2

Backend:
- Reuse [packages/pmo/src/backend/ingestion/parse-workbook.ts](../packages/pmo/src/backend/ingestion/parse-workbook.ts) as the workbook parser.
- Add a new `inspectWorkbook()` step that returns UI-friendly sheet metadata, candidate headers, merged-cell flags, hidden-row flags, and empty-sheet markers.
- Add ignored-sheet detection rules with hard ignore for `Answer_Key`.
- Persist workbook inspection summary.

UI:
- Replace the static Data snapshot and activity log mock values with real workbook summary.
- Add ignored-sheets rendering in Workbook coverage or Copilot/Investigation panel.
- Drive the Step tracker “Understand workbook” from real state.

Exit criteria:
- Workbook analysis appears in the UI without relying on template-specific assumptions.

### Step 8. Implement template identification and schema strategy selection
Flow coverage:
- Phase 3 Step 3.1
- Phase 3 Step 3.2

Backend:
- Build `identifyWorkbookTemplate(workbookProfile)` with deterministic exact/partial/unknown scoring.
- Build `chooseSchemaStrategy(templateMatch)` returning:
	- `template_exact`
	- `template_adaptive`
	- `generic_adaptive`
- Persist template signals and chosen strategy.

UI:
- Replace the static Agent status wording with real template-status messaging.
- Show exact match, partial match, or unknown-template explanation on the page.

Exit criteria:
- New page can explain why it is taking exact, adaptive, or generic mapping path.

### Step 9. Detect sheet roles and canonical coverage by goal
Flow coverage:
- Phase 4 Step 4.1
- Phase 4 Step 4.2

Backend:
- Reuse [packages/pmo/src/backend/ingestion/detect-sheet-role.ts](../packages/pmo/src/backend/ingestion/detect-sheet-role.ts) as the starting point, but wrap it in an agentic step that persists candidates, evidence, and goal-aware severity.
- Implement `detectCanonicalCoverage(sheetRoles, goalType)` as goal-aware deterministic logic.
- Distinguish:
	- required canonical data;
	- recommended/supporting data;
	- downstream impact.
- Create review cases for ambiguity, missing required data, missing recommended data, and coverage limitations.

UI:
- Replace the static Workbook coverage card with real found/missing canonical coverage.
- Add downstream impact notes to the coverage card.
- Add goal-aware warnings, not just raw “sheet missing” messages.

Exit criteria:
- Same workbook produces different severity and next steps depending on goal type.

### Step 10. Refine plan from workbook evidence and open cases
Flow coverage:
- Phase 4 Step 4.3
- Phase 6 Step 6.3

Backend:
- Implement `refinePlanFromCoverage(plan, coverage, openCases)`.
- Support plan changes such as:
	- block until missing required data is resolved;
	- continue with warnings for missing support data;
	- narrow scope to RA-only or timesheet-only when user resolves scope-changing cases.
- Persist plan revisions and audit trail.

UI:
- Update Suggested plan dynamically after coverage/case resolutions.
- Add “Plan updated because…” explanation in the agent status or Copilot panel.

Exit criteria:
- Plan changes are audit-tracked and reflected in UI, not hidden inside workflow logic.

### Step 11. Profile columns and propose mappings with deterministic scoring
Flow coverage:
- Phase 5 Step 5.1
- Phase 5 Step 5.2
- Phase 5 Step 5.3

Backend:
- Reuse [packages/pmo/src/backend/ingestion/profile-columns.ts](../packages/pmo/src/backend/ingestion/profile-columns.ts) and the current mapping/scoring helpers as the base.
- Add an agentic `proposeMappings()` service that combines:
	- template mapping;
	- synonyms and aliases;
	- data type compatibility;
	- value pattern scoring;
	- sheet context;
	- cross-sheet overlap;
	- optional LLM semantic hint as one signal only.
- Implement `validateMappingPlan(mappingCandidates, goalType)` based on goal-specific required fields.
- Persist mapping candidates and approved/blocked status separately from legacy mapping cards.

UI:
- Replace the static Mapping preview table with real mapping candidates, confidence, evidence, and status.
- Show auto-resolved, ambiguity, blocked, and low-confidence states from real data.
- Keep mapping actions scoped to structured decisions only.

Exit criteria:
- Goal-specific required fields create actionable cases instead of silent mapping failures.

### Step 12. Introduce structured review-case engine
Flow coverage:
- Phase 6 Step 6.1
- Phase 6 Step 6.2
- Phase 6 Step 6.3

Backend:
- Implement `createReviewCases()` for coverage, mapping, validation, and DB conflicts.
- Implement `resolveReviewCase(caseId, actionPayload)` with a fixed action vocabulary.
- Recompute session state and plan after every case resolution.
- Persist evidence, severity, allowed actions, and resolution history.

UI:
- Replace the static Review cases section with real case cards.
- Add action handlers for:
	- approve suggestion;
	- choose another mapping;
	- continue with warning;
	- upload missing data;
	- use default fallback;
	- block publish.
- Replace the static Next best action card with a rule-based highest-priority unresolved case.

Exit criteria:
- User resolves only current-goal-relevant uncertainty.

### Step 13. Normalize approved mappings to staging with lineage
Flow coverage:
- Phase 7 Step 7.1
- Phase 7 Step 7.2

Backend:
- Reuse [packages/pmo/src/backend/ingestion/normalize-rows.ts](../packages/pmo/src/backend/ingestion/normalize-rows.ts) where valid.
- Persist approved mappings in dedicated mapping snapshot tables.
- Implement `normalizeToStaging(sessionId, approvedMappings)` with lineage metadata for source sheet, row number, hash, and reporting period.
- Ensure staging is separate from publish.

UI:
- Update step tracker and activity log for mapping approval and staging normalization.
- Expose a normalized row count or table-level normalization summary in the page status if useful.

Exit criteria:
- Staging rows are reproducible and traceable back to workbook lines.

### Step 14. Validate staging data and cross-sheet references
Flow coverage:
- Phase 8 Step 8.1
- Phase 8 Step 8.2

Backend:
- Implement `validateStagingData(sessionId, goalType)` for row-level deterministic validation.
- Implement `validateCrossSheetReferences(sessionId)` for member, project, calendar, and related reference checks.
- Separate hard ingestion blockers from downstream limitations.
- Convert findings into structured review cases when user action is needed.

UI:
- Add validation findings to the Review cases section and Copilot/Investigation summary.
- Drive the Step tracker “Validate data” from actual validation state.

Exit criteria:
- Technical data-integrity failures block ingestion.
- Business interpretation issues do not masquerade as ingestion blockers.

### Step 15. Compute DB changes and DB review cases
Flow coverage:
- Phase 9 Step 9.1
- Phase 9 Step 9.2

Backend:
- Build `computeDbChanges(sessionId)` as an explicit stage in the new workflow.
- Reuse publish diff logic where correct, but persist structured change-set output instead of only approval-card payloads.
- Create DB review cases for updates, conflicts, invalid rows, duplicates, and safe inserts.

UI:
- Add a real DB change summary section to the agentic page instead of relying on legacy PMO tab parsing.
- Show grouped changes by canonical table with per-case actions where needed.
- Drive “Review DB changes” step from the persisted change-set and open DB cases.

Exit criteria:
- DB review is understandable from persisted structured data, not only from workflow suspend payloads.

### Step 16. Evaluate publish readiness and gate explicit publish approval
Flow coverage:
- Phase 10 Step 10.1
- Phase 10 Step 10.2

Backend:
- Implement `evaluatePublishReadiness(sessionId)`.
- Readiness must be rule-based using open blockers, warnings, mapping status, validation status, DB change status, and user resolutions.
- Persist readiness result and publish recommendation summary.
- Add a publish-approval gate in the new workflow, distinct from the legacy publish review card.

UI:
- Replace the static Overall readiness widget with real readiness state.
- Replace the static publish recommendation copy with real readiness summary and warnings.
- Add explicit publish CTA only when readiness is `ready` or `ready_with_warnings` and goal requires publish.

Exit criteria:
- Open blocking cases always prevent publish.
- Warnings can proceed only through explicit user approval.

### Step 17. Publish canonical data and create dataset version
Flow coverage:
- Phase 11 Step 11.1
- Phase 11 Step 11.2

Backend:
- Reuse or refactor [packages/pmo/src/backend/ingestion/publish-upsert.ts](../packages/pmo/src/backend/ingestion/publish-upsert.ts) as a deterministic publish primitive.
- Add dataset-version creation after successful publish.
- Persist audit, lineage, and dataset version linkage.
- Ensure downstream consumers can read by dataset version rather than raw ingestion session.

UI:
- Show publish result, written rows, skipped rows, warnings, and dataset version id in the final summary.
- Add download/export report action against real session outputs.

Exit criteria:
- Successful publish yields canonical data plus stable dataset version.

### Step 18. Evaluate downstream readiness and expose post-publish capabilities
Flow coverage:
- Phase 12 Step 12.1
- prepares Phase 13.

Backend:
- Implement `evaluateDownstreamReadiness(datasetVersionId, goalType)`.
- Return readiness for:
	- `ra_calculation`
	- `timesheet_comparison`
	- `overbook_idle_detection`
	- `exception_analysis`
	- `recommendation`
	- `what_if_rebalancing`
- Persist limitations such as missing leave/holiday data or defaulted calendar.

UI:
- Add a downstream-readiness area to the page or summary state.
- Replace the current mock “Overall readiness” semantics with explicit capability readiness.

Exit criteria:
- Final output says what the dataset is actually ready for, and what remains limited.

### Step 19. Build the agentic page from a dedicated backend view model
Flow coverage:
- all phases from UI perspective.

Backend:
- Implement a view-model adapter, for example `buildPmoIngestionViewModel(sessionId)`.
- The view model should compose session state, parsed goal, plan, workbook summary, coverage, review cases, mappings, readiness, and activity log.
- Avoid making the page reconstruct agentic state by scraping workflow suspend payloads the way the legacy page currently does.

UI:
- Refactor [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx) to fetch and render the backend view model.
- Keep the existing visual structure where useful:
	- Current goal
	- Agent status
	- Next best action
	- Overall readiness / downstream readiness
	- Step tracker
	- Suggested plan
	- Workbook coverage
	- Review cases
	- Mapping preview
	- Copilot / Investigation panel
	- Activity log
- Replace every hard-coded constant with real data.

Exit criteria:
- The agentic page becomes a real UI backed by the new backend flow.

### Step 20. Add history, polling, and approval interactions for the new page
Flow coverage:
- session continuity across all phases.

Backend:
- Expose session list/detail endpoints for agentic runs.
- Expose case-resolution endpoints and publish-approval endpoint.
- Reuse workflow run ids where needed, but make session detail the primary API surface for the new page.

UI:
- Add hooks for list/detail refresh and case resolution.
- Reuse existing query patterns from the workflow pages where useful, but make the agentic page session-centric instead of approval-inbox-centric.
- Optionally show workflow run link-outs for diagnostics, not as the primary state source.

Exit criteria:
- User can leave and re-enter the page and continue from persisted session state.

### Step 21. Add test coverage in the same order as the build
Flow coverage:
- all phases.

Backend tests:
- Goal parsing fallback and schema validation.
- Initial plan generation by goal type.
- Template exact/partial/unknown detection.
- Goal-aware coverage severity.
- Mapping validation by goal.
- Review case creation and resolution effects.
- Publish readiness rules.
- Dataset version creation and downstream readiness.

Integration tests:
- Exact BTC-like workbook full pass.
- Non-standard renamed sheets still detect RA and Timesheet.
- Missing optional support sheets create warnings only.
- Missing required canonical data creates blocking or clarification cases.
- `Answer_Key` is ignored.

UI tests:
- Goal input and clarification path.
- Suggested plan renders from real backend data.
- Review cases and next-best-action update after resolution.
- Publish button availability follows readiness rules.
- Agentic page no longer renders static mock values.

Exit criteria:
- Typecheck, lint, PMO tests, and the agentic page tests pass.

## 7. Recommended Delivery Sequence

Deliver in this order to keep risk low:

1. Step 1 to Step 3: carve-out, contracts, persistence.
2. Step 4 to Step 6: goal parser, upload bootstrap, initial planner.
3. Step 7 to Step 10: workbook understanding, template, coverage, plan refinement.
4. Step 11 to Step 12: mappings and review-case engine.
5. Step 13 to Step 16: staging, validation, DB changes, publish readiness.
6. Step 17 to Step 20: publish, dataset version, downstream readiness, real UI integration.
7. Step 21: full test sweep and stabilization.

## 8. What We Reuse vs Replace

### Reuse
- [packages/pmo/src/backend/ingestion/parse-workbook.ts](../packages/pmo/src/backend/ingestion/parse-workbook.ts)
- [packages/pmo/src/backend/ingestion/profile-columns.ts](../packages/pmo/src/backend/ingestion/profile-columns.ts)
- [packages/pmo/src/backend/ingestion/detect-sheet-role.ts](../packages/pmo/src/backend/ingestion/detect-sheet-role.ts)
- [packages/pmo/src/backend/ingestion/normalize-rows.ts](../packages/pmo/src/backend/ingestion/normalize-rows.ts)
- [packages/pmo/src/backend/ingestion/publish-upsert.ts](../packages/pmo/src/backend/ingestion/publish-upsert.ts), after tightening around new session and dataset version semantics.

### Replace or avoid reusing as control flow
- [packages/pmo/src/backend/workflows/ingest-data/spec.ts](../packages/pmo/src/backend/workflows/ingest-data/spec.ts)
- legacy status assumptions in [packages/pmo/src/backend/domain/ingestion-session.ts](../packages/pmo/src/backend/domain/ingestion-session.ts)
- workflow-suspend-payload scraping as the main UI data source in [apps/web/src/modules/pmo/pages/pmo-page.tsx](../apps/web/src/modules/pmo/pages/pmo-page.tsx)
- static mock content in [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx)

## 9. Acceptance Criteria
- Goal-driven agentic flow is implemented as a new backend flow, not as a mutation of the legacy PMO workflow.
- Natural-language goal input works end to end.
- Plan generation is deterministic and step-enum constrained.
- Workbook understanding is template-aware but tolerant of unknown formats.
- Review cases are structured, persisted, and goal-relevant.
- Publish requires explicit approval.
- Dataset version is created on publish.
- [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx) renders real backend state, not static mock data.
- Existing legacy PMO path remains functional while the new flow is built.

## 10. Immediate First Build Slice
If implementing incrementally, the first safe slice should be:

1. Step 1: carve out new workflow id and folder.
2. Step 2: add shared contracts.
3. Step 3: extend session schema.
4. Step 4: build goal parser with clarification support.
5. Step 5: add upload/session bootstrap APIs.
6. Step 6: render Current goal and Suggested plan from backend on [apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx](../apps/web/src/modules/pmo/pages/pmo-ingestion-agentic-page.tsx).

That slice gives a real starting product:
- user can enter a goal;
- upload a workbook;
- see parsed goal;
- see whether clarification is needed;
- see a real deterministic plan before workbook analysis deepens.
