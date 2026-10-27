---
name: usage
description: Measures how much Claude the user's work consumes — weighted tokens from Claude Code transcripts calibrated against the plan usage % (5-hour and weekly limits, sampled through the status line), tokens and % per task and per day, estimates for a new task from similar past tasks (per phase such as investigate / code / test, with S/M/L size and time to finish under the plan limits), token budgets from a % of the limit (per task or per subagent) and spend per session / subagent — and the shell commands Claude ran, aggregated per day as data on the most used commands. Use when the user says /usage, "ước lượng token", "1% usage bằng bao nhiêu token", "task này tốn bao nhiêu token", "estimate công số", "còn bao nhiêu usage", "lệnh hay dùng", "thống kê lệnh", or during the end-of-day checklist.
argument-hint: "[status|setup|rate|budget <pct> [--split=N]|spent|phase scan --task=<ID>|day [date]|task <ID...>|estimate <new-task> --like=<ID,...>|commands [date] [--days=N]|unsetup] [--dry-run]"
user-invocable: true
---

# Usage

All counting runs in a Node script; the model only interprets numbers and picks reference tasks.

`US` = `node ~/.daily-assistant/bin/usage.mjs` (fallback `node ${CLAUDE_PLUGIN_ROOT}/scripts/usage.mjs`). Run `US` with no args for full usage.

## Config

Section `usage` (see `assistant-config`); defaults apply when it is absent. Gate: `usage.enabled: false` → `⏭️ usage skipped — usage.enabled is false` and stop. Command stats also need `watch.capture.bash` (on by default).

| Key | Meaning |
|-----|---------|
| `dir` | Samples, rate cache, saved days (default `~/.daily-assistant/usage`) |
| `handover_at` | 5-hour % that raises one `human-handover` reminder per window; `0` = off |
| `weights` | Weight per token type (`input`, `output`, `cache_write_5m`, `cache_write_1h`, `cache_read`) |
| `model_weights` | Optional factor per model id substring (e.g. `sonnet: 0.6`); unset = 1 |
| `min_delta_pct` | Minimum 5-hour % movement in a window to use it for calibration |
| `rate_days` | Days of samples used by `rate` |
| `phase_marker` | Regex for phase markers in agent messages (named groups `phase`, `edge`, optional `time`, `agent`); empty = `[phase:<name>:start\|end(@time)]` |
| `size_quantiles` | Cut points of S/M/L within recorded samples (default `[0.33, 0.67]`) |
| `per_pct.five_hour` / `per_pct.seven_day` | Fallback weighted tokens per 1% when this machine has no calibrated `rate.json` — copy the numbers from `US rate` on a machine that samples, or sync the `usage` config section with `/sync-memory` |

## How the numbers are made

| Piece | Source |
|-------|--------|
| Tokens | `~/.claude/projects/**/*.jsonl` (main and subagent transcripts), one record per API response. **Weighted tokens** = Σ tokens × type weight × model weight — plan limits follow compute, so a cache read counts ~1/10 of an input token and an output token ~5× |
| Plan usage % | Status line JSON `rate_limits.five_hour` / `seven_day` (Pro/Max only). `US setup` wraps the current status line command with `statusline.mjs`, which appends a sample to `samples.jsonl` whenever the % changes and still prints the old status line |
| Tokens per 1% | Per limit window: weighted tokens between its first and last sample ÷ Δ%. `perPct` pools all windows; the median is shown next to it |
| Task | A response belongs to the task IDs of the latest prompt in its session that named one (activity log), else the session's branch, else `other` |
| Commands | `bash` events of the activity log (verbatim command, Bash and PowerShell tools), split on `&&` `;` `|` and grouped by head (`git diff`, `node usage.mjs day`, `npm run build`) |

Why the % matters: budgets are given in plan usage ("keep this task under 10%/5h", "1%/5h per subagent"), while the model and transcripts only see tokens. `rate` is the bridge both ways — `estimate` and `spent` turn tokens into %, `budget` turns % into tokens.

Long-lived tokens (`claude setup-token`, CI, `CLAUDE_CODE_OAUTH_TOKEN`) cannot read plan usage: the status line gets no `rate_limits`, so nothing is sampled there. Such sessions still log tokens; their % comes from the rate of a machine that samples — `rate.json` there, then `US rate --set=<5h>,<week>` or `usage.per_pct` here.

Caveats to state when relevant: usage on other machines or claude.ai moves the % without local tokens, so tokens per 1% reads low; tasks are attributed by prompts (≈); transcripts are deleted by Claude Code after `cleanupPeriodDays` (default 30), and `day --save` keeps the per-day aggregate.

## Commands

`$ARGUMENTS` = `<command> [args]`. No command → `status`.

