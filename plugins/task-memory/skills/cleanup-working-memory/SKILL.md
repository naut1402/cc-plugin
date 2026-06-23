---
name: cleanup-working-memory
description: Audit and clean up working memory for a completed or paused task. Reads all artifacts (main memory, surveys, Q&A, knowledge notes), classifies each by persistence value (PERSIST / KEEP / DELETE), and executes cleanup after confirmation. Use this when a task is done or paused and the user wants to tidy up, archive, purge, or close out working memory — even if they don't say "working memory" explicitly. Trigger on phrases like "task is done, clean up", "archive memory for B4488", "purge old task notes", "close out this task".
argument-hint: "<task-id> [--dry-run] [--confirm]"
user-invocable: true
---

# Cleanup Working Memory

Audit the working memory artifacts for a task, classify each by persistence value, and execute a cleanup — flagging reusable knowledge for archival and deleting spent, task-specific artifacts.

## Arguments

- `<task-id>` — Task ID (e.g. `B4488`, `F123`, `U4001`). Infer from conversation if omitted.
- `--dry-run` — Show the cleanup plan without deleting anything. **This is the default** when no flag is passed.
- `--confirm` — Execute the plan immediately after presenting it, without an extra confirmation step.

## Workflow

### Step 1 — Resolve task ID

Use `$ARGUMENTS`, or infer from the current conversation context (most recently mentioned task ID).

### Step 2 — Read all working memory artifacts

1. Call `/read-working-memory task-<task-id>` to load the main task memory.
2. Call `/search-working-memory task-<task-id>` to discover all sub-notes linked to this task (surveys, Q&A, knowledge, design docs, scratch notes).

If both calls return nothing, report "No working memory found for `<task-id>`" and stop.

### Step 3 — Assess task state

From the main task memory, determine:

| Signal | Where to find it |
|--------|-----------------|
| **Status** | `## Trạng thái` or `Status` field — Completed / In-progress / Paused |
| **Open TODOs** | Count unchecked `- [ ]` items in the TODO section |
| **Output docs produced** | `## Output tài liệu` / `Documentation output` section |
| **Distillation done** | Look for a `distilled-knowledge.md` reference or wikilink in the main memory |

### Step 4 — Classify each artifact

Assign one of three dispositions to every artifact found:

| Disposition | Meaning |
|-------------|---------|
| **PERSIST** | Contains reusable knowledge that should be archived to domain memory before deletion |
| **KEEP** | Task-specific but retain for audit trail or ongoing reference |
| **DELETE** | Spent, resolved, or superseded — safe to remove |

**Classification rules (apply in order):**

- Any note tagged `#task-{id}-knowledge` or named `knowledge.md` → **PERSIST** (if non-empty)
- Any note tagged `#task-{id}-qa` or named `qa.md` → **PERSIST** (general-domain answers are reusable; task-specific one-off answers are not, but mark the whole note PERSIST so the user can review)
- Survey notes (`survey-*.md`) → **DELETE** if task is completed and output docs exist; **KEEP** if task is still in-progress
- Detail design notes (`detail-design-*.md`) → **KEEP** (they are output artifacts, not scratch)
- Main task memory (`task-<id>.md`) → **KEEP** if open TODOs remain or status is not Completed; **DELETE** if status is Completed and distillation is done
- Scratch or temporary notes (no recognized tag/name pattern) → **DELETE**

### Step 5 — Warn if distillation is needed

If any artifact is classified as **PERSIST** and distillation has **not** been run yet:

> ⚠️ There are artifacts worth preserving that haven't been distilled yet.
> Run `/distill-knowledge <task-id>` first, then re-run cleanup.

If `--confirm` was passed, **abort** here — do not delete anything until distillation is done.
If `--dry-run` (or no flag), continue to present the plan but highlight this warning prominently.

### Step 6 — Present the cleanup plan

Always present this report before deleting anything:

```
## Working Memory Cleanup Plan — <task-id>

### Task state
- Status: <Completed / In-progress / Paused>
- Open TODOs: <N>
- Output docs: <produced / not yet>
- Distillation: <Done ✅ / Not done ⚠️>

### Artifact inventory

| Artifact | Disposition | Reason |
|----------|-------------|--------|
| task-B4488.md | KEEP | Open TODOs remain |
| survey-login-flow.md | DELETE | Spent investigation note; findings captured in output doc |
| qa.md | PERSIST → distill first | 3 Q&A items not yet archived to domain memory |
| knowledge.md | PERSIST → distill first | 2 reusable patterns |

### Actions
- Delete: survey-login-flow.md, scratch.md (2 files)
- Keep: task-B4488.md, detail-design-auth.md (2 files)
- Archive before deleting: qa.md, knowledge.md (run /distill-knowledge first)
```

If `--dry-run` (default): stop here and ask the user to confirm before proceeding.
If `--confirm`: proceed directly to Step 7.

### Step 7 — Execute cleanup

For each artifact marked **DELETE**:
- Call the appropriate contract skill to remove that specific note.

For the main task memory folder, only call `/delete-working-memory task-<task-id>` if the main file itself is marked **DELETE** and no other artifacts are marked **KEEP**.

Never delete an artifact marked **PERSIST** — those require distillation first.

### Step 8 — Output summary

```
## Cleanup Complete — <task-id>

✅ Deleted (2): survey-login-flow.md, scratch.md
📌 Kept (2): task-B4488.md, detail-design-auth.md
⚠️ Pending archival (2): qa.md, knowledge.md — run /distill-knowledge <task-id> to archive these, then re-run cleanup to delete them.
```

## Guardrails

- **Default to dry-run.** Never delete without explicit confirmation (`--confirm` flag or user approval after seeing the plan).
- **Never delete PERSIST artifacts.** They require distillation first — flag them and block deletion.
- **Never delete the main task memory** if open TODOs remain or status is not Completed.
- Treat every deletion as irreversible. When in doubt, classify as **KEEP** rather than **DELETE**.
- If the working memory backend is unavailable (MCP error), report the error and stop — do not attempt to infer artifact state from conversation context alone.
