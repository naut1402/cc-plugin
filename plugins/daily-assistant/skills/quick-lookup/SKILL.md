---
name: quick-lookup
description: Gathers everything known about a task ID in one view — tracker row, GitHub issues/PRs/branches, Slack threads, Google Drive files and the local archive folder — and prints a compact summary with links. Use when the user says /quick-lookup, "tra cứu", "tìm nhanh", or asks for the status/links of a task ID like B4493 or F00297.
argument-hint: "<task-id | keyword> [--sources=tracker,github,slack,drive,local]"
user-invocable: true
---

# Quick Lookup

## Input

`$ARGUMENTS` = `<query> [--sources=<list>]`

- `<query>`: a task ID (matched by `task_id_patterns`) or free keyword. Keyword → search tracker titles first, then continue with the matched ID(s) (ask if more than 3 match).
- `--sources`: subset; default = all enabled.

## Sources (run independent lookups in parallel)

| Source | How | Show |
|--------|-----|------|
| tracker | Same read as `/my-tasks` (no "mine" filter) | title, PIC, plan/actual dates, hours, rates, status |
| github | For each `lookup.github_repos`: `gh search prs "<id>" --repo <r>`, `gh search issues "<id>" --repo <r>`; local `git branch -a --list "*<id>*"` in `archive.git.repos` | number, title, state, URL; branches |
| slack | `slack_search_public_and_private` with `"<id>"` limited to `lookup.slack_channels` (if set); newest 5 | channel, date, first line, permalink |
| drive | Drive search `name contains '<id>'` when `lookup.drive_query` | file name, type, link |
| local | `archive.layout` folder for the ID (list ≤ 15 entries) | path, newest files |

## Output

```
<ID> — <title>
Tracker : <status> · <DD/IMP/Test/AT> · <actual>/<est>h · <plan end>
GitHub  : PR #n <state> <url> …
Slack   : <channel> <date> <text…> <link>
Drive   : <name> <link>
Local   : <path> (<n> files)
```

Omit lines with no result; add `⏭️ <source> skipped (config)` for disabled ones. Read-only skill — never writes anything.
