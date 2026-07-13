# ChatGPT handoff – 2026-07-13 Commit Worker staged index verification

## 1. Výchozí stav

Commit Worker po schválení správně ověřoval Human Gate fingerprinty, aktuální kompletní workspace diff přes `collectWorkspaceGitState()`, přesnou shodu workspace diffu se schváleným `workspace.diff` a shodu `changedFiles` s `finalResult.finalChangedFiles`.

Chyba byla až po `git add --all`: staged diff se porovnával raw textově se schváleným diffem. To odmítalo validní změny, když byl obsah totožný, ale Git staged patch měl jiné pořadí souborů než schválený workspace/no-index diff.

## 2. Změny v tomto kroku

- Nahrazeno raw porovnání `git diff --cached --binary HEAD` se schváleným patchem obsahovou kontrolou staged Git indexu.
- Zachována preflight kontrola fingerprintů, kompletního workspace diffu přes `collectWorkspaceGitState()`, přesné shody diffu a shody `changedFiles`.
- Po `git add --all` se nyní NUL-safe parsuje `git diff --cached --name-status -z HEAD`.
- Staged ověření kontroluje:
  - staged seznam souborů přesně odpovídá schválenému seznamu,
  - nezůstaly unstaged změny (`git diff --quiet`),
  - nezůstaly untracked soubory (`git ls-files --others --exclude-standard -z`),
  - staged blob každého přidaného/upraveného souboru binárně odpovídá workspace souboru,
  - smazané soubory jsou staged jako delete a ve workspace neexistují,
  - v indexu není žádný další soubor.
- Při selhání staged ověření se provede `git reset`, commit se nevytvoří a pracovní soubory zůstávají beze změny.
- README bylo aktualizováno, aby popisovalo novou staged index kontrolu místo raw patch porovnání.
- Regresní testy Commit Workeru byly rozšířeny o pořadí patchů, staged obsahovou neshodu, neodsouhlasený staged soubor, binární nový soubor a smazaný soubor.

## 3. Skutečně provedená validace

- `npm run typecheck` bylo spuštěno, ale v tomto prostředí skončilo před kompilací kvůli nekompletním / nedostupným typovým balíčkům v `node_modules` (`Cannot find type definition file for 'node'` a `vitest/globals`).
- `npm ci` bylo zkusmo spuštěno pro obnovu závislostí, ale instalace zůstala viset v síťové fázi a byla ukončena.
- `npm run test` a `npm run build` nebylo možné spolehlivě dokončit, protože závislosti nebyly v prostředí korektně dostupné.

## 4. Známá rizika

- Plná validace vyžaduje prostředí s funkční instalací npm závislostí a Node.js splňující `package.json` (`>=22`). Aktuální lokální runtime hlásil Node v20.20.2.
- Nový helper odmítá staged statusy mimo `A`, `M`, `D`; pokud budoucí workflow zavede rename/copy jako samostatně očekávanou operaci, bude nutné rozšířit kontrakt i testy.

## 5. Doporučený další krok

- V prostředí s Node.js 22+ a funkčními npm závislostmi spustit `npm run typecheck`, `npm run test` a `npm run build`.
- Po úspěšné validaci reviewnout zejména regresní testy pro staged index mismatch a patch-order scénář.

## 6. Handoff checkpoint

- **Archivní handoff:** `docs/handoffs/sessions/2026-07-13_02_commit-worker-index-verification.md`
- **Aktualizovaný current handoff:** `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`
- **Checkpoint:** 02
- **Starší archivní handoffy:** ponechány beze změny.
