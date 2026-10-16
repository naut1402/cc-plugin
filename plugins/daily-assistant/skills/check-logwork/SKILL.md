---
name: check-logwork
description: Checks the user's logged work hours on the company logwork web portal against expected hours per day, lists missing days, and can fill in missing entries after confirmation by driving the browser. Use when the user says /check-logwork, "kiểm tra logwork", "log work", "đã log đủ giờ chưa", or before sending the daily report.
argument-hint: "[--today | --date=YYYY-MM-DD | --days=N] [--read-only] [--dry-run]"
user-invocable: true
---

# Check Logwork

The portal has no API/MCP — work through the browser tool set in `logwork.browser`:

| Value | Tooling | Note |
|-------|---------|------|
| `claude-in-chrome` | Load the `claude-in-chrome` skill first | Reuses the user's logged-in Chrome session (preferred) |
| `playwright` | `concurrent-playwright` MCP (`browser_create_session` → … → `browser_close_session`) | Fresh session; user must log in |

## Input

`$ARGUMENTS` = `[--today | --date=<d> | --days=<N>] [--read-only] [--dry-run]`

- Range default: last `logwork.check_days` working days including today.
- `--read-only`: report only, never offer to register (used by `/daily-report`).

## Steps

1. Load config via `assistant-config`; stop if the logwork gate is off.
2. Open `logwork.url`. If the page lands on `logwork.login_url` (or shows a login form) → ask the user to log in in that browser window, then continue. **Never type credentials.**
3. Take a snapshot and locate the entries of `logwork.user_label` for the range. Extract per day: task/category, hours, note.
4. Compare with `user.hours_per_day` on `user.working_days`:

   | Day | Logged | Expected | Gap | Entries |
   |-----|--------|----------|-----|---------|

   Mark `✅` (= expected), `⚠️` (under/over), `❌` (nothing logged).
   When every checked day is `✅`, run `DA mark logwork-ok`.
5. If there are gaps and not `--read-only`: propose entries to fill them, built from evidence — `DA today <date>` active time per task (≈), `DA commits <date>`, commits grouped by task ID, tracker tasks in `Doing`, the daily report draft if any, and logwork habits from `learn recall logwork` (e.g. fixed meeting entries). Show each proposed entry (date, task, hours, note) and ask the user to confirm/edit. Every correction the user makes → `learn capture` (habit, `src=check-logwork`).
6. On confirmation (and not `--dry-run`): fill the portal form one entry at a time, take a snapshot before submitting, submit, then re-read the day to verify the total. Stop at the first error and report it. Today now complete → `DA mark logwork-ok`.
7. Close any browser session/tab the skill opened.

## Rules

- Learn the form by snapshot each run; do not hard-code selectors (the portal can change).
- Never delete or edit existing entries unless the user asks for that specific entry.
- Hours come from the user's confirmation, never from guesses alone.
