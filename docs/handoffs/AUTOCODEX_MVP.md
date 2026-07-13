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
