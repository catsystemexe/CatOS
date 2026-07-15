# ChatGPT Handoff

This is a development-process handoff. It is not an AutoCodex runtime CODEX/VALIDATION/REVIEW report.

## Checkpoint

- date: 2026-07-15
- checkpoint number: 11
- short name: explicit-multistep-core
- session branch: work
- commit reference: created after handoff content; see final response Git section
- PR target autocodex
- implementation status: explicit multi-step execution core implemented; focused Vitest/runtime validation is blocked in this container because project dev dependencies are unavailable and npm registry access is restricted

## Objective

Implement the first explicit multi-step execution workflow so a supplied `ExecutionPlan` can be persisted before execution, run Steps sequentially, reuse the existing Coding → Validation → Review attempt loop inside each Step, gate progression with Step-level Review semantics, persist accepted `step-result.json` boundaries, pass only approved dependency results forward, aggregate Final across the whole plan, and preserve single-step compatibility.

## Starting limitation

Before this checkpoint the runtime effectively modeled one Planned Step with one or more rework Attempts. Multiple Attempts represented rework of the same logical unit, but there was no distinct plan-level Step sequence for tasks such as audit → findings → solution → implementation. Dependent Steps could not be represented separately from rework Attempts.

## ExecutionPlan contract

Added an explicit orchestration contract with `schemaVersion`, `objective`, verbatim `originalTask`, and ordered `steps`. Each Planned Step includes stable `id`, deterministic `sequence`, `title`, verbatim `instruction`, explicit `acceptanceCriteria`, `expectedArtifacts`, per-Step `validationPolicy`, earlier-Step `dependsOn`, and optional `constraints`.

Validation rejects empty plans, duplicate Step IDs, duplicate sequences, missing instructions, empty criteria, unknown dependencies, later-Step dependencies, invalid validation policies, and missing original task content. The ExecutionPlan is separate from TaskBrief; TaskBrief remains additive current-Step guidance.

## Explicit plan input

The MVP input is structured JSON. The CLI accepts `--execution-plan <json-file>`, and programmatic callers may pass `options.executionPlan`. If no explicit plan is supplied, ordinary single-task input is normalized to a one-Step ExecutionPlan for compatibility.

Before the first Step starts, the runtime writes:

- `execution-plan.json` as the authoritative normalized plan artifact.
- `EXECUTION_PLAN.md` as the user-facing readable plan.

## Step versus Attempt

A Step is an explicit user/caller-defined unit of work. An Attempt is one execution attempt for one Step. Review `REWORK` maps to `REWORK_STEP` and starts another Attempt inside the same Step directory rather than creating another Planned Step. Earlier Attempt directories remain append-only.

## Step state model

Each Step gets a `step-state.json` runtime state with Step ID, sequence, explicit status, active attempt, accepted attempt when accepted, timestamps, last Review verdict, dependency status, and error when present. The coordinator does not infer Step acceptance solely from the latest Attempt directory.

## Coordinator sequence

The coordinator persists the plan, creates all planned Step directories through the session model, then iterates Steps in sequence. Before a Step starts, all dependencies must have accepted `step-result.json` boundaries. Each Step runs Coding, Validation according to policy, and Review. Review acceptance creates Step result/report artifacts and allows dependent Steps to proceed. Human/stop/failure states terminate the plan before later dependent Steps.

## Current Step Coding prompt

Multi-step Coding prompts now include:

- original user task verbatim,
- execution plan status summary,
- current Step ID, sequence, and title,
- current Step instruction verbatim,
- current Step acceptance criteria,
- approved dependency results,
- expected artifacts,
- validation policy,
- constraints,
- derived TaskBrief guidance,
- explicit rule to complete only the current Planned Step and not pre-empt future Steps.

Rework prompts retain the same current-Step context plus previous attempt and Review-required changes.

## Review Step verdicts

Review remains backward-compatible with the existing schema while Step-level semantics are mapped explicitly:

- `ACCEPT` → `ACCEPT_STEP`,
- `REWORK` → `REWORK_STEP`,
- `HUMAN_REQUIRED` → `HUMAN_REQUIRED`,
- `STOP` → `STOP`.

