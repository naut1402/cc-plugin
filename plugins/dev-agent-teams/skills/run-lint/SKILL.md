---
name: run-lint
description: Run the project lint/static-analysis tool declared in project rules and write lint.md. Reference skill — opt-in via step skills (not in the default pipeline).
user-invocable: false
---

# Run Lint

Generic contract for static analysis / lint after implement. The **tool, command, and language** are project-specific — do not assume a particular linter.

## Opt-in

Default pipeline does **not** include this skill. Enable via per-task or global `pipeline.yaml` on the `implementer` step:

```yaml
skills: [coding-rules, run-lint]
produces: [lint.md]
```

## Resolve the tool from project rules

1. Read `.dev-team-agent/project-rules.md` (filled by orchestrator from `AGENTS.md`, `CLAUDE.md`, and project rule files).
2. Use the **coding / lint / static analysis** section: tool name, CLI command, scope (changed files vs whole project), baseline policy if any.
3. If that section is missing or empty: skip running a tool, write `lint.md` with status `SKIPPED` and note that project rules did not declare a lint command. Do not invent a tool.

## Run and fix

- Prefer analyzing **files changed in this task** when the project rules allow it.
- Goal: **0 new errors** vs the base branch (`main` unless rules say otherwise).
- Do not require fixing pre-existing issues outside task scope.
- If a new finding cannot be fixed without breaking logic: list it under Known issues in `lint.md` with a short reason.

## Format `lint.md`

```markdown
# Lint Report — <task-id>

## Tool
- Name: <from project-rules>
- Command: <exact command run>
- Scope: <paths or "project">

## Result
- New errors: <count>
- Pre-existing errors: <ignored count or n/a>
- Status: CLEAN / HAS_NEW_ERRORS / SKIPPED

## New errors (if any)
| File | Line | Message | Fixed? |
|---|---|---|---|
| path/file.ext | 42 | … | ✅ |

## Known issues (unfixed in scope)
<Why it cannot be fixed in this task>
```
