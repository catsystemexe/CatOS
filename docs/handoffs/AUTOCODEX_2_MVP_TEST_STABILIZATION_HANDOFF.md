# AutoCodex 2 MVP — test stabilization handoff

## 1. Starting point

| Field | Value |
| --- | --- |
| Starting branch | `work` |
| Starting HEAD | `0caf02bd69811eb4cef71d853926dd0b78d60557` |
| Starting status | `## work` |

## 2. Session purpose and scope

Stabilize the first full offline test-suite run for AutoCodex 2 MVP without running a model, API call, publish operation, or live AutoCodex Run. Scope was limited to deterministic offline fixes for finalization artifacts, readonly TypeScript contracts, frozen test runner semantics, the v2 run CLI fixture/config, UI historical report viewing, and related test fixtures.

## 3. Authoritative documents read

| Document | Status |
| --- | --- |
| Applicable `AGENTS.md` | None found under `/workspace` for this checkout. |
| `docs/audits/AUTOCODEX_2.0_MVP_audit_a_revidovany_navrh.md` | Read before code edits. |
| `docs/handoffs/AUTOCODEX_2_MVP_IMPLEMENTATION_HANDOFF.md` | Read before code edits. |

## 4. Failure matrix

| Test or command | Original cause | Classification | Fix |
| --- | --- | --- | --- |
| `tests/autocodexFinalize.test.ts` terminal status cases | `final/run-summary.md` and sibling final artifacts were written before the `final/` directory existed. | `PRODUCTION_BUG` | `finalizeRun` now creates Run root and `final/` before terminal artifact writes and uses centralized artifact paths plus atomic text/JSON writers. |
| `npm run build` / `npm run typecheck` readonly error | `changeValidation.ts` declared mutable `string[]` where step file rules are readonly. | `PRODUCTION_BUG` | Unified helper signatures to consume/return `readonly string[]`. |
| `tests/autocodexTestRunner.test.ts` ordinary exit failures | Test artifacts were placed inside the checked Git worktree, so runner log writes dirtied the tree and were classified as technical Git mutation. | `TEST_BUG` | Fixture now writes artifact/log directories outside the test worktree; ordinary non-zero exits remain factual check results. |
| `tests/autocodexTestRunner.test.ts` first log assertion | `.resolves` was applied to an already awaited string. | `TEST_BUG` | Assertion now compares the awaited string directly. |
| `tests/autocodexTestRunner.test.ts` signal evidence | Signal result did not expose a dedicated failure-kind field for hidden/stable assertions. | `PRODUCTION_BUG` | Technical failures now record `failureKind`, including `SIGNAL`, while preserving process signal name. |
| `tests/runCli.test.ts` / `projects/demo.yaml` | Demo v2 fixture used legacy `commands` authority and boolean values where schema requires strings. | `STALE_LEGACY_EXPECTATION` | Removed legacy commands from the v2 CLI fixture and demo config; config schema supplies legacy defaults for consumers that still need the optional block. |
| `tests/uiRunContract.test.ts` historical report read | `readRunOutput` could resolve known run reports relative to workspace when metadata was missing. | `PRODUCTION_BUG` | Known legacy/final run reports resolve under the Run directory while traversal checks remain in place. |
| `tests/uiRunContract.test.ts` FINAL timeline / report availability | Historical runs with `FINAL_REPORT.md` but without `final-result.json` did not receive a FINAL row and legacy root reports were not listed as outputs. | `PRODUCTION_BUG` | UI view model includes a FINAL row when `FINAL_REPORT.md` exists and advertises readable legacy root reports. |
| UI start contract and CSS assertions | Not fully re-run in this environment; no production start-flow re-enable was introduced. | `UNRESOLVED` | Recommended next session should verify/update UI-specific assertions under a complete dependency/runtime environment. |
| Continue Package legacy prompt exactness | Git history shows expanded rework prompt existed before v2 refactoring (`1db6c8f`, `f1453eb`, later `4c0c5d1`). | `UNRESOLVED` | No v2 orchestrator import of Continue Package was introduced; recommend changing exact-equality assertions to semantic assertions if still failing. |

## 5. Changed files and purpose