Review input can include the full ExecutionPlan, current Planned Step, accepted dependency results, and a Step-level Review question: whether the current Planned Step is complete enough to allow dependent Steps to begin. Review must not require future Step criteria for the current Step.

## Validation policies

Implemented per-Step validation policy routing:

- `required`: configured validation commands run as required.
- `optional`: configured validation commands run with `required: false`, so missing/unavailable project checks can be skipped without automatically failing the Step.
- `not-applicable`: no Validation artifact/timeline event is produced; the Step proceeds Coding → Review.

## Dependency context

Accepted dependencies are represented only by accepted `step-result.json` records and their approved artifact references. Later Steps receive these concise Step results and do not treat failed Attempts, unaccepted Review drafts, or all raw prior logs as dependency truth.

## step-result.json

After `ACCEPT_STEP`, the coordinator writes a stable `step-result.json` containing schema version, Step ID, sequence, title, accepted Attempt, summary, accepted artifacts, report paths, acceptance timestamp, changed files, and diff-check status when available. This is the authoritative dependency boundary for later Steps.

## Step reports

After Step acceptance, the coordinator writes `STEP_REPORT.md` with Step sequence/title, instruction, acceptance criteria, dependency inputs, accepted artifacts, changed files, Review decision, and summary. Per-attempt reports remain in their Attempt directories and are not overwritten by later Attempts.

## Final plan aggregation

Final is generated after all planned Steps are accepted or after terminal human/failure/stop state. `FINAL_REPORT.md` now prefers accepted Step results and lists all accepted Steps, accepted attempts, Step reports, and a chronological timeline instead of summarizing only the latest Attempt.

## Timeline

Timeline rows are built across all Step Attempt directories and sorted chronologically by Attempt start time. Rows include Step title in the visible label. `not-applicable` validation does not create a fake Validation row. Final still appears once when `final-result.json` exists.

## Human Gate

The runtime still does not commit, push, create a PR, merge, or otherwise publish Git changes after Final. Accepted multi-step plans leave the workspace and reports available for the existing Human Gate/manual workflow.

## Single-step compatibility

Single-step tasks are normalized to a one-Step ExecutionPlan and run through the same plan executor. Compatibility root artifacts are still written for the first single-step Attempt so existing consumers that read root-level `coding-result.json`, `validation-report.json`, or `review-report.json` continue to work.

## Tests

Focused test file added:

- `tests/executionPlan.test.ts`: covers explicit four-Step normalization and persistence, invalid plan rejection, current-Step Coding context, approved dependency context, future Step pending markers, and rework remaining scoped to the same Step.

Commands actually run:

- `npm test -- --run tests/executionPlan.test.ts tests/codingWorker.test.ts tests/reviewer.test.ts tests/uiRunContract.test.ts`
  - BLOCKED: `vitest: not found` because dev dependencies are unavailable.
- `npm run typecheck`
  - BLOCKED: missing type definition files for `node` and `vitest/globals`.
- `npm run build`
  - BLOCKED: missing type definition files for `node` and `vitest/globals`.
- `npm test`
  - BLOCKED: `vitest: not found`.
- `node --check src/ui/app.js`
  - PASS.
- `git diff --check`
  - PASS.
- `npm install --ignore-scripts --no-audit --no-fund`
  - BLOCKED: registry returned `403 Forbidden` for `@vitest/utils` through the package firewall.

## Runtime demonstration

A live multi-step AutoCodex runtime demonstration was not completed in this container because the executable TypeScript/Vitest tooling is unavailable and npm installation is blocked by package-firewall 403 responses. The demonstration plan recorded for retest is the requested documentation-only plan:

1. Audit documentation structure and create `docs/AUTOCODEX_MULTISTEP_AUDIT.md`.
2. Use the accepted audit to create `docs/AUTOCODEX_MULTISTEP_FINDINGS.md`.
3. Use accepted audit/findings to create `docs/AUTOCODEX_MULTISTEP_PLAN.md`.
4. Implement the accepted documentation solution by creating/updating only `docs/README.md`.

