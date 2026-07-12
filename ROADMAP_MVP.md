CatOS MVP – roadmap v OpenAI Agents SDK

1. Cíl MVP

Automatizovat současný ruční postup:

Michal zadá cíl
        ↓
ChatGPT připraví instrukci pro Codex
        ↓
Codex upraví projekt
        ↓
spustí se testy
        ↓
ChatGPT změnu zkontroluje
        ↓
při problému vytvoří instrukci k opravě
        ↓
Codex změnu opraví
        ↓
Michal schválí výsledek

MVP nemá být obecná autonomní továrna.

Má ověřit jedinou hypotézu:

Dokážeme bezpečně odstranit ruční kopírování mezi analytickým modelem a Codexem?

⸻

2. Co použijeme

Jazyk a běhové prostředí

* TypeScript
* Node.js 22+
* samostatný repozitář CatOS
* CLI jako první uživatelské rozhraní
* jeden cílový projekt připojený přes konfigurační soubor

TypeScriptová verze Sandbox Agents aktuálně vyžaduje Node.js 22 nebo vyšší. (openai.github.io)

OpenAI komponenty

OpenAI Agents SDK

Balíček:

@openai/agents

Použijeme ho pro:

* definici analytického agenta,
* definici review agenta,
* structured outputs,
* spouštění jednotlivých agentů,
* tracing,
* případné pozdější human-in-the-loop přerušení.

Agents SDK obsahuje vlastní agentní loop, tool calling, agents-as-tools, handoffs, human-in-the-loop a tracing. (openai.github.io)

Codex tool

Balíčky:

@openai/agents-extensions
@openai/codex-sdk

Experimentální codexTool() umožňuje agentovi zadat úkol Codex SDK, které může pracovat v určeném workspace, spouštět příkazy, upravovat soubory a používat MCP nástroje. Umí také zachovat Codex thread mezi několika voláními, což je vhodné právě pro následné opravy. Tato integrace je zatím experimentální, takže její API se může změnit. (openai.github.io)

Zod

Použijeme pro validaci strukturovaných výstupů:

zod

TypeScript Agents SDK používá Zod pro schémata tools a structured outputs. (openai.github.io)

Pomocné knihovny

Doporučené:

execa       – bezpečnější spouštění příkazů
simple-git  – Git operace
yaml        – projektová konfigurace
vitest      – testování CatOS

Tyto knihovny nejsou architektonickou podmínkou. Lze je později vyměnit.

⸻

3. Co budeme vytvářet sami

Vytvoříme

1. Jednoduchý Coordinator

Obyčejný TypeScript program, který explicitně řídí pořadí:

analyzuj → kóduj → testuj → review → případně oprav

Nebude to další LLM agent.

Bude to deterministická aplikační logika.

2. Project Config

Jeden YAML soubor pro každý projekt:

project:
  id: mgod
  repoPath: /workspace/MGoD
  baseBranch: work
commands:
  typecheck: npm run typecheck
  test: npm run test
  build: npm run build
permissions:
  allowNetwork: false
  allowPush: false
  allowMerge: false
workflow:
  maxReworkAttempts: 2
  createCommit: true

3. Task Analyst

Agent, který převede lidské zadání na přesnou instrukci pro Codex.

4. Reviewer

Oddělený agent, který dostane:

* původní zadání,
* akceptační kritéria,
* Git diff,
* výsledky testů,
* relevantní soubory.

Vrátí strukturovaný verdikt:

ACCEPT
REWORK
HUMAN_REQUIRED

5. Validation Runner

Běžný kód, který spustí příkazy z Configu a uloží:

* exit code,
* stdout,
* stderr,
* dobu běhu.

6. Rework Loop

Při verdiktu REWORK sestaví balíček pro Codex:

* co je špatně,
* důkaz problému,
* co zachovat,
* co změnit,
* co neměnit.

Maximálně dvě opravné iterace.

7. Run Report

Na konci vznikne Markdown soubor obsahující:

* původní cíl,
* vytvořený plán,
* změněné soubory,
* výsledky testů,
* nálezy Reviewera,
* počet iterací,
* finální stav,
* doporučený další krok.