| Command | Do |
|---------|----|
| `status` | `US status` — relay as-is. No sample → offer `setup` |
| `setup` | `US setup` (dry run) → show the settings change → on confirmation `US setup --yes`. Say that samples appear after the next responses and `rate` needs a few windows with ≥ `min_delta_pct` % movement |
| `unsetup` | `US unsetup` → confirm → `--yes` (restores the wrapped command) |
| `rate [--set=<5h>,<week>]` | `US rate` — recompute and cache tokens per 1%. Exit 2 → relay why (not enough samples) and, on a machine that never samples, offer `--set` with numbers from another machine |
| `budget <pct> [--window=5h\|week] [--split=N]` | `US budget …` — see Budgets |
| `spent [--since=HH:MM]` | `US spent --cwd=<current dir> --by-agent` — this session's main thread and each subagent in tokens and % |
| `phase scan\|record\|list\|drop …` | See Phase samples |
| `day [date]` | `US day [date]`; end-of-day → `US day --save` (also saves the day's command stats), then `US commands --md` and offer to write it into the journal (below) |
| `task <ID...>` | `US task <ID...>` |
| `estimate <new task> [--like=…]` | See below |
| `commands [date] [--days=N] [--task=ID]` | `US commands …`; add a 2–3 line reading only if asked (e.g. candidates for a script or a permission allowlist) |

## Phase samples

Estimates by phase (investigate / design / code / test / review …) need one sample per phase of each finished task: the tokens and time the agent doing that phase spent between its reported start and end. The orchestrator (main session) records them; the script reads the transcripts, so the model never has to.

| Way | Command |
|-----|---------|
| Markers — teammates write `[phase:<name>:start]` / `[phase:<name>:end]` (optional `@HH:MM` or `@<ISO>`) in a message or in their report to the orchestrator | after the task (or each phase): `US phase scan --task=<ID> [--sid=<session>]`. A marker relayed into the main thread counts once, for the teammate that wrote it. Other report formats: set `usage.phase_marker` (regex with named groups `phase`, `edge` = start\|end, optional `time`, `agent`) |
| Times reported in prose — orchestrator reads them from the report | `US phase record --task=<ID> --phase=<name> --from=<HH:MM\|ISO> [--to=…] --agent=<id\|name\|agent type\|main>` |

- A sample covers the responses of that agent in the range (all agents of the session when `--agent` is omitted, so pass it when teammates run in parallel). Time = active minutes (gaps between responses, each ≤ 5 min) and wall minutes.
- Re-recording the same task + phase + agent replaces the sample; `US phase drop --task=<ID> [--phase=…]` removes wrong ones; `--dry-run` shows without saving.
- Phase names are free text: keep one vocabulary per project (e.g. the pipeline step ids) so estimates can match them.
- Each sample carries its **project** — the git repository of the session folder (the main repo for a worktree), else the folder name; `--project=<name>` overrides it (e.g. the session ran outside the repo). `US phase list --project=<name>` shows one project.

## Estimate a new task

1. Reference tasks of similar difficulty: `--like` given → use them. Otherwise pick 2–5 finished tasks of the same kind — from `learn recall estimate`, the tracker (`my-tasks` data: same type / size) or task memory — show the picks and let the user change them.
2. `US estimate --like=<IDs> --cwd=<repo of the new task>`. Tasks with no data are listed — drop or replace them. Baseline project: `--project=<name>`, else the project of `--cwd` when a reference task belongs to it, else the project most reference tasks belong to; `--all-projects` compares across projects (say so in the answer). The script prints the baseline and any reference task from another project.
3. With phase samples the script prints, per phase in the usual order: median weighted tokens (max as upper bound), % of the 5-hour and weekly limits, **size S/M/L** relative to the recorded samples of that phase **in the baseline project** (cut points `usage.size_quantiles`, default the 33rd / 67th percentile; `?` until the project has 3 tasks — samples of other projects are never mixed in silently), active time; then the total with size, number of 5-hour windows, and **time with limits** — active time plus waiting for resets, simulated from the current 5-hour % and its reset time, with a warning when the work exceeds what is left of the weekly limit.
4. Without phase samples: totals only (median / mean / max as tokens and %).
5. Answer with size and time per phase plus the total, and the limit context in one line (`= 1.6 × 5h window, needs one reset wait`). Mention that `rate` is missing when % shows `n/a`.
6. Offer `learn capture` of the result as knowledge (`estimate: <task type> ≈ N% of 5h`) once the user confirms the numbers are useful.

## Budgets

When the user gives effort as % of a limit ("giảm effort task xuống 10%/5h", "chia mỗi đệ 1% usage/5h"):

1. `US budget <pct> [--window=…] [--split=<number of agents>]` → weighted token budget (and raw ≈) per whole task / per agent. No rate → say so and stop; never guess a conversion.
2. Fit the plan to it: fewer subagents, a cheaper model for mechanical steps, narrower reads, scripts instead of model work. Compare with `US estimate` of similar tasks when the budget looks too small and say so before starting.
3. Delegating: put the budget into each subagent's brief as a limit on work (`budget ≈ N tokens ≈ 1% of 5h: stop and report when the scope needs more`) — a subagent cannot see its own spend.
4. Checkpoint: note the start time, then `US spent --since=<HH:MM> --by-agent` after each subagent returns or each phase; over budget → tell the user and ask before continuing.

## Journal (end of day)

On the user's confirmation, through the `silverbullet:journal` skill: `log usage-<date> "<usage.journal_section>: <weighted tokens, % of 5h / week>" --detail <entry file>`, entry = heading `## <usage.journal_section>`, one line with the day's weighted tokens, % of each limit and the top 3 tasks, then the `US commands --md` table (top 10). Two-tier journal → the entry lands on the detail page and today's journal gets one summary line; re-running replaces both. No SilverBullet plugin → print the entry in chat. Then `DA mark usage-saved`.

## Rules

- Use script output as-is; never read transcripts or the activity log yourself.
- Commands shown anywhere outside the local log (journal, runbook, chat) come from the script, which redacts secrets — do not paste raw log lines.
- `setup` / `unsetup` change `~/.claude/settings.json` (backup `settings.json.da-bak-<date>`): always dry run + confirmation first.
- `--dry-run`: read-only commands only; no `--save`, no setup, no journal write.
