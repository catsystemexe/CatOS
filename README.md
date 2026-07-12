# CatOS

CatOS je připravovaná CLI aplikace pro řízení bezpečné a auditovatelné automatizace práce nad lokálními repozitáři. Dlouhodobý směr projektu popisuje [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).

## Aktuální stav MVP

Aktuální verze implementuje infrastrukturní kostru z první fáze MVP, první analytický krok, první verzi Codex Workeru, Validation Runner a první verzi Reviewer agenta a ohraničený rework loop:

- CLI příkaz `run`,
- načtení projektové konfigurace z YAML souboru,
- validaci povinných polí konfigurace,
- kontrolu existence cílového repozitáře,
- vytvoření unikátního `runId`,
- založení adresáře `runs/<runId>/`,
- uložení vstupu běhu do `input.json`,
- spuštění Task Analyst agenta bez shellu a bez nástrojů pro úpravu souborů,
- validaci strukturovaného `TaskBrief` přes Zod,
- nejvýše jednu opravnou iteraci při nevalidním výstupu,
- uložení výsledku do `runs/<runId>/task-brief.json`,
- deterministické spuštění Codex Workeru nad `TaskBrief.codexInstruction`,
- přípravu izolovaného Git worktree mimo strom CatOS, výchozí fallback je `/tmp/catos-workspaces/<runId>/workspace`,
- získání změněných souborů, pracovního diffu a Git statusu přes Git,
- uložení coding artefaktů do `coding-result.json`, `workspace.diff` a `workspace-status.txt`,
- deterministické spuštění Validation Runneru nad izolovaným worktree,
- uložení strukturovaného validačního reportu do `validation-report.json`,
- spuštění Reviewer agenta bez shellu a bez filesystem tools nad omezeným review package,
- uložení strukturovaného review verdiktu do `review-report.json`,
- automatické pokračování při `ReviewReport.verdict === "REWORK"` nejvýše do `workflow.maxReworkAttempts`,
- pokračování reworku ve stejném Codex threadu a stejném externím worktree,
- uložení artefaktů každého rework pokusu do vlastního `attempts/NN/` adresáře,
- uložení konečného verdiktu do `final-result.json`.

## Požadavky

- Node.js 22 nebo novější
- npm
- OpenAI API klíč v environment proměnné `OPENAI_API_KEY` pro skutečný běh Task Analysta
- podporovaná autentizace Codex SDK, například `CODEX_API_KEY`, pro skutečný běh Codex Workeru

## Instalace

```bash
npm install
```

Pro lokální konfiguraci použij `.env.example` jako vzor. Skutečné secrets nevkládej do repozitáře.

## Ukázka CLI

Součástí repozitáře je demonstrační konfigurace `projects/demo.yaml`, která míří na lokální adresář `demo-project/`.

```bash
OPENAI_API_KEY=... npm run catos -- run --project demo --task "Testovací úkol"
```

Při úspěchu příkaz vypíše ID běhu, načtený projekt, ověřenou cestu k cílovému repozitáři, cestu k vytvořenému `input.json`, cestu k `task-brief.json`, cestu k izolovanému worktree, počet změněných souborů, cestu k diffu, Codex thread ID, celkový validation status, výsledek každého validačního příkazu, cestu k `validation-report.json`, review verdict, počet blocking findings, počet warnings a cestu k `review-report.json`.

## Codex Worker

