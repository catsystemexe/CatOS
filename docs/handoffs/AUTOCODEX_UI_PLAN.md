# AutoCodex UI Plan
## ASCII UI
```text
+--------------------------------------------------------------+
| CatOS AutoCodex | RUN #... | phase | elapsed                 |
+------------------------------+-------------------------------+
| SETUP                        | RUN                           |
| Git repository               | status message                |
| [repo select..............]  | # | STEP | STATUS | TIME      |
| owner/repository-full-name   | rows wrap, click opens output |
| Branch              CLONE    |                               |
| [branch select....] [BRANCH] |-------------------------------|
| Local clone: wrapped path    | OUTPUT                        |
| Base branch: selected branch | full output title             |
| Snapshot: automatic on RUN   | scrollable pre                |
| Task textarea uses remainder |                               |
| status message               |                               |
| [ RUN ] [ STOP ]             |                               |
+------------------------------+-------------------------------+
```

## State diagram
```text
idle -> loading repositories -> loading branches -> cloning -> ready
ready -> starting -> running -> completed -> idle on next edit/run
ready -> starting -> failed
running -> stopping -> completed/stopped
running -> failed
loading branches -> failed on repository/branch API error
cloning -> failed on clone API error
```

## DOM elements
- `#repository`, `#selectedRepositoryName`
- `#branch`, `#clone`, `#branchStatus`
- `#repositoryPath`, `#baseBranch`
- `#task`, `#runReason`, `#run`, `#stop`
- Header: `#runNo`, `#status`, `#elapsed`
- RUN: `#currentStep`, `#timeline`, `#system`
- OUTPUT: `#viewerTitle`, `#copy`, `#viewer`

## CSS layout model
- `body`: two rows, header plus a non-scrolling content area.
- `.app-layout`: two equal columns, SETUP and RUN/OUTPUT.
- `.setup-panel`: seven-row grid; task is the only flexible row, status and actions remain fixed at the bottom.
- `.execution-panel`: `3fr / 2fr` grid for RUN and OUTPUT.
- Long values wrap using `.value-readout`; output content scrolls only inside `#viewer`.

## JavaScript state model
- Track `phase`, `runId`, `checkout`, `latestRows`, `selected`, `pollSequence`, and `pollFailures`.
- RUN click sets `starting` and “Creating run snapshot…” before the API call.
- `running` is set only after a non-empty `runId` is received.
- STOP is enabled only for `starting`, `running`, and `stopping` with a valid run id.
- Polling uses a sequence guard and never changes a terminal phase back to running.

## Acceptance criteria
- RUN/STOP are always visible and outside the task scroll area.
- CLONE BRANCH is a compact black primary button.
- Repository full name and local clone path are fully readable without ellipsis.
- RUN panel always explains idle, starting, waiting, polling error, or terminal state.
- Empty OUTPUT says no output is available yet.
- First available output is auto-selected.
- No page-level scrolling is introduced.
- Branch-specific shallow clone and clone API contracts remain unchanged.
