---
name: evolution
description: Tracks how the agent evolves — capabilities (plugins, MCP servers, skills, agents, hooks, rules, CLI tools) added, changed or removed, what it learned per project (Claude Code auto memory, learn knowledge) and about the master (habits, working preferences, portrait). Writes the day's changes into the journal, keeps a generated profile page on SilverBullet and writes per-tool integration guides (install, login, credentials, usage). Use when the user says /evolution, "năng lực mở rộng", "đã cài thêm gì", "học được gì", "hồ sơ agent", "trang profile", "đóng gói tool", "hướng dẫn tích hợp", or during the end-of-day checklist.
argument-hint: "[review|show|page|guide <tool>] [--since=YYYY-MM-DD] [--dry-run]"
user-invocable: true
---

# Evolution

Inventory, diffs and page rendering run in a Node script; the model explains changes, writes the wording and asks before every external write.

`EV` = `node ~/.daily-assistant/bin/evolution.mjs` (fallback `node ${CLAUDE_PLUGIN_ROOT}/scripts/evolution.mjs`). Run `EV` with no args for full usage.

## Config

Section `evolution` (see `assistant-config`). Gate: `evolution.enabled`; off → `⏭️ evolution skipped — set evolution.enabled` and stop.

| Key | Meaning |
|-----|---------|
| `silverbullet_page` | Generated profile page (overwritten on every push) |
| `tools_root` | Folder of per-tool guide pages |
| `credentials_root` | Folder for credential attachments of guides |
| `upload_credentials` | `true` = guides may upload credential files (still asks each time) |
| `journal_section` / `journal_block` | Heading and block id prefix of the day's entry (`<journal_block>-<date>`) |
| `projects` | Repos whose rules / project skills are tracked; empty = projects that have Claude memory |
| `language` | Page labels (`vi` / `en`); empty = `persona.language` |

## What the script sees

| Kind | Source |
|------|--------|
| plugin, plugin skill / agent / MCP / hook | `~/.claude/plugins/installed_plugins.json` + each install path; `enabledPlugins` in `~/.claude/settings.json` |
| mcp | `mcpServers` in `~/.claude.json` (user and per project) — name and command / host only |
| skill, agent, rule, hook (user) | `~/.claude/skills`, `~/.claude/agents`, `~/.claude/*.md`, `~/.claude/rules`, hooks in `~/.claude/settings.json` |
| rule, skill (project) | `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules`, `.claude/commands`, `.claude/skills` of each tracked project |
| tool | `uv tool` installs, global npm packages |
| learned | `~/.claude/projects/*/memory/*.md` grouped by project (type `user` / `feedback` = about the master); `learn` profile and knowledge (`memory.backend: file`) |

Snapshots (`~/.daily-assistant/evolution/snapshots/<date>.json`) hold names and hashes only.

## Commands

| `$ARGUMENTS` | Effect |
|--------------|--------|
| `review` (default) | Flow below; the end-of-day checklist item |
| `show` | `EV scan`, plus the page path / last snapshot date. Read-only |
| `page` | `EV page`, show the line count, ask, then `EV page --push` |
| `guide <tool>` | Write or update the tool's guide page (below) |

## Review flow

1. `EV diff [--since=…]`. Exit 2 (no baseline) → `EV snapshot`, say "baseline created", go to step 6.
2. Nothing changed → say so, go to step 6.
3. Draft the journal entry, in the user's language:
   - One bullet per added / changed / removed capability: **what**, **what it is for**, **how to use it** (one line). Take facts from the skill description, the plugin README or the guide page — read only the items in the diff. Link the guide page when one exists.
   - Learned: new entries grouped by project, one short line each; master-related ones (`user`, `feedback`, habits) under their own sub-heading.
4. If master-related entries changed, propose an updated portrait: 3–6 bullets (working style, communication, priorities, red lines), each traceable to entries. Current text: `~/.daily-assistant/evolution/portrait.md`.
5. Show the draft (and portrait diff), ask once, then on approval:
   - Journal: through the `silverbullet:journal` skill, `log <journal_block>-<date> "<journal_section>: <one-line gist>" --detail <entry file>`, entry starting with heading `## <journal_section>` (detail page when the journal is two-tier, summary line in today's journal). No SilverBullet plugin → print the block in chat.
   - Portrait: write `portrait.md`.
6. `EV snapshot` (unless `--dry-run`), then `EV page --push` after confirmation (one question may cover step 5 and this push).
7. Each added tool / MCP without a guide → offer `guide <tool>` (one question listing them).

## Guide flow

Page `<tools_root>/<Tool name>`, user's language, frontmatter `covers: [<ids from EV scan --json: mcp id, uv:/npm: tool id, plugin id>]` so the profile page links it.

Sections: purpose and source (repo, license, version, install date) · install on a new machine · login / credentials · connect to AI tools · common commands · uninstall · caveats (unofficial API, expiry).

Credentials:

- Never paste secret values into page text.
- Upload credential files as attachments under `<credentials_root>/<tool>/…` only when `upload_credentials: true` **and** the user confirms this upload; list the exact files first.
- Document the restore command (e.g. import from file) and how to re-login when the stored copy has expired.
- A credential protected by an OS keystore cannot be moved — say so instead of uploading.

Write with the silverbullet plugin (`put` for a new page, `block` / approved full rewrite for an existing one; `upload` for attachments) after showing the page.

## Rules

- The profile page is generated: never hand-edit it; change the script output or `portrait.md`.
- Facts in bullets come from files or tool output; mark guesses as such.
- Do not copy memory content beyond its one-line description into the journal.
- `--dry-run`: run `EV diff` / `EV page` only; no snapshot, no writes.
