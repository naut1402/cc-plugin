# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is (dev/run model)
This repo is a **pure Markdown + JSON plugin collection** for Claude Code and Cursor. There is **no build step, no test framework, and no package manager** (no `package.json`, `requirements.txt`, `Makefile`, or lockfiles). "Developing" means editing `SKILL.md` files and JSON manifests; "running" means the plugins are loaded by a host (Claude Code / Cursor). Nothing in this repo starts a long-running server. See `CLAUDE.md` and `README.md` for plugin structure and install commands.

### Toolchain
The base image already provides everything needed: `node` (v22), `jq`, and `npx`. There are no dependencies to install, so the startup update script is intentionally a no-op.

### The only runnable code / "lint"-equivalent checks
- **Manifest validity is the real integrity check.** Since a plugin host parses the JSON, validate every manifest parses:
  `for f in $(find . -path ./.git -prune -o -name "*.json" -print); do jq empty "$f" || echo "INVALID $f"; done`
- **`setup.mjs`** (`plugins/dev-agent-teams/skills/dev-dashboard/scripts/setup.mjs`) is the only executable script. It uses Node built-ins only (no `npm install`). Run against a throwaway dir to avoid mutating this repo's own `.gitignore`/`CLAUDE.md`:
  `node plugins/dev-agent-teams/skills/dev-dashboard/scripts/setup.mjs "$(mktemp -d)"`
  It is idempotent (skips already-scaffolded `pipeline.yaml` / `CLAUDE.md`). NOTE: run in the *current* repo root it will append a rules section to this repo's `CLAUDE.md` and add `.dev-team-agent/` to `.gitignore` — use a temp dir when only testing.
- **`task-memory` hook** (`plugins/task-memory/hooks/hooks.json`) is a `jq`/`grep`/`tr` shell one-liner that detects task IDs (`[BUF][0-9]{3,6}`, case-insensitive) from the prompt JSON on stdin and emits `additionalContext`. Test it by piping `{"prompt":"...b1234..."}` into the extracted command.

### External / optional services (NOT needed to develop this repo)
- The **dev-team dashboard app** lives in a separate repo (`naut1402/agent-workflow`, run with `bun`) — not present here.
- **Working-memory MCP backends** (Serena / agentmemory / SilverBullet) are external servers, only relevant when exercising `task-memory*` skills inside a host. Only one should be active at a time.

### Known pre-existing inconsistency (do not "fix" as part of setup)
`.claude-plugin/marketplace.json` references a `document-writting` plugin at `./plugins/document-writting`, but that directory does not exist in the repo. This is pre-existing and unrelated to environment setup.
