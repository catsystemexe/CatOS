# ChatGPT handoff – 2026-07-12 Task Analyst Agent

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatelské zadání zmiňovalo `main`, ale lokální checkout byl během celé session na `work`)
- **Výchozí commit:** `97612aa chore: lock dependencies after MVP validation`
- **Výsledný commit:** HEAD commit obsahující tento handoff (`git log -1 --oneline`)
- **Cíl session:** implementovat pouze další krok roadmapy: Task Analyst Agent převádějící lidské zadání na strukturovaný `TaskBrief`.
- **Stav pracovního stromu:** před commitem obsahoval zamýšlené změny k Task Analystovi, `.env.example`, testy a handoff dokumentaci.

## 2. Executive summary

Cílem bylo přidat OpenAI Agents SDK pouze v rozsahu nutném pro Task Analysta, bez Codex Workera, Reviewera, rework loopu, event logu, databáze, Temporal, LangGraph nebo GitHub automatizace.

Implementováno je Zod schema `TaskBrief`, Task Analyst provider rozhraní, reálný OpenAI Agents SDK provider bez nástrojů, nejvýše jedna opravná iterace při nevalidním výstupu a zápis výsledku do `runs/<runId>/task-brief.json`. CLI `run` po dosavadním vytvoření `input.json` nově spustí analýzu a vypíše cestu k task briefu. Testy používají injected fake provider, takže nemají volat OpenAI API.

Skutečné runtime ověření není dokončené. `npm install @openai/agents` v prostředí selhalo na registry 403. Následné `npm run typecheck`, `npm run test` a `npm run build` byly spuštěny, ale selhaly kvůli chybějícím lokálním dependencies (`node_modules` nebyl dostupný), nikoli kvůli ověřené implementační chybě v kódu. Skutečné OpenAI API volání nebylo provedeno a není vydáváno za ověřené.

## 3. Aktuální architektura dotčené části

Skutečný tok CLI po změně:

CLI
→ `runCommand(args)`
→ načtení `projects/<projectId>.yaml`
→ Zod validace configu
→ kontrola `repoPath`
→ `createRun(...)`
→ zápis `runs/<runId>/input.json`
→ `analyzeTaskBrief(...)`
→ OpenAI Agents SDK provider nebo injected fake provider
→ Zod validace `TaskBrief`
→ případně jedna opravná iterace
→ zápis `runs/<runId>/task-brief.json`
→ terminálový výstup

Hlavní moduly:

- `src/cli/run.ts`: orchestrace současného CLI běhu; zůstává deterministická aplikační logika, není agent.
- `src/agents/taskAnalyst.ts`: hranice mezi CatOS a Task Analyst providerem; obsahuje retry/validaci a zápis briefu.
- `src/schemas/taskBrief.ts`: datový kontrakt pro výstup Task Analysta.
- `src/openai-agents.d.ts`: minimální lokální typová deklarace pro compile-time práci při nedostupném balíčku v sandboxu.
- `tests/taskAnalyst.test.ts` a `tests/runCli.test.ts`: fake-provider testy bez API volání.

## 4. Veřejná rozhraní a datové kontrakty

### `TaskBrief`

Soubor: `src/schemas/taskBrief.ts`

```ts
export const taskBriefSchema = z.object({
  objective: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
  nonGoals: z.array(z.string().trim().min(1)),
  codexInstruction: z.string().trim().min(1),
  riskLevel: z.enum(["trivial", "standard", "critical"]),
});
```

Účel: strukturovaný a validovatelný výstup Task Analysta. Oproti zadání nebyla přidána žádná nová pole; validační podmínky pouze zakazují prázdné zásadní texty a vyžadují alespoň jedno akceptační kritérium.

### `TaskAnalystProvider`

Soubor: `src/agents/taskAnalyst.ts`

```ts
export type TaskAnalystProvider = {
  analyze(input: TaskAnalystProviderInput): Promise<unknown>;
};
```

Účel: umožnit injected fake provider v testech a oddělit retry/validaci od reálného OpenAI volání.

