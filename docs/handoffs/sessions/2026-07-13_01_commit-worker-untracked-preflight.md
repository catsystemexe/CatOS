# ChatGPT handoff – 2026-07-13 Commit Worker untracked preflight

## Kontext

Commit Worker odmítal schválený workspace, pokud schválený `workspace.diff` obsahoval untracked soubor. Před commitem totiž kontroloval pouze `git diff --binary HEAD`, který untracked soubory nezahrnuje, zatímco Coding Worker už do `workspace.diff` přidává také no-index diffy untracked souborů.

## Provedené změny

- Přidán sdílený helper `collectWorkspaceGitState(workspacePath)` / `collectCompleteWorkspaceDiff(workspacePath)` v `src/gitWorkspaceState.ts`.
- Coding Worker používá sdílený helper pro `diff`, `status` a deterministicky seřazené `changedFiles`.
- Commit Worker používá stejný helper pro preflight working diff a complete changed-files kontrolu, takže untracked soubory jsou součástí porovnání proti Human Gate approved diffu.
- Staged kontrola explicitně porovnává `git diff --cached --binary HEAD` proti schválenému kompletnímu diffu po `git add --all`.
- Přidány regresní testy pro schválenou kombinaci tracked změny a untracked souboru, změněný untracked obsah po schválení a nově vzniklý untracked soubor po schválení.
- README aktualizuje popis Commit Worker preflightu tak, aby neuváděl samotný `git diff --binary HEAD` jako důkaz celého working tree.

## Omezení / poznámky

- Human Gate schema ani fingerprint algoritmus nebyly změněny.
- Reviewer ani Rework Loop nebyly měněny.
- Commit Worker nadále nevytváří push ani merge a nepoužívá GitHub API.
- Validace v tomto kontejneru je blokovaná nekompletní instalací dependencies a Node.js 20, zatímco projekt vyžaduje Node.js 22+.

## Doporučené další ověření

V prostředí s Node.js 22+ a kompletně nainstalovanými dependencies spustit:

```bash
npm run typecheck
npm run test
npm run build
```
