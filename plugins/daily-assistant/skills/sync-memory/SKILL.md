---
name: sync-memory
description: Syncs the daily assistant's learned memory (habits and knowledge), persona and chosen config sections between assistants and machines through the hub set in sync.source — a SilverBullet space or the installed task-memory working-memory backend. Two-way, three-way merge against a per-machine base, entry-level merge for memory lists, asks the user on every conflict and deletion. Use when the user says /sync-memory, "đồng bộ bộ nhớ", "sync memory", "đồng bộ persona / config sang máy khác", or when /init-daily-assistant bootstraps a new machine from a hub.
argument-hint: "[status|sync|pull] [--scope=memory,persona,config] [--source=silverbullet|working-memory]"
user-invocable: true
---

# Sync memory

Comparison and file work run in a Node script; the model explains the plan, asks about conflicts and, for the working-memory source, moves pages through the contract skills.

`MS` = `node ~/.daily-assistant/bin/memory-sync.mjs` (fallback `node ${CLAUDE_PLUGIN_ROOT}/scripts/memory-sync.mjs`). Run `MS` with no args for full usage.

## Config

Section `sync` of the config (see `assistant-config`); loaded and validated by `assistant-config`.

| Key | Meaning |
|-----|---------|
| `sync.source` | `none` (feature off) / `silverbullet` / `working-memory` |
| `sync.scopes` | Subset of `memory`, `persona`, `config` |
| `sync.config_sections` | Top-level sections synced by `config` (`sync` itself never is) |
| `sync.silverbullet_root` / `sync.working_memory_prefix` | Where items live on the hub |
| `sync.machine` | Label printed in plans; default hostname |

`sync.source: none` → reply `⏭️ memory sync skipped — set sync.source with /init-daily-assistant --section=sync` and stop.

## What is synced

| Scope | Local | Hub path (under root / prefix) | Merge unit |
|-------|-------|--------------------------------|-----------|
| `memory` | `memory.dir`: `profile.md`, `knowledge/*.md` (`inbox.md` with `include_inbox`) | `memory/...` | Per entry id (`- [h-007] …`); counter-only changes (`seen N×, last D`) auto-merge |
| `persona` | `persona:` section of the config | `config/persona.md` (yaml block) | Whole section |
| `config` | each section in `sync.config_sections` | `config/<section>.md` | Whole section |

`memory` is skipped when `memory.backend` is `working-memory` (already shared). SilverBullet credentials: env `SB_URL` / `SB_TOKEN` or `~/.config/silverbullet/config.json` (silverbullet plugin); missing → point to that plugin's setup, never store a token in this config.

## Commands

| `$ARGUMENTS` | Effect |
|--------------|--------|
| `status` | `MS status` — what would change, nothing saved |
| `sync` (default) | Flow below |
| `pull` | Flow below with `--pull-only` on plan (nothing is written to the hub) and `--prefer=remote` on apply (hub wins every conflict). Used by `init-daily-assistant` to bootstrap a machine; `keep` lines = local sections the hub does not have yet (template defaults on a fresh config) |

## Flow — source `silverbullet`

1. `MS plan [--scope=…]` → plan id, one line per changed item, conflicts with diffs (`--verbose` also lists in-sync items).
2. Nothing to do → report "in sync", stop.
3. Summarize counts per action, then every `conflict` and `delete-*` item.
4. For each conflict ask the user (one question per item, show the diff lines). Skip this step for `pull` unless the user wants to review.

   | Choice | Flag |
   |--------|------|
   | Keep this machine's version | `--resolve=<item>=local` |
   | Keep the hub's version | `--resolve=<item>=remote` |
   | Keep both entries (memory lists only; hub entry gets a new id) | `--resolve=<item>#<key>=both` |
   | Leave for later | `--resolve=<item>=skip` |

   Entry conflicts can be resolved per key (`<item>#h-002=…`) or all at once (`<item>=…`).
5. Deletions (`delete-local` / `delete-remote`) run only with `--allow-delete`; ask once with the exact item list.
6. `MS apply --plan=<id> [--resolve=…] [--prefer=…] [--allow-delete] [--skip=<item>,…]` → report its output as-is.
   - Exit 3 = changed since the plan → plan again; never retry the old id. Exit 4 = another sync is running.
   - `blocked` = content looks like a secret → name the item; do not work around it.
   - Note about `alias_agent` → suggest `/daily-assistant:init-daily-assistant --section=persona`.

## Flow — source `working-memory`

The script cannot call MCP, so the hub is mirrored through a staging folder.

1. Make an empty staging dir (scratchpad if available, else a new temp dir).
2. `search-working-memory <prefix>` (with `--prefix=<prefix>/` when the backend supports it; high `--limit`) → keys starting with `<prefix>/`. For each, `read-working-memory <key>` and write the content exactly to `<stage>/<key without "<prefix>/">.md`.
3. Run the SilverBullet flow, adding `--remote-dir=<stage>` to `plan` (apply reuses it).
4. Each `REMOTE-WRITE <path>` → `write-working-memory <prefix>/<path without .md> --content=<file content> --mode=replace`.
5. `REMOTE-DELETE <path>` → the contract has no single-key delete; list them for the user to remove by hand.
6. `MS commit --plan=<id> [--failed=<path>,…]`. Uncommitted items are pushed again next time.

With the `task-memory-silverbullet` backend keys live per project folder; prefer `sync.source: silverbullet` there.

## Rules

- Never pick a conflict side or pass `--allow-delete` for the user; learned habits are not consent. `pull` is consent to "hub wins" only.
- Only `apply` / `commit` write; never hand-edit memory files, config sections or hub pages to fix a plan.
- Base copies live in `~/.daily-assistant/sync/state/`; deleting them makes every difference look "never synced" (conflicts, no data loss).
- Hub pages may be edited in SilverBullet; the next sync pulls them. In `config/*.md` only the yaml block is read.
