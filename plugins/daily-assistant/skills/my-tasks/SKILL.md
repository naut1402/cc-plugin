---
name: my-tasks
description: Lists and manages the user's tasks in the Google Sheets task tracker — what is in progress, due soon or overdue, and updates status, progress rates or actual dates after confirmation. Use when the user says /my-tasks, "task của tôi", "chuyển trạng thái task", "cập nhật tiến độ", or asks what they are working on.
argument-hint: "[list|review|set <task-id> <field>=<value> ...] [--all] [--dry-run]"
user-invocable: true
---

# My Tasks

Tracker access goes through the Google Sheets MCP (workspace tools). Column mapping, row layout and allowed statuses come from `tracker.*` in the config.

## Input

`$ARGUMENTS` = `[<command>] [--all] [--dry-run]`

| Command | Meaning |
|---------|---------|
| `list` (default) | My open tasks; `--all` includes done ones |
| `review` | `list` + flag inconsistencies + propose updates (used by the end-of-day checklist) |
| `set <task-id> <field>=<value> ...` | Update fields, e.g. `set F00284 status=Done rate_imp=100%` |

## Read the tracker

1. Load config via `assistant-config`; stop if the tracker gate is off.
2. Read `<sheet>!A<header_row>:<last column><last row>` (chunk by 1000 rows).
3. Build task records:
   - `plan-actual-pair`: a row with a value in `columns.id` and `plan_actual = Plan` starts a task; the next `Actual` row holds actual dates, hours, rates and status. Record both sheet row numbers.
   - `single-row`: one row per task.
4. "Mine" = `columns[tracker.mine.column]` ∈ `tracker.mine.values`. Empty values → show all and remind the user to configure it.

## Output (list)

Table sorted by plan end date: `task | title (≤40 chars) | plan end | actual hours/est | DD/IMP/Test/AT | status`, with markers:

- `🔴 overdue` — plan end < today and status not done
- `🟡 due ≤ 3 working days`
- `⚪ not started` — no actual start date

## Review

In addition to the list, propose fixes (do not apply yet):

- status `Doing` but all rates 100% → suggest `Done`
- actual hours present but no actual start → suggest start date
- status done but actual end empty → suggest today
- today's logwork (if `/check-logwork` ran in this session) shows hours on a task not marked `Doing`

## Update (set / accepted proposals)

1. Validate: field exists in `columns`; `status` value ∈ `tracker.statuses`; rates are `0%–100%` or `--`; dates `YYYY/MM/DD`.
2. Target cell = Actual row for actual-side fields (`actual_hours`, `rate_*`, `status`, `at_status`, actual dates), Plan row otherwise.
3. Show `cell: old → new` for every change; write only after confirmation (`--dry-run` stops here).
4. Re-read the cells and report the result. Never touch cells outside the confirmed list, formulas, or other people's rows.
