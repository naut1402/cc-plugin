# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A plugin collection for Claude Code and Cursor. Plugins are **pure Markdown** — no build step, no tests, no package manager. Each plugin is a directory under `plugins/` with skills defined as `SKILL.md` files.

Quy ước git, PR, commit, và xuất tài liệu: xem [`AGENTS.md`](AGENTS.md).

## Plugin Structure

```
plugins/<plugin-name>/
  .claude-plugin/plugin.json     # Claude Code plugin manifest
  .cursor-plugin/plugin.json     # Cursor plugin manifest
  skills/<skill-name>/SKILL.md   # Skill definition
  hooks/hooks.json               # Optional: Claude Code hooks
  agents/<agent-name>.md         # Optional: agent definitions
```

### plugin.json fields

```json
{
  "name": "plugin-name",
  "description": "...",
  "version": "0.0.1",
  "author": { "name": "tttuan" },
  "license": "Apache-2.0",
  "skills": ["./skills/"],
  "userConfig": {
    "key": {
      "type": "string",
      "title": "Display title",
      "description": "Shown to user when enabling plugin",
      "default": "optional-default",
      "sensitive": true,
      "required": true
    }
  }
}
```

`userConfig` values are referenced in `.mcp.json` as `${user_config.key}`. Mark secrets with `sensitive: true` — Claude Code will mask input and store securely.

### .mcp.json

Plugins that need an MCP server include a `.mcp.json` at plugin root:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${PLUGIN_MCP_URL}", "--transport", "http-only",
               "--header", "Authorization:Bearer ${PLUGIN_MCP_TOKEN}"]
    }
  }
}
```

Two ways to inject runtime values:

- **`${user_config.<key>}`** — substituted from the `userConfig` block in `plugin.json` (Claude Code prompts for these on install). This is the preferred mechanism. A `userConfig` field accepts `type`, `title`, `description`, `default`, `sensitive`, `required` — **no `env` key** (the manifest validator rejects unrecognized keys like `"env"`).
- **`${ENV_VAR}`** — expanded from the process environment; users set the var in their shell or under `env` in Claude Code `settings.json`.

`.cursor-plugin/plugin.json` does **not** carry `userConfig` — Cursor reads its values from env vars instead, so keep the Cursor manifest minimal.

### SKILL.md frontmatter

```yaml
---
name: skill-name
description: One-line description (used for triggering)
argument-hint: "[optional hint shown in UI]"
user-invocable: true   # false = contract skill, only called by other skills
---
```

Skill body (`SKILL.md`) is written in **English** (see `.cursor/rules/cc-plugin-skill-authoring.mdc`, glob-scoped to skill files). Runtime artifacts (issue/PR text) still follow project language rules.
## Marketplace Registration

All plugins are registered in `.claude-plugin/marketplace.json`. When adding a new plugin, add an entry:

```json
{
  "name": "plugin-name",
  "description": "...",
  "source": "./plugins/plugin-name"
}
```

## Plugin Overview

| Plugin | Purpose |
|--------|---------|
| `task-memory` | Task context lifecycle: `/prepare-context`, `/init-task-memory`, `/load-domain-context`. Includes a `UserPromptSubmit` hook that auto-detects task IDs (pattern `B\d{4,5}`, `U\d{4,6}`, `F\d{3,5}`) and triggers `/prepare-context`. |
| `task-memory-serena` | Contract skills for working memory via **Serena MCP**: read/write/edit/search/delete. These are `user-invocable: false` — called internally by `task-memory`. |
| `task-memory-agentmemory` | Same contract skills as `task-memory-serena` but backed by **agentmemory MCP**. Drop-in alternative. |
| `task-memory-silverbullet` | Same contract skills backed by **SilverBullet MCP** (`silverbullet-mcp`). Notes stored as `working-memory/<key>.md`. Requires running [silverbullet-mcp](https://github.com/Ahmad-A0/silverbullet-mcp) server + `userConfig` (Claude Code) or env vars `SILVERBULLET_MCP_URL` / `SILVERBULLET_MCP_TOKEN` (Cursor). Drop-in alternative. |
| `document-writting` | Document generation skills for the 楽楽販売 PHP project: impact analysis, surveys, detail design, test matrices, document review. Uses Serena MCP to inspect a codebase at `C:\Users\tttuan\PhpstormProjects\hanbai-product`. |
| `dev-agent-teams` | Multi-agent development pipeline: investigate → design → implement → review → PR. **Config-driven** — the orchestrator reads `pipeline.yaml` (built-in default ← global `.dev-team-agent/pipeline.yaml` ← per-task `tasks/<id>/pipeline.yaml`) to decide steps, per-step agent/skill/rule-category, HITL gates and retry; no config falls back to a built-in 6-agent flow. `/init-dev-pipeline` scaffolds a dummy `pipeline.yaml` (global, or `--task=<id>` override). State + artifacts live under `.dev-team-agent/` (`.dev-state/<id>.json` + `tasks/<id>/`). Includes `/dev-dashboard` — the dashboard **app now lives in a separate repo** ([naut1402/agent-workflow](https://github.com/naut1402/agent-workflow), migrated to TS); the skill bootstraps project state (`setup.mjs`) then clones + runs that app (`$DEV_TEAM_DASHBOARD_APP`, default `~/.dev-team-dashboard/app`, run with **bun**) to read `.dev-team-agent/` and visualize pipeline state in realtime. The orchestrator's runner CLI and the `dev-team-dashboard` MCP server also resolve out of that clone. |
| `session-retrospective` | Post-task meta skills: `/distill-knowledge` (chắt lọc glossary/flow/domain, gợi ý human lưu memory) và `/analysis-working-pipeline` (phân tích session, sơ đồ suy luận, đề xuất cải tiến). Gọi thủ công — không tích hợp orchestrator. |

## Architecture: task-memory call chain

```
/prepare-context <task-id>
  └─ /init-task-memory <task-id> <task-type>
       ├─ /load-domain-context          # reads domain-<key> memories from Serena
       └─ /read-working-memory task-<id>  # or /write-working-memory if new
