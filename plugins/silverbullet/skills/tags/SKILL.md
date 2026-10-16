---
name: tags
description: Hashtags in the user's SilverBullet space — tag statistics (pages, scope, last used), finding where a tag or its child tags are used, choosing tags for new notes, tag scope rules, live tag queries, and tag clean-up (renames/merges on request). Use when the user mentions hashtag, tag, #tag, thống kê tag, gắn tag, or asks which tag to use.
user-invocable: true
argument-hint: "[stats | find <tag> | which tag for …]"
---

# SilverBullet tags

Same CLI and scope rule as silverbullet:notes.

```bash
SB="node ${CLAUDE_PLUGIN_ROOT}/scripts/sb.mjs"
$SB tags                             # tag, pages, scopes (page/item/task/para/heading), last used
$SB tags --prefix Journal/ --sort recent
$SB tagged reading --children        # every use of #reading and #reading/...
$SB tagged reading --scope task
```

## Scope (SilverBullet rules — queries depend on them)

| Written as | Tags |
|---|---|
| frontmatter `tags: a, b` (comma **or space** separated → join words with `-`) | page |
| paragraph containing only hashtags | page |
| `#tag` line directly above text, no blank line | that paragraph |
| `- text #tag` / `- [ ] task #tag` | that item / task |

Hashtags cannot contain whitespace or `!@#$%^&*(),.?":{}|<>\`, nor be digits only. Tags in code and `${...}` are not tags.

## Choosing tags

1. If the space has a tag guide page (ask, or search "hashtag"), follow it; update its tables when a new tag becomes common.
2. Reuse before inventing — check `tags`. New tags: lowercase, words joined by `-`, `/` for children (`topic/sub`; tag pages show parent/child).
3. One topic tag + at most one type tag per note.
4. In docs, put example tags in backticks so they are not indexed.

## Live views in pages

- Stats: `${query[[from t = index.tags() group by t.name select {tag = name, count = #group} order by count desc]]}`
- Per tag: link `[[tag:<name>]]` — the built-in tag page lists pages, tasks, items, paragraphs and child tags.

## Clean-up (renames / merges)

Only on explicit request. Show a dry-run first (old → new per `page:line`), back up the pages, change only the tag tokens (outside code and `${...}`), drop a duplicate created by the rename on the same line, then diff every page against the backup and confirm with `tagged <old>` → no matches. Check for queries or `[[tag:…]]` links using the old name.
