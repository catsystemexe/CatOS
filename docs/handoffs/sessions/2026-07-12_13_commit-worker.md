# ChatGPT handoff – 2026-07-12 Commit Worker

## 1. Session metadata

- **Datum:** 2026-07-12
- **Výchozí stav:** Pipeline končila po Human Gate artefaktu `human-decision.json`; commit ani push nevznikal.
- **Cíl kroku:** přidat první deterministický Commit Worker po explicitním `APPROVE`, bez push/PR/merge a bez dalších LLM/Codex volání.
- **Doporučený commit:** `feat: add approved Git commit worker`

## 2. Executive summary

Byla přidána první verze Git Commit Workeru a CLI příkaz `npm run catos -- commit --run <runId> [--message ...]`. Worker před commitem ověřuje finální výsledek, lidské schválení, evidence fingerprinty, Git top-level, pracovní větev `catos/*`, aktuální diff i seznam změněných souborů. Úspěšný commit zapisuje `runs/<runId>/commit-result.json` a druhé spuštění je idempotentní.

## 3. Změny provedené v tomto kroku

- Human Gate při `APPROVE` ukládá `approvedEvidence` se SHA-256 fingerprinty finálního diffu, validation reportu a review reportu.
- Přidán `GitCommitWorker`, který commit vytvoří pouze pro `final-result.status === "ACCEPTED"` a `human-decision.decision === "APPROVE"` s validními fingerprinty.
- Přidán CLI příkaz `commit`, načítání `input.json`, `task-brief.json`, `final-result.json`, `human-decision.json` a projektové konfigurace.
- Přidána lokální Git identita přes project config / env / fallback bez změny globálního Git configu.
- README dokumentuje příkaz, preflight, fingerprinty, `commit-result.json`, idempotenci a skutečnost, že push/PR zatím neexistují.
- Přidány fixture testy nad dočasnými Git repozitáři bez OpenAI/Codex API.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou dostupné. |
| `npm install --ignore-scripts --no-audit --no-fund` | BLOCKED | Registry/firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz`; runtime hlásí Node.js `v20.20.2`, projekt vyžaduje `>=22`. |
| `npm run test` | BLOCKED | Nelze spustit bez dostupných dependencies/Vitest. |
| `npm run build` | BLOCKED | Nelze spustit bez dostupných dependencies/type definitions. |

## 5. Bezpečnostní stav po změně

- Commit Worker nepushuje, nemerguje, nerebasuje, nepoužívá GitHub API a nespouští Codex ani LLM.
- Starší APPROVE artefakty bez `approvedEvidence` nejsou zpětně akceptované.
- Commit probíhá jen v externím worktree a jen na větvi s prefixem `catos/`.
- `commit-result.json` se zapisuje až po úspěšném commitu a ověření čistého working tree.

## 6. Známá rizika

- Validace nemohla doběhnout v tomto kontejneru kvůli blokovaným dependencies a Node.js 20.
- Test pro změnu staged diffu spoléhá na Git hook scénář; v prostředí s dependencies je vhodné jej po prvním běhu případně zpřesnit podle reálného chování Git hooků.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupným npm registry spustit `npm ci`, potom `npm run typecheck`, `npm run test` a `npm run build`. Následně ověřit end-to-end běh: `decide --decision approve` vytvoří fingerprinty a `commit --run <runId>` vytvoří lokální commit bez push/PR.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_13_commit-worker.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `13`
- **Starší archivní handoffy:** ponechány beze změny.
