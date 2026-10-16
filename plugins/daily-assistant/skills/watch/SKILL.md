---
name: watch
description: Watches the user's working day at minimal token cost — plugin hooks record an activity log (sessions, task IDs, git actions, end-of-day marks), a Node script summarizes it and runs scheduled checks from the OS scheduler that verify the journal/report and logwork were written, raising a desktop notification and a reminder in the next Claude Code prompt only when something is missing. Use when the user says /watch, "bật theo dõi", "kiểm tra nhật ký", "hôm nay tôi đã làm gì", "nhắc tôi ghi nhật ký", or when a reminder from the watch arrives.
argument-hint: "[start|stop|status|run <check-id>|today [date]|flush|mark <name>] [--dry-run]"
user-invocable: true
---

# Watch

Observation runs **without the model**; Claude is involved only when a check fails or the user asks.

| Layer | Runs | Tokens |
|-------|------|--------|
| Activity log | Plugin hooks → `scripts/activity-log.mjs` on SessionStart / UserPromptSubmit / PostToolUse(Bash) / Stop / SessionEnd | 0 — hook injects context only when something needs attention |
| Scheduled checks | OS scheduler (Windows Task Scheduler / cron) → `DA check <id> --notify` | 0 — on failure: desktop notification + entry in `~/.daily-assistant/pending.json` |
| Reminder delivery | Next SessionStart / UserPromptSubmit hook reads unseen `pending.json` items once | a few lines of context |
| In-session fallback | `CronCreate` — only for checks with `action` (need Claude) | one short turn per fire |

`DA` = `node ~/.daily-assistant/bin/daily-assistant.mjs` (see `assistant-config` → Scripts first).

## Activity log format

`<watch.log_dir>/<YYYY-MM-DD>.jsonl`, one object per line, `t` in `user.timezone`:

| `ev` | Fields |
|------|--------|
| `session-start` / `session-end` | `sid`, `source` / `reason`, `cwd`, `branch`, `tasks` |
| `prompt` | `sid`, `tasks` (IDs found), `preview` only if `capture.prompts` |
| `git` | `sid`, `sub` (commit, push, switch, …, pr-create), `cwd`, `branch`, `tasks` |
| `turn-end` | `sid` |
| `mark` | `name`, `note` |

**Marks** record that an end-of-day item happened. Skills write them with `DA mark <name> [note]`:

| Mark | Written by |
|------|-----------|
| `report-sent` | `daily-report` after posting/drafting to Slack |
| `journal-written` | `daily-report` / `watch flush` after writing the journal |
| `logwork-ok` | `check-logwork` when the day's total meets `hours_per_day` |
| `todo-reviewed` | `todo review` |
| `eod-done` | `end-of-day` at the end of the run |

## Commands

`$ARGUMENTS` = `<command> [args] [--dry-run]`. No command → `status`.

| Command | Do |
|---------|----|
| `start` | 1. `DA schedule install` (dry run) → show the planned entries. 2. On user confirmation: `DA schedule install --yes`. 3. For enabled checks with `action` only: offer `CronCreate` with prompt `[daily-assistant watch:<id>] Run: <action>` (session-only, fires while idle, expires after 7 days) |
| `stop` | `DA schedule remove` (dry run) → confirm → `--yes`; `CronList` → `CronDelete` jobs whose prompt starts with `[daily-assistant watch:` |
| `status` | `DA brief` + `DA schedule show`; nothing else |
| `run <id>` | `DA check <id> --force`. Exit 0 → reply `✓ <id>` only. Exit 1 → relay the line and offer its `remind` command |
| `today [date]` | `DA today [date]` — relay output; add interpretation only if asked |
| `flush` | `DA today` → append the summary (not already flushed) under `watch.journal_section` in today's journal, then `DA mark journal-written flush` |
| `mark <name> [note]` | `DA mark <name> [note]` (e.g. the user wrote the journal by hand) |

When a reminder arrives through hook context (`[daily-assistant] Reminder (…)`): mention it in one line and offer the suggested command; do not run checks again.

## Checks (evaluated by the script)

| `check` | Satisfied when |
|---------|----------------|
| `marker:<name>` | Mark `<name>` exists today |
| `journal-section:<heading>` | `watch.journal_http` configured and today's page has `<heading>` with content; otherwise mark `journal-written` |
| `logwork` | Mark `logwork-ok` today (the portal needs a browser, so only `/check-logwork` can set it) |
| `todo-due` | No open todo overdue / due today (file backend; other backends → skipped by the script) |

`DA check all` evaluates only checks whose scheduled time today has passed.

## Notes

- Activity estimates come from Claude Code events only — label them `≈` and never log hours without user confirmation.
- Hooks and scheduled checks need `node` on PATH; `status` shows when today's log is missing.
- Scheduled tasks call the stable copy in `~/.daily-assistant/bin/`; it refreshes on the next Claude Code session after a plugin update.
- On Windows a console window may flash briefly when a scheduled check runs.
