---
name: todo
description: Manages the user's personal to-do list — list, add, complete, reopen, edit, reschedule, remove, and review open items — on the backend set in config (local Markdown file, SilverBullet tasks, or Google Tasks). Use when the user says /todo, "todo", "việc cần làm", "nhắc tôi", "thêm việc", "đánh dấu xong", or asks what is left to do today.
argument-hint: "[list|add|done|undo|edit|move|rm|review] [args] [--all] [--dry-run]"
user-invocable: true
---

# Todo

Backend and location come from `todo.*` in the config (see `assistant-config`).

| `todo.backend` | Storage | How |
|----------------|---------|-----|
| `file` (default) | `todo.file` (default `~/.daily-assistant/todo.md`) | `DA todo list [--all]`, `DA todo add "<text>" [--due=YYYY-MM-DD] [--p=high\|low]`, `DA todo done <n>`, `DA todo undo <n>` (numbers are stable file positions). Edit the file directly only for `edit` / `move` / `rm` / `review` |
| `silverbullet` | Checkbox items in the user's SilverBullet space | Load `silverbullet:tasks` (+ `silverbullet-personal`) and follow its rules — add to today's journal to-do list, tick/untick exactly one line |
| `google-tasks` | Task list named `todo.google_list` | Google Tasks tools (`list_tasks`, `get_task`, `manage_task`) |

## Item format (file backend)

```markdown
- [ ] <text> #<TASK-ID> 📅 2026-10-17 ⏫
- [x] <text> ✅ 2026-10-16
```

- `#<TASK-ID>` optional; auto-added when the text contains an ID matching `task_id_patterns`.
- `📅 <date>` due date; `⏫` high / `🔽` low priority (optional).
- `✅ <date>` completion date, written when ticked.
- New file → header `# Todo` then items. Completed items older than `todo.keep_done_days` move under `## Done` at the end of the file during `review`.

## Commands

`$ARGUMENTS` = `<command> [args] [--all] [--dry-run]`. No command → `list`.

| Command | Example | Effect |
|---------|---------|--------|
| `list` | `/todo list --all` | Open items grouped: overdue → today → upcoming → no date; `--all` adds done items. Number each item for later commands |
| `add <text> [due=<date>] [p=high\|low]` | `/todo add review PR F00284 due=tomorrow` | Append one item. Natural dates (`today`, `tomorrow`, `thứ 6`, `next mon`) resolve in `user.timezone` |
| `done <n\|text>` | `/todo done 2` | Tick item; add completion date |
| `undo <n\|text>` | `/todo undo 2` | Reopen item |
| `edit <n> <field>=<value>` | `/todo edit 3 text="..." due=2026-10-20` | Change text / due / priority |
| `move <n\|all-overdue> <date>` | `/todo move all-overdue tomorrow` | Reschedule |
| `rm <n>` | `/todo rm 4` | Delete item (always confirm) |
| `review` | `/todo review` | End-of-day pass: show today's done items, ask per open overdue/today item → done / move (default tomorrow) / keep / drop; then archive old done items and run `DA mark todo-reviewed`. Items the user moves repeatedly → `learn capture` |

## Rules

- Resolve `<n>` against the numbering of the latest `list` in this session; if no list was shown or text matches several items, show candidates and ask.
- Change exactly the targeted lines; never reorder or reformat other items or content around them.
- Show `before → after` for `edit`, `move`, `rm`, and `review` changes; write after confirmation (`add`/`done`/`undo` apply directly and echo the line). `--dry-run` never writes.
- Backend unreachable → say so and stop; do not silently fall back to another backend.