Codex Worker navazuje přímo na `TaskBrief.codexInstruction`. Coordinator jej spouští deterministicky; o spuštění nerozhoduje další LLM agent. Worker před spuštěním ověří, že cílová cesta je Git repozitář a že existuje nakonfigurovaná `baseBranch`. Pro každý běh vytvoří bezpečně pojmenovanou dočasnou větev `catos/<runId>` a izolovaný Git worktree mimo strom CatOS. Artefakty zůstávají v `runs/<runId>/`, ale pracovní checkout vzniká pod externím `workspaceRoot`, typicky `/tmp/catos-workspaces/<runId>/workspace`. Workspace root lze nastavit přes `execution.workspaceRoot`, poté přes `CATOS_WORKSPACE_ROOT`; bez obojího se použije bezpečný OS temp fallback. Codex SDK dostává jako `workingDirectory` pouze tento externí worktree. Sandbox režim Codexu je konfigurovatelný přes `codex.sandboxMode`; výchozí hodnota je bezpečný režim `workspace-write`. Povolené hodnoty jsou `read-only`, `workspace-write` a `danger-full-access`. Režim `danger-full-access` je pouze explicitní kompatibilní režim pro omezená prostředí, kde Codex sandbox nelze spustit (například kontejnery bez podpory bubblewrap), nikdy se nepoužívá jako automatický fallback a vyžaduje současně `codex.acknowledgeNoSandbox: true`. Při jeho použití CatOS vypíše varování a v `coding-result.json` uloží `sandboxIsolation: "disabled"`.

Worker nepouští push, merge ani automatický commit. Po dokončení Codexu CatOS nevěří pouze textovému shrnutí, ale přes Git uloží:

- `runs/<runId>/coding-result.json` – metadata výsledku bez celého diffu,
- `runs/<runId>/workspace.diff` – celý pracovní diff,
- `runs/<runId>/workspace-status.txt` – Git status worktree.

Model Codexu není připnutý natvrdo. Pokud je potřeba override, lze nastavit `CATOS_CODEX_MODEL`; jinak se použije výchozí chování SDK. Rework pokusy, pokud je spustí Coordinator po verdiktu `REWORK`, pokračují přes resume/continue mechanismus Codex SDK ve stejném threadu a stejném worktree. Worker ani během reworku nepouští push, merge ani automatický commit.

## Validation Runner

Po dokončení Codex Workeru CatOS automaticky spustí deterministický Validation Runner. Nejde o LLM agenta: běžný TypeScript kód přečte validační příkazy z projektové konfigurace, spustí je s `cwd` nastaveným přesně na externí izolovaný worktree a uloží přesný strukturovaný výsledek do `runs/<runId>/validation-report.json`. CatOS tím nevěří textovému tvrzení Codexu o úspěchu.

Pro MVP zůstává podporovaný stávající tvar konfigurace:

```yaml
commands:
  typecheck: npm run typecheck
  test: npm run test
  build: npm run build
execution:
  workspaceRoot: /tmp/catos-workspaces
validation:
  timeoutMs: 120000
```

Příkazy jsou povinné a běží sekvenčně v pořadí `typecheck`, `test`, `build`. Výchozí timeout je 120 sekund na příkaz. Před spuštěním příkazů runner ověří, že workspace existuje, je Git worktree, `git rev-parse --show-toplevel` přesně odpovídá workspace path a workspace neleží uvnitř CatOS repozitáře; porušení těchto podmínek vrací `BLOCKED`. Runner po selhání jednoho příkazu pokračuje dalšími příkazy, aby report obsahoval kompletní obraz.

Stavy mají tento význam:

- `PASS` – příkaz byl spuštěn, neskončil timeoutem a vrátil exit code `0`.
- `FAIL` – příkaz byl spuštěn a vrátil nenulový exit code.
- `BLOCKED` – příkaz nešlo korektně spustit nebo dokončit, například kvůli nenalezenému executable, timeoutu nebo interní chybě runneru.

Celkový stav reportu se počítá deterministicky podle závažnosti `BLOCKED > FAIL > PASS` pouze z povinných příkazů. Validation Runner používá pouze stavy `PASS`, `FAIL` a `BLOCKED`. Tyto stavy popisují výsledek deterministických validačních příkazů; nejsou to kvalitativní review verdikty.

## Reviewer

