# ChatGPT handoff – 2026-07-12 isolated Codex SDK worker

## 1. Session metadata

- **Datum:** 2026-07-12
- **Aktuální branch:** `work` (uživatel požadoval aktuální stav větve main; lokálně je checkoutnutý `work` nad merge commitem z PR.)
- **Výchozí commit:** `cc94b61 Merge pull request #3 from catsystemexe/codex/fix-mkdir-logic-in-createrun-function`
- **Výsledný commit:** bude vytvořen jako `feat: add isolated Codex SDK worker`.
- **Cíl session:** implementovat první verzi Codex Workeru: `TaskBrief.codexInstruction` → Codex SDK → izolovaný Git worktree → Git diff/status/changed files → artefakty v run adresáři; zastavit před validací, review, commitem cílového projektu a pushem.
- **Stav pracovního stromu:** před commitem obsahuje pouze změny k Codex Workeru, CLI toku, testům, README a handoffům.

## 2. Executive summary

Implementována je první verze `CodingWorker` a `CodexSdkWorker`. CLI tok nyní po vytvoření `TaskBrief` deterministicky zavolá Coding Worker bez dalšího LLM rozhodování. Worker ověří Git repozitář, ověří existenci `baseBranch`, vytvoří bezpečně normalizovanou větev `catos/<runId>`, založí izolovaný worktree v `runs/<runId>/workspace/`, spustí Codex SDK pouze s tímto `workingDirectory` a po dokončení získá přes Git diff, status a seznam změněných souborů.

Implementováno je ukládání `coding-result.json`, `workspace.diff` a `workspace-status.txt`. `coding-result.json` záměrně neobsahuje celý diff. `workspace.diff` nyní kombinuje `git diff --binary HEAD` pro sledované změny s `git diff --binary --no-index -- /dev/null <file>` pro nové untracked soubory, takže textové untracked soubory obsahují patch s obsahem a malé binární soubory jsou zachyceny jako `GIT binary patch`. CLI vypisuje run ID, task brief, workspace, počet změněných souborů, diff path a Codex thread ID. Pokud změny nevzniknou, CLI to jen oznámí a nepovažuje to za chybu.

Otestováno přes fake Codex/Coding Worker a lokální dočasné Git repozitáře v jednotkových/integrančních testech na úrovni zdrojového kódu. Test runner v tomto kontejneru ale nebylo možné spustit, protože dependencies nejsou nainstalované. Skutečné Codex SDK volání nebylo spuštěno. Instalace `@openai/codex-sdk` byla BLOCKED registry/firewallem (`403 Forbidden`), proto dependency není přidána do lockfile npm instalací a implementace ponechává dynamický import bez lokálního `.d.ts` shim souboru.

## 3. Aktuální architektura dotčené části

Aktuální tok po změně:

CLI `run`
→ `loadProjectConfig()`
→ kontrola `project.id`
→ `createRun()` a zápis `input.json`
→ `analyzeTaskBrief()` a zápis `task-brief.json`
→ `CodingWorker.executeTask()`
→ `CodexSdkWorker` připraví Git worktree a spustí Codex SDK
→ Git `status --porcelain=v1 -z` / `diff --binary HEAD` / untracked `diff --binary --no-index`
→ `writeCodingArtifacts()`
→ CLI výpis výsledku

Hlavní moduly:

- `src/codingWorker.ts` – veřejné typy `CodingTask`, `CodingResult`, interface `CodingWorker`, implementace `CodexSdkWorker`, helpery pro bezpečnou instrukci, normalizaci větve a zápis artefaktů.
- `src/cli/run.ts` – orchestrace existujícího Task Analysta a nového Coding Workeru. Pro testy přijímá injected `codingWorker`.
- `tests/codingWorker.test.ts` – fake Codex klient + lokální Git worktree testy bez sítě a bez skutečného Codex API.
- `tests/runCli.test.ts` – CLI test s injected Task Analyst providerem a injected Coding Workerem.

## 4. Veřejná rozhraní a datové kontrakty

### `CodingTask` / `CodingResult` / `CodingWorker`

Soubor: `src/codingWorker.ts`

```ts
export type CodingTask = {
  instruction: string;
  repositoryPath: string;
  baseBranch: string;
  runId: string;
  runDir: string;
};

export type CodingResult = {
  threadId: string;
  finalResponse: string;
  workspacePath: string;
  changedFiles: string[];
  diff: string;
  status: string;
};

export interface CodingWorker {
  executeTask(input: CodingTask): Promise<CodingResult>;
}
```

