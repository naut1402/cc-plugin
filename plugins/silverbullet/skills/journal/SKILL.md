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
$SB journal --detail                 # today's detail page (two-tier journal), created if missing
$SB log fix-login-2026-01-15 "Login bug fixed, released to staging" --detail entry.md   # log a piece of work
$SB block "Journal/2026-01-15" reading-2026-01-15 entry.md   # add / update your own block only
```

## Config

| Key | Default | Meaning |
|---|---|---|
| `journalFolder` | `Journal` | daily pages `<folder>/YYYY-MM-DD` |
| `journalTemplate` | `Template-journal` | page copied when a day's journal is created |
| `journalDetailFolder` | empty = off | two-tier journal: details live in `<folder>/YYYY-MM-DD` |
| `journalDetailTag` | `journal-detail` | frontmatter tag of detail pages — not the journal tag, so journal lists do not show a day twice |
| `journalSummaryHeading` / `journalSummaryBlock` | `Work log` / `worklog` | heading and block id prefix (`<block>-YYYY-MM-DD`) of the summary list in the day's journal |
| `journalDetailLabel` | `details` | link text at the end of each summary line |

A personal skill or guide page may set the user's own values (language of heading and label) — follow it.

## Two-tier journal — the day's journal is for the human reader

With `journalDetailFolder` set, the day's journal holds only short summary lines; everything else goes to the detail page.

| Page | Content |
|---|---|
| `<journalFolder>/YYYY-MM-DD` | the user's own writing (to-do list…) + the summary block: one line per piece of work, `- HH:MM <result in plain words> ([[<detail page>$<id>\|<label>]])` |
| `<journalDetailFolder>/YYYY-MM-DD` | one block `## <title> $<id>` per piece of work: steps with times, links, local paths, numbers, commands, topic hashtags, attachment links |

Write work entries with `log <id> "<summary>" --detail <file>` — it upserts block `$<id>` on the detail page, then the summary line with the same id (replaced if it exists, so the journal keeps one line per piece of work). Without `--detail` it only rewrites the summary line of an existing block.

- One `<id>` per piece of work per day (`<topic>-YYYY-MM-DD`); later steps of the same work update its block and line instead of adding new ones.
- Summary: one sentence, the result rather than the process; no paths, URLs or file lists. `--time` defaults to now.
- Never add topic blocks to the day's journal; put them on the detail page and log a summary line.
- When two-tier is off, `log` writes the block into the day's journal and the summary line links to it on the same page.

## Workflow

1. **Today's journal** — always `journal` first: it checks the page exists and creates it if not.
2. **Writing** — work entries with `log` (above); other content as a `block` (one block per topic per day); never rewrite the page. Keep the template's frontmatter (e.g. `tags: journal`; the index lists journals by it).
3. **Tags** — tag per thought: a `#tag` line glued to its paragraph (no blank line) or at the end of a bullet. A standalone tag paragraph tags the whole journal page. See silverbullet:tags.
4. **Attachments** — upload beside the page as `<journalFolder>/<name>_DD-MM-YYYY.<ext>`, link `[[<journalFolder>/<file>]]` from your block (the detail block when two-tier is on).
5. **Related tasks** — when writing today's entry, planning, or asked "what to do today", also check open tasks elsewhere and mention the relevant ones:
   - carried over in earlier journals: `tasks --page <journalFolder>/`
   - project pages: `tasks` grouped by page
   - goals: `tagged <goal-tag>` (e.g. a goals tag in the user's tag guide)

   Skip routine lines copied from the journal template every day — they are not backlog. Never tick or move tasks unless asked (silverbullet:tasks).