Po Validation Runneru CatOS spustí první verzi Reviewer agenta přes OpenAI Agents SDK. Reviewer nemá shell, nemá filesystem tools a nemůže měnit repozitář. Dostává pouze omezený review package: původní `TaskInput`, `TaskBrief`, metadata `coding-result.json` bez celého diffu, celý `workspace.diff`, `workspace-status.txt`, `validation-report.json` a relevantní omezení z projektové konfigurace. Text `finalResponse` z Codex Workeru je pouze neautoritativní pomocný údaj; rozhodující jsou zadání, diff a validační důkazy.

Reviewer ukládá validovaný strukturovaný artefakt:

- `runs/<runId>/review-report.json` – kvalitativní verdikt Reviewera ve schématu `ReviewReport`.

Reviewer používá vlastní verdikty:

- `ACCEPT` – změna podle dostupných důkazů splňuje zadání.
- `REWORK` – změna potřebuje opravu a Coordinator může spustit ohraničený Codex rework loop podle `workflow.maxReworkAttempts`.
- `HUMAN_REQUIRED` – automatické posouzení nestačí nebo je potřeba lidské rozhodnutí.

Důležité rozdělení: Validation Runner vrací statusy `PASS`, `FAIL`, `BLOCKED`, zatímco Reviewer vrací verdikty `ACCEPT`, `REWORK`, `HUMAN_REQUIRED`. Reviewer nikdy nevrací `FAIL`. Pokud je validation status `FAIL` nebo `BLOCKED`, CatOS deterministicky zakazuje verdict `ACCEPT` a nevalidní výstup odmítne. Pokud review package překročí jednoduchý MVP limit velikosti, CatOS kontext tiše nezkracuje a vrátí `HUMAN_REQUIRED`.

Model Reviewera lze volitelně přepsat přes `CATOS_REVIEWER_MODEL`; výchozí model navazuje na výchozí nastavení Task Analysta. Reviewer může vrátit `REWORK`; Coordinator poté deterministicky sestaví verzovaný `ReworkPackage` z TaskBriefu, review nálezů, validace a aktuálního diffu. Reviewer neurčuje strukturu smyčky. Pokud `REWORK` neobsahuje blocking findings, CatOS běh ukončí jako `HUMAN_REQUIRED`. Po dokončení Reviewer/Rework loopu vzniká `final-result.json` a další rozhodnutí přebírá deterministický Human Gate. Reviewer ani Human Gate nevytváří commit, push ani GitHub automatizaci.

## Rework loop

Po prvním review CatOS spouští rework pouze tehdy, když `review.verdict === "REWORK"`. Verdikty `ACCEPT` a `HUMAN_REQUIRED` smyčku okamžitě ukončí. Limit automatických oprav se bere výhradně z konfigurace:

```yaml
workflow:
  maxReworkAttempts: 2
```

Pro každý rework CatOS vytvoří strukturovaný `ReworkPackage` se schématem verze 1. Balíček obsahuje původní cíl, acceptance criteria, blocking findings, přesné `requiredChange`, položky k zachování, non-goals jako `mustNotChange` a shrnutí předchozího pokusu. Codex dostává konkrétní auditovatelnou instrukci, že pokračuje ve stejném worktree, nesmí commitovat, pushovat ani mergovat a nesmí pracovat mimo workspace.

Artefakty prvního pokusu zůstávají kvůli kompatibilitě v rootu `runs/<runId>/`: `coding-result.json`, `workspace.diff`, `workspace-status.txt`, `validation-report.json` a `review-report.json`. Každý rework pokus má vlastní auditní stopu:

```text
runs/<runId>/attempts/01/
  rework-package.json
  coding-result.json
  workspace.diff
  workspace-status.txt
  validation-report.json
  review-report.json
```