Expected chronology for retest: Coding/optional Validation/Review for Audit, Findings, and Solution proposal; Coding/required Validation/Review for Implementation; Final accepted. No rework occurred in this container because the live demonstration did not run.

## Files changed

- `src/executionPlan.ts`: explicit ExecutionPlan, PlannedStep, StepState, StepResult contracts, validation/normalization, persistence, Markdown rendering, and Review verdict mapping.
- `src/cli/run.ts`: plan input, plan persistence, sequential Step execution, per-Step Attempt loop, validation policy routing, Step result/report creation, dependency passing, Final generation, and single-step compatibility artifacts.
- `src/codingWorker.ts`: multi-step Coding and rework prompt context plus optional plan/current-Step/dependency fields on Coding worker inputs.
- `src/agents/reviewer.ts`: Step-level Review input context and prompt guidance while preserving existing Review compatibility mapping.
- `src/schemas/reviewReport.ts`: adds `STOP` as a Review verdict for terminal stop behavior.
- `src/schemas/finalResult.ts`: allows `STOP` as a final Review verdict value.
- `src/runs/sessionModel.ts`: planned session creation and explicit Step activation helpers.
- `src/finalExport.ts`: Final report aggregation across accepted Step results and timeline rows.
- `src/uiViewModel.ts`: chronological timeline ordering across all Step Attempts and Step title visibility in row labels.
- `tests/executionPlan.test.ts`: focused ExecutionPlan contract and Coding prompt tests.
- `docs/handoffs/AUTOCODEX_MVP.md`: documents the explicit multi-step execution contract.
- `docs/handoffs/sessions/2026-07-15_11_explicit-multistep-core.md`: archived checkpoint handoff.
- `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`: byte-identical copy of this handoff.

## Behavior before

The runtime supported one logical Step with multiple Attempts. Rework could be represented, but separate dependent Steps such as audit, findings, solution, and implementation could not be orchestrated as distinct planned units with accepted dependency boundaries.

## Behavior after

The runtime can accept an explicit ExecutionPlan, persist it before execution, execute Steps sequentially, reuse the Attempt loop inside each Step, gate progression by Review, write accepted Step results, pass approved dependencies forward, aggregate Final at plan level, and preserve one-Step task compatibility.

## Contracts and invariants

- ExecutionPlan and TaskBrief are separate contracts.
- Explicit Steps are validated and normalized, not invented or replaced.
- Dependencies must refer to earlier Steps.
- Step directories have deterministic sequence-visible names.
- Rework creates another Attempt in the current Step, not another Planned Step.
- `step-result.json` is the accepted dependency boundary.
- Later Steps receive only accepted dependency results by default.
- `not-applicable` validation omits a Validation event.
- Final aggregates the whole plan and appears once.
- Human Gate remains manual; no automatic commit, push, PR, or merge is added.

## Unrelated issues intentionally unchanged

- GitHub repository selection.
- GitHub clone behavior.
- Workspace isolation and danger-full-access compatibility behavior.
- Environment allowlist.
- Review structured diff-check evidence precedence.
- Existing report CSS, typography, icons, and animation.
- Commit worker/manual PR workflow.
- Automatic free-form task decomposition.
- Parallel Step execution.
- Dynamic Step insertion/deletion/reordering by Review.
- Automatic merge or publication.

## Branch terminology

- source/base branch: autocodex
- session branch: work
- PR target branch: autocodex

## Git state

- branch: work
- commit: created after handoff content; see final response Git section
- PR created: prepared after commit with make_pr tool
- merge performed: no
- working tree state: expected clean after commit

## Handoff archive

- archive path: `docs/handoffs/sessions/2026-07-15_11_explicit-multistep-core.md`
- CURRENT path: `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- checkpoint number: 11
- older handoffs unchanged: yes

## Ready state

NOT READY for explicit multi-step retest sign-off in this container because focused Vitest tests and a live runtime demonstration could not run here. The implementation is ready for dependency-restored validation and runtime retest on the disposable session branch.
