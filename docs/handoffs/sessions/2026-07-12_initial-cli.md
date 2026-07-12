# ChatGPT handoff – 2026-07-12 initial CLI

## 1. Status handoff šablony

- **Požadovaná šablona:** `docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md`
- **Skutečný stav:** soubor v aktuálním repozitáři neexistuje. Ověřeno příkazem `find /workspace -path '*/docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md' -print`, který nevrátil žádný výsledek.
- **Zásah do šablony:** šablona nebyla upravena ani vytvořena. Tento handoff je proto strukturován ručně podle požadavků zadání a skutečného stavu repozitáře.

## 2. Kontext session

Cílem předchozí implementační session bylo vytvořit pouze první infrastrukturní krok CatOS podle `ROADMAP_MVP.md`: minimální TypeScript CLI, načítání projektového YAML configu a ukládání vstupu každého běhu do `runs/<runId>/input.json`.

Výslovně nebylo cílem připojovat OpenAI Agents SDK, Codex SDK, LLM API, databázi, webové UI, Docker, Temporal, LangGraph ani GitHub API.

## 3. Aktuální Git stav

- **Aktuální branch:** `work`
- **HEAD commit:** `fadcde9 feat: initial CatOS CLI, project config loading and run storage`
- **Relevantní historie:**
  - `fadcde9 feat: initial CatOS CLI, project config loading and run storage`
  - `3acf01b added ROADMAP_MVP.md`
  - `b6b5100 Add Replit configuration file`
  - `cd174ee Initial commit`
- **Pracovní strom před vytvořením tohoto handoffu:** čistý.
- **Pracovní strom po vytvoření tohoto handoffu:** obsahuje nové soubory v `docs/handoffs/`.

## 4. Implementováno

### 4.1 Package metadata a scripts

Soubor `package.json` definuje projekt jako ESM TypeScript aplikaci a obsahuje skripty:

```json
{
  "catos": "tsx src/index.ts",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "build": "tsc"
}
```

Dále deklaruje požadavek `node >=22` a dependency `yaml`, `zod`, `tsx`, `typescript`, `vitest`, `@types/node`.

### 4.2 CLI entrypoint

`src/index.ts` bere první argument jako název příkazu. Implementován je pouze příkaz `run`. Pokud příkaz chybí nebo je neznámý, CLI vyhodí srozumitelnou chybu s ukázkou použití.

Klíčové rozhraní:

```ts
const [command, ...args] = process.argv.slice(2);

if (command !== "run") {
  throw new Error("Neznámý nebo chybějící příkaz. Použití: npm run catos -- run --project demo --task \"Testovací úkol\"");
}

await runCommand(args);
```

### 4.3 CLI run handler

`src/cli/run.ts` implementuje:

- načtení `--project`,
- načtení `--task`,
- kontrolu chybějících argumentů,
- konstrukci config path `projects/<projectId>.yaml`,
- načtení configu přes `loadProjectConfig`,
- kontrolu shody `project.id` s CLI parametrem,
- vytvoření runu přes `createRun`,
- stručný terminálový výstup.

Klíčové rozhraní:

```ts
export async function runCommand(args: string[], options: RunCliOptions = {}): Promise<void>
```

`RunCliOptions` má volitelné `cwd` a `runsDir`, což umožňuje testování bez zápisu do produkčního `runs/`.

### 4.4 Config schema

`src/config/projectConfigSchema.ts` definuje Zod schema pro:

- `project.id`,
- `project.name`,
- `project.repoPath`,
- `project.baseBranch`,
- `commands.typecheck`,
- `commands.test`,
- `commands.build`,
- `workflow.maxReworkAttempts`,
- `workflow.createCommit`,
- `permissions.allowNetwork`,
- `permissions.allowPush`,
- `permissions.allowMerge`.

### 4.5 Config loading

`src/config/loadConfig.ts` implementuje:

- čtení YAML souboru,
- parsování přes `yaml`,
- validaci přes Zod,
- převod Zod chyb na uživatelsky čitelný `ConfigError`,
- výpočet absolutní repo cesty relativně k adresáři configu,
- kontrolu existence cílového repozitáře přes `fs.access`.

Klíčové rozhraní:

```ts
export async function loadProjectConfig(configPath: string, cwd = process.cwd()): Promise<LoadedProjectConfig>
```

Vrací:

```ts
type LoadedProjectConfig = {
  config: ProjectConfig;
  configPath: string;
  absoluteConfigPath: string;
  absoluteRepoPath: string;
};
```

### 4.6 Run storage

