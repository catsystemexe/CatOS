# AutoCodex 2.0 MVP — audit aktuálního stavu

Datum auditu: 2026-07-17. Auditovaný checkout: `/workspace/CatOS`.

## 1. Executive summary

**Verdikt: PARTIAL, ale nikoli AutoCodex 2.0 MVP.** Aktuální `run` umí v jedné dosažitelné cestě vytvořit izolovaný worktree, spustit Coding přes SDK child, spustit shellové validace a provést API-key Reviewer loop přes sekvenční plán. Není však předem schválený strojově validovaný Task Package a cyklus neodpovídá cílovým Git, auth, review ani failure hranicím.

První zásadní odchylka dosažitelného toku je hned po založení runu: `runCommand` volá modelového Task Analysta (`analyzeTaskBrief`) pro každý krok, tedy mění/odvozuje pracovní zadání během Runu a vyžaduje `OPENAI_API_KEY` a `@openai/agents`; nejde o deterministický Feeder nad zmrazeným `task.json` (`src/cli/run.ts:56-58`, `src/agents/taskAnalyst.ts:45-69`, `79-112`). Další nezávislá mezera je, že blocking validační FAIL/BLOCKED Review **nepřeskakuje**: Review se volá bezpodmínečně po validaci (`src/cli/run.ts:65,71`).

Největší ověřená rizika refaktoringu: (1) produkční Review i Task Analyst jsou Platform API cesta, zatímco Coding child explicitně předává API klíče; (2) Coding rework obnovuje stejný Codex thread místo čisté session; (3) CatOS commit je samostatný manuální příkaz až po lidském rozhodnutí; (4) změnový guard pouze sbírá diff, nevynucuje allowed paths/HEAD/tag/submodule invariants; (5) zápisy stavu nejsou atomické a neexistuje lock; (6) přítomnost UI/GitHub/PR handoffu rozšiřuje hranici mimo MVP.

## 2. Audit scope, method and limitations

Audit byl read-first: kontrola Git metadata, `package.json`, statická stopa importů/entrypointů, line-level čtení `src/` a testů a pouze bezpečné lokální kontroly. Nebyl spuštěn AutoCodex Run, Codex model, OpenAI API, worktree, commit, síťový Git ani build. Hodnoty credentials nebyly čteny; `codex` binární soubor nebyl k dispozici, proto auth status nelze ověřit. Dokumentace v `README.md`, roadmapách a handoffech byla považována jen za záměr, nikoli za důkaz runtime cesty.

## 3. Verified repository state

| Item | Evidence / observed state |
|---|---|
| Checkout | `/workspace/CatOS`; branch `work`; HEAD `c2cd5763ce6dd841b455d4c96bfc25867a789f40`, subject `fix run` (`git status --short --branch`, `git rev-parse HEAD`, `git log -1 --format=%s`). |
| Initial working tree | čistý (počáteční `git status --short` neměl řádky). |
| Instructions | hledání `AGENTS.md` pod nadřazeným stromem žádný soubor nenalezlo. |
| Runtime | Node `v20.20.2`, npm `11.4.2`; projekt požaduje Node `>=22` (`package.json:12-18`): environment limitation pro kompatibilitu. |
| Codex CLI | `codex --version` a `codex login status`: `command not found`, exit 127. |
| Module/entry | ESM (`type: module`); `npm run catos` = `tsx src/index.ts`; dispatcher registruje `run`, `decide`, `commit`, `step`, `review`, `continue-package`, `run-step`, smoke a UI (`package.json:5-11`, `src/index.ts:11-59`). Neexistuje `bin` ani package export. |
| Script mapping | `typecheck` = `tsc --noEmit`, `test` = `vitest run`, `build` = `tsc`, UI = `tsx src/index.ts ui` (`package.json:5-10`). |
| Source/dist child | `defaultCodexRuntimeChildPath` vybere sibling se stejnou příponou jako běžící `codingWorker`: source `.ts` používá `fork(..., execArgv: [--import, tsx])`; dist `.js` nepoužívá loader (`src/codingWorker.ts:635-651,737-746`). Staticky tedy obě resolution cesty existují; dist nebyl vytvořen/ověřen. |
| Dependencies | Coding: `@openai/codex-sdk`; Task Analyst/Reviewer: `@openai/agents`; config/schema: `yaml`, `zod`; process management je Node `fork/spawn` (`package.json:19-29`, `src/codexRuntimeChild.ts:59-82`, `src/validationRunner.ts:141-173`). |

