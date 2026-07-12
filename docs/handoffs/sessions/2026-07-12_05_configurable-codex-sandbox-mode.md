# ChatGPT handoff – 2026-07-12 configurable Codex sandbox mode

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatel požadoval pracovat nad aktuálním stavem větve main; lokálně je checkoutnutý aktuální pracovní branch.)
- **Výchozí stav:** Codex Worker explicitně předával SDK `sandboxMode: "workspace-write"`, ale režim nebyl konfigurovatelný z project Configu a `coding-result.json` nezaznamenával stav sandbox izolace.
- **Cíl kroku:** přidat konfigurovatelný Codex sandbox režim s bezpečným výchozím `workspace-write`, bez automatického fallbacku na `danger-full-access`, s povinným acknowledgement pro vypnutí sandbox izolace.
- **Výsledný commit:** bude vytvořen pro tento krok.

## 2. Executive summary

Project Config nyní obsahuje sekci `codex` s `sandboxMode` a volitelným `acknowledgeNoSandbox`. Výchozí sandbox režim zůstává `workspace-write`. Režim `danger-full-access` projde validací pouze při současném `acknowledgeNoSandbox: true`; jinak je konfigurace odmítnuta ještě před spuštěním Codex Workeru.

Codex Worker předává nakonfigurovaný režim SDK, při `danger-full-access` vypisuje výrazné varování a do `coding-result.json` zapisuje `sandboxMode` i `sandboxIsolation`.

## 3. Změny provedené v tomto kroku

### `src/config/projectConfigSchema.ts`

- Přidán `sandboxModeSchema` s povolenými hodnotami:
  - `read-only`,
  - `workspace-write`,
  - `danger-full-access`.
- Přidána config sekce `codex` s výchozím `sandboxMode: "workspace-write"` a `acknowledgeNoSandbox: false`.
- Přidána validace odmítající `danger-full-access` bez `acknowledgeNoSandbox: true`.

### `src/codingWorker.ts`

- Přidány typy `SandboxMode` a `SandboxIsolation`.
- `CodingTask` přijímá volitelný `sandboxMode`; pokud není předán, Worker používá `workspace-write`.
- `CodingResult` obsahuje `sandboxMode` a `sandboxIsolation`.
- `CodexSdkWorker` předává SDK nakonfigurovaný sandbox mode.
- Při `danger-full-access` vypíše Worker výrazné varování, že sandbox izolace je vypnutá.
- `writeCodingArtifacts()` zapisuje nové sandbox metadata do `coding-result.json`.

### `src/cli/run.ts`

- CLI předává `loaded.config.codex.sandboxMode` do Codex Workeru.
- Výstup CLI zobrazuje sandbox mode a stav izolace.

### `projects/demo.yaml`

- Demo konfigurace dočasně používá explicitní kompatibilní režim:
  - `codex.sandboxMode: danger-full-access`,
  - `codex.acknowledgeNoSandbox: true`.
- Tento demo režim je určen pouze pro demonstrační repozitář bez citlivých dat.

### `README.md`

- Doplněna dokumentace povolených sandbox režimů.
- Zdůrazněno, že `danger-full-access` není automatický fallback, je pouze explicitní kompatibilní režim pro prostředí, kde Codex sandbox nelze spustit, a vyžaduje acknowledgement.

### Testy

- `tests/config.test.ts` ověřuje:
  - výchozí režim `workspace-write`,
  - odmítnutí `danger-full-access` bez acknowledgement,
  - přijetí `danger-full-access` s acknowledgement.
- `tests/codingWorker.test.ts` ověřuje:
  - předání `danger-full-access` fake SDK,
  - `CodingResult.sandboxIsolation: "disabled"`,
  - zachování `workingDirectory` pro fake Codex,
  - zápis sandbox metadat do `coding-result.json`,
  - původní izolovaný worktree scénář dál používá `workspace-write`.
- `tests/runCli.test.ts` ověřuje, že CLI předá výchozí `workspace-write` injected Coding Workeru a artefakt obsahuje sandbox metadata.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |
| `npm install --no-audit --no-fund` | BLOCKED | Spuštěno pro odblokování dependencies; exit code 1; lokální package firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz` a Node runtime je `v20.20.2` proti požadavku `>=22`. |
| `npm run test` | BLOCKED | Spuštěno; exit code 127; `vitest: not found`, protože dependencies nelze nainstalovat. |
| `npm run build` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |

## 5. Bezpečnostní stav po změně

Zachováno:

- žádný automatický fallback z `workspace-write` na `danger-full-access`,
- žádné potlačení chyby bubblewrap,
- žádné automatické přepnutí na neizolovaný režim,
- výchozí bezpečný režim `workspace-write`,
- žádný push ani merge cílového projektu,
- žádný Validation Runner ani Reviewer.

`danger-full-access` je dostupný pouze jako explicitní, configem potvrzený kompatibilní režim pro prostředí, kde Codex sandbox nelze spustit.

## 6. Známá rizika

- Lokální dependencies v kontejneru nejsou nainstalované a instalace je blokovaná package firewallem, takže TypeScript a Vitest validace nejsou lokálně dokončené.
- Runtime prostředí hlásí Node.js `v20.20.2`, zatímco projekt vyžaduje Node.js `>=22`.
- Skutečné end-to-end Codex SDK volání v Replitu nebylo v tomto kroku spuštěno.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit:

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. end-to-end demo běh s `projects/demo.yaml` nad repozitářem bez citlivých dat, který ověří explicitní `danger-full-access` v Replit kompatibilním režimu.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_05_configurable-codex-sandbox-mode.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `05`
- **Starší archivní handoffy:** ponechány beze změny.
