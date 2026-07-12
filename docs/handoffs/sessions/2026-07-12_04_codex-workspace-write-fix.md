# ChatGPT handoff – 2026-07-12 Codex workspace-write fix

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatel požadoval pracovat nad aktuálním stavem větve main; lokálně je checkoutnutý `work`.)
- **Výchozí stav:** existující `CodexSdkWorker` zakládal izolovaný Git worktree a předával SDK pouze `workingDirectory`, takže skutečný Codex thread mohl skončit v read-only sandboxu.
- **Cíl kroku:** explicitně spouštět Codex thread v režimu `workspace-write` bez přidání `danger-full-access`, `skipGitRepoCheck`, automatického commitu, pushe, merge nebo další fáze workflow.
- **Výsledný commit:** bude vytvořen pro tento opravný krok.

## 2. Executive summary

Oprava přidává explicitní `sandboxMode: "workspace-write"` do volání `codex.startThread()` v `CodexSdkWorker`. Zachované zůstává omezení na konkrétní `workingDirectory` izolovaného worktree a nepřidává se žádná širší filesystem permission ani obcházení Git kontroly.

Fake Codex factory test nyní ověřuje nejen správný `workingDirectory`, ale i předání `sandboxMode: "workspace-write"` do `startThread()`.

## 3. Změny provedené v tomto kroku

### `src/codingWorker.ts`

- Rozšířen lokální úzký typ `CodexClient.startThread()` o SDK option `sandboxMode` s hodnotami `read-only`, `workspace-write`, `danger-full-access`.
- `CodexSdkWorker.executeTask()` nyní při založení Codex threadu předává:
  - `workingDirectory: workspacePath`,
  - `sandboxMode: "workspace-write"`,
  - případný model z `CATOS_CODEX_MODEL`.
- Nebyl přidán `skipGitRepoCheck`.
- Nebyl použit `danger-full-access`.
- Nebyl přidán commit/push/merge cílového projektu.

### `tests/codingWorker.test.ts`

- Existující fake Codex factory v testu izolovaného worktree nyní zachytává `sandboxMode` z `startThread()` options.
- Test ověřuje, že `sandboxMode` je přesně `"workspace-write"`.
- Dosavadní ověření `workingDirectory`, izolace worktree, diffu a statusu zůstává zachováno.

## 4. Ověření SDK option názvu

Lokální `node_modules/@openai/codex-sdk` v kontejneru stále není dostupné, protože instalace dependencies naráží na registry/firewall. Pro přesný název option byl proto použit veřejný TypeScript zdroj balíčku `@openai/codex-sdk` 0.144.x z upstreamu: `ThreadOptions` obsahuje `sandboxMode?: SandboxMode` a `SandboxMode` obsahuje hodnotu `"workspace-write"`.

Nebyl vytvořen žádný lokální `.d.ts` shim.

## 5. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |
| `npm run test` | BLOCKED | Spuštěno; exit code 127; `vitest: not found`, protože dependencies nejsou nainstalované. |
| `npm run build` | BLOCKED | Spuštěno; exit code 2; stejný problém s chybějícími typy `node` a `vitest/globals`. |
| `npm install --no-audit --no-fund` | BLOCKED | Spuštěno pro ověření prostředí; exit code 1; registry/firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz`. |

## 6. Bezpečnostní stav po opravě

Zachováno:

- žádný automatický commit cílového projektu,
- žádný push,
- žádný merge,
- žádné `danger-full-access`,
- žádné `skipGitRepoCheck`,
- zápis Codexu omezený na izolovaný `workspacePath`,
- žádná nová fáze Validation Runner / Reviewer / rework loop.

## 7. Známá rizika

- Lokální dependencies v kontejneru stále nejsou nainstalované, takže validace je blokovaná prostředím.
- Skutečné end-to-end Codex SDK volání nebylo v tomto kroku spuštěno.
- Přesný typ byl ověřen z upstream TypeScript zdroje, ne z lokálně nainstalovaného `node_modules`, protože balíček v prostředí nelze nainstalovat.

## 8. Doporučený další krok

V prostředí s funkční instalací dependencies spustit znovu:

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. end-to-end Codex SDK běh nad dočasným cílovým repozitářem, který ověří, že Codex skutečně dokáže editovat soubor uvnitř izolovaného worktree.

## 9. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_04_codex-workspace-write-fix.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `04`
- **Starší archivní handoffy:** ponechány beze změny.