`runDir` je přidán oproti původnímu návrhu, aby Worker deterministicky zapisoval worktree do adresáře konkrétního běhu a nemusel odvozovat cestu z globálního CWD.

### `CodexSdkWorker.executeTask()`

Soubor: `src/codingWorker.ts`

Ověří repozitář přes `git rev-parse --is-inside-work-tree`, ověří branch přes `git rev-parse --verify <baseBranch>^{commit}`, vytvoří branch a worktree, spustí Codex a vrátí Git-zjištěné výsledky. Po Codexu načte status přes NUL-separated porcelain formát kvůli bezpečnějším názvům souborů, tracked diff vytvoří přes `git diff --binary HEAD` a pro každý untracked soubor připojí no-index binary diff proti `/dev/null`. Nepoužívá `skipGitRepoCheck`, nedělá commit, push ani merge a nemění index.

### `writeCodingArtifacts()`

Soubor: `src/codingWorker.ts`

Zapíše `task-brief.json`, `coding-result.json`, `workspace.diff` a `workspace-status.txt`. Do JSON ukládá jen metadata, nikoli celý diff.

## 5. Změny podle souborů

`src/codingWorker.ts`

- Nový modul s rozhraním Coding Workeru a implementací `CodexSdkWorker`.
- Obsahuje bezpečnostní obal instrukce pro Codex: pouze workspace, žádný commit/push/merge, žádné secrets, žádná práce mimo TaskBrief.
- Vytváří izolovaný worktree v `runDir/workspace` a získává změny přes Git. Diff artefakt zahrnuje tracked změny i obsah nových untracked souborů; pro binární untracked soubory používá `--binary` patch.
- Dynamický import `@openai/codex-sdk` je připraven podle oficiálního toku, ale skutečná dependency nemohla být nainstalována kvůli registry blokaci.

`src/cli/run.ts`

- Přidává injected `codingWorker` option pro deterministické testy.
- Po Task Analystovi volá `CodingWorker.executeTask()` s `TaskBrief.codexInstruction`, `repositoryPath`, `baseBranch`, `runId` a `runDir`.
- Zapíše coding artefakty a rozšíří CLI výpis.

`tests/codingWorker.test.ts`

- Přidává test zápisu artefaktů.
- Přidává Git testy pro non-repo odmítnutí, chybějící branch, normalizaci branch name, izolovaný worktree bez změny původního checkoutu a untracked textový i binární obsah ve `workspace.diff`.
- Používá fake Codex klient; nevolá síť ani Codex API.

`tests/runCli.test.ts`

- Rozšiřuje CLI test o injected Coding Worker.
- Ověřuje předání přesné `TaskBrief.codexInstruction`, vznik `coding-result.json`, `workspace.diff`, `workspace-status.txt` a přenesený seznam změněných souborů.

`README.md`

- Popisuje nový Codex Worker, požadovanou autentizaci, izolovaný worktree, artefakty a hranici: zatím bez automatické validace/review/commitu/pushe.

`docs/handoffs/CURRENT_CHATGPT_HANDOFF.md` a archivní session soubor

- Aktualizují předávací dokumentaci podle šablony.

## 6. Důležitá implementační rozhodnutí

- **Úzké rozhraní místo plugin systému:** Implementace má jen `CodingWorker` a `CodexSdkWorker`; nevznikl obecný plugin registry.
- **`runDir` v `CodingTask`:** Zvoleno kvůli jednoznačnému umístění workspace a artefaktů pod konkrétním runem.
- **Fake Codex přes `codexFactory`:** Testy pokrývají chování bez skutečného API a bez sítě.
- **Seznam změněných souborů a untracked diff ze statusu:** NUL-separated porcelain status zahrne i untracked soubory a bezpečněji pracuje s mezerami v názvech. Obsah untracked souborů se přidává přes `git diff --binary --no-index` bez shellu a bez změny indexu.
- **Žádný automatický cleanup po úspěchu:** Worktree zůstává pro ruční kontrolu, jak bylo požadováno.
- **Žádný lockfile ruční zásah:** `npm install @openai/codex-sdk` selhal, proto nebyl lockfile ručně upravován.

## 7. Validace a důkazy

