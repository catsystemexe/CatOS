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
