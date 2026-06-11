# cc-plugin

Plugin collection for Claude Code and Cursor — task memory management, domain context, and working memory skills.

## Plugins

| Plugin | Description |
|--------|-------------|
| `task-memory` | Init, load context, lookup knowhow/terms, search |
| `task-memory-serena` | Working memory skills via [Serena MCP](https://github.com/oraios/serena) |
| `task-memory-agentmemory` | Working memory skills via agentmemory MCP |
| `task-memory-silverbullet` | Working memory skills via SilverBullet MCP |
| `dev-agent-teams` | Multi-agent pipeline: investigate → design → implement → review → PR |
| `session-retrospective` | Post-task: `/distill-knowledge`, `/analysis-working-pipeline` |

## Installation

<details>
<summary>Claude Code</summary>

**1. Add marketplace**

```bash
claude plugin marketplace add naut1402/cc-plugin
```

**2. Enable a plugin**

```bash
claude plugin add task-memory@tttuan-plugins-official
```

**Skills**

| Plugin | Skills |
|--------|--------|
| `task-memory` | `/init-task-memory`, `/prepare-context`, `/load-domain-context`, `/lookup-knowhow`, `/lookup-term`, `/search-task-memory` |
| `task-memory-serena` | `/read-working-memory`, `/write-working-memory`, `/edit-working-memory`, `/search-working-memory`, `/delete-working-memory` |
| `task-memory-agentmemory` | Same skills as `task-memory-serena`, backed by agentmemory MCP |
| `dev-agent-teams` | `/dev-team-orchestrator`, `/doc-review`, reference skills (coding-rules, write-design, ...) |
| `session-retrospective` | `/distill-knowledge`, `/analysis-working-pipeline` |

</details>

<details>
<summary>Cursor</summary>

Install via the Cursor marketplace panel, or link locally for development:

```bash
ln -s /path/to/cc-plugin/plugins/task-memory ~/.cursor/plugins/local/task-memory
```

Then reload Cursor (`Developer: Reload Window`).

See [Cursor plugin docs](https://cursor.com/docs/plugins) for details.

**SilverBullet MCP backend** (`task-memory-silverbullet`):

1. Clone and start [silverbullet-mcp](https://github.com/Ahmad-A0/silverbullet-mcp) (`docker-compose up --build` → MCP at `http://localhost:4000/mcp`).
2. Set env vars (Cursor: Settings → MCP, or shell):
   - `SILVERBULLET_MCP_URL=http://localhost:4000/mcp`
   - `SILVERBULLET_MCP_TOKEN=<MCP_TOKEN from silverbullet-mcp .env>`
3. Reload Cursor (`Developer: Reload Window`).

</details>

## License

Apache-2.0
