---
name: tasks
description: List, add and tick tasks (checkbox items) in the user's SilverBullet space — open/done tasks by tag or page, adding a task to today's journal to-do list, marking a task done or reopening it, changing exactly one line. Use when the user mentions task, todo, to-do, việc cần làm, việc chưa xong, đánh dấu xong, or asks what is left to do.
user-invocable: true
argument-hint: "[list | add <text> | done <what>]"
---

# SilverBullet tasks

Same CLI and scope rule as silverbullet:notes.

```bash
SB="node ${CLAUDE_PLUGIN_ROOT}/scripts/sb.mjs"
$SB tasks --tag reading --limit 20                               # open tasks as page:line [state] text
$SB tasks --page Journal/ --all                                  # --done / --all, --page prefix
$SB task add "Read chapter 3 #reading"                           # end of "## To-do list" in today's journal
$SB task add "Call the shop" --page "Projects/Move" --section "## Todo"
$SB task done "Journal/2026-01-15:7" --expect "Read chapter 3"   # tick exactly that line; --undo reopens
```

## Syntax (as SilverBullet parses it)

List item + non-empty `[state]` + space: `- [ ] open`, `- [x] done`, custom `- [IN PROGRESS] …` (no `:` in states). `- []` and `- [text](url)` are not tasks. A `#tag` inside the task line tags that task.

## Workflow

| Request | Do |
|---|---|
| What is left / tasks by topic | `tasks` (+ `--tag`, `--page`, `--limit`). The journal template and `Template/` pages are skipped |
| Add a task | `task add "<text> #tag"` — one line at the end of the section's list; today's journal is created if needed. Section missing → exit 2: ask, don't invent structure |
| Tick / reopen | `tasks` to get `page:line`, then `task done <page:line> --expect "<distinctive words>"` (`--undo` reopens) |

- `task add` / `task done` change exactly one line, abort if the page changed meanwhile (exit 4) or the line no longer matches (exit 5 — re-run `tasks`), and verify the write.
- Report `page:line` of what you changed.
- Routine tasks copied into every journal from the template are not backlog — leave them out of summaries.
