# CatOS

CatOS je připravovaná CLI aplikace pro řízení bezpečné a auditovatelné automatizace práce nad lokálními repozitáři. Dlouhodobý směr projektu popisuje [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).

## Aktuální stav MVP

Aktuální verze implementuje infrastrukturní kostru z první fáze MVP, první analytický krok, první verzi Codex Workeru, Validation Runner a první verzi Reviewer agenta:

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
- uložení strukturovaného review verdiktu do `review-report.json`.

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

Model Codexu není připnutý natvrdo. Pokud je potřeba override, lze nastavit `CATOS_CODEX_MODEL`; jinak se použije výchozí chování SDK. Tato etapa zatím neobsahuje rework loop, commit vytvořený CatOS, push ani merge.

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
- `REWORK` – změna potřebuje opravu, ale zatím se automaticky nespouští další Codex iterace.
- `HUMAN_REQUIRED` – automatické posouzení nestačí nebo je potřeba lidské rozhodnutí.

Důležité rozdělení: Validation Runner vrací statusy `PASS`, `FAIL`, `BLOCKED`, zatímco Reviewer vrací verdikty `ACCEPT`, `REWORK`, `HUMAN_REQUIRED`. Reviewer nikdy nevrací `FAIL`. Pokud je validation status `FAIL` nebo `BLOCKED`, CatOS deterministicky zakazuje verdict `ACCEPT` a nevalidní výstup odmítne. Pokud review package překročí jednoduchý MVP limit velikosti, CatOS kontext tiše nezkracuje a vrátí `HUMAN_REQUIRED`.

Model Reviewera lze volitelně přepsat přes `CATOS_REVIEWER_MODEL`; výchozí model navazuje na výchozí nastavení Task Analysta. Tato etapa zatím neobsahuje rework loop, Human Gate, commit vytvořený CatOS, push ani GitHub automatizaci.

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

Tato verze záměrně neobsahuje rework loop, Human Gate, event log, databázi, Temporal, LangGraph ani GitHub automatizaci. Také zatím neumí:

- automaticky opravovat validační nebo review chyby,
- vytvářet Git commity v cílovém projektu,
- pushovat nebo mergovat změny,
- ukládat stav do databáze,
- poskytovat webové UI,
- vytvářet finální run report.

Další kroky a hranice MVP jsou popsány v [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).