Po každém reworku CatOS znovu získá aktuální diff, spustí Validation Runner a Reviewer. Pokud Reviewer vrátí `ACCEPT`, finální stav je `ACCEPTED`. Pokud vrátí `HUMAN_REQUIRED`, finální stav je `HUMAN_REQUIRED`. Pokud po vyčerpání limitu zůstane `REWORK`, finální stav je `REWORK_LIMIT_REACHED`. Stejný blocking finding ve dvou po sobě jdoucích review ukončí automatické opravy jako `HUMAN_REQUIRED`; stejně tak opakovaný `BLOCKED` validation stav nesmí způsobit nekonečné opakování.

Každý běh ukládá konečný artefakt `runs/<runId>/final-result.json` se stavem, počtem coding pokusů, počtem reworků, finálním workspace, finálními změněnými soubory, finálním validation statusem a cestou k finálnímu review reportu. CLI vypisuje finální stav, počet coding pokusů a cestu k tomuto souboru.

## Human Gate

Po dokončení Reviewer/Rework loopu CatOS uloží `runs/<runId>/final-result.json`. Na tento auditní bod navazuje deterministický Human Gate, který není agent, nepoužívá LLM a nespouští Codex. V této etapě slouží pouze k jednorázovému záznamu lidského rozhodnutí do:

- `runs/<runId>/human-decision.json`

Human Gate nemění cílový worktree, nevytváří commit, nepushuje, nemerguje a nevytváří pull request. Existující `human-decision.json` se nikdy tiše nepřepisuje; druhé rozhodnutí nad stejným runem CLI odmítne.

Podporovaná rozhodnutí jsou přesně:

- `APPROVE` – člověk schvaluje změnu pro budoucí Commit Worker; commit se zatím nevytváří.
- `REJECT` – člověk změnu odmítá a workflow končí bez další automatické práce.
- `REQUEST_CHANGES` – člověk ukládá konkrétní požadované úpravy; automatický Codex rework se zatím nespouští.

CLI příkaz pro záznam rozhodnutí:

```bash
npm run catos -- decide \
  --run <runId> \
  --decision approve
```

Hodnoty `--decision` jsou `approve`, `reject` a `request-changes`. Komentář lze přidat přes `--comment`. Požadované změny se zadávají opakovatelným argumentem `--change`:

```bash
npm run catos -- decide \
  --run <runId> \
  --decision request-changes \
  --change "Zachovej původní API kompatibilitu." \
  --change "Doplň regresní test."
```

Schválení vyžaduje explicitní potvrzení všech klíčových důkazů:

```bash
npm run catos -- decide \
  --run <runId> \
  --decision approve \
  --reviewed task-brief \
  --reviewed diff \
  --reviewed validation \
  --reviewed review \
  --comment "Diff a validace zkontrolovány."
```

Pravidla Human Gate:

- `APPROVE` je bez override povoleno pouze pro `final-result.json` se stavem `ACCEPTED`.
- `APPROVE` vyžaduje potvrzení `task-brief`, `diff`, `validation` a `review`.
- `REQUEST_CHANGES` vyžaduje alespoň jeden `--change`.
- `REJECT` může, ale nemusí obsahovat komentář.
- Příkaz `decide` ověřuje existenci `task-brief.json`, finálního diffu, finálního validation reportu a finálního review reportu. Pro finální artefakty používá cesty z `final-result.json`, pokud jsou dostupné.

## TaskBrief

Task Analyst vrací strukturovaný výstup přibližně ve tvaru:

```ts
type TaskBrief = {
  objective: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  codexInstruction: string;
  riskLevel: "trivial" | "standard" | "critical";
};
```

Testy používají injected provider, takže nevyžadují skutečné API volání.

## Co tato verze ještě neumí

Tato verze záměrně neobsahuje event log, databázi, Temporal, LangGraph ani GitHub automatizaci. Také zatím neumí:

- automaticky opravovat chyby mimo ohraničený `REWORK` loop,
- vytvářet Git commity v cílovém projektu,
- pushovat nebo mergovat změny,
- ukládat stav do databáze,
- poskytovat webové UI,
- vytvářet finální run report.

Další kroky a hranice MVP jsou popsány v [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).
