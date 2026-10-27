---
name: human-handover
description: Hands knowledge from the agent to the human so work can go on by hand when Claude tokens run out — a runbook for operating the daily routine manually (steps, URLs, scripts that run without Claude, the most used commands) and a handover note for the task in progress (state, next steps with exact commands, how to verify, how to resume with Claude), saved locally and on SilverBullet. Use when the user says /human-handover, "bàn giao", "sắp hết token", "hết usage", "viết runbook", "làm tay thế nào", "vận hành thủ công", when a usage-handover reminder arrives, or to resume a task after a manual stretch.
argument-hint: "[task [<ID>]|runbook|resume <ID>] [--local-only] [--dry-run]"
user-invocable: true
---

# Human Handover

Facts come from scripts (zero tokens); the model writes only what a human needs to act. A task handover usually runs when tokens are scarce: **one pass, no extra exploration**.

`US` = `node ~/.daily-assistant/bin/usage.mjs`, `DA` = `node ~/.daily-assistant/bin/daily-assistant.mjs` (fallbacks: `${CLAUDE_PLUGIN_ROOT}/scripts/…`).

## Config

Section `handover` (see `assistant-config`); works with defaults when absent.

| Key | Meaning |
|-----|---------|
| `dir` | Local copies (default `~/.daily-assistant/handover`) — always written first, readable with no network or Claude |
| `runbook_page` | SilverBullet page of the runbook (default `Agent/Runbook`) |
| `tasks_root` | SilverBullet folder of task handovers (default `Agent/Handover`) → `<tasks_root>/<ID>` |
| `silverbullet` | `false` = local only |
| `language` | `""` = `persona.language` |

## Commands

`$ARGUMENTS` = `<command> [args] [--local-only] [--dry-run]`. No command → `task` when the conversation has work in progress, else ask `task` or `runbook`.

### `task [<ID>]` — hand over the work in progress

1. `US facts --cwd=<current dir> [--task=<ID>]` — session, git state, plan usage, commands run in the session (redacted), open todo. Do not run anything else to gather facts; the rest is in the conversation.
2. Write the note (template below) from the conversation and the facts. Every next step must be doable without Claude: exact command, file path with line, URL, or UI path — never "continue the implementation".
3. Write the local file `<dir>/<YYYY-MM-DD>-<ID or session>.md` right away (no question: local, recoverable).
4. Unless `--local-only` / `silverbullet: false`: ask once, then `put` (new) or approved overwrite of `<tasks_root>/<ID>` with the `silverbullet:notes` skill. Tokens nearly gone → skip the push, say where the local file is.
5. Reply with the local path (and page) plus the two lines a human needs first: the next step and how to resume Claude.

Note template (user's language):

```markdown
# Handover <ID> — <one-line goal>
<date time> · branch `<branch>` · plan usage 5h <p5>% (resets <time>)

## State
- [x] done items (one line each)
- [ ] in progress: <what, where it stopped>
- [ ] not started: …

## Next steps (manual)
1. <action> — `<command>` / `<file:line>` / <URL> → expected: <result>

## Verify
- `<test / check command>` → <what success looks like>

## Decisions and open questions
- <decision taken and why> · <question, who can answer>

## Git
<uncommitted files / unpushed commits from facts>; commit with `git commit -m "[<ID>] …"`, push `git push -u origin <branch>`

## Commands used in this session
<from facts, already redacted>

## Resume with Claude
`claude --resume <session id>` then: "Đọc handover <local path>, xem phần đã tick và `git log` từ <commit>, rồi làm tiếp."
```

### `runbook` — operate the daily routine by hand

1. Gather (scripts and config only): `US commands --days=30 --json` (top 30 heads), `US status`, the checklist (`checklist` in config or the default), config values for tracker sheet, logwork portal, Slack channel, SilverBullet space, repos and archive folders (URLs and paths only — never tokens), and `DA` / `US` / `node ~/.daily-assistant/bin/evolution.mjs` / `memory-sync.mjs` usage text (run each with no args).
2. For each checklist item read **only** the matching skill's `SKILL.md` and turn its steps into manual steps.
3. Write the runbook (sections below) to `<dir>/runbook.md`; show the line count, ask, then push to `runbook_page` (same rules as `task`).

Runbook sections:

| Section | Content |
|---------|---------|
| When tokens run out | Read `US status` (works without Claude), when the 5-hour and weekly windows reset, what still works (all `DA` / `US` scripts, scheduled checks, hooks) |
| Daily routine | One row per checklist item: when · manual steps · where (URL / app / file) · script command if one exists · mark to record it (`DA mark <name>`) |
| Scripts that run without Claude | Each `DA` / `US` / evolution / memory-sync / `sb.mjs` command with a one-line purpose and an example |
| Most used commands (30 days) | Head · count · redacted example · one-line purpose (yours); group by program |
| Where things live | Config, activity log, todo file, archive root, journal pages, handover folder |
| Back to Claude | Resume a session, run `/daily-assistant:human-handover resume <ID>`, record manual work with `DA mark` |

Refresh the runbook when `evolution` reports changed daily-assistant skills or scripts, or when the user asks; otherwise do not regenerate it.

### `resume <ID>` — pick a task back up

1. Read the local handover (`<dir>/*-<ID>.md`, newest) — or the SilverBullet page when the local copy is missing.
2. `US facts --task=<ID>` and `git log --oneline <commit in the note>..HEAD` to see what the human did; compare with the ticked items.
3. Summarize in ≤ 5 lines: done by hand, still open, anything that diverged from the plan. Continue from the first open step after the user agrees.

## Reminders

`statusline.mjs` queues `usage-handover` once per 5-hour window when the % reaches `usage.handover_at`; the hook shows it in the next prompt as `[daily-assistant] Reminder (…, usage-handover)`. Then: say the % in one line and offer `task` (and `runbook` if `<dir>/runbook.md` is older than 30 days or missing). Do not run either without the user's yes.

## Rules

- Never put secrets in a note or the runbook: use the redacted commands from the scripts; refer to credentials by where they live (env var name, config file), not by value.
- Facts in the note come from `US facts` or the conversation; mark guesses as guesses.
- `--dry-run`: print the note / runbook in chat only; write nothing.
