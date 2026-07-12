# ChatGPT handoff – 2026-07-12 Reviewer support changes

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** aktuální pracovní branch v repozitáři CatOS.
- **Výchozí stav:** Rework loop předával Reviewerovi standardní review balíček pro každý pokus, ale rework review nemělo explicitní strukturovaný kontext předchozího rework balíčku. Reviewer instrukce také dostatečně neodlišovaly skutečně nesouvisející soubory od podpůrných změn vynucených validací, acceptance criteria, existující konfigurací nebo testy.
- **Cíl kroku:** opravit review pravidla tak, aby Reviewer nepovažoval validačně vyžádaný podpůrný soubor za unrelated změnu jen proto, že nebyl doslovně uveden v původním zadání.
- **Doporučený commit:** `fix: recognize validation-required support changes in review`

## 2. Executive summary

Reviewer nyní dostává při review rework pokusu volitelný `reworkContext` s předchozími blocking findings, required changes, důvodem reworku a kompletním úzkým `ReworkPackage`. Instrukce OpenAI Reviewera nově vyžadují posuzovat scope podle TaskBriefu, předchozí validační chyby nebo rework contextu, aktuálního validation reportu, diffu a explicitních nonGoals, nikoli pouze podle seznamu změněných souborů.

Doplněné regresní testy ověřují pozitivní pravidlo pro podpůrný soubor vyžádaný validací i opačné pravidlo pro nový soubor bez vazby na acceptance criteria, validaci, projektovou konfiguraci/testy nebo rework context.

## 3. Změny provedené v tomto kroku

### `src/agents/reviewer.ts`

- Rozšířen `ReviewerInput` o volitelný `reworkContext` obsahující `reworkPackage`, `previousBlockingFindings`, `requiredChanges` a `reworkReason`.
- Doplněny Reviewer instrukce pro obecné rozpoznání legitimních podpůrných změn.
- Přidáno povinné pravidlo: při PASS validaci, splněných acceptance criteria, opravě konkrétní předchozí validační chyby nebo blocking findingu, bez porušení nonGoals a bez jiných blocking findings má Reviewer vrátit `ACCEPT` místo `REWORK`.
- Zachováno deterministické pravidlo, že `FAIL` nebo `BLOCKED` validace nesmí vést k `ACCEPT`.

### `src/cli/run.ts`

- Rework review input nyní obsahuje strukturovaný `reworkContext` odvozený z právě zapsaného `ReworkPackage`.
- Rework loop, Codex Worker, počet rework pokusů ani Human Gate nebyly měněny.

### `tests/reviewer.test.ts`

- Doplněn regresní test pro podpůrný soubor vytvořený po předchozí validační chybě, kdy následná validation je `PASS` a Reviewer instrukce i prompt obsahují potřebný rework context.
- Doplněn opačný test, že nový soubor bez vazby na acceptance criteria, validaci, projektovou konfiguraci/testy nebo rework context může být považován za scope violation.

### `tests/runCli.test.ts`

- Doplněno ověření, že počáteční review nemá `reworkContext`, zatímco následné rework review jej dostává s předchozím blocking findingem, required changes a důvodem reworku.

## 4. Skutečně provedená validace

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm run typecheck` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`, protože dependencies nejsou dostupné v kontejneru. |
| `npm run test` | BLOCKED | Exit code 127; `vitest` není nainstalovaný. |
| `npm run build` | BLOCKED | Exit code 2; chybí type definition files `node` a `vitest/globals`. |
| `npm install --ignore-scripts --no-audit --no-fund` | BLOCKED | Registry/firewall vrátil `403 Forbidden` pro `zod-4.4.3.tgz`; runtime zároveň hlásí Node.js `v20.20.2`, projekt vyžaduje `>=22`. |

## 5. Bezpečnostní stav po změně

Zachováno:

- Nebyl změněn Rework loop.
- Nebyl změněn Codex Worker.
- Nebyl zvýšen `maxReworkAttempts`.
- Nebyl přidán Human Gate.
- Nebyla přidána hardcoded výjimka pro konkrétní soubor typu `.rework-ok`.
- Nebyl přidán push ani merge.

Zlepšeno:

- Reviewer má pro rework review explicitní důkazní kontext předchozího blocking findingu a required changes.
- Scope posouzení je obecné pro podpůrné změny vyžádané validací, acceptance criteria, konfigurací nebo testy.

## 6. Známá rizika

- Validace nemohla doběhnout do PASS kvůli blokovanému package registry a lokálnímu Node.js 20 místo požadovaného Node.js 22+.
- Přidané testy ověřují předávání a instrukční pravidla; skutečné LLM chování je stále závislé na Reviewer modelu, ale prompt nyní obsahuje explicitní povinné pravidlo.

## 7. Doporučený další krok

V prostředí s Node.js 22+ a dostupnými dependencies spustit `npm ci` nebo `npm install`, poté `npm run typecheck`, `npm run test` a `npm run build`. Následně ověřit end-to-end rework scénář, kde předchozí validace vyžaduje nový podpůrný soubor a rework jej vytvoří.

## 8. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-12_11_reviewer-support-changes.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** `11`
- **Starší archivní handoffy:** ponechány beze změny.
