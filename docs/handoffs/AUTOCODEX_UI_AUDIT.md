# AutoCodex UI Audit
## Current structure
- `index.html` used a left SETUP section and a right execution section with RUN and OUTPUT stacked.
- Repository and branch controls shared one grid row; clone, path, base branch, snapshot, task, status, and RUN/STOP were arranged as a long flex column.
- `app.js` loaded GitHub repositories, then branches, cloned the selected branch through `/api/github/clone-branch`, and posted RUN payloads to `/api/runs` using the checkout response.
- `uiApi.ts` preserves the branch-specific shallow clone flow and can return `{ runId: "", status: "running" }` when the spawned run is not discovered in time.

## Layout failures
- RUN/STOP were clipped because `.setup-window` was a flex column where `.task-field` consumed remaining height after several fixed controls; in shorter viewports the action row landed below the visible panel.
- CLONE looked like an input because the global `button` rule made every button `width:100%`, white background, one-pixel border, and left-aligned text.
- Long repository, branch, path, base branch, output title, and step values used single-line controls or nowrap table cells, so values were clipped instead of wrapped.

## State-management failures
- `start()` assigned `runId=res.runId` and updated the header before validating that the API returned a non-empty run id.
- Because `uiApi.startRun()` polls for a run directory for a bounded time, an empty `runId` can be returned while status still says running.
- STOP was enabled by `!!runId`, not by an explicit UI phase, so it did not distinguish starting, running, stopping, completed, failed, or stopped.

## RUN timeline failures
- `refreshRun()` used an empty `catch {}` that hid status and timeline polling failures.
- `renderRows()` wrote `<div>` elements into a table body and showed `No output selected` when rows were empty, so the RUN panel did not explain whether a run had not started, was starting, was waiting for the first event, or failed.
- Polling had no sequence guard, so stale responses could overwrite newer state.

## Output-viewer failures
- The OUTPUT title defaulted to `No output selected`, while the RUN panel reused the same phrase for an empty timeline.
- No automatic output selection existed after timeline rows appeared.
- The output title was single-line clipped.

## Accessibility and readability
- The repository select did not have a separate full-name readout.
- The local clone path was a readonly one-line input requiring horizontal scrolling.
- RUN state changes were not exposed as a stable status message.

## Root causes
- The UI relied on implicit booleans (`runId`, `checkout`, `cloneBusy`) instead of an explicit run phase.
- Layout used one long SETUP flex column with global control styles instead of a bounded grid with fixed bottom status/actions.
- Polling failures and empty states were not rendered in the UI.

## Required fixes
- Convert the page to a two-panel grid, and make SETUP a fixed-row grid where task uses only remaining space.
- Add a primary button style for RUN and CLONE BRANCH.
- Replace path/base inputs with wrapping readouts and add a repository full-name readout.
- Add explicit `idle | starting | running | stopping | completed | failed | stopped` run phases.
- Validate non-empty `runId` before showing running.
- Render empty RUN, starting, waiting, and polling-error messages.
- Add guarded polling, terminal-state handling, correct STOP enabled logic, and automatic first-output selection.