### `analyzeTaskBrief`

Soubor: `src/agents/taskAnalyst.ts`

```ts
export async function analyzeTaskBrief(
  goal: string,
  projectId: string,
  options: AnalyzeTaskOptions = {},
): Promise<AnalyzeTaskResult>
```

Účel: získat `TaskBrief`, validovat jej přes Zod a při prvním nevalidním výstupu provést nejvýše jednu opravnou iteraci.

### `writeTaskBrief`

Soubor: `src/agents/taskAnalyst.ts`

```ts
export async function writeTaskBrief(runDir: string, taskBrief: TaskBrief): Promise<string>
```

Účel: zapsat `runs/<runId>/task-brief.json`.

## 5. Změny podle souborů

`package.json`

- Přidává `@openai/agents` jako runtime dependency a aktualizuje `zod` na v4 řadu, kterou vyžaduje oficiální Agents SDK dokumentace.
- Riziko: package-lock nemohl být plně regenerován kvůli registry 403 v prostředí.

`package-lock.json`

- Root dependency metadata bylo upraveno tak, aby odpovídalo záměru `package.json`.
- Omezení: chybí ověřená regenerace lockfile z npm registry.

`.env.example`

- Přidává vzor pro `OPENAI_API_KEY` a volitelný `CATOS_TASK_ANALYST_MODEL`.
- Neobsahuje žádný secret.

`src/schemas/taskBrief.ts`

- Nové Zod schema a TypeScript typ pro `TaskBrief`.

`src/agents/taskAnalyst.ts`

- Nová implementace Task Analyst flow.
- Reálný provider dynamicky importuje `@openai/agents`, nastavuje API key z env a definuje agenta s `tools: []`.
- Retry je explicitní a omezený na 2 pokusy celkem.

`src/openai-agents.d.ts`

- Minimální typová deklarace pro použitou část SDK. Slouží jako dočasná opora, dokud sandbox nedovolí instalaci balíčku.

`src/cli/run.ts`

- Zachovává dosavadní načtení configu a vytvoření runu.
- Nově volá Task Analysta a zapisuje task brief.
- Přidává `taskAnalystProvider` do testovacích optionů.

`tests/taskAnalyst.test.ts`

- Testuje validní brief, odmítnutí nevalidního výstupu, opravnou iteraci, selhání po druhém nevalidním výstupu a zápis `task-brief.json`.

`tests/runCli.test.ts`

- Ověřuje CLI tok s injected providerem bez API volání.

`README.md`

- Aktualizuje popis aktuálního MVP, požadavek na `OPENAI_API_KEY`, `TaskBrief` kontrakt a hranice toho, co zatím není součástí implementace.

## 6. Důležitá implementační rozhodnutí

- **Injected provider místo mockování SDK:** Testy neimportují ani nevolají reálné OpenAI API. To drží jednotkové testy deterministické.
- **Žádné nástroje pro Task Analysta:** Reálný `Agent` je vytvořen s `tools: []`; nepoužívá `SandboxAgent`, shell, apply patch ani filesystem tool.
- **Dynamický import SDK:** `@openai/agents` se importuje až v reálném provideru. Fake-provider testy tedy mohou běžet bez API volání a bez importu SDK v testovací cestě.
- **Jedna opravná iterace v CatOS kódu:** I když Agents SDK podporuje structured output, CatOS záměrně validuje finální hodnotu přes vlastní `taskBriefSchema.safeParse`, aby byl retry mechanismus testovatelný a explicitní.
- **Bez předčasné orchestrace:** Nebyl přidán Codex Worker, Reviewer, rework loop, event log ani další durable workflow vrstva.

## 7. Validace a důkazy

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm install @openai/agents` | BLOCKED | Spuštěno; exit code 1; registry vrátilo `403 Forbidden - GET https://registry.npmjs.org/@openai%2fagents`. |
| `npm run typecheck` | BLOCKED | Spuštěno; exit code 2; `Cannot find type definition file for 'node'` a `vitest/globals`, protože dependencies nejsou instalované. |
| `npm run test` | BLOCKED | Spuštěno; exit code 127; `vitest: not found`, protože dependencies nejsou instalované. |
| `npm run build` | BLOCKED | Spuštěno; exit code 2; stejné chybějící typové balíčky jako typecheck. |
| Skutečné OpenAI API volání | NOT RUN | Neproběhlo; nebyl použit reálný API klíč a SDK balíček nebyl nainstalován v sandboxu. |

