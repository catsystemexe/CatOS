# ChatGPT handoff – 2026-07-12 Validation Runner

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatel požadoval pracovat nad aktuálním stavem větve main; lokálně je checkoutnutý aktuální pracovní branch.)
- **Výchozí stav:** Pipeline byla ověřena do kroku Codex Workeru v izolovaném Git worktree a ukládala `coding-result.json`, `workspace.diff` a `workspace-status.txt`. Chyběl deterministický Validation Runner po Codex Workeru.
- **Cíl kroku:** přidat první verzi deterministického Validation Runneru, který spouští projektové příkazy nad izolovaným worktree a ukládá `validation-report.json`.
- **Výsledný commit:** bude vytvořen jako `feat: add deterministic validation runner`.

## 2. Executive summary

CatOS nyní po dokončení Codex Workeru spouští neagentní TypeScript Validation Runner. Runner čte příkazy z project Configu, interně je převádí na povinné příkazy `typecheck`, `test`, `build`, spouští je sekvenčně v izolovaném worktree a ukládá strukturovaný report do `runs/<runId>/validation-report.json`.

Celkový stav reportu je deterministicky počítán podle závažnosti `BLOCKED > FAIL > PASS`. Selhání jednoho příkazu nezastaví další příkazy, aby report ukázal kompletní validační obraz.

## 3. Změny provedené v tomto kroku

### `src/validationRunner.ts`

- Přidány typy `ValidationCommand`, `ValidationCommandResult`, `ValidationReport` a rozhraní `ValidationRunner`.
- Přidán `ShellValidationRunner`, který spouští project config command stringy explicitně přes shell s `cwd` nastaveným na izolovaný worktree.
- Zachytává exit code, signal, stdout, stderr, duration a timeout.
- Mapuje výsledky na `PASS`, `FAIL` a `BLOCKED`.
- Pokračuje v dalších příkazech i po předchozím selhání.
- Přidán helper `buildValidationCommands()` pro kompatibilitu se stávajícím config tvarem `commands.typecheck/test/build`.
- Přidán `writeValidationReport()` pro zápis `validation-report.json`.

### `src/config/projectConfigSchema.ts`

- Přidána jednoduchá sekce `validation.timeoutMs` s výchozí hodnotou `120000` ms.
- Zachován stávající tvar `commands.typecheck`, `commands.test`, `commands.build`.

### `src/cli/run.ts`

- CLI tok rozšířen na:
  - `createRun`,
  - Task Analyst,
  - Codex Worker,
  - `writeCodingArtifacts`,
  - Validation Runner,
  - `writeValidationReport`,
  - CLI výstup.
- Přidána injection možnost `validationRunner` pro testy bez OpenAI API, Codex API a skutečného cílového projektu.
- CLI vypisuje celkový validation status, stav každého příkazu, exit code, dobu běhu a cestu k reportu.

### `tests/validationRunner.test.ts`

Přidány testy pro:

- exit code 0 → `PASS`,
- nenulový exit code → `FAIL`,
- neexistující executable → `BLOCKED`,
- timeout → `BLOCKED`,
- pokračování dalších příkazů po předchozím selhání,
- celkový report `PASS`, `FAIL` a `BLOCKED`,
- správné `cwd` ve worktree,
- zápis `validation-report.json`,
- převod config příkazů na `typecheck`, `test`, `build`.

### `tests/runCli.test.ts`

- CLI integrační test nyní používá injected Task Analyst provider, injected Coding Worker a injected Validation Runner.
- Ověřuje zápis `validation-report.json` a předání příkazů v pořadí `typecheck`, `test`, `build`.

### `README.md`

- Doplněna dokumentace Validation Runneru, pořadí příkazů, významu `PASS` / `FAIL` / `BLOCKED`, umístění `validation-report.json` a faktu, že zatím neexistuje Reviewer ani automatická oprava.

### `projects/demo.yaml`

- Doplněna explicitní ukázka `validation.timeoutMs: 120000`.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |
| `npm install --no-audit --no-fund` | BLOCKED | Spuštěno pro ověření odblokování dependencies; exit code 1; package firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz` a runtime je Node.js `v20.20.2` proti požadavku `>=22`. |
| `npm run test` | BLOCKED | Spuštěno; exit code 127; `vitest: not found`, protože dependencies nejsou nainstalované a instalace je blokovaná. |
| `npm run build` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |

## 5. Bezpečnostní stav po změně

Zachováno:

- Validation Runner není LLM agent.
- Validační příkazy se neodvozují z TaskBriefu ani z modelového výstupu.
- Každý příkaz běží s `cwd` nastaveným na `CodingResult.workspacePath`.
- Runner neposílá do logů environment proměnné.
- Codex sandbox mode se tímto krokem nemění.
- Nebyl přidán Reviewer, rework loop, další volání Codexu, commit cílového projektu, push, merge, GitHub API, Memory, event log, Temporal, LangGraph ani webové UI.

Poznámka: protože stávající config ukládá příkazy jako shell command stringy (`npm run typecheck`), MVP je spouští přes explicitní shell. To je zdokumentované v kódu a omezené na důvěryhodnou project Config hodnotu s `cwd` připnutým na worktree.

## 6. Známá rizika

- Lokální dependencies v kontejneru nejsou nainstalované a instalace je blokovaná package firewallem, takže TypeScript, Vitest a build validace nejsou lokálně dokončené.
- Runtime prostředí hlásí Node.js `v20.20.2`, zatímco projekt vyžaduje Node.js `>=22`.
- Shell execution je záměrná kompatibilní MVP volba pro stávající command stringy; pro budoucí bezpečnější rozšíření lze zvážit strukturovaný argv config, ale nebyl přidán v tomto kroku.
- Skutečný end-to-end běh přes OpenAI Agents SDK a Codex SDK nebyl v tomto kroku spouštěn.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit `npm run typecheck`, `npm run test`, `npm run build` a následně malý end-to-end demo běh, který ověří vytvoření `validation-report.json` po reálném Codex Workeru.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_06_validation-runner.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `06`
- **Starší archivní handoffy:** ponechány beze změny.
