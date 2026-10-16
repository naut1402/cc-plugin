---
name: notes
description: Read, search, create, edit and delete pages in the user's SilverBullet space over its HTTP API — any page, Inbox quick notes, attachments — with edits scoped to the agent's own sections. Use when the user mentions SilverBullet, second brain, notes, Inbox / quick note, or asks to save or look up something in their notes. For the daily journal, tasks or hashtags use silverbullet:journal, silverbullet:tasks, silverbullet:tags.
user-invocable: true
argument-hint: "[what to read, find or write]"
---

# SilverBullet notes

All access goes through the plugin's Node CLI (Node ≥ 18), which calls the SilverBullet v2 `/.fs` API with a bearer token. The other `silverbullet:*` skills use the same CLI and the rules below.

```bash
SB="node ${CLAUDE_PLUGIN_ROOT}/scripts/sb.mjs"
$SB ls Inbox/ --limit 10            # newest pages under a prefix (--all includes attachments)
$SB get "Topic/Reading"             # page name = path without .md
$SB search "kafka"                  # regex, case-insensitive, titles + lines
$SB put "Inbox/2026-01-15/09-30-00 Ideas" note.md   # new page; existing page needs --force
$SB block "Topic/Reading" my-entry entry.md         # upsert only the section owned by anchor $my-entry
$SB upload ./shot.png "Inbox/2026-01-15/shot.png"
$SB download "Topic/Reading.md" page.md             # fetch to a file for editing
```

Run `$SB` with no args for full usage. Exit codes: 2 not found · 3 page exists (`put` without `--force`) · 4 page changed while editing · 5 ambiguous match · 6 write verification failed.

## Setup (once)

Config: env `SB_URL` / `SB_TOKEN`, else the first existing file of `${CLAUDE_PLUGIN_ROOT}/config.json`, `~/.config/silverbullet/config.json` (preferred — survives plugin updates). Copy `${CLAUDE_PLUGIN_ROOT}/config.example.json`, fill `url` + `token` (the server's `SB_AUTH_TOKEN`); `journalFolder` / `journalTemplate` are optional.

The CLI stops on: a config file that exists but is not valid JSON (it never falls back to another server); a plain `http://` URL other than localhost (the token would travel unencrypted — `SB_ALLOW_HTTP=1` overrides, at the user's risk); any redirect (set the final `https` address).

User-specific conventions (terminology, layout, tag set) may come from a personal skill or a guide page in the space — follow them over the defaults here.

## Scope rule — never touch content you were not asked to change

Pages mix the user's writing with yours; edit only your own section.

| Goal | Command |
|---|---|
| Add an entry to a page | `block <page> <id> file.md` — appends a section starting with anchor `$<id>`, closed by a `---` line |
| Update your own entry | same `block` call, same id — replaces only that section |
| Take over an older entry without anchor | `block <page> <id> new.md --adopt old.md` (old.md = its exact current lines) |
| Plain one-off line | `append` |
| Rewrite a whole page | `put --force` — only for pages you created entirely, or on explicit request |
| Delete | `rm` only after the user confirms the exact page — there is no trash |

- Block id: `<topic>-<YYYY-MM-DD>` (anchors are unique across the space). Block content must not contain a `---` line.
- `block` aborts if the page changed meanwhile, verifies the write, and prints which lines changed — report that.
- Never reformat, collapse blank lines or fix typos outside your section.
- Editing the user's own text only on request: `download` → change just those lines → `put --force` → diff to confirm nothing else moved.

## Pages

- Run `$SB ls --limit 30` once to learn the layout; read a neighbouring page to match language, frontmatter and tag style.
- Quick note = `Inbox/YYYY-MM-DD/HH-MM-SS[ <title>]` (local time; what the `Quick Note` command creates). First paragraph = page-level tags only, then a blank line.
- Links `[[Page Name]]` or `[text](/Page/Path)`. Preserve frontmatter, `${...}` expressions and ```` ```space-lua ```` fences exactly. Do not edit `Library/`.
- `${query[[...]]}` runs in the browser; the CLI cannot execute Lua. SilverBullet's Runtime API (`POST /.runtime/lua`, needs Chromium on the server) can — probe with `curl -d '1 + 1'`; `503 runtime not ready` means unavailable.

## Notes

- Write content to a temp file and pass its path — avoids quoting issues with multiline or non-ASCII text.
- Some Node shims print extra lines to stdout; never pipe `get` output back into `put` — use `download`.
- Plain `curl` on Windows may fail with `CRYPT_E_NO_REVOCATION_CHECK`; add `--ssl-no-revoke`. The Node CLI is unaffected.
