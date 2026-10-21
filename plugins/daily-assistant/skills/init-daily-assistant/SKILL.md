---
name: init-daily-assistant
description: Creates or updates the daily-assistant personal config file (~/.daily-assistant/config.yaml) — either bootstrapped from a sync hub (SilverBullet or working memory) or by interviewing the user about their task tracker, logwork portal, report destinations and archive folders. Use on first install, on a new machine, when moving to a new project, or when the user says /init-daily-assistant.
argument-hint: "[--force] [--from=silverbullet|working-memory|none] [--section=persona|user|tracker|logwork|report|lookup|todo|archive|memory|sync|evolution|watch]"
user-invocable: true
---

# Init Daily Assistant

Scaffold the personal config consumed by every `daily-assistant` skill. Template (canonical, commented): [../assistant-config/assets/config.example.yaml](../assistant-config/assets/config.example.yaml).

## Input

`$ARGUMENTS` = `[--force] [--from=<source>] [--section=<name>]`

- none: create the file if missing; if it exists, show a summary of enabled/disabled features and stop.
- `--force`: rebuild the whole file from the template (keep current values as defaults in the interview).
- `--section=<name>`: re-run the interview for one section only and patch it in place.
- `--from=<source>`: answer the "start from" question (step 2) up front.

## Steps

1. Resolve target path as in `assistant-config` (`$DAILY_ASSISTANT_CONFIG` or `~/.daily-assistant/config.yaml`).
2. **Start from** — when the target is missing or `--force` is given, ask first (skip with `--from`):

   | Option | Next |
   |--------|------|
   | Sync from SilverBullet | [Bootstrap from a hub](#bootstrap-from-a-hub) with `sync.source: silverbullet` |
   | Sync from working memory | [Bootstrap from a hub](#bootstrap-from-a-hub) with `sync.source: working-memory` |
   | Fresh setup (no sync) | Steps 3–6 with `sync.source: none`; the `sync` section can be set later with `--section=sync` |

   Recommend a sync option when the user already uses the assistant on another machine.
3. Nothing is written before step 5. Build the proposal in memory:
   - target missing → start from the template;
   - `--force` → start from the template, current values used as interview defaults;
   - `--section=<name>` → start from the current file and replace only that top-level section; every other line stays byte-for-byte.
   - target exists and no flag → print the feature-gate table (step 5) and stop.
4. Interview the user per section — ask only what cannot be detected; batch questions (max 4 per round):

   | Section | Ask / detect |
   |---------|--------------|
   | persona | assistant name, personality (free text), tone, how it addresses the user and itself, emoji level; optional alias slug (see below) |
   | user | name, email (default: `git config user.email`), hours per day |
   | tracker | sheet URL → extract `spreadsheet_id`; the URL `gid` is a numeric sheet id, not a tab name — resolve it to the matching tab's title from the spreadsheet metadata (ask the user for the tab name if metadata is unavailable); read header row with the Google Sheets MCP and propose the `columns` mapping; ask which PIC values mean "mine" |
   | logwork | portal URL; user label in the portal; browser tool |
   | report | Slack channel + draft/send; SilverBullet on/off; repos to scan |
   | lookup | GitHub repos (default: remotes of `report.sources.git_repos`), Slack channels |
   | todo | backend (`file` / `silverbullet` / `google-tasks`); file path or Google Tasks list name |
   | archive | default inbox dirs, archive root, project folder (list sub folders of root to pick from); remind that `/tidy-workspace` can override locations per run |
   | memory | backend (`file` / `working-memory`), patterns never to learn |
   | sync | source (`none` / `silverbullet` / `working-memory`) — check the prerequisite below; scopes, config sections, machine label. After enabling on an existing config, offer `/daily-assistant:sync-memory status` |
   | watch | capture options (prompts off by default), required marks, check times, autostart |
   | evolution | on/off; profile page and guide folders on SilverBullet; whether guides may upload credential files; journal heading; tracked projects (default: projects with Claude memory). After enabling, run `/daily-assistant:evolution review` once to create the baseline |

5. Show the diff between the current file (or empty) and the proposal; write only after the user confirms (create the parent dir then).
6. Print the feature-gate table (enabled / skipped + missing keys) and suggest `/end-of-day` as the next command.

## Bootstrap from a hub

Reuse persona, learned memory and shared config from the user's other machines instead of re-interviewing.

1. Prerequisite — stop with the fix if missing:
   - `silverbullet`: env `SB_URL` / `SB_TOKEN` or `~/.config/silverbullet/config.json` (set up via the `silverbullet` plugin);
   - `working-memory`: an installed task-memory backend (`read/write/search-working-memory`).
2. Ask only the sync keys: `silverbullet_root` / `working_memory_prefix` (defaults from the template), machine label, scopes.
3. Write the template with that `sync` section (diff + confirm as in step 5).
4. Run `/daily-assistant:sync-memory pull`: hub sections and memory replace the template defaults; deletions are not expected on a fresh file.
   Hub empty (first machine) → say so and continue with the fresh interview; the next `/sync-memory` publishes this machine's setup.
5. Interview only what the hub did not provide: machine-local sections (`report` repos, `archive`, `watch`, `memory.dir`, `checklist`) and any synced section the hub lacked. Patch each with the `--section` rules (other lines unchanged).
6. Persona came with `alias_agent` set → generate the alias agent (below). Finish with step 6.

## Persona alias agent

The plugin agent is always `daily-assistant:assistant` (start with `claude --agent daily-assistant:assistant`); `persona.name` changes how it presents itself. To also **start it by the new name**, set `persona.alias_agent: <slug>` and generate a user-level agent:

1. Read the plugin agent file `../../agents/assistant.md` (relative to this skill directory).
2. Write `~/.claude/agents/<slug>.md`: frontmatter first (the file must start with `---`): `name: <slug>`, `description` with `persona.name` prepended, same plugin-qualified `skills` list (`daily-assistant:<skill>`). Immediately after the closing `---`, the marker line `<!-- generated by /init-daily-assistant from daily-assistant:assistant; re-run --section=persona after plugin updates -->`, then the same body.
3. Refuse to overwrite an existing file without that marker. Show the path and `claude --agent <slug>` when done.
4. Clearing `alias_agent` → offer to delete the generated file (only if it has the marker).

## Notes

- Do not store tokens or passwords; authentication stays in MCP servers or the browser session.
- A user may keep several configs (one per project) and switch with `DAILY_ASSISTANT_CONFIG`.
