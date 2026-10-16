---
name: daily-report
description: Builds the user's daily work report from today's git commits, tracker progress and Slack activity, then posts it to Slack (draft or send) and/or today's SilverBullet journal. Use when the user says /daily-report, "báo cáo hằng ngày", "daily report", "standup", or asks what they did today.
argument-hint: "[--date=YYYY-MM-DD] [--to=slack,journal,chat] [--dry-run]"
user-invocable: true
---

# Daily Report

## Input

`$ARGUMENTS` = `[--date=<YYYY-MM-DD>] [--to=<slack,journal,chat>] [--dry-run]`

- `--date`: report day (default: today in `user.timezone`).
- `--to`: override destinations; default = every enabled destination in `report.*`. `chat` = print only.
- `--dry-run`: print the report, write nowhere.

## Steps

1. Load config via `assistant-config`.
2. Collect (skip a source whose gate is off, note it in the footer):

   | Source | How |
   |--------|-----|
   | Git | `DA commits <date>` — own commits per repo grouped by task ID |
   | Tracker | Rows matching `tracker.mine` with status not in `done_statuses`, plus rows whose status changed to done today; take progress columns (`rate_*`), est/actual hours |
   | Logwork | If logwork gate is on, reuse `/check-logwork --date=<date> --read-only` result for hours per task |
   | Slack | If `slack_activity`: search own messages `from:me on:<date>`; keep only work-relevant threads (one line each) |
   | Activity log | `DA today <date>` — active time per task ID (≈), git actions; fills gaps the other sources miss |
   | Habits | `learn recall daily-report` — preferred wording, section order, language quirks |

3. Fill [report-template.md](report-template.md) in `report.language`. One bullet per task; merge sources for the same task ID. No invented items — if a section has nothing, write the template's empty marker.
4. Show the report and ask for edits (single round, accept "ok"). Each edit the user makes → `learn capture` (habit, `src=daily-report`), except under `--dry-run`.
5. Deliver:
   - **Slack**: `mode: draft` → save as draft in `report.slack.channel` (or as reply to the thread matching `thread_search`). `mode: send` → send only after explicit confirmation.
   - **SilverBullet**: append under heading `report.silverbullet.section` in the day's journal page (create the heading if missing; never rewrite other sections).
6. Record marks for the report day (`--date=<date>`): `DA mark report-sent` only after a confirmed Slack send; `DA mark report-drafted` when only a draft was saved; `DA mark journal-written` after SilverBullet. Skip on `--dry-run` / `chat`.
7. Print where it went (links when available).

## Rules

- Use the Slack and SilverBullet skills/MCP tools available in the session; if one is unavailable, say so and fall back to `chat`.
- Never post on someone else's behalf or to a channel not in config.
