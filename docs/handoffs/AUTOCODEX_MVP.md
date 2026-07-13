AUTOCODEX_MVP.md

AutoCodex MVP v1.0

Status: Draft
Purpose: MVP Specification
Parent project: CatOS

⸻

Mission

AutoCodex automatizuje komunikaci mezi ChatGPT a Codexem tak, aby odstranil ruční přenášení informací (Ctrl+C / Ctrl+V), při zachování úplné lidské kontroly a auditovatelnosti.

AutoCodex není autonomní vývojář.

Je to orchestraceční vrstva řídící vývojovou session.

⸻

Core Principle

AutoCodex nesmí měnit způsob práce.

Pouze automatizuje mechanické předávání informací mezi:

* ChatGPT
* Codex
* lokálním repozitářem
* validací
* artefakty

Veškerá rozhodnutí zůstávají pod kontrolou člověka.

⸻

Goal

Úspěšně dokončit kompletní vývojovou session:

ChatGPT

↓

AutoCodex

↓

Codex

↓

AutoCodex

↓

Review

↓

Human

↓

Commit

↓

Ruční PR

↓

Ruční Merge

bez jediného ručního kopírování textu.

⸻

MVP Scope

AutoCodex umí:

* vytvořit session
* vytvořit izolovaný workspace/worktree
* spouštět Codex
* řídit více iterací nad stejnou pracovní větví
* archivovat všechny kroky
* provádět validaci
* připravit review package
* vytvořit commit

AutoCodex neumí:

* push
* PR
* merge
* CI/CD
* release
* deployment

⸻

Architecture

ChatGPT
↓
AutoCodex Runtime
↓
Workspace Worker
↓
Codex Worker
↓
Validation Worker
↓
Audit Engine
↓
Review Package
↓
Human Decision

⸻

Development Session Model

Session
    Step
        Attempt
            Validation
        Decision

Session

Celá práce od zadání po připravený commit.

Step

Jeden logický krok.

Například:

* analýza
* implementace
* oprava
* review

Attempt

Jedno spuštění Codexu.

⸻

Session Lifecycle

Create Session
↓
Create Workspace
↓
Step 1
↓
Attempt(s)
↓
Validation
↓
Decision
↓
Step 2
↓
...
↓
Final Review
↓
Commit
↓
Done

⸻

Workspace Policy

Každá session používá vlastní izolovaný workspace.

Například:

/tmp/catos-workspaces/<runId>/workspace

Nikdy:

* hlavní repo
* HOME
* Replit workspace
* produkční projekt

⸻

Security Model

Používá se:

danger-full-access

Bezpečnost ale nezajišťuje sandbox.

Bezpečnost zajišťuje:

* izolovaný workspace
* allowlist environment
* odstranění credentials
* audit
* Human Gate

⸻

Runtime Hardening

Před spuštěním Codexu musí proběhnout:

Workspace Guard

Ověření:

* workspace existuje
* není symlink
* není HOME
* není parent repo
* je pod povoleným workspace rootem

⸻

Hardened Environment

Nevyužívat process.env.

Použít allowlist.

Například:

* PATH
* HOME
* TMPDIR
* LANG
* TERM

Pouze nezbytné proměnné.

⸻

Credential Scrubber

Odstranit:

* GitHub tokeny
* SSH agent
* Git credentials
* Replit secrets
* cloud credentials

⸻

Runtime Manifest

Každý běh vytvoří runtime manifest obsahující:

* sandbox mode
* workspace
* environment policy
* credentials policy
* network policy

Aktuální MVP zapisuje `runtime/runtime.json` jako sourozence pracovního
`workspace` adresáře pro počáteční běh i rework attempt. Manifest obsahuje
pouze názvy předaných environment proměnných, nikdy jejich hodnoty.
Zaznamenává také absolutní `realpath` workspace, povolený workspace root,
dočasné `HOME` a `TMPDIR`, stav odstranění GitHub credentials a SSH agenta,
`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null` a
`GIT_TERMINAL_PROMPT=0`.

Síťová izolace není v Replitu v tomto MVP vynucena. Runtime manifest proto
uvádí síťový stav jako `unrestricted`; bezpečnostní hranice MVP stojí na
Workspace Guardu, environment allowlistu, credential scrubbingu, auditu a
Human Gate.

