# AutoCodex Console MVP

## Repository-first setup

The MVP Console no longer uses Project/Profile as the primary UI selector. The SETUP panel contains only Repository, Repository path, Base branch, PR target, Task and RUN. Project YAML files remain supported for CLI compatibility, but the UI starts runs from an explicit repository path and branch pair.

## Repository discovery

Repository roots are configured in `catos.config.yaml`:

```yaml
repositoryRoots:
  - /home/runner/workspace
  - /tmp
```

If this file is absent, CatOS scans only `process.cwd()`. CatOS never scans the whole filesystem. Discovery walks the configured roots to a bounded depth of three levels, canonicalizes paths via `realpath`, verifies candidates with `git rev-parse --is-inside-work-tree`, supports both `.git` directories and `.git` files for worktrees, and deduplicates symlinked repositories by canonical top-level path. It ignores `node_modules`, `.git`, `runs`, `build`, `dist`, `coverage`, CatOS runtime/workspace directories, and continues when one directory cannot be read.


## GitHub repository discovery and clone

The Console can augment local repository discovery with GitHub repositories available to the authenticated Replit user. In Replit, configure a Secret named `GITHUB_TOKEN` with read-only repository access for the repositories that should appear in the selector. `GH_TOKEN` is accepted as a fallback alias, but `GITHUB_TOKEN` takes precedence. The token is read from the environment at runtime, is not written to source, config, remotes, logs, run artifacts, or UI state, and no token input is exposed in the UI.

GitHub discovery uses the GitHub REST API directly with built-in `fetch`; the `gh` CLI is not required. If no token is available, CatOS does not attempt anonymous public repository discovery and the UI shows only the short message `GitHub repositories unavailable.` while local discovery continues to work.

Remote GitHub repositories are cloned only after the user presses `clone`, into the managed persistent root `/home/runner/catos-repositories/<owner>/<repo>` using sanitized owner/repo path segments. Private HTTPS clones use a temporary `GIT_ASKPASS` helper and `GIT_TERMINAL_PROMPT=0`; clone URLs and stored `origin` remotes remain clean `https://github.com/owner/repo.git` URLs without embedded credentials.

## Manual repository path

The UI also accepts a manually entered Repository path. Manual paths may be outside configured roots because the user explicitly supplied them. CatOS canonicalizes the path, verifies that it exists, verifies it is a Git worktree, adds it to the in-memory selector list, and loads local branches. It is not persisted by the MVP.

## Branch selectors

After a repository is selected, CatOS loads local branches with `git for-each-ref --format=%(refname:short) refs/heads`. Base branch defaults to the current branch, then `main`, then `master`, then the first local branch. PR target initially defaults to the base branch. When base changes, PR target follows until the user manually changes PR target. Before RUN, both branches must exist.

## UI start-run contract

```ts
type UiStartRunInput = {
  repositoryPath: string;
  baseBranch: string;
  prTargetBranch: string;
  task: string;
};
```

The backend validates the repository, validates both branches, resolves the exact base commit, creates the `catos/<runId>` run branch from that snapshot, and continues through the existing AutoCodex orchestration. CLI compatibility is preserved with `npm run catos -- run --project ...`; the CLI also accepts repository-started runs internally.

## Repository run config fallback

For repository-started runs CatOS resolves config in this order: repo-local CatOS config, matching `projects/*.yaml` by canonical repository path, inferred npm scripts from `package.json`, then a safe default. Inferred validation commands only use `npm run typecheck`, `npm test`, and `npm run build` when matching scripts exist; missing scripts are explicit no-op skips. Session input records `configSource` as `project-config`, `repo-config`, `inferred`, or `default`.

## GPT handoff

AutoCodex runtime does not generate GPT handoff artifacts. The only GPT handoff is the final text response produced by Codex after a development task completes.

## UI handoff workflow

Timeline rows open their actual phase outputs, such as coding results, validation reports, review reports/packages, and the final session report.

## Final export

The session-level final export remains a summary of real session artifacts and does not link GPT handoff files.

## Example workflow

Select repository → select base branch → PR target defaults to base → enter task → RUN → inspect actual phase outputs → final session export summarizes the session.

## Security boundaries

No whole-filesystem scans, no token persistence, no token-bearing remote URLs, no automatic push, no remote PR, no merge, no interactive auth flow, and no environment dump. Viewer paths remain restricted to the run root.

## Known limitations

The MVP has no complex filesystem browser, no multi-user dashboard, no IDE/editor, no anonymous GitHub discovery without credentials, and no parallel run dashboard. Manual repository paths are in-memory only. STOP remains best-effort for UI-started child processes.
