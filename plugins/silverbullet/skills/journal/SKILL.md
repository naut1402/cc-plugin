---
name: journal
description: Read and write the daily journal in the user's SilverBullet space — today's journal page (created from the journal template when missing), entries, attachments for a day, plus related open tasks from earlier journals, project and goal pages. Use when the user mentions journal, nhật ký, today's journal, daily note, or wants something written into / read from a day's journal.
user-invocable: true
argument-hint: "[YYYY-MM-DD] [what to read or write]"
---

# SilverBullet journal

Same CLI and scope rule as silverbullet:notes.

```bash
SB="node ${CLAUDE_PLUGIN_ROOT}/scripts/sb.mjs"
$SB journal                          # today's journal; created from the template if missing
$SB journal 2026-01-14               # a given day
$SB block "Journal/2026-01-15" reading-2026-01-15 entry.md   # add / update your entry only
```

Journal folder and template come from config (`journalFolder`, default `Journal`; `journalTemplate`, default `Template-journal`).

## Workflow

1. **Today's journal** — always `journal` first: it checks the page exists and creates it if not.
2. **Writing** — add your content as a `block` (one block per topic per day); never rewrite the page. Keep the template's frontmatter (e.g. `tags: journal`; the index lists journals by it).
3. **Tags** — tag per thought: a `#tag` line glued to its paragraph (no blank line) or at the end of a bullet. A standalone tag paragraph tags the whole journal page. See silverbullet:tags.
4. **Attachments** — upload beside the page as `<journalFolder>/<name>_DD-MM-YYYY.<ext>`, link `[[<journalFolder>/<file>]]` from your block.
5. **Related tasks** — when writing today's entry, planning, or asked "what to do today", also check open tasks elsewhere and mention the relevant ones:
   - carried over in earlier journals: `tasks --page <journalFolder>/`
   - project pages: `tasks` grouped by page
   - goals: `tagged <goal-tag>` (e.g. a goals tag in the user's tag guide)

   Skip routine lines copied from the journal template every day — they are not backlog. Never tick or move tasks unless asked (silverbullet:tasks).