## 4. Current architecture

* `src/cli/run.ts` je jediný automatizovaný orchestrátor: vytvoří run, persistuje ExecutionPlan, resolves Git context, zakládá session, a pak provádí per-step Coding → validation → Review loop (`src/cli/run.ts:37-85`).
* `executionPlan.ts` poskytuje ručně validovaný JSON plán s kroky a dependency, avšak plán je předán CLI nebo odvozen ze string tasku; nejde o cílový Task Package (`src/executionPlan.ts:72-140`).
* `taskAnalyst.ts` je modelový plánovací/briefing článek přes OpenAI Agents API, nikoli deterministický Feeder (`src/agents/taskAnalyst.ts:45-69,79-114`).
* `CodexSdkWorker` kontroluje workspace, vytváří Git worktree, připraví allowlisted environment a forkne SDK child (`src/codingWorker.ts:886-`, `src/codexRuntimeChild.ts:59-104`).
* `validationRunner.ts` provádí tři string shell commands v worktree s timeoutem/process-group kill (`src/validationRunner.ts:81-100,141-233`).
* `reviewer.ts` je in-process OpenAI Agents API review nad předaným balíkem, bez Codex CLI/session (`src/agents/reviewer.ts:233-255,336-372`).
* `commitWorker.ts` má silnější pozdní commit guard, ale `commit` CLI ho volá až po `human-decision.json` a finálním výsledku (`src/cli/commit.ts:73-125`, `src/commitWorker.ts:90-144`).

## 5. End-to-end flow as actually implemented

1. `npm run catos -- run --project … --task …` nebo `--execution-plan` načte YAML/repo config, vytvoří `runs/<uuid>/input.json`, persistuje plan a resolves immutable `baseCommit` (`src/cli/run.ts:37-47`).
2. Vytvoří session/step files a následně **modelově** analyzuje každý PlannedStep do `TaskBrief` (`src/cli/run.ts:47,50-58`). Bez injected provideru jde o OpenAI API.
3. Pro první Attempt Coding worker založí `git worktree add -b <runBranch> <workspace> <baseCommit>`; Coding SDK child obdrží instrukci a sandbox mode (`src/codingWorker.ts:914-`, `src/gitSession.ts:23-27`).
4. Worker uloží coding artefakty/diff/status, pak shell Validation spustí typecheck/test/build (`src/cli/run.ts:63-66`).
5. **I při blocking FAIL/BLOCKED** se zavolá `reviewChange` (`src/cli/run.ts:65,71`), což používá `@openai/agents`, nikoli clean read-only Codex session.
6. `ACCEPT` přijme Step a uvolní další; `REWORK` pokračuje stejným `threadId`; HUMAN_REQUIRED/STOP ukončí run (`src/cli/run.ts:72-80`). Následně se vytvoří `final-result.json` a report, nikoli commit (`src/cli/run.ts:82-85`).
7. Commit je samostatný člověkem spouštěný `commit --run`, podmíněný `APPROVE` z `decide`; `decide` explicitně říká „Automatic rework was not started“ a ukazuje další manuální command (`src/cli/decide.ts:99-125`, `src/cli/commit.ts:91-125`).

První manuální/chybějící přechod vůči cíli je před Coding: modelový Task Analyst místo zmrazeného schváleného Task Package. I kdyby byl nahrazen injected test providerem, CatOS po Coding netvoří commit a Review není Codex/read-only; poslední commit/publish handoff zůstává manuální.

## 6. Current data and state model

Existují dvě překrývající se vrstvy. Legacy/session model obsahuje `Session`, `Step`, `Attempt`, `Decision` a `timeline.jsonl` (`src/runs/sessionModel.ts:5-112,144-167`); ExecutionPlan model má `StepState` (`PENDING/RUNNING/REWORK/ACCEPTED/HUMAN_REQUIRED/FAILED/STOPPED`) a `StepResult` (`src/executionPlan.ts:27-58`). `SessionGitContext` ukládá `baseCommit`, run branch a workspace, ale ne `taskBaseCommit`, `stepBaseCommit`, `attemptBaseCommit`, `resultCommit` (`src/runs/sessionModel.ts:47-71`).

