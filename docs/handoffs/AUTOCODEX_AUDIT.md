# AutoCodex Audit
## Scope
Audited repository discovery, GitHub repository discovery, remote/local branch loading, clone API, UI clone flow, repository-first RUN payload, and MVP orchestration notes.
## Architecture observed
The UI loads `/api/repositories`, selects a `RepositoryOption`, loads branches, posts clone requests for GitHub remotes, refreshes repositories, and starts RUN with `repositoryPath`, `baseBranch`, `prTargetBranch`, and `task`.
## Critical findings
Remote clone state could remain `not cloned` because branch selection was not part of clone, managed clone roots were not authoritative in discovery, remote branches were unavailable before clone, and post-clone refresh could select an older/remote option.
## Root cause of "not cloned"
The clone operation returned insufficient local identity and discovery did not reliably include `/home/runner/catos-repositories/<owner>/<repo>`, so the UI could not consistently match the clone after refresh.
## Fixed findings
Added branch-aware clone contract, remote branch API, managed root helper, managed root discovery, branch checkout validation, structured clone errors, safe git environment, and UI post-clone matching/race guard.
## Remaining risks
Real private GitHub clone still requires Replit `GITHUB_TOKEN`/`GH_TOKEN` and smoke validation against the target account.
## Repository → branch → clone pipeline
Remote repositories expose branches before clone, clone uses `git clone --branch <branch> --single-branch`, the worktree is validated, repositories refresh, local/GitHub dedupe prefers the local checkout, and RUN uses the selected local path and branch.
## API contracts
`POST /api/repositories/clone` accepts `{ repositoryId, branch }` and returns `{ repository, branch, headCommit }`. `GET /api/github/branches?repositoryId=github:owner/repo` returns `{ branches }`.
## Test coverage
Added local no-network clone/API integration coverage and frontend static assertions for branch-aware clone and race guards.
## Replit smoke procedure
Set `GITHUB_TOKEN`, open AutoCodex UI, select a GitHub repository, select a non-default branch, clone, verify local path appears, enter a task, and run.
## Verdict
Development fix pending Replit smoke.
