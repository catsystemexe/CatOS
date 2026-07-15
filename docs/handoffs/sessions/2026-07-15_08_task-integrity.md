# ChatGPT Handoff

This is a development-process handoff. It is not an AutoCodex runtime CODEX/VALIDATION/REVIEW report.

## Checkpoint

- date: 2026-07-15
- checkpoint number: 08
- short name: task-integrity
- session branch: work
- commit hash reference: created after handoff content; see final response Git section
- PR target: autocodex
- implementation status: task-integrity implementation completed; focused Vitest validation is blocked in this container because project dev dependencies are unavailable

## Objective

Guarantee that every Coding attempt receives the complete original user task verbatim while preserving TaskBrief as additive derived implementation guidance. Apply the invariant to initial Coding, rework Coding, child-process IPC, Codex SDK execution, and attempt-scoped audit artifacts without changing Review evidence handling, diffCheck Review behavior, report lifecycle, timeline behavior, CSS, typography, icons, repository selection, clone behavior, sandbox mode, validation behavior, or manual Git/PR workflow.

## Starting defect

Checkpoint 07 established that reports used `input.json.goal` and therefore displayed the original UI task, but the Coding runtime received only `TaskBrief.codexInstruction`. A real runtime task contained a complete BEGIN/END block with exact file content, yet Codex responded that the required BEGIN/END content was not included. Rework attempts had the same defect because they were built from TaskBrief-derived fields and review findings rather than from the complete original task.

## Root cause

- `src/ui/app.js` preserved the raw UI task in `payload.task`.
- `src/uiApi.ts` passed `input.task` to the CLI as `--task`.
- `src/cli/run.ts` stored that value as `goal`/`input.json.goal`, but started attempts and called `codingWorker.executeTask()` with only `analysis.taskBrief.codexInstruction`.
- `src/codingWorker.ts` `buildCodexInstruction()` previously accepted a single ambiguous `instruction` string and labeled it as `TaskBrief.codexInstruction`.
- `src/codingWorker.ts` `buildReworkCodexInstruction()` previously accepted only `ReworkPackage`, so rework Coding could omit the full original user task.

## New task-integrity invariant

The full original user task is authoritative for literal user requirements. Every Coding attempt receives that original task as one exact contiguous Markdown section titled `Original user task — verbatim`. Derived TaskBrief fields and Review rework instructions are additive guidance and must not replace, summarize, truncate, parse, normalize, or transform the original task. If derived guidance conflicts with explicit literal requirements in the original task, the prompt instructs Coding to preserve the original literal requirement and surface the conflict.

## New Coding input contract

`src/codingWorker.ts` now makes the Coding boundary explicit:

- `CodingTask.originalTask: string`
- `CodingTask.taskBrief: TaskBrief`
- `CodingTask.approvalPolicy?: "never"`
- `CodingTask.attemptNumber?: number`
- `ReworkCodingTask.originalTask: string`
- `ReworkCodingTask.taskBrief: TaskBrief`
- `ReworkCodingTask.reworkPackage: ReworkPackage`
- `ReworkCodingTask.attemptNumber: number`
- optional previous-result/review-verdict context for rework prompts

The public `CodingWorker` interface no longer exposes an ambiguous `continueInstruction()` escape hatch. The low-level Codex runtime IPC still carries the final rendered `instruction` string, but that rendered string is produced from `originalTask` plus `taskBrief`/rework context.

## Initial Coding prompt

Initial Coding prompts are rendered by `buildCodexInstruction({ originalTask, taskBrief })` in this order:

1. `# Coding task`
2. `## Original user task — verbatim`
3. exact original task string
4. `## Derived implementation guidance`
5. `TaskBrief.codexInstruction`
6. `## Acceptance criteria`
7. derived acceptance criteria
8. `## Expected files`
9. derived expected files when present
10. `## Non-goals`
11. derived non-goals
12. `## Constraints`
13. derived constraints/risk level
14. `## Execution rules`
15. existing workspace/no-commit/no-push/no-merge/no-secret safety rules plus the literal-task authority rule

## Rework Coding prompt

Rework prompts are rendered by `buildReworkCodexInstruction({ originalTask, taskBrief, reworkPackage, previousAttemptResult, reviewVerdict })` in this order:

1. `# Coding rework task`
2. `## Original user task — verbatim`
3. exact original task string
4. `## Existing derived task brief`
5. derived TaskBrief fields
6. `## Previous attempt result`
7. concise previous result
8. `## Review verdict`
9. Review verdict
10. `## Blocking findings`
11. Review blocking findings
12. `## Required changes`
13. Review/rework required changes
14. `## Acceptance criteria`
15. original derived acceptance criteria
16. `## Constraints`
17. original constraints, non-push/non-merge constraints, and conflict-preservation instructions
18. `## Preserve`
19. preserve guidance
20. `## Execution rules`
21. existing runtime and safety rules

Rework attempts are no longer constructed only from `mustChange.join("\n")` or reviewer findings.

## Attempt audit artifact