| File | Purpose |
| --- | --- |
| `src/autocodex/finalize.ts` | Create Run/final directories deterministically and write final artifacts atomically. |
| `src/autocodex/persistence.ts` | Add reusable atomic text writer alongside atomic JSON writer. |
| `src/autocodex/changeValidation.ts` | Align path-rule helpers with readonly step file contracts. |
| `src/autocodex/checks.ts` | Preserve ordinary test-failure semantics and add stable `failureKind` for technical failures. |
| `src/config/projectConfigSchema.ts` | Make legacy `commands` block optional via string defaults so v2 fixtures do not need it. |
| `src/uiApi.ts` | Resolve known historical run reports relative to Run directory. |
| `src/uiViewModel.ts` | Surface FINAL row/report and legacy root reports for historical viewing. |
| `projects/demo.yaml` | Remove legacy `commands` authority from v2 demo configuration. |
| `tests/autocodexTestRunner.test.ts` | Move test artifacts outside worktree and fix awaited-string assertion/signal assertions. |
| `tests/runCli.test.ts` | Remove legacy commands block from the v2 CLI fixture. |
| `docs/handoffs/AUTOCODEX_2_MVP_TEST_STABILIZATION_HANDOFF.md` | Audit trail for this stabilization session. |

## 6. Production contract changes

No approved AutoCodex 2 architecture changes were made. The production contract was clarified in these compatible ways:

- finalization owns creation of `runs/<RUN_ID>/final/` and terminal final artifacts;
- path-rule consumers accept readonly file-rule arrays;
- technical test-process failures expose `failureKind` while ordinary non-zero exits remain ordinary `FAIL` check results;
- legacy project `commands` are optional for v2 project config loading and default to string commands for legacy consumers;
- UI historical report readers continue to support legacy root reports without enabling v2 Run start from UI.

## 7. Validation commands and results

| Command | Exit code | Result |
| --- | ---: | --- |
| `npm ci` | `143` | Interrupted after hanging under Node 20 with EBADENGINE warning; environment uses Node `v20.20.2` while repo requires Node `>=22`. |
| `npm run typecheck` | `2` | Failed before checking project code because type definitions `node` and `vitest/globals` were not available in the incomplete dependency installation. |
| `npx vitest run tests/autocodexFinalize.test.ts` | `1` | Not completed: `npx` attempted registry access and received `403 Forbidden` for `vitest`. |
| `npx vitest run tests/autocodexTestRunner.test.ts` | `1` | Not completed: same registry/dependency limitation. |
| `npx vitest run tests/runCli.test.ts` | `1` | Not completed: same registry/dependency limitation. |
| `npx vitest run tests/continuePackage.test.ts` | `1` | Not completed: same registry/dependency limitation. |
| `npx vitest run tests/uiRunContract.test.ts` | `1` | Not completed: same registry/dependency limitation. |
| `npx vitest run tests/uiViewModel.test.ts` | `1` | Not completed: same registry/dependency limitation. |
| `npm test` | Not run | Blocked by missing/incomplete test dependencies and registry 403 observed on targeted `npx vitest`. |
| `npm run build` | Not run | Blocked by missing/incomplete dependencies and Node version mismatch; typecheck already fails before code validation. |
| `node -e "import('./dist/src/index.js').then(() => process.exit(0), error => { console.error(error); process.exit(1); })"` | Not run | Dist was not built because build/typecheck prerequisites are blocked. |
| `git diff --check` | `0` | Passed. |
| `git status --short` | `0` | Shows expected modified files before commit. |

## 8. Test counts

No trustworthy updated pass/fail/skipped totals were produced in this environment. The starting reported suite result was 229 passed / 23 failed. Current validation is environment-blocked before Vitest execution.

## 9. Live gates not confirmed

- No live AutoCodex Run was executed.
- No model call was executed.
- No OpenAI Platform/API call was executed.
- No push, publish, merge, or live PR operation was executed inside a v2 Run.
- Codex CLI ChatGPT login/live gates were not checked.

## 10. Unresolved issues