Codex SDK neběží v hlavním coordinator procesu CatOS. Coordinator vytvoří
samostatný Codex runtime child process a předá mu pouze explicitní allowlist
environmentu. Globální `process.env` hlavního procesu se kvůli spuštění
Codexu nepřepisuje ani dočasně nemutuje. `OPENAI_API_KEY` a `OPENAI_BASE_URL`
jsou v tomto MVP ponechány jako důvěryhodné credentials dostupné Codex
procesu pro současný způsob autentizace; nejde tedy o izolaci těchto konkrétních
OpenAI credentials od Codex procesu. Manifest nadále zapisuje pouze názvy
proměnných, nikdy jejich hodnoty.

Runtime child má výchozí timeout 30 minut na attempt; lze ho změnit pomocí
`CATOS_CODEX_RUNTIME_TIMEOUT_MS`. Stdout a stderr child procesu jsou oddělené
od IPC výsledku a ukládají se do `runtime/codex-runtime.stdout.log` a
`runtime/codex-runtime.stderr.log` s limitem 1 MiB na stream. Při chybě se
zapíše také `runtime/codex-runtime-error.json` s důvodem bez hodnot secrets.

Danger Full Access Policy

`danger-full-access` nesmí být tichý fallback. Musí být explicitně nastaven
v konfiguraci a potvrzen pomocí `codex.acknowledgeNoSandbox: true`. Pokud je
zapnutý, runtime manifest uvádí `sandboxIsolation: disabled`; CatOS přitom
nadále zachovává Human Gate, nepřidává push, PR ani merge.

⸻

Audit Model

Každý Step vytváří vlastní audit.

Obsahuje:

* request
* prompt
* commands
* changed files
* stdout
* stderr
* validation
* decision
* summary

Historie se nikdy nepřepisuje.

⸻

Attempt Policy

Neúspěšné pokusy se zachovávají.

Například:

Attempt 1

❌ Build failed

Attempt 2

❌ Tests failed

Attempt 3

✅ Success

⸻

Review Package

Na konci session vznikne balíček obsahující:

* Goal
* Timeline
* Attempts
* Validation Summary
* Risks
* Remaining Work
* Suggested Commit Message
* Suggested PR Description

Review Package slouží jako podklad pro společnou revizi v ChatGPT.

⸻

Human Gate

AutoCodex nikdy automaticky:

* nepushuje
* nevytváří PR
* nemerguje

To zůstává vědomým rozhodnutím člověka.

⸻

Artefacts

Navržená struktura:

session/
    session.json
    step-001/
        attempts/
        decision.json
        summary.md
    step-002/
    review/
    commit/

⸻

CLI (MVP)

autocodex start
autocodex continue
autocodex review
autocodex commit
autocodex clean

⸻

Definition of Done

MVP je dokončeno, pokud lze:

* zahájit vývojovou session
* provést více iterací Codexu
* archivovat všechny kroky
* vytvořit review package
* vytvořit commit

bez jediného ručního Ctrl+C / Ctrl+V.

⸻

Explicitly Out of Scope

Do verze MVP nepatří:

* GitHub API
* automatické PR
* automatický merge
* CI/CD
* release management
* multi-agent orchestrace
* paralelní běhy
* plugin systém
* cloud workers
* pokročilé plánování

⸻

Vision

CatOS je platforma.

AutoCodex je první produkt postavený nad CatOS.

Jeho úkolem není nahradit vývojáře.

Jeho úkolem je odstranit mechanickou práci, zachovat auditovatelnost a umožnit efektivní spolupráci mezi člověkem, ChatGPT a AI coding agentem.

⸻

Implemented session step model note

A session records exactly one active logical step through `activeStepId`. New steps are explicit and append-only: `step` creates `steps/NNN-<stepId>/step.json`, `request.md`, appends `step.created`, and makes the new step active.

Minimal step status transitions:

