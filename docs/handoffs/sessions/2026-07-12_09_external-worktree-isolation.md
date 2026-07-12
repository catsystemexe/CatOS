# ChatGPT handoff – 2026-07-12 External worktree isolation fix

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** aktuální pracovní branch v repozitáři CatOS.
- **Výchozí stav:** Validation Runner už ukládal `validation-report.json`, ale Codex worktree vznikal pod `runs/<runId>/workspace` uvnitř CatOS repozitáře. To umožnilo `npm run ...` v cílovém checkoutu bez vlastního `package.json` najít rodičovský `package.json` CatOS a vytvořit falešný validační `PASS`.
- **Cíl kroku:** oddělit run artefakty od pracovního checkoutu cílového projektu, přidat externí workspace root, přidat boundary guardy a validační preflight, neměnit Reviewera, nepřidávat rework loop, Human Gate, cleanup provider ani obecný sandbox provider.
- **Výsledný commit:** bude vytvořen jako `fix: isolate target worktrees from CatOS repository`.

## 2. Executive summary

Codex Worker už nepoužívá `runDir` jako implicitní workspace. `CodingTask` nyní přijímá samostatný `workspaceRoot` a worktree se skládá jako `<workspaceRoot>/<runId>/workspace`, zatímco artefakty nadále zapisuje Coordinator do `runs/<runId>/`.

Workspace root se určuje v pořadí explicitní `execution.workspaceRoot`, proměnná `CATOS_WORKSPACE_ROOT`, bezpečný fallback `os.tmpdir()/catos-workspaces`. Před vytvořením worktree se používají absolutní normalizované cesty a boundary kontrola přes `path.relative`, ne prosté stringové `startsWith`.

Validation Runner má novou preflight kontrolu. Pokud workspace neexistuje, není git toplevel, jeho `git rev-parse --show-toplevel` neodpovídá přesně workspace path, nebo workspace leží uvnitř CatOS rootu, vrací `BLOCKED` před spuštěním validačních příkazů. Tím se zabrání falešnému `PASS` z rodičovského `package.json`.

## 3. Změny provedené v tomto kroku

### `src/codingWorker.ts`

- `CodingTask` byl změněn z `runDir` na `workspaceRoot`.
- Přidána funkce `buildIsolatedWorkspacePath()` pro vytvoření externího worktree path `<workspaceRoot>/<runId>/workspace`.
- Přidány guardy, že workspace neleží uvnitř CatOS rootu ani uvnitř původního cílového checkoutu.
- Přidána kontrola, že workspace path obsahuje segment odvozený z `runId` a před vytvořením neexistuje.
- Codex SDK dostává jako `workingDirectory` externí workspace path.
- Zápis `coding-result.json`, `workspace.diff` a `workspace-status.txt` zůstává v run artefaktech.

### `src/workspaceRoot.ts`

- Přidána funkce `resolveWorkspaceRoot()`.
- Pořadí resolution je explicitní config, environment `CATOS_WORKSPACE_ROOT`, fallback `os.tmpdir()/catos-workspaces`.

### `src/config/projectConfigSchema.ts`

- Přidána volitelná sekce `execution.workspaceRoot`.

### `src/cli/run.ts`

- CLI resolveuje workspace root a předává ho Coding Workeru.
- Coordinator nadále používá `run.runDir` pouze pro artefakty.

### `src/validationRunner.ts`

- Přidána validační preflight kontrola před spuštěním příkazů.
- Při porušení izolace nebo git top-level mismatch se vrací `BLOCKED`.
- `cwd` validačních příkazů zůstává přesně externí `workspacePath`.

### `tests/codingWorker.test.ts`

- Aktualizovány testy na nový kontrakt `workspaceRoot`.
- Přidány testy, že worktree vzniká mimo CatOS root a unsafe workspace roots uvnitř CatOS nebo cílového checkoutu jsou odmítnuty.

### `tests/validationRunner.test.ts`

- Testovací workspaces jsou git top-level checkouty.
- Přidán test odmítnutí workspace, jehož Git top-level neodpovídá workspace path.
- Přidán regresní test pro cílový repo bez `package.json`, který nesmí použít parent package scripts.
- Přidán test, že demo workspace uvnitř CatOS root skončí `BLOCKED`, nikdy falešným `PASS`.

### `tests/runCli.test.ts`

- CLI integrační test ověřuje externí workspace path odvozený z `workspaceRoot` a `runId`, zatímco artefakty zůstávají v `runs/<runId>/`.

### `README.md`

- Dokumentováno oddělení run artefaktů a externího worktree.
- Popsáno pořadí `execution.workspaceRoot` → `CATOS_WORKSPACE_ROOT` → OS temp fallback.
- Popsána Validation Runner preflight kontrola Git top-level a CatOS root boundary.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm install --ignore-scripts --no-audit --no-fund` | BLOCKED | Registry/firewall vrátil `403 Forbidden` pro `@vitest/utils-3.2.7.tgz`; zároveň runtime hlásí Node.js `v20.20.2`, projekt vyžaduje Node.js `>=22`. |
| `npm run typecheck` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nelze v tomto kontejneru kompletně nainstalovat. |
| `npm run test -- --runInBand` | BLOCKED | Exit code 127; `vitest: not found`, protože dependencies nelze v tomto kontejneru kompletně nainstalovat. |
| `npm run test` | BLOCKED | Exit code 127; `vitest: not found`, protože dependencies nelze v tomto kontejneru kompletně nainstalovat. |
| `npm run build` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nelze v tomto kontejneru kompletně nainstalovat. |

## 5. Bezpečnostní stav po změně

Zachováno:

- Reviewer nebyl měněn.
- Nebyl přidán rework loop.
- Nebyl přidán Human Gate.
- Význam statusů `PASS`, `FAIL`, `BLOCKED` nebyl změněn.
- Nebyl přidán obecný sandbox provider ani cleanup worktree nad rámec nutné opravy.

Zlepšeno:

- Worktree cílového projektu už není pod `runs/<runId>/workspace` uvnitř CatOS repozitáře.
- Validation Runner odmítá workspace uvnitř CatOS rootu nebo workspace, který není přesným Git top-level.
- Parent `package.json` CatOS už nemá být dosažitelný přes npm parent lookup z externího worktree.

## 6. Známá rizika

- V tomto kontejneru nelze dokončit závislosti kvůli package firewallu a běží Node.js 20 místo požadovaného Node.js 22+, takže TypeScript/Vitest/build validace jsou blokované.
- Guard na existující workspace path záměrně neřeší cleanup starých worktree nad rámec požadované izolace.
- `execution.workspaceRoot` není zpětně zapisován do existujících projektových YAMLů; bez něj se použije env override nebo OS temp fallback.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit `npm ci` nebo `npm install`, poté `npm run typecheck`, `npm run test` a `npm run build`. Následně provést end-to-end demo na fixture cílovém repozitáři bez `package.json` a ověřit, že validace skončí `FAIL` nebo `BLOCKED`, nikoli falešným `PASS`.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_09_external-worktree-isolation.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `09`
- **Starší archivní handoffy:** ponechány beze změny.