- Full test-suite results remain unconfirmed due to Node 20 vs required Node 22+ and incomplete/blocked dependency installation.
- UI start-contract/CSS tests and Continue Package semantic assertion updates should be verified in a complete Node 22 dependency environment.

## 11. Recommended next-session input

Use Node 22+ with dependencies installed from the lockfile, then run exactly:

```bash
npm run typecheck
npx vitest run tests/autocodexFinalize.test.ts
npx vitest run tests/autocodexTestRunner.test.ts
npx vitest run tests/runCli.test.ts
npx vitest run tests/continuePackage.test.ts
npx vitest run tests/uiRunContract.test.ts
npx vitest run tests/uiViewModel.test.ts
npm test
npm run build
node -e "import('./dist/src/index.js').then(() => process.exit(0), error => { console.error(error); process.exit(1); })"
git diff --check
git status --short
```

Then complete unresolved UI/Continue Package assertion stabilization without changing the approved AutoCodex 2 architecture or enabling UI start.

## 12. Final point

| Field | Value |
| --- | --- |
| Final HEAD | Final amended commit SHA is reported in the session final response and PR metadata. |
| Final working tree | Expected clean after final metadata amend. |
| Commit SHA | Final amended commit SHA is reported in the session final response and PR metadata. |
| PR metadata | Title: `Stabilize AutoCodex v2 offline test contracts`; body recorded via `make_pr` tool. |

## 13. Follow-up offline stabilization session — 2026-07-18

### Input verification

| Command | Result |
| --- | --- |
| `node --version` | `v20.20.2` |
| `npm --version` | `11.4.2` with npm warning `Unknown env config "http-proxy"` |
| `git branch --show-current` | `work` |
| `git rev-parse HEAD` | `805cd564680ba909a8b70fd98b059d2603dcf5a1` |
| `git status --short --branch` | `## work` |
| `git log -1 --oneline` | `805cd56 Stabilize AutoCodex v2 offline tests: deterministic finalization, readonly contracts, and test-runner fixes` |

### Corrections made after review

| Area | Correction |
| --- | --- |
| Run CLI fixture / demo config | Reverted the previous production schema relaxation for `commands`. Because `commands` remains required by the current schema, the demo config and v2 CLI test fixture now provide schema-valid string commands instead of removing the block or using booleans. V2 test authority remains the Task Package. |
| UI start contract | Disabled the production UI start API for AutoCodex v2 with an explicit CLI-only error message. This removes the legacy `--task` / `danger-full-access` UI launch path instead of merely testing that the front-end does not call it. |
| UI view-model tests | Updated stale tests to assert readonly Task Package guidance, disabled `RUN (CLI ONLY)`, no legacy start API invocation, retained repository viewer/clone controls, and structural CSS properties instead of exact pixel/string snapshots. |
| UI run-contract test | Replaced the stale Replit/danger-full-access UI-start assertion with the v2 CLI-only disabled API contract. |

### Follow-up validation commands and results

| Command | Exit code | Result |
| --- | ---: | --- |
| `npm ci --offline --ignore-scripts --no-audit --no-fund` | `1` | Failed because required package tarballs were not cached (`ENOTCACHED` for `zod`) and the environment still reports Node `v20.20.2` while `package.json` requires Node `>=22`. |
| `npm run typecheck` | `2` | Failed before project type-checking because `node` and `vitest/globals` type definitions are unavailable without installed dependencies. |
| `npx vitest run tests/autocodexFinalize.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/autocodexTestRunner.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/runCli.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/continuePackage.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/uiRunContract.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/uiViewModel.test.ts` | `1` | Failed before test execution: npm registry request for `vitest` returned `403 Forbidden`. |
| `npm test` | `127` | Failed because local `vitest` binary is not installed. |
| `npm run build` | `2` | Failed before project build because `node` and `vitest/globals` type definitions are unavailable without installed dependencies. |
| `node -e "import('./dist/src/index.js').then(() => process.exit(0), error => { console.error(error); process.exit(1); })"` | `1` | Failed because `dist` imports runtime dependency `yaml`, but dependencies are not installed. |
| `git diff --check` | `0` | Passed. |
| `git status --short` | `0` | Completed; showed the expected follow-up modified files before commit. |

### Follow-up test counts