## 8. Git diff summary

- Změněno/přidáno 11 souborů.
- Hlavní změny: nový `TaskBrief` kontrakt, Task Analyst implementace, CLI integrace, fake-provider testy, `.env.example`, README a handoff dokumentace.
- Nebyly přidány secrets.
- Nebyly přidány generované run artefakty.
- Lockfile nebyl plně regenerován kvůli registry bloku; commit proto obsahuje pouze root dependency metadata v lockfile.
- Rozsah je zamýšleně omezený na Task Analyst krok.

## 9. Rizika a podezřelá místa

- Největší riziko je neověřená kompatibilita přesné verze `@openai/agents` se zvoleným importem `Agent`, `run` a `setDefaultOpenAIKey`. API bylo navrženo podle oficiálních dokumentů, ale balíček nebylo možné nainstalovat.
- `package-lock.json` není plně obnovený. Před navázáním by mělo prostředí s přístupem k registry spustit `npm install` a lockfile korektně regenerovat.
- Výchozí model je `gpt-5.5`; pokud nebude v daném OpenAI účtu dostupný, je připraven env override `CATOS_TASK_ANALYST_MODEL`.
- CLI teď pro běžný reálný run vyžaduje `OPENAI_API_KEY`; to je záměr Task Analyst kroku, ale znamená to, že původní demo CLI bez klíče už nedokončí celý run.
- Nebyla provedena end-to-end validace s reálným OpenAI API.

## 10. Otevřené úkoly

### Blokující před pokračováním

- V prostředí s dostupnou registry spustit `npm install`, zkontrolovat a commitnout plně regenerovaný `package-lock.json`, pokud se změní.
- Spustit `npm run typecheck`, `npm run test`, `npm run build` s nainstalovanými dependencies.
- Provést alespoň jeden reálný CLI běh s `OPENAI_API_KEY` a jasně označit skutečný výsledek.

### Následující doporučený krok

- Stabilizovat dependency instalaci a ověřit reálné OpenAI Agents SDK volání Task Analysta, ještě před přidáváním Codex Workera.

### Pozdější práce

- Codex Worker.
- Reviewer.
- Rework loop.
- Event log.
- Databáze / Temporal / LangGraph.
- GitHub automatizace.

## 11. Otázky pro ChatGPT review

1. Je `TaskBrief` schema dostatečně úzké pro první MVP krok?
2. Má CLI vyžadovat Task Analyst vždy, nebo má mít dočasný explicitní `--skip-analysis` režim pro offline demo?
3. Je dynamický import `@openai/agents` vhodný kompromis pro testovatelnost, nebo má být SDK provider oddělen do vlastního souboru?
4. Je ruční limit dvou pokusů správně umístěný v CatOS kódu, nikoli v SDK error handleru?
5. Má být default model pevně v kódu, nebo pouze přes env?
6. Je dočasná lokální deklarace `src/openai-agents.d.ts` přijatelná do doby, než půjde dependency nainstalovat?

## 12. Doporučené soubory k přímému review

1. `src/agents/taskAnalyst.ts` – hlavní Task Analyst flow, provider a retry logika.
2. `src/schemas/taskBrief.ts` – nový datový kontrakt.
3. `src/cli/run.ts` – integrace do dosavadního CLI toku.
4. `tests/taskAnalyst.test.ts` – pokrytí validace a retry chování.
5. `tests/runCli.test.ts` – ověření zápisu briefu přes CLI s fake providerem.
6. `package.json` – nové dependency a Zod v4.
7. `.env.example` – deklarace očekávaných env proměnných bez secrets.
8. `README.md` – veřejný popis aktuálního stavu a omezení.