Persistence je prostý `mkdir` + `writeFile` (`src/runs/createRun.ts:34-36`, `src/runs/sessionModel.ts:144-147`, `src/executionPlan.ts:146-149`), bez temporary-file/rename/fsync. `timeline.jsonl` appenduje bez sequence a bez synchronizačního locku (`src/runs/sessionModel.ts:151-167`). Restart/resume automatického `run` není implementován: vždy createRun s novým directory; `continue-package`/`run-step` jsou manuální nástroje (`src/runs/createRun.ts:19-38`, `src/cli/continuePackage.ts:5-17`). Repeated `commit` je částečně idempotentní přes existing `commit-result.json` (`src/commitWorker.ts:91-97`), ale Run/step commands lock nemají.

## 7. Capability matrix

| Capability | Status | Evidence | Current behavior | Missing for target |
|---|---|---|---|---|
| machine-readable Task Package | PARTIAL | `executionPlan.ts:20-25,72-109` | JSON ExecutionPlan, not versioned task.json | approved Task Package incl. paths/tests |
| Task schema validation | PARTIAL | `executionPlan.ts:72-136` | manual validator; TaskBrief zod | task.json schema/freeze |
| immutable base commit | IMPLEMENTED | `gitSession.ts:17-24` | resolves `<base>^{commit}`, worktree uses SHA | record all target boundaries |
| Task snapshot/hash | PARTIAL | `run.ts:44-45`; `codingWorker.ts:414-416` | plan copied; prompt hashes only | package snapshot/hash authority |
| sequential Step selection | IMPLEMENTED | `run.ts:50-81` | sorted plan loop/dependencies | no parallelism is implicit |
| deterministic Feeder | MISSING | `taskAnalyst.ts:45-69` | model derives brief | deterministic approved-input composer |
| separate Coding prompt | IMPLEMENTED | `codingWorker.ts:445-545` | rendered per attempt | structured final result contract |
| clean Coding session per Attempt | PARTIAL | `run.ts:62`; `codexRuntimeChild.ts:74-80` | first start; rework resumes thread | new process/session every attempt |
| structured Coding result validation | PARTIAL | `codingWorker.ts:829-850` | IPC validates only threadId/finalResponse | schema output/result semantics |
| Coding timeout/process termination | PARTIAL | `codingWorker.ts:820-822,796-817` | timeout kills child only | process-group termination |
| change guard | PARTIAL | `gitWorkspaceState.ts`; `commitWorker.ts:118-128` | collects diff; commit checks files late | allowed paths/HEAD/tag/submodule/task guard pre-commit |
| CatOS-owned commit | PARTIAL | `commitWorker.ts:90-144` | CatOS can commit | must occur automatically after validation |
| commit boundary metadata | PARTIAL | `commitWorker.ts:141-143` | parent/result commit only after manual commit | task/step/attempt/result boundaries |
| registered deterministic Tests | PARTIAL | `validationRunner.ts:81-90` | config string commands | task-specific argv/source-of-truth |
| blocking/non-blocking test semantics | PARTIAL | `validationRunner.ts:93-100`; `run.ts:33` | required flag/policy | no review skip on blocking failure |
| baseline checks | MISSING | searched runner/CLI | none before coding | baseline result storage |
| test timeout and exit-code handling | IMPLEMENTED | `validationRunner.ts:189-231` | timeout, exit/signal statuses | N/A core |
| stdout/stderr persistence | PARTIAL | `validationRunner.ts:15-35,270-274` | embedded JSON, unbounded | artifact logs/truncation |
| clean-tree assertion after Tests | MISSING | `run.ts:65-71` | no post-test state comparison | enforce clean tree |
| separate Review prompt | IMPLEMENTED | `reviewer.ts:283-325` | API review prompt | Codex review prompt/session |
| clean Review session | MISSING | `reviewer.ts:336-372` | Agents API run, no Codex process | clean Codex session |
| technically enforced read-only Review | MISSING | `reviewer.ts:350-367` | prompt/tools-empty only | read-only sandbox |
| structured Review result validation | IMPLEMENTED | `reviewer.ts:241-254`; `reviewReport.ts:3-25` | zod parsed | target values/invariants |
| APPROVE invariant | PARTIAL | `reviewer.ts:228-252` | blocks ACCEPT on failed validation | no required-change invariant explicit |
| test-driven REWORK | PARTIAL | `reviewer.ts:228-252` | reviewer may rework | direct `REWORK_TESTS`, review skipped missing |
| review-driven REWORK | IMPLEMENTED | `run.ts:75-78` | actionable REWORK starts retry | retry is resumed thread |
| BLOCKED handling | PARTIAL | `validationRunner.ts:96-100`; `run.ts:71-77` | review gets BLOCKED | target BLOCKED terminal semantics |
| max Attempts handling | PARTIAL | `run.ts:77` | off-by-one condition and `REWORK_LIMIT_REACHED` | `BLOCKED_MAX_ATTEMPTS` |
| technical FAILED distinct from REWORK | PARTIAL | `runStep.ts:93-108`; `run.ts:75-77` | manual path classifies runtime | automatic run exceptions escape; guard absent |
| automatic next-Step progression | IMPLEMENTED | `run.ts:50-81` | accepted loop moves next | target boundaries lacking |
| automatic final completion | PARTIAL | `run.ts:82-85` | writes final result/report | no final audit packet/hash manifest |
| file lock/single active Run | MISSING | no lock/rename references | none | file lock |
| atomic state persistence | MISSING | `sessionModel.ts:144-147` | direct writes | atomic replace |
| crash/fail-closed behavior | PARTIAL | direct artifacts, no resume | partial state remains | explicit terminal fail-closed recovery |
| runtime manifest | IMPLEMENTED | `codingWorker.ts:297-341` | runtime.json without env values | audit hash/integrity |
| event/command log | PARTIAL | `sessionModel.ts:151-167` | timeline JSONL; runtime stdio | monotonic sequence/full command events |
| final review packet | PARTIAL | `reviewPackage.ts:105-106`; `finalExport.ts:116-125` | manual review package/final report | automatic final audit packet |
| artifact hash manifest | MISSING | `hashArtifacts.ts:4-15` | hashes approval evidence only | final manifest of artifacts |
| ChatGPT auth preflight | MISSING | no `login status` reference | none | Codex ChatGPT preflight |
| API-key/provider fallback prevention | MISSING | `codingWorker.ts:185-193`; `taskAnalyst.ts:79-112`; `reviewer.ts:336-370` | API credentials permitted/required | deny keys/providers |
| Coding sandbox policy | PARTIAL | `projectConfigSchema.ts:3-50`; `codexRuntimeChild.ts:68-72` | configurable incl. danger mode | no verified effective enforcement/fallback contract |
| Review sandbox policy | MISSING | reviewer API no sandbox | none | read-only enforcement |
| prohibition of push/PR/merge | PARTIAL | prompts `codingWorker.ts:497-500`; config flags; `gitSession.ts:42-46` | no push call, but PR handoff emits command | enforce policy/remove handoff scope |