No updated passed/failed/skipped totals were produced. The environment cannot install or execute Vitest dependencies and is still Node 20 rather than the requested Node 22+ runtime.

### Follow-up result

`BLOCKED_ENVIRONMENT`: follow-up corrections are offline-only and no model, API, live AutoCodex Run, push, merge, or publish operation was executed. Complete validation still requires Node 22+ with dependencies installed.

## 14. Offline stabilization closure — 2026-07-18

### Scope completed

This closure preserved the approved AutoCodex v2 architecture. It did not run a model, OpenAI API request, live AutoCodex Run, push, merge, publish operation, or PR from inside AutoCodex.

| Area | Result |
| --- | --- |
| Readonly validation contract | `ChangeValidationReport`, changed-file entries, Git guards, path-rule inputs, and v2 orchestrator path-rule handoff now use readonly arrays where the values are immutable. No casts or mutable defensive copies were introduced. |
| FINAL historical timeline | A historical `FINAL_REPORT.md` without `final-result.json` uses valid terminal `completed`, not invalid `succeeded`. |
| Legacy Continue Package prompt | The production expanded legacy rework prompt is unchanged. Its test uses semantic assertions for the original task, derived brief, `REWORK`, findings, required changes, acceptance criteria, no commit/push/merge, and audit preservation rather than whole-prompt equality. |
| v2 isolation | Static source check found no Continue Package or legacy rework-flow import in `src/autocodex/orchestrator.ts`. |
| UI API | Manual repository validation remains covered. `startRun` is asserted to fail closed with the v2 CLI `--project` and `--task-package` guidance before branch validation. |
| Final reports and CSS | Tests now follow the renderer's `### Validation` capitalization and status lines. Timeline CSS is tested structurally for grid columns, a `minmax` text column, and overflow protection rather than obsolete pixel values. |

### Environment and validation evidence

| Field | Value |
| --- | --- |
| Node runtime used | `v22.22.2` (`/root/.nvm/versions/node/v22.22.2/bin/node`) |
| npm runtime used | `11.4.2` |
| Stabilization implementation commit | `8992728baebb37d848463c9a82737c6ae5c3a307` (`Stabilize AutoCodex v2 offline contracts`) |
| Working-tree state before this handoff metadata update | clean (`## work`) |

| Command | Exit code | Result |
| --- | ---: | --- |
| `npm ci --no-audit --no-fund` | `1` | Environment blocked dependency installation: package firewall returned `403 Forbidden` for locked `zod-4.4.3.tgz`. |
| `npm run typecheck` | `2` | Blocked before source checking because `@types/node` and `vitest/globals` are unavailable without dependencies. |
| `npx vitest run tests/continuePackage.test.ts` | `1` | Blocked before test execution: registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/uiApi.test.ts` | `1` | Blocked before test execution: registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/uiRunContract.test.ts` | `1` | Blocked before test execution: registry request for `vitest` returned `403 Forbidden`. |
| `npx vitest run tests/uiViewModel.test.ts` | `1` | Blocked before test execution: registry request for `vitest` returned `403 Forbidden`. |
| `npm test` | `127` | Blocked: local `vitest` executable is absent because dependency installation failed. |
| `npm run build` | `2` | Blocked before source build because `@types/node` and `vitest/globals` are unavailable without dependencies. |
| `node -e "import('./dist/src/index.js').then(() => process.exit(0), error => { console.error(error); process.exit(1); })"` | `1` | Blocked: stale `dist` cannot resolve runtime dependency `yaml` without installed dependencies. |
| `git diff --check` | `0` | Passed. |
| `git status --short --branch` | `0` | Passed; the implementation commit's working tree was clean before this handoff metadata update. |

### Merge-gate disposition

`BLOCKED_ENVIRONMENT` — **not** `READY_FOR_MERGE`. The requested Node 22 runtime is available and was used, but dependency installation is prohibited by the environment's package firewall. Therefore typecheck, the targeted Vitest tests, the 252/252 suite gate, build, and dist smoke cannot be truthfully marked passing. Re-run the listed commands in an environment with the lockfile dependencies available before declaring `READY_FOR_MERGE`.
