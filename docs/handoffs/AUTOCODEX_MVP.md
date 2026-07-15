# AutoCodex MVP

## 1. Purpose

AutoCodex is an automated, reviewable pipeline that transfers structured work between Codex execution and GPT/ChatGPT review.

The MVP goal is:

- user selects a GitHub repository and branch,
- CatOS creates an isolated run workspace,
- Codex performs the implementation task,
- Validation checks the resulting repository state,
- Review evaluates task acceptance,
- Final summarizes the complete run,
- reports are exposed through the Console VIEW,
- development checkpoints are passed from Codex to ChatGPT through documented handoff files.

AutoCodex is not an IDE, repository browser, or autonomous merge system.

## 2. GitHub-first setup

The Console repository selector must reflect current authenticated GitHub state only.

Required behavior:

- source: GitHub REST API `/user/repos`
- `GITHUB_TOKEN` preferred
- `GH_TOKEN` fallback
- `visibility=all`
- `affiliation=owner,collaborator,organization_member`
- `per_page=100`
- Link `rel=next` pagination
- deterministic sorting
- repository IDs: `github:<owner>/<repo>`

Local repositories and previous clones must not:

- suppress a GitHub repository,
- replace it with `source:"local"`,
- change selector ordering,
- influence whether the repository appears.

When a repository disappears from GitHub, it disappears from the selector after refresh. When a repository appears on GitHub, it appears after refresh.

No local filesystem paths are exposed in the repository selector response.

## 3. Branch selection and clone

After repository selection:

- load GitHub branches,
- user selects an exact branch,
- clone exactly that repository and branch,
- use shallow single-branch clone.

Canonical clone destination:

```text
/home/runner/catos-repositories/Cloned/<owner>/<repo>/<branch>
```

Canonical clone command:

```sh
git clone \
  --branch <branch> \
  --single-branch \
  --depth 1 \
  <clean-url> \
  <target>
```

Existing checkout rules:

- validate exact repository identity,
- validate exact selected branch,
- validate clean working tree,
- do not fetch, pull, switch, delete, or overwrite it automatically in MVP.

The source clone remains immutable during a RUN.

## 4. UI start-run contract

Current request:

```json
{
  "repositoryPath": "checkout.localPath",
  "baseBranch": "checkout.branch",
  "prTargetBranch": "checkout.branch",
  "task": "string"
}
```

`repositoryPath` is the validated branch-specific clone. CatOS resolves the exact base commit, creates an isolated run workspace, and Codex works only in that isolated workspace. The source clone must remain clean.

## 5. Runtime compatibility and security

Replit currently requires Codex runtime compatibility mode:

```yaml
sandboxMode: danger-full-access
approvalPolicy: never
```

Reason: `workspace-write` relies on bwrap/user namespace capabilities unavailable in the target Replit environment.

Required safeguards:

- isolated external run workspace,
- no secrets in target repository,
- explicit environment allowlist,
- isolated `HOME` and `TMPDIR`,
- Git system/global config disabled,
- `GIT_TERMINAL_PROMPT=0`,
- coordinator write probe,
- workspace boundary and realpath checks,
- runtime manifest without secret values,
- no automatic commit, push, PR, or merge.

`danger-full-access` disables Codex sandbox isolation. The safety boundary is therefore CatOS workspace isolation, environment restriction, repository selection, Human Gate, and audit artifacts.

## 6. AutoCodex RUN model

Exactly four user-visible rows are shown:

1. CODEX
2. VALIDATION
3. REVIEW
4. FINAL

For each row the UI exposes purpose through its name, inputs through reports, outputs through report artifacts, and status/time in RUN.

Recommended statuses:

- waiting
- running
- completed
- failed
- blocked
- skipped
- rework
- human_required
- stopped
- accepted

Completed is not merely “process exited”. Completed means the step completed its functional responsibility.

## 7. Task integrity for Coding

The original UI task is the authoritative source for literal user requirements.

Required behavior:

- store the original task verbatim in `input.json.goal`,
- pass the original task verbatim to every Coding attempt, including rework attempts,
- keep the original task as an independent field separate from `TaskBrief`,
- treat `TaskBrief` as additive derived implementation guidance, not as a replacement for the original task,
- treat Review rework instructions as additive guidance, not as a replacement for the original task,
- preserve Markdown headings, blank lines, backticks, BEGIN/END markers, indentation, punctuation, and exact file-content blocks in the Coding prompt,
- retain the original task during rework attempts even when Review findings focus on only a subset of required changes,
- store the actual rendered Coding instruction attempt-locally as `coding-instruction.md`,
- keep `coding-instruction.md` free of API keys, authorization headers, secret environment values, and unnecessary absolute workspace paths,
- record non-secret task-integrity metadata such as instruction artifact path, original task length, original task SHA-256, rendered instruction SHA-256, and attempt number,
- never overwrite one attempt's instruction artifact with a later attempt's artifact.

