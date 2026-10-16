#!/usr/bin/env node
// Claude Code hook entry: node activity-log.mjs hook   (stdin = hook JSON)
// Appends activity JSONL, keeps ~/.daily-assistant/bin in sync with the plugin scripts,
// and injects context only when something needs the user's attention. Always exits 0.
import { readFileSync, readdirSync, existsSync, unlinkSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, tzOf, nowParts, taskIds, git, logDir, readDay, appendLog, readPending, writePending, homeDir,
} from './lib.mjs';

const GIT_CMD = /\bgit\s+(commit|push|switch|checkout|merge|rebase|cherry-pick)\b|\bgh\s+pr\s+(create|merge)\b/;
const HERE = dirname(fileURLToPath(import.meta.url));

function main() {
  const cfg = loadConfig();
  if (!cfg) return;
  const watch = cfg.watch || {};
  if (watch.enabled === false) return;
  const capture = watch.capture || {};
  const patterns = cfg.task_id_patterns || [];
  const dir = logDir(cfg);
  const { date } = nowParts(tzOf(cfg));
  const log = (entry) => appendLog(cfg, entry);

  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const ev = input.hook_event_name;
  const sid = input.session_id;
  const cwd = input.cwd;
  const notes = [];

  if (ev === 'SessionStart') {
    syncBin();
    const firstToday = !readDay(dir, date).some((e) => e.ev === 'session-start');
    const branch = cwd ? git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 1500) : undefined;
    if (capture.sessions !== false) log({ ev: 'session-start', sid, source: input.source, cwd, branch, tasks: taskIds(branch, patterns) });
    if (firstToday) {
      notes.push(...missedEarlier(dir, date, watch.required_marks || ['report-sent', 'logwork-ok']));
      prune(dir, date, Number(watch.retention_days) || 60);
    }
    if (watch.autostart && input.source === 'startup') {
      notes.push('Scheduled checks: if `node ~/.daily-assistant/bin/daily-assistant.mjs schedule show` reports none installed, offer once to run the `watch` skill with `start`.');
    }
  } else if (ev === 'UserPromptSubmit') {
    const tasks = capture.task_ids === false ? [] : taskIds(input.prompt, patterns);
    const preview = capture.prompts ? String(input.prompt || '').slice(0, 120) : undefined;
    if (tasks.length || preview) log({ ev: 'prompt', sid, tasks, preview });
  } else if (ev === 'PostToolUse') {
    const cmd = input.tool_input?.command || '';
    const m = capture.git !== false && cmd.match(GIT_CMD);
    if (m) {
      const branch = cwd ? git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 1500) : undefined;
      log({ ev: 'git', sid, sub: m[1] || `pr-${m[2]}`, cwd, branch, tasks: taskIds(`${branch} ${cmd}`, patterns) });
    }
    return;
  } else if (ev === 'Stop') {
    if (capture.turns !== false) log({ ev: 'turn-end', sid });
    return;
  } else if (ev === 'SessionEnd') {
    if (capture.sessions !== false) log({ ev: 'session-end', sid, reason: input.reason });
    return;
  }

  // Reminders raised by the OS-scheduled `check --notify` runs: deliver once.
  const pending = readPending();
  const unseen = pending.filter((p) => !p.seen);
  if (unseen.length) {
    notes.push(...unseen.map((p) => `Reminder (${p.t.slice(11, 16)}, ${p.id}): ${p.msg}`));
    writePending(pending.map((p) => ({ ...p, seen: true })));
  }
  if (notes.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: `[daily-assistant]\n- ${notes.join('\n- ')}` } }) + '\n');
  }
}

// Stable copy for the OS scheduler and skills: plugin root changes on every plugin update.
function syncBin() {
  const bin = join(homeDir(), 'bin');
  if (resolve(HERE) === resolve(bin)) return;
  mkdirSync(bin, { recursive: true });
  for (const f of readdirSync(HERE).filter((n) => n.endsWith('.mjs'))) {
    const src = join(HERE, f), dst = join(bin, f);
    if (!existsSync(dst) || readFileSync(src, 'utf8') !== readFileSync(dst, 'utf8')) copyFileSync(src, dst);
  }
}

// Most recent earlier day with activity but missing required marks.
function missedEarlier(dir, today, required) {
  if (!existsSync(dir)) return [];
  const days = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).filter((d) => d < today).sort();
  const last = days.at(-1);
  if (!last) return [];
  const entries = readDay(dir, last);
  if (!entries.some((e) => e.ev !== 'mark')) return [];
  const marks = new Set(entries.filter((e) => e.ev === 'mark').map((e) => e.name));
  const missing = required.filter((r) => !marks.has(r));
  return missing.length ? [`On ${last} not recorded: ${missing.join(', ')}. Mention it briefly and offer to catch up (e.g. /daily-assistant:daily-report --date=${last}, /daily-assistant:check-logwork --date=${last}).`] : [];
}

function prune(dir, today, keepDays) {
  if (!existsSync(dir)) return;
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const limit = cutoff.toISOString().slice(0, 10);
  for (const f of readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < limit) unlinkSync(join(dir, f));
  }
}

try { main(); } catch { /* never block Claude Code */ }
process.exit(0);
