# ChatGPT Handoff

This is a development-process handoff. It is not an AutoCodex runtime CODEX/VALIDATION/REVIEW report.

## Checkpoint

- date: 2026-07-15
- checkpoint number: 09
- short name: review-structured-evidence
- session branch: work
- commit reference: created after handoff content; see final response Git section
- PR target autocodex
- implementation status: Review structured-evidence implementation completed; focused Vitest execution remains blocked in this container because project dev dependencies are unavailable

## Objective

Make structured coordinator diff-check evidence available to Review before the model makes its decision, define evidence precedence explicitly, normalize diff-check evidence deterministically, and reconcile narrow model contradictions before `review-report.json` and Markdown are generated.

## Starting defect

A successful real runtime run produced structured coordinator evidence with `codingResult.diffCheck.status = PASS`, `codingResult.diffCheck.command = git diff --check`, and `codingResult.diffCheck.exitCode = 0`. The generated Review Markdown also displayed `structured diff-check: PASS (git diff --check)`, but the model-authored Review acceptance criterion still said `UNCERTAIN: git diff --check passes` and claimed structured diff-check output was unavailable or present only as Coding prose.

## Root cause

- `src/cli/run.ts` called `reviewChange()` for the initial Review with a manually reconstructed `codingResult` object that omitted `diffCheck`.
- `src/cli/run.ts` repeated the same omission for rework Review calls.
- `src/agents/reviewer.ts` typed the Review boundary as a partial Coding result and did not define structured coordinator evidence or evidence precedence in the Review prompt.
- `src/finalExport.ts` later rendered a structured diff-check Markdown line from `coding-result.json`, after the model decision, so Markdown could contradict the persisted `review-report.json` criterion.

## New ReviewerInput contract

`ReviewerInput.codingResult` now uses an explicit safe Coding subset that includes `threadId`, `finalResponse`, `workspacePath`, `changedFiles`, `sandboxMode`, `sandboxIsolation`, and optional `diffCheck`. Call sites use `safeReviewCodingResult()` instead of manually selecting fields that can silently drop coordinator evidence. Legacy/interrupted artifacts may omit `diffCheck`; missing evidence is typed and normalized to `UNCERTAIN`, never to `PASS`.

## Evidence precedence

Review receives an explicit structured-evidence section and precedence order:

1. Structured coordinator evidence, including `codingResult.diffCheck`, the coordinator changed-file list, and workspace/runtime boundary metadata where applicable.
2. Validation evidence, including `validation-report.json`, configured command results, and task-output checks.
3. Workspace evidence, including `workspace.diff`, `workspace-status.txt`, and actual changed files.
4. Coding natural-language claims from `codingResult.finalResponse`.

Natural-language Coding claims never override contradictory structured evidence. Validation `SKIPPED` does not erase an independent coordinator diff-check result.

## PASS / FAIL / BLOCKED / missing mapping

`normalizeDiffCheckEvidence()` maps coordinator diff-check evidence as follows:

- `PASS`: normalized state `SATISFIED`; command ran; exit code is 0; evidence names coordinator status, command, and exit code.
- `FAIL`: normalized state `NOT_SATISFIED`; command ran but failed or returned non-zero; stdout/stderr are included concisely; this is blocking when a clean diff is required.
- `BLOCKED`: normalized state `UNCERTAIN`; success was not established; it is never represented as satisfied.
- missing: normalized state `UNCERTAIN`; no structured result exists; Review must not invent PASS.

## Reconciliation behavior

Reconciliation occurs in `reviewChange()` after provider output is parsed and validated, before `writeReviewReport()` persists `review-report.json`, and before `writeSessionReport()` generates Markdown.

The reconciliation is intentionally narrow:

- If coordinator `diffCheck.status` is `PASS` and a semantically equivalent diff-check criterion is `UNCERTAIN` or `NOT_SATISFIED` because Validation skipped it or because structured evidence was incorrectly ignored, the criterion is corrected to `SATISFIED` with coordinator status/command/exit-code evidence and any limitation text.
- If coordinator `diffCheck.status` is `FAIL` and the model marks the criterion `SATISFIED`, the criterion is corrected to `NOT_SATISFIED`, a blocking finding is added when missing, and an `ACCEPT` verdict becomes `REWORK`.
- If coordinator `diffCheck.status` is `BLOCKED` and the model marks the criterion `SATISFIED`, the criterion is corrected to `UNCERTAIN`.
- Missing evidence is not forced to satisfied.

The reconciler does not rewrite unrelated criteria and does not automatically accept an otherwise rework-required change solely because diff-check passed.

## Limitations

The coordinator limitation `git diff --check does not inspect untracked file content` remains visible in normalized evidence and corrected criteria. A passed command can satisfy the command-execution criterion, but it does not independently prove exact untracked file contents. Exact file-content requirements must still be evaluated from workspace diff, file artifacts, or other evidence.

## Artifact consistency

Because reconciliation happens before persistence, `review-report.json` contains the corrected Review result. Generated Review Markdown is derived from that corrected persisted result. `FINAL_REPORT.md` does not add contradictory diff-check wording. The old contradictory pair of `structured diff-check: PASS` plus `UNCERTAIN: git diff --check passes` should no longer occur for a reconciled PASS case.

## Tests

Focused tests added/updated:

