---
name: end-of-day
description: Walks through the user's end-of-day checklist item by item — logwork check, tracker update, daily report, archiving downloads, git cleanup — calling the matching daily-assistant skill for each item and ending with a summary. Use when the user says /end-of-day, "cuối ngày", "wrap up the day", or asks to run the daily checklist.
argument-hint: "[--only=<n,n>] [--skip=<n,n>] [--dry-run]"
user-invocable: true
---

# End of Day

Run the checklist defined by `checklist` in the config (default: [../assistant-config/assets/checklist.default.md](../assistant-config/assets/checklist.default.md)).

## Input

`$ARGUMENTS` = `[--only=<n,...>] [--skip=<n,...>] [--dry-run]`

- `--only` / `--skip`: 1-based item numbers.
- `--dry-run`: pass `--dry-run` to every called skill; nothing external is changed.

## Steps

1. Load config via `assistant-config`.
2. Parse the checklist: each `- [ ] <label> :: <action>` line is one item. Ignore comments.
3. Show the numbered list once, then run items in order:

   | Action | Behaviour |
   |--------|-----------|
   | `/skill args` | Invoke the skill. If its feature gate is disabled → mark `⏭️ skipped (config)` and continue |
   | `manual` | Ask the user to confirm done / skip / not done (one short question) |

4. After each item record one status: `✅ done`, `⚠️ needs attention` (skill reported a gap, e.g. missing hours), `⏭️ skipped`, `❌ failed` (with one-line reason). A failure never stops the run.
5. Final summary table: `# | item | status | note`. List open `⚠️`/`❌` items as tomorrow's to-dos.
6. If SilverBullet report is enabled, offer to append the summary under the report section of today's journal.
7. `DA mark eod-done`, unless `--dry-run`.

Token budget: before the loop run `DA check all --verbose` once; checklist items whose check is already `✓` (e.g. `report-sent` marked) are reported as `✅ done (already recorded)` without invoking their skill.

## Rules

- Each called skill keeps its own confirmation before writing; do not batch-approve on the user's behalf.
- Keep chat output short: one line per item while running, the table at the end.
