# ChatGPT handoff – 2026-07-12 Validation timeout fix

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatel požadoval pracovat nad aktuálním stavem větve main; lokálně je checkoutnutý aktuální pracovní branch.)
- **Výchozí stav:** Validation Runner spouštěl validační příkazy přes shell a při timeoutu posílal `SIGTERM` pouze procesu shellu. V Replitu proto test timeoutu doběhl až na Vitest limit, protože child proces spuštěný shellem mohl zůstat běžet a držet otevřené handly.
- **Cíl kroku:** opravit timeout mechanismus tak, aby ukončil celý shell procesní strom, vrátil `BLOCKED` s `timedOut: true`, zachoval sekvenční spuštění dalších validačních příkazů a nezanechal běžící child procesy.
- **Výsledný commit:** bude vytvořen jako `fix: terminate validation timeout process groups`.

## 2. Executive summary

Validation Runner nyní na POSIX platformách spouští shell validačního příkazu v samostatné process group (`detached: true`) a při timeoutu ukončuje záporný PID process group. Tím se ukončí shell i proces spuštěný shellem. Po krátké grace period je připraven fallback na `SIGKILL`, aby runner nezůstal čekat na otevřené stdout/stderr handly.

Na Windows zůstává bezpečný fallback přes `child.kill()`, protože záporné PID process group je POSIX mechanismus. Chyby při ukončování procesu jsou ošetřené tak, aby již ukončený proces nezpůsobil pád runneru.

## 3. Změny provedené v tomto kroku

### `src/validationRunner.ts`

- Přidán helper `killProcessTree()`, který na POSIX posílá signál celé process group přes záporný PID.
- Shell validační příkazy se na POSIX spouštějí s `detached: true`, aby shell a jeho child procesy patřily do samostatné process group.
- Timeout nyní nejprve posílá `SIGTERM` celé process group a po 250 ms připraví fallback `SIGKILL`.
- `SIGKILL` fallback timer se čistí při `error` i `close`, aby po dokončení příkazu nezůstal otevřený timer handle.
- Zachováno mapování timeoutu na `BLOCKED`, `timedOut: true` a měření `durationMs`.
- Zachováno sekvenční spouštění všech validačních příkazů.

### `tests/validationRunner.test.ts`

- Timeout test teď používá delší child příkaz a krátký runner timeout, ale očekává dokončení výrazně pod 1 sekundou.
- Přidán test, kde první příkaz timeoutne a druhý krátký příkaz následně skončí `PASS`.
- Přidána kontrola, že timeoutnutý child proces po návratu runneru nevytvoří odložený soubor.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm install` | BLOCKED | Spuštěno; proces se zasekl při stahování přes package firewall a byl ručně ukončen. |
| `npm ci --ignore-scripts --no-audit --no-fund` | BLOCKED | Spuštěno; exit code 1; package firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz`. |
| `npm run typecheck` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |
| `npm run test` | BLOCKED | Spuštěno; exit code 127; `vitest: not found`, protože dependencies nejsou nainstalované. |
| `npm run build` | BLOCKED | Spuštěno; exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou nainstalované. |

## 5. Bezpečnostní stav po změně

Zachováno:

- Validation Runner není LLM agent.
- Validační příkazy zůstávají důvěryhodné project Config command stringy.
- Každý příkaz běží s `cwd` nastaveným na izolovaný worktree.
- Význam stavů `PASS`, `FAIL` a `BLOCKED` se nemění.
- Sekvenční vykonávání validačních příkazů se nemění.
- Nebyl přidán Reviewer, rework loop, Codex Worker změna, push, merge ani webové UI.

## 6. Známá rizika

- Lokální prostředí běží na Node.js `v20.20.2`, zatímco projekt vyžaduje Node.js `>=22`.
- Lokální dependencies nelze obnovit kvůli package firewallu (`403 Forbidden` pro `zod-4.4.3.tgz`), takže TypeScript, Vitest a build validace nebyly v tomto kontejneru dokončené.
- Windows fallback neumí zabít celý procesní strom stejně spolehlivě jako POSIX process group; podporované Replit/Linux prostředí je pokryté.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit `npm install`, `npm run typecheck`, `npm run test` a `npm run build`. Zvlášť ověřit `tests/validationRunner.test.ts`, že timeout test končí výrazně pod 1 sekundou a následný validační příkaz se provede.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_07_validation-timeout-fix.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `07`
- **Starší archivní handoffy:** ponechány beze změny.