- file name: `coding-instruction.md`
- initial artifact path: `coding-instruction.md` under the run directory, with an identical session-attempt copy under `steps/001-step/attempts/001-attempt/coding-instruction.md`
- rework artifact path: `attempts/NN/coding-instruction.md`, with an identical session-attempt copy under `steps/001-step/attempts/NNN-attempt/coding-instruction.md`
- write time: immediately after attempt creation and before invoking Coding runtime
- contents: the actual rendered instruction sent to Coding
- sanitization: the artifact is built only from original task, TaskBrief, and rework context; it does not include environment variables, API keys, authorization headers, or runtime env dumps
- immutability: each attempt writes to its own attempt path and later attempts do not overwrite earlier session-attempt copies
- metadata: `coding-result.json` records `instructionArtifactPath`, `originalTaskLength`, `originalTaskSha256`, `renderedInstructionSha256`, and `attemptNumber` using relative paths and SHA-256 hashes

## Tests

Focused tests added/updated:

- `tests/codingWorker.test.ts`: prompt-builder tests verify exact original task preservation, derived guidance separation, rework prompt structure, deterministic SHA-256 hashing, and IPC request preservation closest to `CodexSdkWorker`.
- `tests/runCli.test.ts`: run-command tests verify `originalTask` and `taskBrief` are passed separately, incomplete TaskBrief guidance does not remove the original task, `coding-instruction.md` is written, fake secrets are absent, metadata/hashes are recorded, and rework attempts retain original task plus Review verdict/findings/required changes.

Commands actually run:

- `npm test -- --run tests/codingWorker.test.ts tests/runCli.test.ts`
  - BLOCKED: `vitest: not found` because project dev dependencies are unavailable.
- `npx --yes vitest@3.2.4 run tests/codingWorker.test.ts tests/runCli.test.ts`
  - BLOCKED: registry returned `403 Forbidden` for `https://registry.npmjs.org/vitest`.
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

Exact unrelated failures:

- Automated Vitest/TypeScript validation remains blocked by the same missing dependency state reported in checkpoint 07. No unrelated test failures could be reproduced because the test runner is unavailable.

## Files changed

- `src/codingWorker.ts`: replaces ambiguous Coding task inputs with explicit `originalTask`/`taskBrief` contracts, renders initial/rework prompts with original task sections, preserves runtime IPC architecture, and adds task-integrity metadata fields.
- `src/cli/run.ts`: passes original task and TaskBrief to initial/rework Coding, writes attempt-scoped `coding-instruction.md`, records hashes/metadata, and stops using `mustChange.join("\n")` as the complete rework prompt.
- `src/cli/runStep.ts`: carries the original task into manual continuation Coding prompts and writes instruction audit metadata for run-step attempts.
- `src/cli/runtimeWriteSmoke.ts`: updates the smoke worker call to the explicit task-integrity contract.
- `src/runs/sessionModel.ts`: adds `codingInstructionPath` to artifact references.
- `tests/codingWorker.test.ts`: adds focused prompt/IPC task-integrity coverage and updates worker call fixtures.
- `tests/runCli.test.ts`: adds focused run-command/rework/audit-artifact task-integrity coverage and updates worker fixtures.
- `docs/handoffs/AUTOCODEX_MVP.md`: adds the task-integrity contract only.
- `docs/handoffs/sessions/2026-07-15_08_task-integrity.md`: archived checkpoint handoff.
- `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`: byte-identical copy of this handoff.

## Behavior before

Coding received only `TaskBrief.codexInstruction`; rework Coding received only TaskBrief/review-derived rework fields. The Coding report could display `input.json.goal` even when the actual Coding prompt omitted literal original-task content.

## Behavior after

Initial Coding and rework Coding receive prompts that include the full original task verbatim as an exact contiguous section, followed by separate derived guidance and rework sections. The rendered Coding instruction is stored attempt-locally as `coding-instruction.md`, and `coding-result.json` records non-secret hashes and relative artifact metadata for auditability.

## Contracts and invariants

- Original UI task remains authoritative for literal requirements.
- Original task is stored independently from TaskBrief and passed to every Coding attempt.
- TaskBrief remains required and additive; Task Analyst is not removed or bypassed.
- Review rework instructions remain additive and do not replace the original task.
- Low-level child-process IPC still sends one rendered instruction string to Codex, preserving child-process isolation.
- No automatic commit, push, PR creation, merge, sandbox-mode change, validation behavior change, report lifecycle change, or timeline behavior change is introduced.

## Unrelated issues intentionally unchanged

- Review ignoring `codingResult.diffCheck`.
- Review evidence precedence and UNCERTAIN diff-check criteria.
- Delayed per-attempt Markdown report generation.
- Raw JSON timeline fallback.
- Final row fixture expectations.
- Legacy report path tests.
- Title-case Final report heading tests.
- CSS assertion failures.
- UI typography size and cache behavior.
- SVG visual quality and reduced-motion CSS.

## Branch terminology

- source/base branch: autocodex
- session branch: work
- PR target branch: autocodex

## Ready state

NOT READY — task-integrity implementation is complete, but focused task-integrity tests could not run in this container because `vitest` and required type definitions are unavailable. Run the focused tests in an environment with project dev dependencies installed before task-integrity runtime retest.

## Git state

- branch: work
- commit: created after handoff content; see final response Git section
- PR created: yes, after commit
- merge performed: no
- working tree state: clean after commit expected

## Handoff archive

- archive path: docs/handoffs/sessions/2026-07-15_08_task-integrity.md
- CURRENT path: docs/handoffs/CURRENT_CHATGPT_HANDOFF.md
- checkpoint number: 08
- older handoffs unchanged: yes