* `open → running → awaiting_decision`
* `awaiting_decision → accepted` for `accept`
* `awaiting_decision → rejected` for `reject` or `abort`
* `awaiting_decision → open` for `retry`
* `awaiting_decision → superseded` for `revise`
* `open|running|awaiting_decision → superseded` only when `step --supersede-current` is used

The implemented rule for `revise` is conservative: it closes the current step as `superseded` and clears the active step so the next logical request must be created explicitly with `step`. Rework attempts never create a new step automatically; they attach to the current `activeStepId` and are rejected when there is no active step or the target step is already closed.

⸻

Implemented Review Package note

AutoCodex now provides a deterministic session-level Review Package. It is a derived, human-readable review artifact assembled only from existing audit artifacts; it does not use AI, infer new facts, or rewrite source artifacts.

Generated files:

* `runs/<sessionId>/review/review-package.json` — structured renderer model with `schemaVersion: 1`.
* `runs/<sessionId>/review/review-package.md` — stable Markdown rendering for human review.

CLI command:

```sh
npm run catos -- review --run <sessionId>
```

The command loads `session.json`, ordered `step.json` files, ordered `attempt.json` files, decision history, validation/reviewer/commit artifacts when present, runtime manifests, changed-file metadata, and the timeline summary. It then prints the package paths and concise session state.

The JSON model contains:

* `session` metadata (`sessionId`, goal, status, branch, workspace path, timestamps, active step)
* aggregate `summary`
* ordered `steps` with attempts, decisions, and optional `summary.md` path
* de-duplicated `changedFiles`
* validation summaries
* decision history
* filtered timeline summary
* known limitations
* missing/invalid artifacts
* stable `recommendedNextAction`

`recommendedNextAction` is rule-based and machine-readable. Current values are:

* `abort` — session is aborted
* `wait` — active step is running
* `decide` — active step is awaiting a human decision
* `run-step` — active step is open without attempts, or open after a retry decision
* `create-step` — session is active and has no active step
* `commit-or-revise` — session is ready for review and has not been committed
* `manual-pr` — session is committed or has a commit artifact
* `inspect` — missing/invalid critical artifacts or otherwise unclear state

Security behavior:

* Environment variable values, API keys, tokens, secrets, SSH credentials, and Git credentials are not copied into the package.
* Runtime manifests are filtered to allowed variable names, sandbox/isolation/network state, HOME/TMPDIR paths, and credential scrub flags.
* Secret-like values are redacted from JSON and Markdown output.

The renderer is idempotent for unchanged source artifacts except for `generatedAt`, which can be injected by tests.

## Continue Package MVP

AutoCodex now separates review/audit handoff from the executable continuation contract. The Review Package remains an audit-oriented, human review artifact. The Continue Package is a deterministic, agent-neutral working contract for exactly the current active step and next coding attempt. It is not an AI summary and is rebuilt from `session.json`, the active `step.json`, `request.md`, ordered attempt artifacts, the last validation/report/decision artifacts, static AutoCodex policy constraints, and whitelisted runtime metadata only.

Generated artifacts live under:

```text
runs/<sessionId>/continue/
  continue-package.json
  continue-package.md
  codex-prompt.md
```

`continue-package.json` is the stable machine-readable contract. `continue-package.md` is a human-readable rendering of the same fields. `codex-prompt.md` is a Codex-specific renderer produced from the neutral contract.

CLI usage:

```bash
npm run catos -- continue-package --run <sessionId>
npm run catos -- continue --run <sessionId>
```

The command prints the session, active step, previous attempt count, continue reason, artifact paths, and the recommended next command:

```bash
npm run catos -- run-step --run <sessionId> --prompt-file runs/<sessionId>/continue/codex-prompt.md
```

`run-step` regenerates the Continue Package and Codex prompt by default, uses the prompt for the new attempt, and stores an exact prompt copy in the attempt audit directory. The current smoke/integration path supports `--fake-child` for deterministic child-run testing without invoking an external Codex runtime.

### Continue reason rules

Reasons are deterministic and evaluated with this priority:

1. no active-step attempts: `initial-step`
2. last attempt failed, timed out, or reports runtime error/timeout: `runtime-failure`
3. latest decision is retry: `retry`
4. latest decision is revise: `revise`
5. latest review verdict is `REWORK`: `review-rework`
6. latest validation is `FAIL` or `BLOCKED`: `validation-failure`
7. later explicit open step without failures: `manual-follow-up`
8. otherwise: `retry`

