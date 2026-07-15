# ChatGPT Handoff

This is a development-process handoff. It is not an AutoCodex runtime CODEX/VALIDATION/REVIEW report.

## Checkpoint

- date: 2026-07-15
- checkpoint number: 01
- short name: autocodex-mvp-contract
- branch: autocodex
- commit hash: pending documentation commit
- PR target: work
- implementation status: documentation checkpoint complete; runtime repair not started in this checkpoint

## Objective

Align the authoritative AutoCodex MVP and ChatGPT development handoff documentation with the current GitHub-first, report-driven MVP contract before implementation fixes continue.

## Starting state

The MVP document still described obsolete local repository discovery, manual repository path controls, Project/Profile-era behavior, and runtime GPT handoff wording. The handoff template was an older Czech process note rather than the mandatory structured development checkpoint format.

## Changes completed

### documentation

- Rewrote the AutoCodex MVP specification around GitHub-first repository selection, branch-specific clones, isolated run workspaces, Replit runtime compatibility, four RUN rows, deterministic report files, Human Gate limits, and development handoffs.
- Rewrote the ChatGPT handoff template with the mandatory checkpoint sections and archive/CURRENT byte-identical rules.

## Files changed

- docs/handoffs/AUTOCODEX_MVP.md: authoritative current MVP contract.
- docs/handoffs/CHATGPT_HANDOFF_TEMPLATE.md: mandatory development checkpoint format and rules.
- docs/handoffs/sessions/2026-07-15_01_autocodex-mvp-contract.md: archived documentation checkpoint handoff.
- docs/handoffs/CURRENT_CHATGPT_HANDOFF.md: byte-identical copy of this checkpoint handoff.

## Behavior before

Documentation could mislead implementers toward local discovery, manual repository paths, separate OUTPUT UI concepts, and conflated runtime/development handoffs.

## Behavior after

Documentation states the intended MVP contract: GitHub selector mirrors GitHub only, selected branches clone to branch-specific destinations, RUN creates an isolated workspace, UI runtime requires danger-full-access with approvalPolicy never, runtime reports remain separate from ChatGPT development handoffs, and Git publication is never automatic.

## Contracts and invariants

- GitHub selector mirrors GitHub only.
- Source clone remains immutable.
- UI MVP runtime requests danger-full-access with approvalPolicy never.
- CODEX bwrap/write failure is blocked or failed, not completed.
- Placeholder validation is SKIPPED, not PASS.
- Runtime reports and ChatGPT development handoffs are distinct artifacts.
- No automatic commit, push, PR, or merge in AutoCodex runtime.

## Validation actually performed

- command: cmp docs/handoffs/sessions/2026-07-15_01_autocodex-mvp-contract.md docs/handoffs/CURRENT_CHATGPT_HANDOFF.md
- PASS / FAIL / BLOCKED / NOT RUN: PASS
- relevant result: archive and CURRENT handoff content were byte-identical at documentation checkpoint creation time.

## Validation not performed

Full npm/typecheck/build/runtime validation was intentionally deferred to the implementation repair checkpoint.

## Known issues and risks

The runtime and reporting defects documented by the user remained unresolved at the end of this documentation-only checkpoint.

## Evidence

- Report filenames documented: 01_CODEX_REPORT.md, 02_VALIDATION_REPORT.md, 03_REVIEW_REPORT.md, FINAL_REPORT.md.
- Handoff archive: docs/handoffs/sessions/2026-07-15_01_autocodex-mvp-contract.md

## Recommended next step

Repair the UI-started runtime mode, CODEX failure status mapping, validation semantics, review/final reports, and sanitizer regressions against this documented contract.

## Ready state

READY FOR CHATGPT REVIEW — documentation checkpoint is complete and ready to guide the functional repair checkpoint.

## Git state

- branch: autocodex
- commit: pending documentation commit
- PR target: work
- whether PR was created: no
- whether merge was performed: no
- working tree state: documentation changes pending commit

## Handoff archive

- archive path: docs/handoffs/sessions/2026-07-15_01_autocodex-mvp-contract.md
- current handoff path: docs/handoffs/CURRENT_CHATGPT_HANDOFF.md
- checkpoint number: 01
- confirmation that older handoffs were left unchanged: yes