⸻

4. Co v MVP vytvářet nebudeme

* vlastní durable workflow engine,
* Temporal,
* LangGraph,
* Symphony implementaci,
* webové UI,
* vektorovou databázi,
* dlouhodobou autonomní paměť,
* podporu více LLM providerů,
* paralelní práci více Coderů,
* automatický push,
* automatický merge,
* deployment,
* složitý Planner s backlogem,
* obecný plugin marketplace.

To všechno může přijít později. Pro první experiment by to pouze zakrylo, zda funguje základní smyčka.

⸻

5. Architektura MVP

┌──────────────────────┐
│ Human / CLI          │
│ zadání cíle          │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Task Analyst Agent   │
│ OpenAI Agents SDK    │
└──────────┬───────────┘
           │ TaskBrief
           ▼
┌──────────────────────┐
│ Coordinator          │
│ TypeScript kód       │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Codex tool           │
│ práce ve worktree    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Validation Runner    │
│ test / build / lint  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ Reviewer Agent       │
│ diff + důkazy        │
└──────────┬───────────┘
           ▼
       rozhodnutí
       ┌───┴────┐
       ▼        ▼
    ACCEPT    REWORK
       │        │
       │        └──────▶ Codex tool
       ▼
 Human approval
       ▼
 commit + handoff

Pro MVP doporučuji nepoužívat handoff mezi agenty. Coordinator má jednotlivé agenty volat sám v pevném pořadí.

Tím zabráníme tomu, aby model sám rozhodoval, zda přeskočí testy nebo review.

⸻

6. Minimální datové kontrakty

TaskInput

type TaskInput = {
  projectId: string;
  goal: string;
  constraints?: string[];
};

TaskBrief

Výstup analytického agenta:

type TaskBrief = {
  objective: string;
  acceptanceCriteria: string[];
  nonGoals: string[];
  codexInstruction: string;
  riskLevel: "trivial" | "standard" | "critical";
};

ValidationReport

type ValidationReport = {
  passed: boolean;
  commands: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
};

ReviewReport

type ReviewReport = {
  verdict: "ACCEPT" | "REWORK" | "HUMAN_REQUIRED";
  blockingFindings: Array<{
    title: string;
    evidence: string;
    requiredChange: string;
  }>;
  warnings: string[];
  summary: string;
};

RunState

type RunState = {
  runId: string;
  projectId: string;
  branch: string;
  attempt: number;
  codexThreadId?: string;
  status:
    | "CREATED"
    | "CODING"
    | "VALIDATING"
    | "REVIEWING"
    | "REWORK"
    | "WAITING_FOR_HUMAN"
    | "COMPLETED"
    | "FAILED";
};

⸻

7. Roadmap realizace

Etapa 0 – Uzamčení rozsahu

Nejprve zapsat MVP_SCOPE.md.

MVP umí

* přijmout jeden úkol,
* pracovat na jednom lokálním repozitáři,
* vytvořit izolovanou pracovní větev nebo worktree,
* předat úkol Codexu,
* spustit validace,
* provést review,
* vrátit úkol Codexu k opravě,
* vytvořit commit a report po lidském schválení.

MVP neumí

* řešit několik úkolů paralelně,
* sám mergovat,
* pracovat s produkcí,
* běžet neomezeně dlouho,
* měnit vlastní Config.

Dokončeno, když

Každý budoucí požadavek lze jednoznačně označit jako „součást MVP“ nebo „pozdější fáze“.

⸻

Etapa 1 – Kostra CatOS

Vytvořit samostatný repozitář:

catos/
├── src/
│   ├── cli/
│   ├── coordinator/
│   ├── agents/
│   ├── codex/
│   ├── validation/
│   ├── git/
│   ├── schemas/
│   └── reports/
├── projects/
├── runs/
├── tests/
├── package.json
└── tsconfig.json

Funkce

Příkaz:

npm run catos -- run \
  --project mgod \
  --task "Oprav drag kurzoru v timeline"

