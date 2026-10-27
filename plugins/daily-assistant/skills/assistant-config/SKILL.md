---
name: assistant-config
description: Contract skill that loads and validates the daily-assistant personal config file (tracker, logwork, report, archive, checklist settings). Called by every daily-assistant skill before doing anything; not meant to be invoked directly.
user-invocable: false
---

# Assistant Config (contract)

Single source of per-person / per-project settings for the `daily-assistant` plugin.

## Resolve the file

1. `$DAILY_ASSISTANT_CONFIG` if set — expand a leading `~` and `$VAR` / `${VAR}` / `%VAR%`, then resolve to an absolute path (the scripts do the same).
2. Otherwise `~/.daily-assistant/config.yaml`.
3. Not found → stop the caller with:
   `⚠️ daily-assistant config not found. Run /init-daily-assistant to create it.`

Schema and defaults: [assets/config.example.yaml](assets/config.example.yaml) (commented). Missing keys fall back to the values in that file.

## Normalize

| Item | Rule |
|------|------|
| Paths (`~`, `{root}`, `{project}`) | Expand `~` to the home dir; substitute `{root}`/`{project}` in `archive.layout` (`{task_id}`, `{yyyy}`, `{mm}` are filled per file by `tidy-workspace`) |
| `logwork.user_label` | Empty → `user.name` |
| `checklist` | Empty → [assets/checklist.default.md](assets/checklist.default.md) |
| `task_id_patterns` | Compile as case-insensitive regexes; output IDs upper-cased |
| Today | Compute in `user.timezone`, not the machine clock zone |

## Feature gates

A section is **enabled** only when its required keys are non-empty. Callers check the gate and, when disabled, report `⏭️ <feature> skipped — set <keys> in config` instead of failing.

| Feature | Required keys |
|---------|---------------|
| tracker | `tracker.type != none`, `tracker.spreadsheet_id` |
| my tasks filter | `tracker.mine.values` |
| logwork | `logwork.type != none`, `logwork.url` |
| report → Slack | `report.slack.enabled`, `report.slack.channel` |
| report → SilverBullet | `report.silverbullet.enabled` |
| todo | `todo.backend` (+ `todo.google_list` for `google-tasks`) |
| memory (learn) | `memory.backend` (+ installed task-memory backend for `working-memory`) |
| memory sync | `sync.source != none` (+ SilverBullet credentials for `silverbullet`, installed task-memory backend for `working-memory`) |
| evolution | `evolution.enabled` (+ SilverBullet credentials for the page push and guides) |
| watch log | `watch.enabled`, `node` on PATH (hooks) |
| usage | `usage.enabled` not `false` (section optional); plan % needs the status line wrapper (`/usage setup`, Pro/Max plans) or a rate from another machine (`usage.per_pct`) |
| human handover | always on (section optional); SilverBullet push needs `handover.silverbullet` + SilverBullet credentials |
| watch checks | `watch.checks` non-empty |
| archive files | inbox + destination resolvable (config `archive.*` or run-time `--inbox` / `--dest`) |
| archive git | repos resolvable (config `archive.git.repos` or run-time `--repos`) |

## Scripts first (token budget)

Deterministic work runs in Node scripts, not in the model. The SessionStart hook keeps a stable copy at `~/.daily-assistant/bin/`; skills call it as:

`DA` = `node ~/.daily-assistant/bin/daily-assistant.mjs`

| Command | Replaces |
|---------|----------|
| `DA brief` | Reading log, todo file and marks to say "what needs doing now" (≤ 8 lines) |
| `DA check [all\|<id>] [--verbose]` | Evaluating watch checks; prints only problems, exit 1 if any |
| `DA today [date] [--json]` | Summarizing the activity log (active time per task) |
| `DA mark <name> [note] [--date=D]` | Appending end-of-day marks (`--date` files the mark under the day that was actually checked) |
| `DA todo list\|add\|done\|undo` | Editing the todo file (file backend) |
| `DA commits [date]` | Collecting own commits by task |
| `DA tidy-plan` / `DA tidy-apply --plan=<id>` | Classifying and moving inbox files (apply is bound to the plan id the user confirmed) |
| `DA git-stale` | Finding merged / gone branches and stale worktrees (runs `git fetch --prune`) |
| `DA schedule show\|install\|remove` | OS-level schedule for checks (no Claude session needed) |
| `node ~/.daily-assistant/bin/memory-sync.mjs status\|plan\|apply\|commit` | Three-way compare / merge of memory, persona and config sections with the sync hub (`sync-memory`) |
| `node ~/.daily-assistant/bin/evolution.mjs scan\|diff\|snapshot\|page` | Inventory of capabilities and learned memory, diff against the last snapshot, profile page render / push (`evolution`) |
| `node ~/.daily-assistant/bin/usage.mjs status\|day\|rate\|budget\|spent\|phase\|task\|estimate\|commands\|facts\|setup` | Reading transcripts for tokens, calibrating tokens per 1% of plan usage, % ↔ token budgets, per-session / per-subagent spend, per-phase samples, per-task history and estimates (S/M/L, time under the limits), shell-command stats, handover facts (`usage`, `human-handover`) |
| `~/.daily-assistant/bin/statusline.mjs` (status line, not called by skills) | Sampling plan usage % on every status line refresh; queues the `usage-handover` reminder |

Rules:

- Use the script output as-is; do not re-read the underlying files to "double check".
- Read raw files only for what the script does not cover (judgment, wording, external systems).
- If `~/.daily-assistant/bin/` is missing (hook has not run yet), fall back to `node ${CLAUDE_PLUGIN_ROOT}/scripts/daily-assistant.mjs`.

## Rules for callers

- Never write secrets into the config; tokens stay in MCP / env settings.
- Read-only toward the config: only `/init-daily-assistant` creates it; edits are done by the user (or by a skill only after explicit user approval).
- Any write to an external system (sheet, portal, Slack, journal, file move/delete) requires showing the exact change and getting user confirmation first.
