# CatOS

CatOS je připravovaná CLI aplikace pro řízení bezpečné a auditovatelné automatizace práce nad lokálními repozitáři. Dlouhodobý směr projektu popisuje [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).

## Aktuální stav MVP

Aktuální verze implementuje infrastrukturní kostru z první fáze MVP, první analytický krok a první verzi Codex Workeru:

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
- přípravu izolovaného Git worktree v `runs/<runId>/workspace/`,
- získání změněných souborů, pracovního diffu a Git statusu přes Git,
- uložení coding artefaktů do `coding-result.json`, `workspace.diff` a `workspace-status.txt`.

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

Při úspěchu příkaz vypíše ID běhu, načtený projekt, ověřenou cestu k cílovému repozitáři, cestu k vytvořenému `input.json`, cestu k `task-brief.json`, cestu k izolovanému worktree, počet změněných souborů, cestu k diffu a Codex thread ID.

## Codex Worker

Codex Worker navazuje přímo na `TaskBrief.codexInstruction`. Coordinator jej spouští deterministicky; o spuštění nerozhoduje další LLM agent. Worker před spuštěním ověří, že cílová cesta je Git repozitář a že existuje nakonfigurovaná `baseBranch`. Pro každý běh vytvoří bezpečně pojmenovanou dočasnou větev `catos/<runId>` a izolovaný Git worktree v adresáři `runs/<runId>/workspace/`. Codex SDK dostává jako `workingDirectory` pouze tento worktree. Sandbox režim Codexu je konfigurovatelný přes `codex.sandboxMode`; výchozí hodnota je bezpečný režim `workspace-write`. Povolené hodnoty jsou `read-only`, `workspace-write` a `danger-full-access`. Režim `danger-full-access` je pouze explicitní kompatibilní režim pro omezená prostředí, kde Codex sandbox nelze spustit (například kontejnery bez podpory bubblewrap), nikdy se nepoužívá jako automatický fallback a vyžaduje současně `codex.acknowledgeNoSandbox: true`. Při jeho použití CatOS vypíše varování a v `coding-result.json` uloží `sandboxIsolation: "disabled"`.

Worker nepouští push, merge ani automatický commit. Po dokončení Codexu CatOS nevěří pouze textovému shrnutí, ale přes Git uloží:

- `runs/<runId>/coding-result.json` – metadata výsledku bez celého diffu,
- `runs/<runId>/workspace.diff` – celý pracovní diff,
- `runs/<runId>/workspace-status.txt` – Git status worktree.

Model Codexu není připnutý natvrdo. Pokud je potřeba override, lze nastavit `CATOS_CODEX_MODEL`; jinak se použije výchozí chování SDK. Tato etapa zatím neobsahuje automatickou validaci, Reviewer, rework loop, commit vytvořený CatOS, push ani merge.

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

Tato verze záměrně neobsahuje Reviewer, rework loop, event log, databázi, Temporal, LangGraph ani GitHub automatizaci. Také zatím neumí:

- spouštět validační příkazy cílového projektu,
- vytvářet Git commity v cílovém projektu,
- pushovat nebo mergovat změny,
- ukládat stav do databáze,
- poskytovat webové UI,
- vytvářet finální run report.

Další kroky a hranice MVP jsou popsány v [`ROADMAP_MVP.md`](./ROADMAP_MVP.md).