Zatím pouze:

* načte Config,
* zkontroluje existenci repozitáře,
* vytvoří runId,
* uloží vstup do runs/<runId>/input.json.

Dokončeno, když

CLI přijme zadání a vytvoří reprodukovatelný záznam běhu.

⸻

Etapa 2 – Task Analyst

Vytvořit první Agents SDK agenta.

Úloha

Převést lidské zadání do TaskBrief.

Omezení

* nesmí upravovat soubory,
* nemá shell,
* nemá přístup k secrets,
* vrací pouze validní structured output.

Flow

lidské zadání
→ Task Analyst
→ Zod validace
→ TaskBrief.json

Při nevalidním výstupu:

validace selže
→ jedna opravná žádost
→ druhé selhání
→ ukončit běh

Dokončeno, když

Pět různých zadání opakovaně vytvoří validní TaskBrief.

⸻

Etapa 3 – Codex Worker

Připojit codexTool().

První režim

* workingDirectory ukazuje do izolovaného worktree,
* sandboxMode: workspace-write,
* síť vypnutá,
* žádný push,
* žádný merge,
* Codex smí měnit pouze pracovní workspace.

Codex tool umí pracovat nad určeným workspace a jeho thread lze zachovat v kontextu pro další iteraci. (openai.github.io)

Vstup

* TaskBrief.codexInstruction,
* akceptační kritéria,
* informace o validačních příkazech.

Výstup

* Codex response,
* thread ID,
* Git diff,
* seznam změněných souborů,
* stav pracovního stromu.

Dokončeno, když

CatOS předá Codexu skutečný malý úkol a po jeho skončení automaticky získá diff bez ručního kopírování.

⸻

Etapa 4 – Deterministická validace

Po skončení Codexu Coordinator vždy spustí příkazy z Configu.

Například:

npm run typecheck
npm run test
npm run build

Codex nesmí rozhodnout, že se validace vynechá.

Pravidlo

libovolný povinný příkaz selže
→ REWORK
všechny povinné příkazy projdou
→ REVIEW

Ochrany

* timeout každého příkazu,
* omezení délky logu,
* zaznamenání kompletního exit code,
* žádné automatické ignorování chyb.

Dokončeno, když

Úmyslně rozbitý build vždy vede k REWORK a úspěšný build k REVIEW.

⸻

Etapa 5 – Reviewer Agent

Reviewer dostane:

* původní TaskInput,
* TaskBrief,
* Git diff,
* seznam změněných souborů,
* ValidationReport,
* relevantní části Configu.

Nedostane přesvědčovací text typu:

Codex úkol úspěšně dokončil.

Výstup

Striktní ReviewReport.

Rozhodnutí

ACCEPT
→ WAITING_FOR_HUMAN
REWORK
→ vytvořit ReworkPackage
HUMAN_REQUIRED
→ zastavit workflow a vysvětlit problém

Dokončeno, když

Reviewer zachytí alespoň připravené referenční chyby, které samotný build nezachytí.

⸻

Etapa 6 – Rework loop

Při REWORK se použije stejný Codex thread, aby Codex znal předchozí práci, ale dostane nový přesný balíček:

původní cíl
aktuální diff
výsledky testů
blokující nálezy
co zachovat
co opravit

Omezení

maximálně 2 rework pokusy

Po druhém neúspěchu:

HUMAN_REQUIRED

Nikdy:

opakuj, dokud to nebude dobré

Dokončeno, když

CatOS automaticky provede alespoň jeden celý cyklus:

Codex
→ neúspěšný test nebo review
→ oprava
→ nový test
→ nové review

bez zásahu člověka.

⸻

Etapa 7 – Human gate

Po verdiktu ACCEPT systém zobrazí:

* cíl,
* změněné soubory,
* diff summary,
* testy,
* review,
* náklady,
* počet iterací.

Člověk zvolí:

approve
reject
request-changes

Approve

* vytvořit commit,
* uložit report,
* ukončit běh jako COMPLETED.

Reject

* neprovádět commit,
* zachovat worktree pro kontrolu.