`src/runs/createRun.ts` implementuje vytvoření runu:

- `runId` je buď předán v testech, nebo generován jako ISO timestamp se sanitizovanými `:`/`.` plus `crypto.randomUUID()`.
- `runsDir` je volitelný pro testy; default je `process.cwd()/runs`.
- Vytváří se adresář `runs/<runId>/`.
- Ukládá se `input.json`.

Klíčové rozhraní:

```ts
export async function createRun(
  projectId: string,
  goal: string,
  configPath: string,
  options: CreateRunOptions = {},
): Promise<CreateRunResult>
```

### 4.7 Task input schema

`src/schemas/taskInput.ts` definuje minimální strukturu `input.json`:

```ts
{
  schemaVersion: 1,
  runId: string,
  projectId: string,
  goal: string,
  createdAt: ISO datetime string,
  configPath: string
}
```

### 4.8 Demo config a fixture adresář

`projects/demo.yaml` obsahuje demonstrační config:

```yaml
project:
  id: demo
  name: Demo project
  repoPath: ../demo-project
  baseBranch: main
commands:
  typecheck: npm run typecheck
  test: npm run test
  build: npm run build
workflow:
  maxReworkAttempts: 2
  createCommit: false
permissions:
  allowNetwork: false
  allowPush: false
  allowMerge: false
```

Repo path míří na lokální `demo-project/`, který obsahuje pouze `.gitkeep`. Nebyl zakládán žádný další GitHub repozitář.

### 4.9 Testy

Přidány testy:

- `tests/config.test.ts`
  - úspěšné načtení validního configu,
  - odmítnutí nevalidního configu,
  - chyba při neexistující repo cestě.
- `tests/createRun.test.ts`
  - vytvoření run adresáře,
  - vytvoření a validní obsah `input.json`,
  - unikátnost dvou po sobě vytvořených `runId`.

Testy používají `mkdtemp(os.tmpdir())`, takže podle záměru nezapisují do produkčního `runs/`.

### 4.10 README

`README.md` bylo rozšířeno o:

- co je CatOS,
- aktuální stav MVP,
- požadavky na Node.js,
- instalaci,
- ukázku CLI,
- co první verze ještě neumí,
- odkaz na `ROADMAP_MVP.md` místo duplicitní roadmapy.

## 5. Spuštěno během validace

Byly spuštěny tyto příkazy:

```bash
node -v
npm -v
npm install
npm run typecheck
npm run test
npm run build
npm run catos -- run --project demo --task "Testovací úkol"
npm run catos -- run --project missing --task "Testovací úkol"
git status --short
git log --oneline --decorate -5
find /workspace -path '*/docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md' -print
```

## 6. Ověřeno

Ověřeno pouze staticky z aktuálního obsahu repozitáře a Git stavu:

- `ROADMAP_MVP.md` existuje a nebyl upraven.
- `docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md` v repozitáři ani pod `/workspace` neexistuje.
- `package.json` obsahuje požadované scripts.
- Implementace nepřidává žádné LLM/OpenAI/Codex dependency.
- Implementace nepřidává databázi, Docker, web UI, Temporal, LangGraph ani GitHub API.
- Testy jsou napsány proti dočasným adresářům, ne proti produkčnímu `runs/`.

## 7. Blokováno / neověřeno runtime

Runtime validace je blokována prostředím.

### 7.1 Node verze

Aktuální prostředí hlásí:

```text
v20.20.2
```

Projekt vyžaduje Node.js `>=22`, takže runtime prostředí neodpovídá deklarovanému požadavku.

### 7.2 Instalace dependencies

`npm install` selhalo:

```text
npm error code E403
npm error 403 403 Forbidden - GET https://registry.npmjs.org/@types%2fnode
```

Kvůli tomu nejsou lokálně dostupné `tsx`, `vitest`, `@types/node` ani další deklarované balíčky.

### 7.3 Typecheck

`npm run typecheck` bylo spuštěno, ale selhalo kvůli chybějícím typům po neúspěšném `npm install`:

```text
error TS2688: Cannot find type definition file for 'node'.
error TS2688: Cannot find type definition file for 'vitest/globals'.
```

Výsledek: **blokováno prostředím / dependency nejsou nainstalované**.

### 7.4 Testy

`npm run test` bylo spuštěno, ale selhalo:

```text
sh: 1: vitest: not found
```

Výsledek: **blokováno prostředím / Vitest není nainstalovaný**.

### 7.5 Build

`npm run build` bylo spuštěno, ale selhalo ze stejného důvodu jako typecheck:

```text
error TS2688: Cannot find type definition file for 'node'.
error TS2688: Cannot find type definition file for 'vitest/globals'.
```

Výsledek: **blokováno prostředím / dependency nejsou nainstalované**.

### 7.6 Ruční CLI běhy

Úspěšný i neúspěšný CLI scénář byly spuštěny, ale oba skončily před aplikační logikou:

```text
sh: 1: tsx: not found
```

Výsledek: **blokováno prostředím / tsx není nainstalovaný**.

## 8. Pouze očekáváno, ne runtime ověřeno

Po úspěšné instalaci dependencies a spuštění v Node.js 22+ se očekává, že:

- `npm run catos -- run --project demo --task "Testovací úkol"` načte `projects/demo.yaml`, ověří `demo-project/`, vytvoří `runs/<runId>/input.json` a vypíše stručný výsledek.
- `npm run catos -- run --project missing --task "Testovací úkol"` skončí nenulovým exit codem se srozumitelnou chybou o chybějícím configu.
- `npm run typecheck`, `npm run test` a `npm run build` proběhnou po instalaci dependencies, pokud v kódu není skrytá chyba, kterou současné prostředí neumožnilo odhalit.

## 9. Rizika a poznámky pro další session

1. **Template handoffu chybí.** Uživatel požadoval práci podle `docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md`, ale soubor není v aktuálním repozitáři přítomen. Tento fakt by měl být potvrzen s vlastníkem projektu nebo doplněn v samostatném kroku.
2. **Nebylo možné runtime ověření.** Není k dispozici Node.js 22 a npm registry vrací 403, takže před merge je nutné spustit validace v korektním prostředí.
3. **Není `package-lock.json`.** Protože `npm install` selhalo, nevznikl lockfile. Pokud projekt chce reprodukovatelné npm instalace, je potřeba lockfile vygenerovat v prostředí s přístupem k registru.
4. **Jednoduchý argument parser.** CLI má ruční parser přes `args.indexOf`. Pro aktuální MVP krok to stačí, ale při rozšiřování CLI může být potřeba robustnější parser.
5. **`mkdir(runDir, { recursive: false })`.** To je záměrně přísné. Při kolizi `runId` běh selže, což je prakticky nepravděpodobné díky UUID, ale chybová hláška pro kolizi zatím není specializovaná.
6. **Demo repo není skutečný Git repo.** Požadavek zněl ověřit existenci cesty, ne validovat Git repository. Současná implementace kontroluje pouze existenci adresáře/cesty.

## 10. Doporučený další malý krok

Nejbližší malý krok by měl být čistě validační, ne funkční rozšíření:

1. Spustit vše v prostředí s Node.js 22+ a funkčním npm registry.
2. Vygenerovat a commitnout `package-lock.json`, pokud je lockfile v projektu požadovaný.
3. Spustit:
   - `npm run typecheck`,
   - `npm run test`,
   - `npm run build`,
   - úspěšný CLI běh s `demo`,
   - neúspěšný CLI běh s chybějícím projektem nebo chybějící repo cestou.
4. Teprve potom pokračovat dalším malým infrastrukturním krokem, například jednoduchým `events.jsonl` audit logem pro run, stále bez LLM a bez Codex SDK.

## 11. Souborový přehled aktuální implementace

- `.gitignore` – ignoruje runtime obsah `runs/*`, ponechává `runs/.gitkeep`.
- `README.md` – dokumentace aktuálního MVP stavu a CLI.
- `package.json` – npm scripts, Node engine, dependencies.
- `tsconfig.json` – TypeScript konfigurace pro NodeNext/ESM.
- `projects/demo.yaml` – demo project config.
- `demo-project/.gitkeep` – lokální fixture cesta pro demo config.
- `runs/.gitkeep` – zachování prázdného runtime adresáře v Gitu.
- `src/index.ts` – CLI entrypoint.
- `src/cli/run.ts` – implementace `run` příkazu.
- `src/config/projectConfigSchema.ts` – Zod schema pro projektový config.
- `src/config/loadConfig.ts` – YAML loading, validace, repo path check.
- `src/runs/createRun.ts` – tvorba run adresáře a `input.json`.
- `src/schemas/taskInput.ts` – Zod schema pro `input.json`.
- `tests/config.test.ts` – config loader tests.
- `tests/createRun.test.ts` – run storage tests.
- `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md` – tento aktuální handoff.
- `docs/handoffs/sessions/2026-07-12_initial-cli.md` – archivní kopie tohoto handoffu.