## 8. Authentication and cost-path assessment

**Code-proven:** Coding child allowlist passes `OPENAI_API_KEY`, `CODEX_API_KEY`, `OPENAI_BASE_URL` and creates an isolated runtime `HOME`/`TMPDIR`; it does **not** pass `CODEX_ACCESS_TOKEN` (`src/codingWorker.ts:185-239,301-341`). Isolated HOME means stored default CLI/SDK auth is not demonstrated as reachable. Task Analyst and Reviewer explicitly read `OPENAI_API_KEY`, set it as default OpenAI key and invoke `@openai/agents` (`src/agents/taskAnalyst.ts:79-112`, `src/agents/reviewer.ts:336-371`): this is a Platform API path, not ChatGPT Codex login. Custom `OPENAI_BASE_URL` is allowed into Coding child, permitting provider routing.

**Local CLI proof:** no Codex CLI installed; `codex login status` was not executable (exit 127). Thus no local ChatGPT auth, access-token behavior, quota exhaustion behavior, or CLI fallback can be confirmed. **Documented-only/UNVERIFIED:** credential-store path and impact of `CODEX_HOME` are not configured in code; there is no preflight nor enforcement that auth is ChatGPT rather than API key. No claim of zero cost is supportable; code positively supports separately billed Platform API calls for analysis/review.

## 9. Security and isolation assessment

Workspace Guard rejects symlinks, filesystem root, HOME, CatOS root, source repo root and paths outside workspaceRoot using `lstat`, `realpath` and containment (`src/codingWorker.ts:242-263`); workspace write probe and validation preflight further check isolation (`src/codingWorker.ts:266-294`, `src/validationRunner.ts:57-75`). This is valuable **operational containment, not a sandbox**. The SDK receives requested sandbox mode, but reports effective mode as `unconfirmed` (`src/codexRuntimeChild.ts:66-92`). Config allows `danger-full-access` after acknowledgement (`src/config/projectConfigSchema.ts:42-50`); no automatic widening was found, but actual SDK enforcement is unverified.

