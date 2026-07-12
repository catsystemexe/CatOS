# ChatGPT handoff – 2026-07-12 Reviewer Agent

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** aktuální pracovní branch v repozitáři CatOS.
- **Výchozí stav:** CatOS uměl projít tokem Task Analyst → Codex Worker → isolated worktree → coding artefakty → Validation Runner → `validation-report.json`. Validation statusy `PASS`, `FAIL` a `BLOCKED` byly oddělené od budoucích review verdiktů.
- **Cíl kroku:** přidat první verzi Reviewer agenta po Validation Runneru, uložit `runs/<runId>/review-report.json`, nepřidávat rework loop, Human Gate, commit/push cílového projektu, Memory, event log, Temporal, LangGraph ani webové UI.
- **Výsledný commit:** bude vytvořen jako `feat: add structured reviewer agent`.

## 2. Executive summary

Byla přidána první verze strukturovaného Reviewera nad OpenAI Agents SDK. Reviewer používá injected `ReviewerProvider`, aby testy nevolaly API, a produkční provider vytváří agenta bez tools. CatOS sestaví omezený review package z původního vstupu běhu, `TaskBrief`, metadat coding výsledku bez diffu/statusu, celého `workspace.diff`, `workspace-status.txt`, `validation-report.json` a relevantních omezení project configu.

Reviewer vrací validovaný `ReviewReport` s verdikty `ACCEPT`, `REWORK` nebo `HUMAN_REQUIRED`. CatOS deterministicky zakazuje `ACCEPT`, pokud validation status je `FAIL` nebo `BLOCKED`, a stejnou podmínku ověřuje po návratu provideru. Při překročení jednoduchého MVP limitu velikosti review package se kontext netruncuje; CatOS vrátí `HUMAN_REQUIRED`.

## 3. Změny provedené v tomto kroku

### `src/schemas/reviewReport.ts`

- Přidáno Zod schema `reviewReportSchema` pro `ReviewReport`.
- Verdikty Reviewera jsou výhradně `ACCEPT`, `REWORK`, `HUMAN_REQUIRED`.
- Kritéria používají statusy `SATISFIED`, `NOT_SATISFIED`, `UNCERTAIN`.
- Nálezy obsahují `id`, `title`, `evidence` a `requiredChange`.

### `src/agents/reviewer.ts`

- Přidán `ReviewerProvider` interface s metodou `review(input)`.
- Přidán `ReviewerInput` pro omezený review package.
- Přidána funkce `reviewChange()`, která validuje structured output vlastním Zod schematem.
- Přidána deterministická pravidla: `ACCEPT` není povolen pro validation `FAIL` ani `BLOCKED`.
- Přidán jednoduchý limit velikosti review package s návratem `HUMAN_REQUIRED` místo tichého krácení diffu.
- Přidán OpenAI Agents SDK provider s `tools: []`, bez shellu a bez filesystem tools.
- Přidán `CATOS_REVIEWER_MODEL` override s fallbackem na model Task Analysta.
- Přidán zápis `review-report.json`, který ukládá pouze validní `ReviewReport`.

### `src/cli/run.ts`

- CLI tok rozšířen na Task Analyst → Codex Worker → Validation Runner → Reviewer → `writeReviewReport`.
- CLI přijímá injected `reviewerProvider` pro testy.
- CLI vypisuje review verdict, počet blocking findings, počet warnings a cestu k `review-report.json`.
- Při `REWORK`, `ACCEPT` i `HUMAN_REQUIRED` zatím pouze uloží report a skončí; nebyl přidán rework loop ani Human Gate.

### `tests/reviewer.test.ts`

- Přidány testy pro validní `ACCEPT`, `REWORK`, `HUMAN_REQUIRED`.
- Přidány testy odmítnutí `ACCEPT` při validation `FAIL` a `BLOCKED`.
- Přidán test odmítnutí nevalidního structured outputu.
- Přidán test zápisu `review-report.json`.
- Přidán test předání `TaskBrief`, diffu a `ValidationReportu` provideru.
- Přidán test, že OpenAI Reviewer agent vzniká s `tools: []`.
- Přidán test oversized review package → `HUMAN_REQUIRED`.

### `tests/runCli.test.ts`

- CLI integrační test nyní injectuje Task Analyst provider, Coding Worker, Validation Runner i Reviewer provider.
- Test ověřuje zápis `review-report.json` a předání review dat.

### `README.md`

- Dokumentován účel Reviewera.
- Popsán rozdíl mezi validation statusy a review verdikty.
- Popsán artefakt `review-report.json`.
- Výslovně uvedeno, že zatím neexistuje rework loop ani Human Gate.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou v kontejneru nainstalované. |
| `npm run test` | BLOCKED | Exit code 127; `vitest: not found`, protože dependencies nejsou v kontejneru nainstalované. |
| `npm run build` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou v kontejneru nainstalované. |

## 5. Bezpečnostní stav po změně

Zachováno:

- Reviewer nemá shell ani filesystem tools.
- Reviewer nemění repozitář a nedostává interní reasoning Codexu ani kompletní Codex thread.
- `CodingResult.finalResponse` je pouze neautoritativní pomocný údaj.
- Rozhodující vstupy Reviewera jsou zadání, `TaskBrief`, diff, workspace status, validation report a project constraints.
- Validation statusy zůstávají `PASS`, `FAIL`, `BLOCKED`.
- Review verdikty jsou oddělené: `ACCEPT`, `REWORK`, `HUMAN_REQUIRED`.
- Nebyl přidán rework loop, Human Gate, commit/push cílového projektu, Memory, event log, Temporal, LangGraph ani webové UI.

## 6. Známá rizika

- V tomto kontejneru nejsou dostupné nainstalované dependencies, takže TypeScript, Vitest a build validace jsou pro tuto session blokované.
- Review package limit je jednoduchý MVP guard, nikoli plnohodnotný Context Assembler.
- Automatický rework loop zatím neexistuje; `REWORK` pouze uloží report a běh skončí.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit `npm install` nebo `npm ci`, poté `npm run typecheck`, `npm run test` a `npm run build`. Po ověření pokračovat až dalším samostatným krokem, například návrhem rework loopu nebo Human Gate podle roadmapy.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_08_reviewer-agent.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `08`
- **Starší archivní handoffy:** ponechány beze změny.