Derived fields may include implementation guidance, acceptance criteria, expected files, non-goals, constraints, Review findings, and required rework changes. If derived guidance conflicts with an explicit literal requirement in the original task, Coding must preserve the original literal requirement and surface the conflict rather than silently changing or omitting it.

## 8. CODEX step

Purpose: perform the user task in the isolated workspace.

Inputs:

- task
- repository snapshot
- branch/base commit
- runtime configuration

Primary source artifacts:

- `coding-result.json`
- `workspace.diff`
- `workspace-status.txt`
- `runtime/runtime.json`
- `runtime/codex-runtime-error.json`
- final Codex response

User-visible report:

- `01_CODEX_REPORT.md`

The report must expose:

- task
- runtime mode
- write-probe result
- actual actions when available
- commands when available
- created / modified / deleted files
- diff and workspace result
- full final Codex response
- exact preserved runtime error

A bwrap/write failure must produce blocked or failed, not completed.

## 9. VALIDATION step

Purpose: run repository checks and report their real semantic state.

Primary source artifact:

- `validation-report.json`

User-visible report:

- `02_VALIDATION_REPORT.md`

Check states:

- PASS
- FAIL
- SKIPPED
- BLOCKED

A no-op placeholder command must be reported as SKIPPED, never PASS. When no repository checks are configured, or every configured check is SKIPPED, the overall validation result is SKIPPED rather than failed. PASS plus SKIPPED with no failed or blocked required checks is PASS; FAIL dominates; BLOCKED dominates when no FAIL exists.

Validation must distinguish repository checks from task acceptance. Generic repository validation does not prove the requested user output exists.


## 10. Review structured evidence contract

Review receives a safe structured Coding result subset directly from the coordinator, including `codingResult.diffCheck` when the coordinator produced it. Review must not reconstruct a partial Coding result that drops `diffCheck.status`, `command`, `exitCode`, `stdout`, `stderr`, `durationMs`, or `limitation`.

Evidence precedence for Review decisions is:

1. Structured coordinator evidence, including `codingResult.diffCheck`, the coordinator changed-file list, and workspace/runtime boundary metadata where applicable.
2. Validation evidence, including `validation-report.json`, configured command results, and task-output checks.
3. Workspace evidence, including `workspace.diff`, `workspace-status.txt`, and actual changed files.
4. Coding natural-language claims from `codingResult.finalResponse`.

Natural-language claims must never override contradictory structured evidence. A Validation status of `SKIPPED` does not erase an independent coordinator `diffCheck` result. A structured coordinator `PASS` may satisfy a `git diff --check` criterion even when that command is not duplicated as a configured Validation script.

Diff-check normalization for Review is deterministic:

- `PASS`: normalized to `SATISFIED` for semantically equivalent `git diff --check passes` criteria when the command ran, exit code is `0`, and no contradictory structured evidence exists.
- `FAIL`: normalized to `NOT_SATISFIED`; non-zero exit output is evidence and is blocking when the task requires a clean diff.
- `BLOCKED`: normalized to `UNCERTAIN`; success was not established and must never be represented as `SATISFIED`.
- missing legacy evidence: normalized to `UNCERTAIN`; Review must not invent `PASS`.

After the model returns a Review report, a narrow deterministic reconciliation may correct only diff-check acceptance criteria that contradict authoritative structured diff-check evidence without citing conflicting structured evidence. Reconciliation runs after provider output is parsed, before `review-report.json` is persisted, and before Markdown report generation. It may change a false `UNCERTAIN`/`NOT_SATISFIED` diff-check criterion to `SATISFIED` for coordinator `PASS`, or change a false `SATISFIED` criterion to `NOT_SATISFIED` and add a blocking finding for coordinator `FAIL`. It must not force `BLOCKED` or missing evidence to `SATISFIED`, rewrite unrelated criteria, or automatically accept an otherwise rework-required change solely because diff-check passed.

`review-report.json` and generated Review Markdown must agree about the corrected Review result. Markdown must not add a post-hoc structured diff-check line that contradicts the persisted model/reconciled criterion. Limitations such as `git diff --check does not inspect untracked file content` remain visible: they do not invalidate the command-execution criterion when the command passed, but they also do not prove exact untracked file contents. Exact file-content requirements must be evaluated from workspace diff, file artifacts, or other evidence.

## 10. REVIEW step

Purpose: compare the task acceptance criteria with actual workspace evidence.

Inputs include:

- original task
- coding result
- validation result
- workspace diff/status
- changed files
- expected outputs

User-visible report:

- `03_REVIEW_REPORT.md`

Decisions:

- ACCEPT
- REWORK
- HUMAN_REQUIRED

REWORK must contain concrete actionable instructions.

## 11. FINAL step

Purpose: create the final terminal summary of the run.

User-visible report:

- `FINAL_REPORT.md`

The report must contain:

- GitHub repository full name
- selected base branch
- internal run branch separately
- run ID
- terminal status
- durations
- all step statuses
- changed files
- final outcome
- root cause
- final Codex response

Generate `FINAL_REPORT.md` for all terminal states.

## 12. Console UI

Current right panel:

- RUN
- VIEW

RUN rows:

```text
1 CODEX       status time REPORT
2 VALIDATION  status time REPORT
3 REVIEW      status time REPORT
4 FINAL       status time FINAL REPORT
```

VIEW:

- selected report context
- read-only report content
- internal scrolling
- one COPY action for currently displayed content

No separate OUTPUT panel. No Technical details panel. No raw JSON in the main UI. No multiple-output selector.

## 12. Report contract

Required report filenames:

- `01_CODEX_REPORT.md`
- `02_VALIDATION_REPORT.md`
- `03_REVIEW_REPORT.md`
- `FINAL_REPORT.md`

Reports are MVP user-facing artifacts. They must be created from real source artifacts and must not use placeholders when source data exists.

Path/token redaction must redact only actual sensitive values and absolute filesystem paths, including internal run workspace roots in final model responses. Repository-relative paths and report filenames remain visible. It must not corrupt normal prose such as:

- `workspace diff/status`
- `input/output`
- `file/path`

## 13. ChatGPT development handoff

Runtime reports and development handoffs are separate artifacts.

Runtime report:

- belongs to an AutoCodex user RUN,
- displayed in VIEW,
- describes CODEX / VALIDATION / REVIEW / FINAL.

ChatGPT development handoff:

- belongs to CatOS development work,
- generated by Codex after a meaningful implementation or repair checkpoint,
- passed to ChatGPT for review and next-step planning,
- stored in `docs/handoffs/sessions/`.

Development handoffs follow `docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md`.

## 14. Human Gate and Git operations

The MVP performs:

- no automatic commit,
- no automatic push,
- no automatic PR,
- no automatic merge,
- source clone remains unchanged,
- approval and commit remain explicit operations.

## 15. MVP test task

Deterministic E2E test task:

Create `docs/AUTOCODEX_E2E_TEST.md` with exact requested content and verify:

- exact content,
- exactly one changed file,
- `git diff --check` recorded by the coordinator, not inferred from Codex prose.

## 16. Known limitations

- `danger-full-access` effective mode cannot currently be independently confirmed by the SDK.
- Action trace may be incomplete when Codex returns only a final response.
- Clipboard may be restricted by embedded browser contexts.
- STOP is best-effort.
- No parallel-run dashboard.
- No automatic Git publication.

Previous design note: earlier documents described Project/Profile selectors, local repository discovery, manual repository paths, a separate OUTPUT panel, session-report wording, and a runtime GPT handoff based only on the final Codex response. Those are not the current MVP contract.

## 17. Report lifecycle and Final row contract

Per-attempt human-readable Markdown reports are generated immediately when each concrete terminal event persists its source JSON artifact:

- Coding persists `coding-result.json` and then writes `coding-report.md` in the same attempt directory.
- Validation persists `validation-report.json` and then writes `validation-report.md` in the same attempt directory, including `SKIPPED` results.
- Review persists the reconciled `review-report.json` and then writes `review-report.md` in the same attempt directory.

The source JSON artifacts remain the authoritative machine-readable evidence on disk. Terminal UI `REPORT` actions default to the per-attempt Markdown report, not raw JSON; raw JSON is retained for debugging and legacy/incomplete compatibility only. Attempt reports are attempt-scoped and immutable: later attempts write to their own directories and must not overwrite earlier attempts.

`FINAL_REPORT.md` is generated when `final-result.json` is persisted. The Final timeline row requires a real `final-result.json`; `FINAL_REPORT.md` alone does not create terminal state. `writeSessionReport()` may refresh existing attempt Markdown reports, but it must not invent `final-result.json` or fabricate a Final row.

If Markdown report generation fails after the source JSON was persisted, the execution result and source JSON survive. The failure is represented by an explicit report-generation error artifact when possible, so normal terminal UI reporting does not silently fall back to raw JSON or claim a missing Markdown report exists.

Legacy aggregate reports (`01_CODEX_REPORT.md`, `02_VALIDATION_REPORT.md`, and `03_REVIEW_REPORT.md`) may still be generated as compatibility summaries, but concrete timeline rows use per-attempt Markdown reports.