Request changes

* vytvořit ruční ReworkPackage,
* pokračovat ještě jednou přes Codex.

Agents SDK podporuje přerušení běhu kvůli lidskému schválení a následné pokračování ze stejného uloženého stavu; do prvního MVP ale můžeme použít i jednodušší CLI potvrzení. (openai.github.io)

⸻

Etapa 8 – Handoff a audit

Po každém běhu vytvořit:

runs/<runId>/
├── input.json
├── task-brief.json
├── codex-result.json
├── diff.patch
├── validation.json
├── review.json
├── events.jsonl
└── HANDOFF.md

HANDOFF.md bude přesně ten dokument, který dnes Codex vytváří ručně pro další session.

Agents SDK má vestavěný tracing modelových generací, tool calls, handoffs a guardrails. To použijeme pro ladění, zatímco vlastní events.jsonl bude jednoduchý projektový audit CatOS. (openai.github.io)

Dokončeno, když

Z adresáře jednoho běhu lze zpětně určit:

* co člověk požadoval,
* co model navrhl,
* co Codex změnil,
* jaké testy proběhly,
* proč byla změna přijata nebo odmítnuta.

⸻

Etapa 9 – Testování CatOS

Ještě před nasazením na důležitý úkol vytvořit malý golden set.

Referenční scénáře

1. Jednoduchá úspěšná změna.
2. Codex vytvoří syntax error.
3. Test selže a Codex jej opraví.
4. Testy projdou, ale Reviewer nalezne porušení zadání.
5. Reviewer opakovaně vrací stejný problém.
6. Člověk změnu odmítne.
7. Codex nebo model vrátí nevalidní strukturovaný výstup.

Replay režim

Agentní odpovědi uložit jako fixtures, aby šlo Coordinator testovat bez placených API volání.

Dokončeno, když

Stejné uložené vstupy vytvářejí stejné stavové přechody a finální rozhodnutí.

⸻

8. První praktický rozsah

První projekt:

MGoD nebo jeho menší testovací kopie

První typ úkolu:

* izolovaná oprava existující funkce,
* jasná očekávaná změna,
* dostupný typecheck, test nebo smoke test,
* žádná změna celkové architektury.

Nevhodné jako první experiment:

* vytvoření celé aplikace,
* kompletní redesign UI,
* migrace architektury,
* neurčité zadání typu „udělej projekt lepší“,
* Android změna vyžadující ruční testování na telefonu.

⸻

9. Definice hotového MVP

MVP je hotové, když lze zadat jeden příkaz:

catos run mgod "Oprav konkrétní chybu v timeline"

a CatOS bez ručního kopírování:

1. vytvoří přesné zadání,
2. předá jej Codexu,
3. nechá Codex změnit izolovaný workspace,
4. spustí testy,
5. nechá změnu zkontrolovat Reviewerem,
6. případně provede nejvýše dvě opravy,
7. předloží člověku finální výsledek,
8. po schválení vytvoří commit a handoff.

⸻

10. Co přijde až po MVP

Teprve po úspěšném ověření základní smyčky:

* více projektových Configů,
* Planner a backlog,
* Temporal nebo LangGraph,
* dlouhodobá Memory,
* GitHub PR automatizace,
* Docker sandbox,
* webový dashboard,
* jiný model pro nezávislé review,
* paralelní tasky,
* provider plugin system.

⸻

11. Největší technické riziko MVP

Nejrizikovější součástí je codexTool(), protože je aktuálně označen jako experimentální.

Proto má Codex integrace od začátku vlastní úzké rozhraní:

interface CodingWorker {
  executeTask(input: CodingTask): Promise<CodingResult>;
  continueTask(input: ReworkTask): Promise<CodingResult>;
}

První implementace:

CodexToolWorker

Záložní implementace:

SandboxAgentWorker

Sandbox Agents také umožňují izolovaný workspace, shell, editaci souborů a obnovu sandboxového stavu, ale jsou rovněž v beta režimu. (openai.github.io)

Tím případná změna experimentálního Codex API nerozbije celý CatOS.