| Kontrola | Stav | Důkaz / překážka |
|---|---:|---|
| `npm install @openai/codex-sdk --no-audit --no-fund` | BLOCKED | Spuštěno; exit code 1; `403 Forbidden - GET https://registry.npmjs.org/@openai%2fcodex-sdk`. |
| `npm run typecheck` | BLOCKED | Spuštěno znovu; exit code 2; chybí `@types/node` a `vitest/globals`, protože dependencies nejsou kompletně nainstalované. |
| `npm run test` | BLOCKED | Spuštěno znovu; exit code 127; `vitest: not found`, protože dependencies nejsou kompletně nainstalované. |
| `npm run build` | BLOCKED | Spuštěno znovu; exit code 2; stejná chybějící typová dependencies jako typecheck. |
| Skutečné Codex SDK volání | NOT RUN | Neprováděno; SDK dependency nelze nainstalovat a nebylo cílem volat Codex nad CatOS ani MGoD. |

## 8. Git diff summary

- Změněny/přidány jsou soubory pro jednu tematickou funkcionalitu: `src/codingWorker.ts`, `src/cli/run.ts`, `tests/codingWorker.test.ts`, `tests/runCli.test.ts`, `README.md` a handoff dokumenty.
- Hlavní změny: nový Worker, CLI napojení, fake a Git worktree testy, dokumentace artefaktů a následná oprava úplnosti `workspace.diff` pro untracked soubory.
- Nebyly přidány run artefakty, secrets ani ručně upravený lockfile.
- Commit má obsahovat pouze první verzi Codex Workeru; žádný Reviewer, Validation Runner, rework loop, push, merge ani GitHub API.

## 9. Rizika a podezřelá místa

- Největší riziko je nezkompilovaný skutečný import `@openai/codex-sdk`, protože registry v kontejneru balíček blokuje. Nebyl vytvořen lokální shim a nebyly domýšleny typy SDK; po odblokování npm je nutné spustit instalaci a případně upravit volání podle skutečných typů balíčku.
- Pokud branch `catos/<runId>` už existuje, příprava worktree selže. To je bezpečné, ale chybová zpráva zatím není uživatelsky obalená.
- Selhání po vytvoření větve/worktree zatím nemá složitý rollback, v souladu se zadáním pro tuto etapu.

## 10. Otevřené úkoly

### Blokující před pokračováním

- V prostředí s funkčním registry spustit `npm install @openai/codex-sdk` a commitnout změny `package.json`/`package-lock.json` vytvořené npm.
- Spustit `npm run typecheck`, `npm run test`, `npm run build` nad Node 22+ s kompletními dependencies.
- Ověřit skutečný Codex SDK tok nad dočasným Git repozitářem, nikoli nad CatOS/MGoD.

### Následující doporučený krok

- Stabilizovat skutečné typy a runtime API `@openai/codex-sdk` po odblokování instalace, bez přidávání Reviewera nebo Validation Runneru.

### Pozdější práce

- Validation Runner.
- Reviewer.
- Rework loop.
- Commit vytvořený CatOS.
- Push/merge/GitHub API.
- Event log, Memory, Temporal, LangGraph, web UI.

## 11. Otázky pro ChatGPT review

1. Je přidání `runDir` do `CodingTask` správné, nebo má Worker dostávat jen obecný `runsRoot`?
2. Má se pro velmi velké untracked binární soubory později zavést limit velikosti diff artefaktu?
3. Má se branch kolize `catos/<runId>` převést na přátelštější chybu?
4. Je `codexFactory` pro testy dostatečně úzký seam, nebo příliš odhaluje SDK tvar?
5. Po odblokování SDK: má se `CATOS_CODEX_MODEL` mapovat přes přesný SDK option, pokud se liší od předpokladu `model`?

## 12. Doporučené soubory k přímému review

1. `src/codingWorker.ts` – hlavní implementace Workeru, Git worktree přípravy a Codex SDK toku.
2. `src/cli/run.ts` – deterministická orchestrace Task Analyst → Codex Worker → artefakty.
3. `tests/codingWorker.test.ts` – nejdůležitější pokrytí Git worktree izolace a artefaktů.
4. `tests/runCli.test.ts` – CLI tok s injected Task Analystem a Coding Workerem.
5. `README.md` – uživatelský popis nové hranice funkce.
6. `package.json` – nutné zkontrolovat po odblokování `@openai/codex-sdk` instalace.
