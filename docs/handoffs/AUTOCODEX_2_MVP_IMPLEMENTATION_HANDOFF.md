# AutoCodex 2 MVP — implementation handoff

## Scope and architecture

The supported production entrypoint is a deliberately thin adapter:

```text
src/index.ts → src/cli/run.ts → v2 preflight → v2 orchestrator
```

`run` accepts only an existing project configuration and an approved Task Package. The adapter resolves the repository and workspace root from the project, then delegates the frozen package to `runPreflight` and `orchestrate`. Preflight validates `task.json`, immutable `baseCommitSha`, Codex CLI ChatGPT authentication, locks, detached external worktree and baseline argv checks. The orchestrator owns Coding → change validation → CatOS local commit → post-commit checks → fresh read-only Review, including bounded rework.

The adapter does **not** import or call Task Analyst, Reviewer, the old SDK worker, legacy execution plans, or publishing/push/PR logic. `--task` and `--execution-plan` fail before project/config/core work starts. `decide`, `commit`, `run-step`, `continue-package`, `review`, and `step` are legacy compatibility commands and are outside this path.

## CLI contract

```bash
npm run catos -- run --project demo --task-package ./task-packages/example
```

Required arguments:

| Argument | Contract |
| --- | --- |
| `--project <id>` | Resolves `projects/<id>.yaml`; its `project.id` must match. |
| `--task-package <directory>` | Directory containing the immutable, schema-valid `task.json`. |

Rejected production inputs: `--task` and `--execution-plan`. There is no Analyst fallback, inferred plan, API-key/provider route, or legacy model invocation.

`task.json` has `schemaVersion: 2`, `taskId`, literal task text, immutable reachable `baseCommitSha`, registered argv checks, and sequential steps with allowed file rules. The package is the authority; project YAML no longer supplies v2 test commands.

## Core contracts

* **Preflight:** locks Task Package and repository, verifies ChatGPT-authenticated Codex CLI, creates a detached worktree outside the source repository, and records baseline test evidence under `artifacts/`.
* **Coding:** one clean `codex exec` session per attempt, workspace-write only, schema-validated result.
* **Validation and commit:** CatOS rechecks Git invariants and allowed paths before staging the verified change set and creating a local commit. No push, merge, PR, or publish command is produced.
* **Tests:** frozen Task Package argv only; required failures gate progress.
* **Review:** a separate clean `codex exec --sandbox read-only` session; mutation is detected and fails closed.
* **Artifacts:** Task Package `artifacts/` is the v2 audit root. Keep Task Package and artifact directory available for inspection after a terminal run.

## Test matrix

| Area | Check |
| --- | --- |
| CLI authority | Missing `--project`/`--task-package` fails; `--task` and `--execution-plan` fail before preflight. |
| No legacy path | Static adapter import test excludes Analyst, Reviewer, SDK worker, execution plan and publish Git vocabulary. |
| Package security | Schema, SHA, argv, traversal/symlink and exclusivity-lock tests. |
| Preflight | Immutable base, ChatGPT CLI capabilities, external detached worktree and baseline checks. |
| Core cycle | Change guards, CatOS commits, argv checks, review read-only behavior and rework limits. |
| Entrypoints | Source and built `index` modules resolve without a model call. |

## Environment limitations

* Node.js 22+ is required by `package.json`; use the repository's declared runtime for build/test.
* An actual v2 run requires a compatible `codex` executable authenticated through ChatGPT (`codex login status`); API-key and unknown auth are intentionally refused.
* Git must be available and the package `baseCommitSha` must be reachable in the selected repository.
* The UI is intentionally start-disabled for v2; use the CLI contract above until it can supply both immutable authorities safely.

## Live gates before enabling an unattended run

1. Verify `node --version` satisfies Node 22+ and run `npm run typecheck`, `npm test`, and `npm run build`.
2. Verify `codex --version`, `codex exec --help`, and `codex login status` report a supported ChatGPT session.
3. Review `task.json`: SHA is immutable/reachable, steps have explicit file rules, and checks are safe argv vectors with correct baseline policy.
4. Confirm the project repository is clean enough for a detached external worktree and has sufficient disk/permissions under `execution.workspaceRoot` (or `CATOS_WORKSPACE_ROOT`).
5. Run the command once with an audited package; inspect `artifacts/runtime.json`, baseline evidence, per-attempt validation/commit/test/review evidence, and final manifest before relying on automation.

## Git workflow and handoff identity

`autocodex` is the canonical integration branch in GitHub and Replit. A Codex session normally works on an isolated branch such as `work` or `codex/...`; the two branch names therefore need not match.

Record the session SHA, implementation SHA, PR SHA, GitHub merge SHA, and Replit HEAD separately. Merge, squash/rebase, and isolated-checkout workflows may legitimately produce different values, so a branch-name or SHA difference alone is not a blocker. A human selects the PR target, reviews and performs the merge, and pulls the merged integration branch into Replit; Codex does not perform those operations.

## Offline validation status

**OFFLINE_VERIFIED:** Node 22 Replit validation passed `npm run typecheck`, targeted stabilization tests, `npm test` (253/253 tests across 26/26 test files), `npm run build`, and the built `dist` entrypoint smoke. The v2 UI remains CLI-only: UI start is disabled and the supported entrypoint requires both `--project` and `--task-package`.

Task Packages remain immutable authorities, and v2 Run audit artifacts remain under `runs/<RUN_ID>/`. This offline result does not validate live model execution.

**LIVE_UNVERIFIED:** A target-runtime Codex CLI version/capability preflight, `codex login status` with ChatGPT authentication, real workspace-write Coding, real read-only Review, the complete Coding → commit → Tests → Review cycle, and live REWORK and BLOCKED scenarios have not yet been run.