Review has no filesystem tools by prompt and `tools: []`, but that is application-level agent configuration, not an OS/CLI read-only sandbox (`src/agents/reviewer.ts:350-367`). Runtime manifest lists allowlisted variable **names** rather than values; however coding runtime error can serialize arbitrary `rootCause` and SDK diagnostic options are persisted (`src/codingWorker.ts:716-724,875-883`), so secret-redaction completeness is not provable. Validation inherits complete `process.env` (`src/validationRunner.ts:167-173`), exposing project commands to credentials despite Coding allowlist.

## 10. Audit trail assessment

Produced files include `input.json`, execution plan, session/step/attempt JSON, prompt, task brief, coding result/diff/status, validation report, review report, rework package, timeline, runtime manifest/stdout/stderr/error and final reports (`src/cli/run.ts:44-85`, `src/runs/sessionModel.ts:32-45`, `src/codingWorker.ts:699-724`, `src/finalExport.ts:116-125`). The manual `review` command writes a review-package JSON/Markdown (`src/cli/review.ts:6-19`). There are no final artifact hash manifest, baseline results, separate review events/session logs, or target commit-boundary diff packet.

Sensitive-data risk: Coding runtime allowlist may carry API-key values into child (values are not printed in manifest); validation inherits all environment; raw command stdout/stderr and SDK errors are persisted. Existing redaction is pattern-based in prompts/reports, not a complete artifact boundary (`src/agents/reviewer.ts:276-325`, `src/finalExport.ts:11-14`).

## 11. Gaps against AutoCodex 2.0 MVP

| Gap | Current evidence | Target / impact / dependency |
|---|---|---|
| Task authority | Analyst API generates brief during run | Replace with pre-approved schema-validated frozen package; prerequisite for deterministic Feeder and audit hashes. |
| Auth/cost boundary | API keys allowed; Analyst/Reviewer require API | Must remove Platform/custom-provider route and preflight ChatGPT CLI auth before any model process. |
| Cycle ordering | validation then unconditional API review; commit later/manual | Need CatOS validation→commit→tests→read-only review ordering; affects state/artifacts. |
| Git/change enforcement | commit validates late; no allowed-path/task/HEAD guard | Need pre-commit CatOS validation and commit boundaries. |
| Review isolation | no Codex session/read-only technical enforcement | Need separate clean read-only Review process and exact cumulative/delta diffs. |
| Failure semantics | model review mediates blocking validation; exceptions not recorded into uniform terminal states | Need technical FAILED, test REWORK, BLOCKED and max-attempt semantics. |
| consistency | direct writes/no lock/no terminal recovery policy | Need lock and atomic state before autonomous loop. |
| final audit | reports exist but no hash manifest/final review packet | Need final local audit packet after final approval. |

## 12. Technical debt

* Two state representations (`sessionModel` and `executionPlan`) coexist with different status vocabularies and files; `run` writes both (`src/runs/sessionModel.ts:5-112`, `src/executionPlan.ts:27-58`, `src/cli/run.ts:51-53`).
* Long, dense one-line orchestration expressions in `run.ts` combine persistence, policy and execution (notably `src/cli/run.ts:60-78`), obscuring failure ownership.
* `run-step` is separate/manual and can use a fake child, while automated `run` is different orchestration (`src/cli/runStep.ts:161-245`).
* PR handoff/push command generation is reachable from manual commit although target MVP excludes publish (`src/gitSession.ts:42-46`).

## 13. Components to preserve

* Workspace path guard/probe and validation worktree preflight: dependencies are Node fs/realpath and isolated workspace (`src/codingWorker.ts:242-294`, `src/validationRunner.ts:57-75`).
* Immutable base SHA resolution/worktree creation primitives (`src/gitSession.ts:17-27`).
* Validation process-group timeout handling (`src/validationRunner.ts:115-233`).
* Zod ReviewReport parsing and structured diff-check reconciliation (`src/agents/reviewer.ts:170-254`).
* Commit-worker evidence/index checks, adapted to CatOS-owned automatic timing (`src/commitWorker.ts:64-144`).

## 14. Components to remove or simplify