Fresh steps therefore contain the session goal, current step request, and constraints without fabricated previous failures. Retries include only previous attempts and findings for the same active step, so findings from closed steps are not carried into the next step.

### Security and determinism policy

Continue artifacts apply the same or stricter redaction policy as review handoff artifacts: OpenAI/GitHub/Slack-style tokens and known test secret values are replaced with `[REDACTED]`. Full logs, full diffs, arbitrary environment values, credentials, and unfiltered runtime manifests are not embedded. Runtime metadata is included only through existing attempt fields and artifact references.

Previous attempt summaries are chronological and limited to the last five attempts for the active step; the omitted count is recorded in `execution.omittedPreviousAttempts`. Findings, constraints, validation commands, relevant files, and artifact references are deduplicated and sorted deterministically. Tests can inject `generatedAt` by calling the builder with a fixed clock.

### Codex prompt renderer

`renderCodexPrompt(pkg)` converts the agent-neutral contract into working instructions with these sections:

- Session Goal
- Current Step
- Task
- Why This Attempt Exists
- Previous Attempt Results
- Required Changes
- Constraints
- Relevant Files
- Validation
- Output Requirements

The output requirements explicitly forbid push, merge, and audit artifact deletion, and require a concise change summary, changed files, validation results, and known limitations.

## Codex-like Git branch workflow

AutoCodex sessions now use an explicit Git contract instead of relying on the
current repository `HEAD`. A user selects a project and a base branch. CatOS
resolves that base branch to an exact immutable commit (`baseCommit`), creates a
single deterministic run branch (`catos/<runId>`) from that commit, and runs all
steps and attempts in one isolated Git worktree. The target project worktree is
separate from the CatOS orchestrator repository; CatOS stores audit artifacts
under `runs/<sessionId>` while source changes happen only in the target project
workspace.

The session Git context records:

* project id,
* target repository path,
* remote name and sanitized remote URL when present,
* base branch,
* exact base commit snapshot,
* run branch,
* PR target branch,
* isolated workspace path.

The run CLI accepts explicit branch selection:

```bash
npm run catos -- run \
  --project <projectId> \
  --base-branch <branch> \
  --pr-target <branch> \
  --task "<task>"
```

`--base-branch` overrides the project config. If it is omitted, CatOS uses
`project.baseBranch`. If neither is present, run startup fails with a clear
error. `--pr-target` is optional and defaults to the selected base branch; it may
be different from the base snapshot branch, but it must resolve to a local Git
commit at session start.

Before creating a workspace, CatOS verifies the target path is a Git repository,
verifies both base and PR target branches, resolves
`git rev-parse <baseBranch>^{commit}`, stores the resulting hash as
`baseCommit`, and creates the run branch from that hash. The run branch is never
created from a moving branch name.

Session invariants:

* all steps and attempts use the same isolated worktree,
* all changes stay on the stored run branch,
* the base branch is never modified directly,
* later attempts never create a new run branch,
* changing the base branch mid-session is invalid,
* Workspace Guard still validates the workspace,
* continuation checks fail if the worktree branch differs from the stored
  `runBranch`.

Remote metadata is read with `git remote get-url <remoteName>`. Missing remotes
do not block local sessions or commits. Credential-bearing HTTPS remotes are
sanitized before they are stored in session, review, or handoff artifacts. CatOS
never stores GitHub tokens, never accesses the SSH agent, and never derives
credentials from remote URLs.

After an approved commit, CatOS writes deterministic manual handoff artifacts:

* `runs/<sessionId>/handoff/pr-handoff.json`
* `runs/<sessionId>/handoff/pr-handoff.md`

The handoff records the base snapshot, run branch, head commit, PR target,
remote status, push readiness, and PR direction (`runBranch → prTargetBranch`).
If a commit exists, the remote exists, and the workspace is still on the stored
run branch, CatOS renders but does not run the manual push command:

```bash
git -C "<workspacePath>" push -u "<remoteName>" "<runBranch>"
```

