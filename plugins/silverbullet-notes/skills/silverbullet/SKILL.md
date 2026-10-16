---
name: silverbullet
description: Read, search, create, edit and delete notes in the user's SilverBullet space over its HTTP API — daily journal, inbox quick notes, topic pages, hashtag stats and lookup, attachments. Edits stay scoped to the agent's own sections. Use when the user mentions SilverBullet, journal, nhật ký, inbox, quick note, hashtag, second brain, or asks to save or look up something in their notes.
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
$SB tags                            # hashtag stats: pages, scope (page/item/task/para), last used
$SB tagged reading --children       # where a tag (and its tag/child tags) is used
$SB journal                         # today's journal (created from template if missing)
printf '\n- new note\n' | $SB append "Journal/2026-01-15"
$SB block "Journal/2026-01-15" my-entry entry.md   # upsert only the section owned by anchor $my-entry
$SB put "Inbox/2026-01-15/ideas" note.md   # new page; existing page needs --force
$SB upload ./shot.png "Inbox/2026-01-15/shot.png"
```

Run `$SB` with no args for full usage. Exit codes: 2 = not found, 3 = page exists (`put` without `--force`), 4 = page changed while editing, 5 = ambiguous block/adopt match, 6 = write verification failed.

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

## Hashtags

Scope follows SilverBullet rules — queries depend on them:

| Written as | Tags |
|---|---|
| frontmatter `tags: a, b` (comma **or space** separated → join words with `-`) | page |
| paragraph containing only hashtags | page |
| `#tag` line directly above text, no blank line | that paragraph |
| `- text #tag` / `- [ ] task #tag` | that item / task |

- Daily journal: tag per thought (tag glued to its paragraph, or end of a bullet/task); a standalone tag paragraph tags the whole journal page.
- Quick note (`Inbox/YYYY-MM-DD/HH-MM-SS`, the `Quick Note` command): first paragraph = page-level tags, then a blank line.
- Reuse before inventing: run `tags`. Use `/` for child tags (`topic/sub`) — tag pages show parent/child.
- Put example tags in docs inside backticks so they are not indexed. Rename/merge tags only on explicit request.
- In-page live stats: `${query[[from t = index.tags() group by t.name select {tag = name, count = #group} order by count desc]]}`; per-tag view: link `[[tag:<name>]]`.

## Workflows

**Scope rule — never touch content you were not asked to change.** Pages mix the user's writing with yours; edit only your own section.

| Goal | Command |
|---|---|
| Add an entry to a journal / page | `block <page> <id> file.md` — appends a section starting with anchor `$<id>`, closed by a `---` line |
| Update your own entry later | same `block` call with the same id — replaces only that section |
| Take over an older entry without anchor | `block <page> <id> new.md --adopt old.md` (old.md = its exact current lines) |
| Plain one-off line | `append` |
| Rewrite a whole page | `put --force` — only for pages you created entirely, or on explicit request |
| Delete | `rm` only after the user confirms the exact page — there is no trash |

- Block id: `<topic>-<YYYY-MM-DD>` (anchors are unique across the space). Block content must not contain a `---` line.
- `block` aborts if the page changed while editing, verifies the write, and prints which lines changed — report that to the user.
- Never reformat, collapse blank lines or fix typos outside your section.
- Editing inside the user's own text only on request: `download` → change just those lines → `put --force` → diff to confirm nothing else moved.
- Some Node shims print extra lines to stdout; never pipe `get` output back into `put` — use `download` to a file.

## Notes

- Write content to a temp file and pass its path — avoids shell quoting issues with multiline or non-ASCII text.
- Plain `curl` on Windows may fail with `CRYPT_E_NO_REVOCATION_CHECK` behind Cloudflare; add `--ssl-no-revoke`. The Node CLI is unaffected.
- Writes hit the server directly; open browser tabs pick them up on next sync.