```

The working memory contract (`read/write/edit/search/delete-working-memory`) is fulfilled by whichever backend plugin is installed (`task-memory-serena`, `task-memory-agentmemory`, or `task-memory-silverbullet`). Only one should be active at a time.

## Adding a New Plugin

1. Create `plugins/<name>/` with the structure above.
2. Add `plugin.json` in both `.claude-plugin/` and `.cursor-plugin/`.
3. Register in `.claude-plugin/marketplace.json`.
4. Each skill lives in its own subdirectory with a single `SKILL.md`.

## Installing Plugins (for testing locally)

```bash
# Add this repo as a marketplace source
claude plugin marketplace add naut1402/cc-plugin

# Install a plugin
claude plugin add task-memory@tttuan-plugins-official
```

<!-- dev-team-agent:rules -->
## Dev Team — Tham chiếu Rule & Cấu trúc

> Orchestrator nạp các rule này qua skill `read-project-rules` ở đầu pipeline.
> Điền đường dẫn / nội dung cụ thể bên dưới. Mục có ⚠ là **bắt buộc** — pipeline sẽ dừng nếu thiếu.

### Rule coding

- [AGENTS.md](AGENTS.md) — §3 Quy ước code

### Rule viết tài liệu (doc-writing) ⚠ Bắt buộc

- [.cursor/rules/cc-plugin-doc-writing.mdc](.cursor/rules/cc-plugin-doc-writing.mdc)

### Rule trình bày (presentation)

- Phi ngôn ngữ kỹ thuật khi trình bày tài liệu điều tra, thiết kế.

### Rule viết test case

- [AGENTS.md](AGENTS.md) — §4 Test

### Rule git/PR

- [AGENTS.md](AGENTS.md) — §6 Xuất tài liệu, §7 Git hygiene

### File cấu trúc dự án

- [CLAUDE.md](CLAUDE.md) — cấu trúc plugin, marketplace, SKILL.md format.
- [AGENTS.md](AGENTS.md) — §2 Cấu trúc dự án
- `plugins/dev-agent-teams/` — orchestrator, agents.