If no commit exists, the push status is `not-committed`. If the remote is absent,
the push status is `remote-missing` and no fake push command is generated. If the
branch invariant fails, the status is `blocked` with explicit blocking reasons.

CatOS does not automatically push, create remote PRs, call the GitHub API, merge,
manage OAuth, or handle GitHub credentials. The handoff is only metadata for a
human to push, open a PR, review, and merge manually.

## AutoCodex MVP UI

AutoCodex now includes a minimal local web UI control panel in a retro DOS/Norton Commander style. It is intentionally a thin layer over the existing AutoCodex run/session artifacts and CLI workflow, not a second orchestration engine.

### Layout: SETUP / RUN / VIEWER

Start the UI with:

```bash
npm run ui
```

Then open the printed local URL, by default `http://127.0.0.1:8787`.

The page has three fixed panels:

- `SETUP`: project selection, repository display, base branch, PR target, task input, sandbox summary, `RUN`, and `STOP` only while a UI-started run is active.
- `RUN`: dynamic timeline table with `#`, `STEP`, `STATUS`, `OUTPUT`, and `TIME`.
- `VIEWER`: read-only text viewer for the selected output file.

The top bar contains only `CatOS`, `RUN #<id>`, status, and elapsed time. The bottom bar shows only implemented DOS-like shortcuts.

### Dynamic timeline

The UI timeline is built from actual run/session artifacts and timeline-relevant files. It does not pre-generate future steps. Rows appear only after corresponding session data or output files exist.

Current deterministic mapping:

- `session.json` or `task-brief.json` -> `ANALYSIS`
- first attempt artifact -> `CODEX`
- later attempts -> `CODEX (REWORK #N)`
- validation report -> `VALIDATION`
- review report -> `REVIEW`

Each row has at most one primary output file and shows `/copy/ /view/` actions when that output exists. `/copy/` copies the relative path, not file contents.

### Output Viewer

The viewer opens only files inside the selected run directory. Supported extensions are:

- `.md`
- `.txt`
- `.json`
- `.diff`
- `.log`

JSON is pretty printed. Markdown is shown as plain text. Diff files keep minimal text coloring for added (`+`) and removed (`-`) lines. Large files are truncated to keep the UI responsive.

### Human Review

Human Review is displayed as a separate system state after automatic processing, not as a normal future timeline step. When the authoritative final result requires human intervention, the UI shows:

```text
HUMAN REVIEW REQUIRED
[ ACCEPT ] [ RETRY ] [ REVISE ] [ REJECT ]
```

For this MVP, decision actions are read-only guidance and point users back to the existing CLI Human Gate flow. The UI does not bypass Human Gate rules.

### Final Export

The UI writes and displays the final export at:

```text
runs/<runId>/AUTOCODEX_SESSION_REPORT.md
```

The report is generated from existing audit artifacts where available: input/session metadata, steps, attempts, decisions, validation, review, changed files, commit/PR handoff notes, and known limitations. It is created on explicit final-export request and best-effort after UI-started run exit or stop.

### STOP state

`STOP` is implemented only for runs started by the current UI server process. It sends `SIGTERM` to the active child process, writes a `.ui-stopped` marker, preserves files already written, and refreshes the final export best-effort. For runs not owned by the active UI process, the API reports stop as unsupported and the UI does not present an active stop control.

### Security limitations

- No automatic push.
- No automatic remote PR.
- No merge.
- No GitHub API or credentials in UI.
- Output reading is restricted to the selected run directory and rejects path traversal.
- Project start validation checks repository existence, Git repository presence, and base/target branch existence before launching the existing run command.
- Workspace Guard and branch workflow remain owned by the existing backend/CLI code.

### Known limitations

- Human Review decisions are not yet wired to a browser form; use the CLI decision commands.
- STOP is best-effort and only applies to UI-owned child processes.
- The UI uses 1.5 second polling rather than websockets/SSE. Running STEP rows show a client-only ASCII spinner (`|`, `/`, `-`, `\`) at roughly 200 ms; spinner frames are never written to timeline or backend artifacts.
- Branch selection is text input in this first version.
- The UI is designed for one active local operator and does not implement users, auth, or parallel run management.
