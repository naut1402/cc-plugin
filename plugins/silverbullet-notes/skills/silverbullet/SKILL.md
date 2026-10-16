---
name: silverbullet
description: Read, search, create, edit and delete notes in the user's SilverBullet space over its HTTP API — daily journal, inbox captures, topic pages, attachments. Use when the user mentions SilverBullet, journal, nhật ký, inbox, second brain, or asks to save or look up something in their notes.
user-invocable: true
argument-hint: "[what to read, find or write]"
---

# SilverBullet

All access goes through the bundled Node CLI (Node ≥ 18), which calls the SilverBullet v2 `/.fs` API with a bearer token.

## Setup (once)

Config is read from env `SB_URL` / `SB_TOKEN`, else the first existing file:

1. `<skill-dir>/config.json`
2. `~/.config/silverbullet/config.json`

Copy [config.example.json](config.example.json) and fill `url` + `token` (the server's `SB_AUTH_TOKEN`). `journalFolder` / `journalTemplate` are optional. Never commit a real `config.json`.

## Quick start

```bash
SB="node <skill-dir>/scripts/sb.mjs"
$SB ls Journal/ --limit 10          # newest pages under a prefix
$SB get "Journal/2026-01-15"        # page name = path without .md
$SB search "kafka"                  # regex, case-insensitive, titles + lines
$SB journal                         # today's journal (created from template if missing)
printf '\n- new note\n' | $SB append "Journal/2026-01-15"
$SB put "Inbox/2026-01-15/ideas" note.md   # new page; existing page needs --force
$SB upload ./shot.png "Inbox/2026-01-15/shot.png"
```

Run `$SB` with no args for full usage. Exit codes: 2 = not found, 3 = page exists (`put` without `--force`).

## Before writing

- Run `$SB ls --limit 30` once to learn the space layout (journal folder, inbox, topic pages) and follow it.
- Read a neighbouring page to match language, frontmatter and tag style.
- Do not edit `Library/` (plugs, Space Lua libraries).

## Writing conventions

| Element | Syntax |
|---|---|
| Link | `[[Page Name]]` or `[text](/Page/Path)` |
| Tag | frontmatter `tags:` or inline `#tag` |
| Task | `- [ ] item` / `- [x] item` |

Preserve frontmatter, `${...}` Lua expressions, `${query[[...]]}` blocks and ```` ```space-lua ```` fences exactly when editing.

## Workflows

| Goal | Steps |
|---|---|
| Add to today's journal | `journal` → read → `append`; to insert mid-page: `get` → edit → `put --force` |
| Edit a page | `get` first, change the full text, `put <page> <file> --force`. Never `--force` without reading — it replaces the whole page |
| Quick capture | `put "Inbox/<YYYY-MM-DD>/<HH-MM-SS>" file.md` with a `# Title` heading |
| Delete | `rm` only after the user confirms the exact page — there is no trash |

## Notes

- Write content to a temp file and pass its path — avoids shell quoting issues with multiline or non-ASCII text.
- Plain `curl` on Windows may fail with `CRYPT_E_NO_REVOCATION_CHECK` behind Cloudflare; add `--ssl-no-revoke`. The Node CLI is unaffected.
- Writes hit the server directly; open browser tabs pick them up on next sync.