- `tests/reviewer.test.ts`: verifies complete `diffCheck` reaches the provider, Review prompt includes structured coordinator evidence and evidence precedence, PASS plus Validation `SKIPPED` reconciles to `SATISFIED`, FAIL cannot remain satisfied and adds a blocking finding, BLOCKED and missing do not become PASS, the untracked-file limitation remains visible without satisfying file-content criteria, and prompt secret redaction covers API keys/authorization headers.
- `tests/runCli.test.ts`: verifies initial Review receives coordinator `diffCheck` and rework Review receives the current attempt's `diffCheck` instead of a manually truncated Coding object.
- `tests/uiRunContract.test.ts`: verifies persisted Review JSON, generated Review Markdown, and Final report do not disagree for a structured PASS case.

Commands actually run:

- `npm test -- --run tests/reviewer.test.ts tests/runCli.test.ts tests/uiRunContract.test.ts`
  - BLOCKED: `vitest: not found` because project dev dependencies are unavailable.
- `npx --yes vitest@3.2.4 run tests/reviewer.test.ts tests/runCli.test.ts tests/uiRunContract.test.ts`
  - BLOCKED: npm registry returned `403 Forbidden` for `https://registry.npmjs.org/vitest`.
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

## Runtime retest

The BEGIN/END file-content smoke was performed directly in the working tree as a local disposable check: `docs/AUTOCODEX_UI_DEMO.md` was created with the exact requested content, content comparison passed, Git status showed that file as untracked, and `git diff --check` returned exit code 0. The disposable file was removed before commit because the runtime task explicitly said not to commit it. A full AutoCodex network/model runtime retest was not performed in this container.

Expected Review behavior after this checkpoint: coordinator `diffCheck` PASS with Validation `SKIPPED` yields a `SATISFIED: git diff --check passes` criterion with evidence equivalent to `Coordinator diffCheck status PASS, command git diff --check, exit code 0`.

## Files changed

- `src/agents/reviewer.ts`: adds safe Review Coding subset, structured evidence normalization, prompt evidence/preference sections, prompt secret redaction, and narrow post-provider diff-check reconciliation.
- `src/cli/run.ts`: passes `safeReviewCodingResult(codingResult)` to initial and rework Review calls so `diffCheck` is retained.
- `src/cli/runStep.ts`: passes `safeReviewCodingResult(codingResult)` on the manual/resumed Review path.
- `tests/reviewer.test.ts`: adds focused structured-evidence prompt/reconciliation/limitation/secret tests and updates fixtures with `diffCheck`.
- `tests/runCli.test.ts`: asserts initial and rework Review receive coordinator diff-check evidence.
- `tests/uiRunContract.test.ts`: asserts Review JSON/Markdown and Final report remain consistent for diff-check PASS.
- `docs/handoffs/AUTOCODEX_MVP.md`: documents only the Review structured-evidence contract.
- `docs/handoffs/sessions/2026-07-15_09_review-structured-evidence.md`: archived checkpoint handoff.
- `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`: byte-identical copy of this handoff.

## Behavior before

Review received a manually reconstructed Coding result without `diffCheck`. The model could mark `git diff --check passes` as `UNCERTAIN` because Validation skipped the command or because it only saw Coding prose, while Markdown later added a separate structured PASS line from `coding-result.json`.

## Behavior after

Review receives coordinator `diffCheck` before model evaluation. The prompt names the coordinator evidence, explains that it is authoritative for command execution/exit status, defines evidence precedence, and includes a normalized diff-check fact. After provider output, narrow reconciliation corrects only contradictory diff-check criteria before persistence, so JSON and Markdown agree.

## Contracts and invariants

- The Review boundary preserves safe coordinator `diffCheck` fields when present.
- Structured coordinator evidence outranks Validation evidence, workspace evidence, and Coding prose.
- Validation `SKIPPED` does not invalidate independent coordinator `PASS`.
- `PASS` maps to `SATISFIED`; `FAIL` maps to `NOT_SATISFIED`; `BLOCKED` and missing map to `UNCERTAIN`.
- The untracked-file limitation remains visible and does not prove exact untracked file contents.
- Reconciliation is limited to semantically equivalent diff-check criteria.
- No Coding prompt structure, task-integrity behavior, report lifecycle timing, timeline behavior, CSS, repository selection, clone behavior, sandbox mode, validation execution, commit workflow, push workflow, PR workflow, main branch, or real_test branch behavior was intentionally changed.

## Unrelated issues intentionally unchanged

- Delayed per-attempt Markdown generation.
- Raw JSON timeline fallback before final/export.
- Final row fixture expectations.
- Legacy aggregate report paths.
- Obsolete title-case/uppercase test expectations.
- CSS assertion cleanup.
- Font-size perception.
- UI cache headers.
- Icon visual quality.
- Reduced-motion CSS.
- General timeline redesign.
- Task-integrity behavior from checkpoint 08.

## Branch terminology

- source/base branch: autocodex
- session branch: work
- PR target branch: autocodex

## Git state

- branch: work
- commit: created after handoff content; see final response Git section
- PR created: yes, after commit
- merge performed: no
- working tree state: clean after commit expected

## Handoff archive

- archive path: docs/handoffs/sessions/2026-07-15_09_review-structured-evidence.md
- CURRENT path: docs/handoffs/CURRENT_CHATGPT_HANDOFF.md
- checkpoint number: 09
- older handoffs unchanged: yes
