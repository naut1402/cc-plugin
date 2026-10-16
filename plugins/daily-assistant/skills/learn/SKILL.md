---
name: learn
description: Self-learning memory of the daily assistant — captures candidate knowledge and habits from the user's work (corrections, repeated choices, explicit "remember this", the activity log), lets the user approve them, and serves the approved profile and knowledge back to the agent and skills. Use when the user says /learn, "nhớ là…", "ghi nhớ", "quên … đi", "bạn biết gì về tôi", or during the end-of-day review; other daily-assistant skills call `learn capture` and `learn recall`.
argument-hint: "[recall [topic]|capture <text>|remember <text>|review|show|forget <id|text>] [--dry-run]"
user-invocable: true
---

# Learn

Two kinds of memory, both readable/editable by the user:

| Kind | What | Examples |
|------|------|----------|
| **habit** (`profile.md`) | How the user works and wants things done | starts ~08:45, logs meetings as 1h "MTG", report bullets in Japanese terms, prefers draft over send, archives zips after extracting |
| **knowledge** (`knowledge/<topic>.md`) | Facts learned from the work | glossary terms, which Slack channel for which question, how to run a project script, task-ID → feature area |

## Storage

`memory.backend` in config:

| Backend | Layout |
|---------|--------|
| `file` (default) | `memory.dir` (default `~/.daily-assistant/memory/`): `profile.md`, `knowledge/<topic>.md`, `inbox.md` (pending candidates) |
| `working-memory` | Contract skills `read/write/edit/search-working-memory` of the installed task-memory backend; keys `assistant-profile`, `assistant-knowledge-<topic>`, `assistant-inbox` |

Entry format (one bullet, stable id):

```markdown
- [h-007] Logs internal meetings as a separate 1h "MTG" entry. (seen 4×, last 2026-10-16, src: check-logwork)
```

Prefix `h-` habit, `k-` knowledge. `inbox.md` uses the same format plus `→ habit|knowledge/<topic>`.

## Commands

`$ARGUMENTS` = `<command> [args] [--dry-run]`. No command → `show`.

| Command | Effect |
|---------|--------|
| `recall [topic]` | Return profile + knowledge relevant to the topic/skill (whole profile if none). Read-only; used at agent start-up and by skills |
| `capture <text> [→ target] [src=<skill>]` | Append a candidate to the inbox, or bump `seen` + `last` if an equivalent one exists. Silent (no question to the user) |
| `remember <text>` | User asked explicitly ("nhớ là …"): classify, echo the entry, save directly (skip inbox) |
| `review` | Consolidate (below); part of the end-of-day checklist |
| `show` | Print profile, knowledge topics with entry counts, inbox size |
| `forget <id\|text>` | Remove matching entries (confirm first) and add the text to `memory.never_learn` patterns so it is not re-captured |

## When to capture (rules for the agent and every skill)

| Signal | Capture as |
|--------|-----------|
| User corrects an output ("không, log là 2h", edits the report wording) | habit, with the corrected value |
| User makes the same choice ≥ `memory.repeat_threshold` times (destination folder, report channel, status value) | habit |
| A fact needed to finish a task was found or told (channel, command, term meaning) | knowledge/<topic> |
| Pattern in the activity log (see `watch`) — start/end time, hours per task type, recurring folders | habit, during `review` only |

Never capture: secrets, passwords, tokens, personal data of other people, anything matching `memory.never_learn`, or one-off details of a single task (those belong to task memory).

## Review (consolidation)

1. Read inbox + `DA today <date> --json` for each of the last `memory.review_days` days (do not read raw log files).
2. Derive habit candidates from the log (median session start/end, typical hours per task, frequent commands/folders) — each with evidence count.
3. Merge duplicates; drop candidates already present or contradicted by a newer user correction.
4. Show a table `id | candidate | target | evidence | action(add/update/drop)`. Candidates with `seen ≥ repeat_threshold` default to **add**, others to **keep in inbox**.
5. Apply only the rows the user approves; write `--dry-run` = show only.
6. Expire: inbox items older than `memory.inbox_ttl_days` with `seen = 1` are dropped; profile entries not confirmed for `memory.stale_days` are listed for re-confirmation (not auto-deleted).

## Using the memory

- Learned habits are **defaults**, never overrides: config values and explicit user instructions in the current conversation win.
- When a habit changes an output (e.g. pre-filled logwork hours), say so in one short note: `(theo thói quen h-007)`.