Candidates are not authorized for removal in this audit: Task Analyst API dependency (conflicts with frozen Task Package), manual Human Gate/`decide` transition in automated cycle, `continue-package`/manual `run-step` continuation, and PR handoff/push-readiness surface (`src/agents/taskAnalyst.ts:79-114`, `src/cli/decide.ts:99-125`, `src/cli/continuePackage.ts:5-17`, `src/gitSession.ts:29-46`). UI/GitHub repository discovery is outside the target core and should be evaluated separately, not silently retained as orchestration authority.

## 15. Refactoring constraints

Preserve source repository and CatOS root exclusion; never treat worktree/allowlist as sandbox. Preserve no automatic push/PR/merge, local file artifacts, complete attempt history and immutable base SHA. Migration must avoid changing user existing worktrees/artifacts; data compatibility needs explicit handling for existing `session.json`, `execution-plan.json`, `final-result.json` and `commit-result.json`. Do not reintroduce API keys/custom base URLs; no fallback when sandbox/auth fails.

## 16. Recommended migration order

1. **Contract/state foundation:** prerequisite: freeze target schemas/statuses. Preserve legacy reads/artifacts. Proof: atomic state + lock and validated task snapshot.
2. **Preflight/auth/workspace boundary:** prerequisite: foundation. Preserve base SHA/worktree checks. Proof: ChatGPT-only auth preflight and denylisted provider env without secret logging.
3. **Deterministic feeder and Coding attempt:** prerequisite: frozen task. Preserve prompts as artifacts. Proof: fresh `codex exec --json`/equivalent session and schema-validated final output per attempt.
4. **Change/commit/tests:** prerequisite: attempt boundaries. Preserve validation timeout behavior. Proof: guard then CatOS commit, test result semantics and clean tree.
5. **Read-only Review/state loop:** prerequisite: commit/test artifacts. Proof: fresh read-only Review with target decisions and no Review after blocking tests.
6. **Final audit/retire manual paths:** prerequisite: autonomous terminal semantics. Preserve historical report readability. Proof: final packet plus hash manifest; no publish behavior.

## 17. Validation results

Working tree was checked after each executed validation and remained identical to initial clean state.

| Command / cwd | Executed | Exit | Classification | Result / tree effect |
|---|---:|---:|---|---|
| `node --version` / repo | yes | 0 | PASS | `v20.20.2`; below declared >=22. |
| `npm --version` / repo | yes | 0 | PASS | `11.4.2`. |
| `codex --version` / repo | yes | 127 | ENVIRONMENT_LIMITATION | CLI absent. |
| `codex login status` / repo | yes | 127 | ENVIRONMENT_LIMITATION | CLI/auth unverified. |
| `npm run typecheck` / repo | yes | 2 | ENVIRONMENT_LIMITATION | missing `node` and `vitest/globals` type definitions; no install attempted. |
| `npm test` / repo | yes | 127 | ENVIRONMENT_LIMITATION | `vitest: not found`; no install attempted. |
| `npm run build` / repo | no | n/a | SKIPPED_UNSAFE | writes `dist`; dependencies already demonstrably absent. |

## 18. Open factual questions

1. Does installed Codex SDK enforce the requested `workspace-write`/`read-only` mode? Closing evidence: controlled runner execution with a non-secret fixture and SDK/CLI evidence; not performed because runs/model calls are out of scope.
2. Which auth mode the SDK would select when isolated `HOME` is used? Closing evidence: safe preflight/SDK documentation plus status in a configured controlled runner; CLI is absent here.
3. Does a built `dist` run load child correctly with actual installed dependencies? Static resolution supports it, but closing evidence is a safe build and non-model module smoke in a dependency-complete environment.

## 19. Evidence index

* CLI dispatcher: `src/index.ts:11-65`; automated orchestrator: `src/cli/run.ts:37-85`.
* Model integrations: `src/codexRuntimeChild.ts:59-104`, `src/agents/taskAnalyst.ts:45-114`, `src/agents/reviewer.ts:233-372`.
* Runtime isolation/timeout/logging: `src/codingWorker.ts:185-239,242-341,635-871`.
* State/artifacts: `src/runs/sessionModel.ts:5-167`, `src/executionPlan.ts:20-156`, `src/finalExport.ts:116-125`.
* Git/commit: `src/gitSession.ts:17-46`, `src/commitWorker.ts:64-144`.
* Tests: `src/validationRunner.ts:57-100,115-274`.
* Commands recorded above were executed in `/workspace/CatOS`; all Git observations are checkout-local.
