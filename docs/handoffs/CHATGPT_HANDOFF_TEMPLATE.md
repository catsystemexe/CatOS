# ChatGPT Handoff

This is a development-process handoff. It is not an AutoCodex runtime CODEX/VALIDATION/REVIEW report.

## Checkpoint

- date
- checkpoint number
- short name
- branch
- commit hash
- PR target
- implementation status

## Objective

What this specific step was intended to accomplish.

## Starting state

Only the relevant previous state.

Do not paste the complete previous handoff.

## Changes completed

Concrete changes made in this checkpoint.

Group by:

- architecture / data contract
- backend
- frontend
- tests
- documentation

Omit empty groups.

## Files changed

Exact file paths with a short explanation.

## Behavior before

What the system did before this checkpoint.

## Behavior after

What the system does now.

## Contracts and invariants

List new or changed invariants.

Examples:

- GitHub selector mirrors GitHub only.
- Source clone remains immutable.
- CODEX bwrap failure is blocked, not completed.
- Placeholder validation is SKIPPED, not PASS.

## Validation actually performed

List only commands that were actually run.

For each:

- command
- PASS / FAIL / BLOCKED / NOT RUN
- relevant result

Never describe a test as passed when it did not run.

## Validation not performed

Explain why and where it must be performed next.

## Known issues and risks

Concrete unresolved problems.

## Evidence

Relevant:

- run IDs
- report filenames
- test names
- error messages
- screenshots only when genuinely available

Do not include secrets or token values.

## Recommended next step

One focused recommended action.

## Ready state

Use one of:

- READY FOR CHATGPT REVIEW
- READY FOR REPLIT RETEST
- READY FOR RUNTIME RETEST
- READY FOR MERGE
- NOT READY

Include the reason.

## Git state

- branch
- commit
- PR target
- whether PR was created
- whether merge was performed
- working tree state

## Handoff archive

- archive path
- current handoff path
- checkpoint number
- confirmation that older handoffs were left unchanged

## Mandatory rules

1. Create a new handoff after every meaningful implementation or repair checkpoint.
2. Do not create a handoff for trivial edits inside the same checkpoint.
3. Never overwrite an archived handoff.
4. Determine the highest checkpoint number for the current date.
5. Create:

   `docs/handoffs/sessions/YYYY-MM-DD_NN_short-description.md`

6. Copy the exact same final content to:

   `docs/handoffs/CURRENT_CHATGPT_HANDOFF.md`

7. `CURRENT_CHATGPT_HANDOFF.md` is a pointer/copy, not the historical record.
8. The archived file and CURRENT file must be byte-identical.
9. Codex final response must name both paths and the checkpoint number.
10. Existing archived files must remain unchanged.
11. Handoffs must describe only the current checkpoint.
12. Never claim tests passed when they were blocked or not run.
13. Never include secret values, environment dumps, or unrestricted filesystem paths.
