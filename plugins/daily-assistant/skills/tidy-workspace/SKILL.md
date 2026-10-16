---
name: tidy-workspace
description: Sweeps files from inbox folders into a per-task archive folder and cleans merged branches / stale worktrees in git repos. All locations are dynamic — inbox folders, archive destination layout and repos come from the archive section of the daily-assistant config, or from --inbox / --dest / --repos given at run time (e.g. a folder the user names in chat). Always shows a dry-run plan first and applies only after confirmation. Use when the user says /tidy-workspace, "dọn dẹp", "dọn workspace", "lưu trữ artifact", "clean up <folder>", or runs the end-of-day checklist.
argument-hint: "[--scope=files|git|all] [--inbox=<dir,...>] [--dest=<layout>] [--repos=<dir,...>] [--dry-run]"
user-invocable: true
---

# Tidy Workspace

## Input

`$ARGUMENTS` = `[--scope=files|git|all] [--inbox=<dir,...>] [--dest=<layout>] [--repos=<dir,...>] [--dry-run]` (scope default `all`).

## Resolve locations

Locations are never hard-coded. For each one, the first available value wins:

| Location | 1. Run-time argument | 2. Config | Notes |
|----------|----------------------|-----------|-------|
| Inbox folders | `--inbox` | `archive.inbox_dirs` | Folders to sweep (top level only) |
| Archive destination | `--dest` | `archive.layout` with `archive.root`, `archive.project` | Layout placeholders: `{root}`, `{project}`, `{task_id}`, `{yyyy}`, `{mm}` |
| Git repos | `--repos` | `archive.git.repos` | |

- A folder the user names in chat ("dọn thư mục X") is passed as `--inbox`.
- Expand `~` and environment variables; reject a location that does not exist (report, do not create inbox folders).
- `--dest` without `{task_id}` = flat destination: every moved file goes into that folder.
- Print the resolved locations as the first line of the plan.

## Files scope

The script does listing, classification and moving (`DA` — see `assistant-config` → Scripts first).

1. `DA tidy-plan [--inbox=<dir,...>] [--dest=<layout>]` → prints the resolved locations, a plan id and a numbered plan, saved to `~/.daily-assistant/tidy-plan.json`. It lists top-level files of each inbox folder (skipping `archive.ignore` and files newer than `min_age_days`) and classifies them:

   | Action | Meaning |
   |--------|---------|
   | `move` | Name contains a task ID (or flat `--dest`) → destination; name clash with a different file gets a ` (2)` suffix; `.zip` with an extracted sibling folder is noted |
   | `dup` | Identical file (size + hash) already at the destination |
   | `ask` | No task ID, `unmatched: ask` |
   | `keep` | No task ID, `unmatched: keep` |

2. Relay the plan as-is. For `ask` rows, suggest a task ID from `learn recall tidy-workspace` and the current branch; the user picks a task ID / keep / delete.
3. Ask once for confirmation (user may exclude rows). `--dry-run` stops here.
4. `DA tidy-apply --plan=<id shown in step 1> --only=<n,...> [--assign=<n>:<TASK-ID>,...] [--delete-dups]` — refuses if the saved plan is not the one the user confirmed (re-plan and confirm again); moves only the confirmed rows; `--delete-dups` only if the user approved removing duplicates, and each duplicate is re-verified (size + hash) right before deletion. Files the user chose to delete outside `dup` rows are removed one by one with explicit paths after a final confirmation.
5. `learn capture` the user's choices for `ask` rows. Report the script's summary line.

## Git scope

1. `DA git-stale [--repos=<dir,...>]` → per repo: local branches merged into `origin/<main_branch>`, local branches whose upstream is gone (both exclude the current and main branch), and worktrees whose path is missing (prunable) or whose branch is merged. It first runs `git fetch --prune`, which updates and removes stale remote-tracking refs; it does not change local branches or worktrees.
2. Relay the list; on confirmation run `git branch -d` (never `-D`), `git worktree remove` (never `--force`), `git worktree prune`. Anything refused by git stays and is reported.

## Rules

- Never touch files outside the resolved inbox folders / destination, and never delete without per-run confirmation.
- Never remove a branch with unpushed commits or a worktree with uncommitted changes.
