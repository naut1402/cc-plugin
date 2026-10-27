#!/usr/bin/env node
// daily-assistant CLI — deterministic, zero-LLM observation and file chores.
// Stable path (synced by the SessionStart hook): ~/.daily-assistant/bin/daily-assistant.mjs
//
//   brief                                   compact status of today (≤ 8 lines)
//   check [all|<id>] [--notify] [--force]   run watch.checks locally; prints only problems; exit 1 if any
//   today [YYYY-MM-DD] [--json]             active time per task from the activity log
//   mark <name> [note] [--date=D]           append an end-of-day mark (for today or a past day)
//   todo list [--all] | add "<text>" [--due=D] [--p=high|low] | done <n> | undo <n>     (file backend)
//   commits [YYYY-MM-DD]                    own commits in report.sources.git_repos grouped by task
//   tidy-plan [--inbox=a,b] [--dest=<layout>] [--json]   plan for sweeping inbox folders (no changes), prints its id
//   tidy-apply --plan=<id> [--only=1,2] [--assign=3:B4493] [--delete-dups]   apply that exact plan (moves only by default)
//   git-stale [--repos=a,b]                 merged / gone branches and stale worktrees (fetch --prune, no branch changes)
//   schedule show | install [--yes] | remove [--yes]    OS scheduler entries for watch.checks
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, copyFileSync, unlinkSync,
} from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  loadConfig, configPath, homeDir, expandHome, tzOf, nowParts, toMinutes, fmtDur, taskIds, git,
  logDir, readDay, appendLog, readPending, writePending,
} from './lib.mjs';

const [cmd = 'brief', ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => { const [k, ...v] = a.slice(2).split('='); return [k, v.length ? v.join('=') : true]; }));
const args = rest.filter((a) => !a.startsWith('--'));

const cfg = loadConfig();
if (!cfg) { console.log(`no config at ${configPath()} — run /init-daily-assistant`); process.exit(2); }
const tz = tzOf(cfg);
const now = nowParts(tz);
const patterns = cfg.task_id_patterns || [];
const out = (s = '') => console.log(s);
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ================================================================ brief
async function brief() {
  const act = activity(now.date);
  const todos = cfg.todo?.backend === 'file' || !cfg.todo?.backend ? todoItems() : null;
  const lines = [`${now.date} (${now.dow}) ${now.hm} · active ≈${fmtDur(act.total)}${act.byTask.length ? ' · ' + act.byTask.slice(0, 4).map(([t, m]) => `${t} ${fmtDur(m)}`).join(', ') : ''}`];
  if (todos) {
    const open = todos.filter((t) => !t.done);
    const over = open.filter((t) => t.due && t.due < now.date), dueToday = open.filter((t) => t.due === now.date);
    lines.push(`todo: ${open.length} open · ${over.length} overdue · ${dueToday.length} today`);
    for (const t of [...over, ...dueToday].slice(0, 3)) lines.push(`  #${t.n} ${t.text.slice(0, 60)}${t.due ? ` (📅${t.due.slice(5)})` : ''}`);
  } else lines.push(`todo: backend ${cfg.todo.backend} (ask the assistant)`);
  const req = cfg.watch?.required_marks || ['report-sent', 'logwork-ok'];
  lines.push(`marks: ${req.map((m) => `${m} ${act.marks.has(m) ? '✓' : '✗'}`).join(' · ')}`);
  const fails = runChecks({ onlyDue: true }).filter((r) => r.status === 'fail');
  if (fails.length) lines.push(`attention: ${fails.map((f) => f.id).join(', ')}`);
  const pend = readPending().filter((p) => !p.seen).length;
  if (pend) lines.push(`pending reminders: ${pend}`);
  out(lines.join('\n'));
}

// ================================================================ checks
function cronTime(cron) {
  const [m, h, dom, mon, dow] = String(cron || '').trim().split(/\s+/);
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h) || dom !== '*' || mon !== '*') return null;
  const days = dow === '*' ? [0, 1, 2, 3, 4, 5, 6] : expandDow(dow);
  return days ? { minute: Number(m), hour: Number(h), days } : null;
}

const fmtHm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const todoFile = () => expandHome(cfg.todo?.file || '~/.daily-assistant/todo.md');
const planFile = () => join(homeDir(), 'tidy-plan.json');
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
const sha1 = (f) => createHash('sha1').update(readFileSync(f)).digest('hex');

function expandDow(s) {
  const out = new Set();
  for (const part of s.split(',')) {
    const r = part.match(/^(\d)(?:-(\d))?$/);
    if (!r) return null;
    for (let d = Number(r[1]); d <= Number(r[2] ?? r[1]); d++) out.add(d % 7);
  }
  return [...out].sort();
}

function runChecks({ only, onlyDue = false, force = false } = {}) {
  const act = activity(now.date);
  const results = [];
  for (const c of cfg.watch?.checks || []) {
    const named = only && only !== 'all';
    if (named && c.id !== only) continue;
    if (c.enabled === false && !named) continue;
    const ct = cronTime(c.cron);
    if (onlyDue && !force && ct) {
      if (!ct.days.includes(DOW.indexOf(now.dow))) continue;
      if (ct.hour * 60 + ct.minute > toMinutes(now.time)) continue;
    }
    results.push({ id: c.id, remind: c.remind, ...evaluate(c, act) });
  }
  return results;
}

function evaluate(c, act) {
  if (!c.check) return { status: 'skip', msg: `action ${c.action} needs Claude` };
  const [kind, ...argParts] = String(c.check).split(':');
  const arg = argParts.join(':');
  if (kind === 'marker') return act.marks.has(arg) ? ok() : fail(`mark "${arg}" not recorded today`);
  if (kind === 'logwork') return act.marks.has('logwork-ok') ? ok() : fail('logwork not confirmed today');
  if (kind === 'journal-section') {
    const r = journalHasSection(arg);
    if (r === true || act.marks.has('journal-written')) return ok();
    return fail(r === null ? 'journal not confirmed (no mark; journal not readable from script)' : `journal section "${arg}" is empty or missing`);
  }
  if (kind === 'todo-due') {
    if (cfg.todo?.backend && cfg.todo.backend !== 'file') return { status: 'skip', msg: 'todo backend needs Claude' };
    const due = todoItems().filter((t) => !t.done && t.due && t.due <= now.date);
    return due.length ? fail(`${due.length} todo due: ${due.slice(0, 3).map((t) => `#${t.n} ${t.text.slice(0, 40)}`).join('; ')}`) : ok();
  }
  return { status: 'skip', msg: `unknown check ${c.check}` };
  function ok() { return { status: 'ok' }; }
  function fail(msg) { return { status: 'fail', msg }; }
}

// Optional: read today's journal page over HTTP (watch.journal_http.{url,page,detail_page,token_env}); with a
// two-tier journal the section may sit on the detail page. null = not configured / unreachable.
function journalHasSection(heading) {
  const j = cfg.watch?.journal_http || {};
  if (!j.url || !j.page) return null;
  const [y, m, d] = now.date.split('-');
  const pages = [j.page, j.detail_page].filter(Boolean).map((p) => p.replace('{yyyy}', y).replace('{mm}', m).replace('{dd}', d));
  const headers = j.token_env && process.env[j.token_env] ? ['-H', `Authorization: Bearer ${process.env[j.token_env]}`] : [];
  let found = null;
  for (const page of pages) {
    let text;
    try {
      text = execFileSync('curl', ['-sf', '-m', '8', ...headers, `${j.url.replace(/\/$/, '')}/.fs/${encodeURI(page)}.md`], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    } catch { continue; }
    // Heading text without SilverBullet block anchors ("## Daily report $daily-report-2026-10-22")
    const title = (l) => l.replace(/^#+\s*/, '').replace(/(^|\s)\$[A-Za-z0-9][\w-]*(?=\s|$)/g, '').trim();
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^#+\s/.test(l) && title(l) === heading);
    if (idx < 0) { found = false; continue; }
    const after = lines.slice(idx + 1);
    const end = after.findIndex((l) => /^#+\s/.test(l) || /^\s*---\s*$/.test(l)); // next heading or block end
    if ((end < 0 ? after : after.slice(0, end)).some((l) => l.trim())) return true;
    found = false;
  }
  return found;
}

async function check() {
  const results = runChecks({ only: args[0] || 'all', onlyDue: !args[0] || args[0] === 'all', force: !!flags.force });
  const fails = results.filter((r) => r.status === 'fail');
  for (const f of fails) out(`⚠ ${f.id}: ${f.msg}${f.remind ? ` → ${f.remind}` : ''}`);
  if (flags.verbose) for (const r of results.filter((x) => x.status !== 'fail')) out(`${r.status === 'ok' ? '✓' : '·'} ${r.id}${r.msg ? `: ${r.msg}` : ''}`);
  if (fails.length && flags.notify) {
    const pending = readPending();
    for (const f of fails) pending.push({ t: now.time, id: f.id, msg: `${f.msg}${f.remind ? ` → ${f.remind}` : ''}`, seen: false });
    writePending(pending);
    notify(`${cfg.persona?.name || 'daily-assistant'}`, fails.map((f) => `${f.id}: ${f.msg}`).join('\n'));
  }
  return fails.length ? 1 : 0;
}

function notify(title, msg) {
  const t = title.replace(/'/g, "''"), m = msg.slice(0, 250).replace(/'/g, "''");
  try {
    if (process.platform === 'win32') {
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(10000,'${t}','${m}',[System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep 8; $n.Dispose()`], { stdio: 'ignore', timeout: 20000 });
    } else if (process.platform === 'darwin') {
      execFileSync('osascript', ['-e', `display notification "${m.replace(/"/g, '\\"')}" with title "${t.replace(/"/g, '\\"')}"`], { stdio: 'ignore' });
    } else {
      execFileSync('notify-send', [title, msg.slice(0, 250)], { stdio: 'ignore' });
    }
  } catch { /* notification is best effort; pending.json still reaches the next session */ }
}

// ================================================================ activity
function activity(date) {
  const entries = readDay(logDir(cfg), date);
  const marks = new Set(entries.filter((e) => e.ev === 'mark').map((e) => e.name));
  const bySid = new Map();
  for (const e of entries) if (e.sid) { if (!bySid.has(e.sid)) bySid.set(e.sid, []); bySid.get(e.sid).push(e); }
  const perTask = new Map();
  const spans = [];
  let total = 0;
  for (const evs of bySid.values()) {
    evs.sort((a, b) => a.t.localeCompare(b.t));
    const base = evs.find((e) => e.ev === 'session-start')?.tasks || [];
    let span = null;
    const close = () => {
      if (!span) return;
      const len = span.end - span.start + 5;
      const tasks = span.tasks.size ? [...span.tasks] : base.length ? base : ['other'];
      for (const t of tasks) perTask.set(t, (perTask.get(t) || 0) + Math.round(len / tasks.length));
      spans.push({ from: fmtHm(span.start), to: fmtHm(span.end), minutes: len, tasks });
      total += len;
      span = null;
    };
    for (const e of evs) {
      const m = toMinutes(e.t);
      if (span && m - span.end > 15) close();
      if (!span) span = { start: m, end: m, tasks: new Set() };
      span.end = m;
      for (const t of e.tasks || []) span.tasks.add(t);
    }
    close();
  }
  const own = entries.filter((e) => !e.for);  // marks filed later for this day carry the filing time
  const first = own[0]?.t?.slice(11, 16), last = own.at(-1)?.t?.slice(11, 16);
  const gitEvents = entries.filter((e) => e.ev === 'git').map((e) => ({ t: e.t.slice(11, 16), sub: e.sub, branch: e.branch, tasks: e.tasks }));
  return { date, total, first, last, marks, byTask: [...perTask].sort((a, b) => b[1] - a[1]), spans, git: gitEvents };
}

async function today() {
  const a = activity(args[0] || now.date);
  if (flags.json) { out(JSON.stringify({ ...a, marks: [...a.marks] })); return; }
  out(`${a.date} · ${a.first || '--'}–${a.last || '--'} · active ≈${fmtDur(a.total)} (Claude Code only)`);
  for (const [t, m] of a.byTask) out(`  ${t.padEnd(14)} ≈${fmtDur(m)}`);
  if (a.git.length) out(`git: ${a.git.map((g) => `${g.t} ${g.sub}${g.tasks?.length ? ' ' + g.tasks.join('/') : ''}`).join(' · ')}`);
  out(`marks: ${[...a.marks].join(', ') || 'none'}`);
}

async function mark() {
  if (!args[0]) { out('usage: mark <name> [note] [--date=YYYY-MM-DD]'); return 2; }
  const date = flags.date || now.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > now.date) { out(`invalid --date ${date} (YYYY-MM-DD, not in the future)`); return 2; }
  appendLog(cfg, { ev: 'mark', name: args[0], note: args.slice(1).join(' ') || undefined }, date);
  out(`marked ${args[0]} for ${date}`);
}

// ================================================================ todo (file backend)
function todoLines() {
  const f = todoFile();
  return existsSync(f) ? readFileSync(f, 'utf8').split(/\r?\n/) : ['# Todo', ''];
}

function todoItems(lines = todoLines()) {
  const items = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*- \[( |x|X)\] (.*)$/);
    if (!m) return;
    const text = m[2];
    items.push({
      n: items.length + 1, line: i, done: m[1] !== ' ', text: text.replace(/\s*(📅|✅) \d{4}-\d{2}-\d{2}/g, '').replace(/\s*[⏫🔽]/g, '').trim(),
      due: text.match(/📅 (\d{4}-\d{2}-\d{2})/)?.[1], raw: l,
    });
  });
  return items;
}

async function todo() {
  const [sub = 'list', ...a] = args;
  const lines = todoLines();
  const items = todoItems(lines);
  const save = () => { mkdirSync(dirname(todoFile()), { recursive: true }); writeFileSync(todoFile(), lines.join('\n')); };
  if (sub === 'list') {
    const show = items.filter((t) => flags.all || !t.done);
    const rank = (t) => (t.done ? 4 : !t.due ? 3 : t.due < now.date ? 0 : t.due === now.date ? 1 : 2);
    for (const t of show.sort((x, y) => rank(x) - rank(y) || (x.due || '').localeCompare(y.due || ''))) {
      const tag = ['🔴', '🟡', '  ', '  ', '✓ '][rank(t)];
      out(`${tag} #${t.n} ${t.text}${t.due ? ` (📅${t.due})` : ''}`);
    }
    if (!show.length) out('no open todo');
    return;
  }
  if (sub === 'add') {
    const text = a.join(' ').trim();
    if (!text) { out('usage: todo add "<text>" [--due=YYYY-MM-DD] [--p=high|low]'); return 2; }
    const ids = taskIds(text, patterns).filter((id) => !text.includes(`#${id}`));
    let line = `- [ ] ${text}${ids.map((id) => ` #${id}`).join('')}`;
    if (flags.due) line += ` 📅 ${flags.due}`;
    if (flags.p === 'high') line += ' ⏫'; else if (flags.p === 'low') line += ' 🔽';
    const lastItem = items.filter((t) => !t.done).at(-1)?.line ?? items.at(-1)?.line;
    const doneHdr = lines.findIndex((l) => /^## Done/.test(l));
    const at = lastItem !== undefined ? lastItem + 1 : doneHdr >= 0 ? doneHdr : lines.length;
    lines.splice(at, 0, line);
    save();
    out(`added: ${line}`);
    return;
  }
  if (sub === 'done' || sub === 'undo') {
    const t = items.find((x) => x.n === Number(a[0]));
    if (!t) { out(`no item #${a[0]}`); return 2; }
    lines[t.line] = sub === 'done'
      ? `${t.raw.replace('- [ ]', '- [x]')} ✅ ${now.date}`
      : t.raw.replace(/- \[[xX]\]/, '- [ ]').replace(/\s*✅ \d{4}-\d{2}-\d{2}/, '');
    save();
    out(`${sub}: ${lines[t.line].trim()}`);
    return;
  }
  out('todo: list | add | done <n> | undo <n>  (edit/move/rm/review are done by the assistant)');
  return 2;
}

// ================================================================ commits
async function commits() {
  const date = args[0] || now.date;
  const email = cfg.user?.email;
  const repos = cfg.report?.sources?.git_repos || [];
  if (!email || !repos.length) { out('commits: set user.email and report.sources.git_repos'); return 2; }
  for (const r of repos.map(expandHome)) {
    const log = git(r, ['log', '--all', `--author=${email}`, `--since=${date} 00:00`, `--until=${date} 23:59:59`, '--format=%h%x09%ad%x09%s', '--date=format:%H:%M'], 8000);
    if (!log) { out(`${basename(r)}: no commits by ${email} on ${date}`); continue; }
    const groups = new Map();
    for (const l of log.split('\n')) {
      const [h, t, s] = l.split('\t');
      const id = taskIds(s, patterns)[0] || 'other';
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(`${t} ${h} ${s}`);
    }
    out(basename(r));
    for (const [id, ls] of groups) { out(`  ${id}`); for (const l of ls) out(`    ${l}`); }
  }
}

// ================================================================ tidy
function destFor(layout, id) {
  const [y, m] = now.date.split('-');
  const a = cfg.archive || {};
  return expandHome(layout.replace('{root}', a.root || '~/Documents').replace('{project}', a.project || '').replace('{task_id}', id || '').replace('{yyyy}', y).replace('{mm}', m)).replace(/[\\/]+$/, '');
}

async function tidyPlan() {
  const a = cfg.archive || {};
  const inboxes = (flags.inbox ? String(flags.inbox).split(',') : a.inbox_dirs || []).map(expandHome);
  const layout = flags.dest || a.layout || '{root}/{project}/{task_id}';
  const flat = !layout.includes('{task_id}');
  const ignore = (a.ignore || []).map(globRe);
  const minAge = Number(a.min_age_days) || 0;
  const rows = [];
  const missing = [];
  if (!flags.json) out(`inbox: ${inboxes.join(', ') || '(none)'} → dest: ${layout}`);
  for (const dir of inboxes) {
    if (!existsSync(dir)) { missing.push(dir); if (!flags.json) out(`  missing: ${dir}`); continue; }
    for (const name of readdirSync(dir)) {
      const src = join(dir, name);
      let st; try { st = statSync(src); } catch { continue; }
      if (!st.isFile() || ignore.some((r) => r.test(name))) continue;
      if (minAge && Date.now() - st.mtimeMs < minAge * 864e5) continue;
      const id = taskIds(name, patterns)[0];
      const row = { n: rows.length + 1, src, name, size: st.size, id: id || null };
      if (!id && !flat) row.action = a.unmatched === 'keep' ? 'keep' : 'ask';
      else {
        const destDir = destFor(layout, id);
        let dst = join(destDir, name);
        row.action = 'move';
        if (existsSync(dst)) {
          if (statSync(dst).size === st.size && sha1(dst) === sha1(src)) row.action = 'dup';
          else { let i = 2; const ext = extname(name), stem = basename(name, ext); while (existsSync(dst)) dst = join(destDir, `${stem} (${i++})${ext}`); }
        }
        if (extname(name).toLowerCase() === '.zip' && existsSync(join(destDir, basename(name, '.zip')))) row.note = 'already extracted';
        row.dst = dst;
      }
      rows.push(row);
    }
  }
  const id = createHash('sha1').update(JSON.stringify({ layout, rows })).digest('hex').slice(0, 8);
  writeFileSync(planFile(), JSON.stringify({ id, created: now.time, layout, rows }, null, 1));
  if (flags.json) { out(JSON.stringify({ id, inboxes, layout, missing, rows })); return; }
  out(`plan ${id} (apply with --plan=${id})`);
  for (const r of rows) out(`${String(r.n).padStart(3)} ${r.action.padEnd(4)} ${r.name.slice(0, 60)} ${(r.size / 1024).toFixed(0)}K${r.dst ? ` → ${r.dst}` : ''}${r.note ? ` (${r.note})` : ''}`);
  if (!rows.length) out('nothing to tidy');
}

async function tidyApply() {
  if (!existsSync(planFile())) { out('no plan — run tidy-plan first'); return 2; }
  const plan = JSON.parse(readFileSync(planFile(), 'utf8'));
  // Row numbers are only meaningful for the plan the user saw and confirmed.
  if (!flags.plan || flags.plan !== plan.id) { out(`plan mismatch: confirmed ${flags.plan || '(none)'}, current ${plan.id} — re-run tidy-plan and confirm again`); return 2; }
  const only = flags.only ? new Set(String(flags.only).split(',').map(Number)) : null;
  const assign = Object.fromEntries(String(flags.assign || '').split(',').filter(Boolean).map((p) => p.split(':')).map(([n, id]) => [Number(n), id]));
  let moved = 0, removed = 0, failed = 0;
  for (const r of plan.rows) {
    if (only && !only.has(r.n)) continue;
    if (!existsSync(r.src)) continue;
    let action = r.action, dst = r.dst;
    if (assign[r.n]) { action = 'move'; dst = join(destFor(plan.layout, assign[r.n].toUpperCase()), r.name); }
    try {
      if (action === 'move') {
        if (existsSync(dst)) throw new Error('destination exists (re-run tidy-plan)');
        mkdirSync(dirname(dst), { recursive: true });
        try { renameSync(r.src, dst); } catch (e) {
          if (e.code !== 'EXDEV') throw e;
          copyFileSync(r.src, dst);
          if (statSync(dst).size !== r.size) throw new Error('copy size mismatch');
          unlinkSync(r.src);
        }
        moved++; out(`moved #${r.n} → ${dst}`);
      } else if (action === 'dup' && flags['delete-dups']) {
        if (!existsSync(r.dst) || statSync(r.dst).size !== statSync(r.src).size || sha1(r.dst) !== sha1(r.src)) {
          throw new Error('destination no longer identical — not deleted');
        }
        unlinkSync(r.src); removed++; out(`removed duplicate #${r.n} ${r.name}`);
      }
    } catch (e) { failed++; out(`failed #${r.n} ${r.name}: ${e.message}`); }
  }
  out(`done: ${moved} moved, ${removed} duplicates removed, ${failed} failed`);
  return failed ? 1 : 0;
}

async function gitStale() {
  const repos = (flags.repos ? String(flags.repos).split(',') : cfg.archive?.git?.repos || []).map(expandHome);
  const main = cfg.archive?.git?.main_branch || 'main';
  for (const r of repos) {
    // Side effect: refreshes and prunes remote-tracking refs (needed to see "upstream gone"); local branches are untouched.
    git(r, ['fetch', '--prune', '--quiet'], 20000);
    const cur = git(r, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const merged = (git(r, ['branch', '--format=%(refname:short)', '--merged', `origin/${main}`]) || '').split('\n').filter((b) => b && b !== main && b !== cur);
    const gone = (git(r, ['branch', '--format=%(refname:short)\t%(upstream:track)']) || '').split('\n').filter((l) => l.includes('[gone]')).map((l) => l.split('\t')[0]).filter((b) => b !== cur && b !== main);
    const wts = (git(r, ['worktree', 'list', '--porcelain']) || '').split('\n\n').slice(1).map((b) => ({ path: b.match(/^worktree (.*)$/m)?.[1], branch: b.match(/^branch refs\/heads\/(.*)$/m)?.[1], prunable: /^prunable/m.test(b) }));
    const staleWt = wts.filter((w) => w.prunable || (w.branch && merged.includes(w.branch)));
    out(`${basename(r)} (current ${cur})`);
    for (const b of new Set([...merged, ...gone])) out(`  branch ${b} — ${[merged.includes(b) && 'merged', gone.includes(b) && 'upstream gone'].filter(Boolean).join(', ')}`);
    for (const w of staleWt) out(`  worktree ${w.path} — ${w.prunable ? 'missing path' : `branch ${w.branch} merged`}`);
    if (!merged.length && !gone.length && !staleWt.length) out('  clean');
  }
}

// ================================================================ OS scheduler
async function schedule() {
  const sub = args[0] || 'show';
  const script = join(homeDir(), 'bin', 'daily-assistant.mjs');
  const checks = (cfg.watch?.checks || []).filter((c) => c.enabled !== false && c.check);
  const plan = checks.map((c) => ({ c, t: cronTime(c.cron) }));
  if (process.platform !== 'win32') {
    out('# crontab entries (add with `crontab -e`):');
    for (const { c } of plan) out(`${c.cron} DAILY_ASSISTANT_CONFIG="${configPath()}" "${nodePath()}" "${script}" check ${c.id} --notify`);
    return;
  }
  const name = (id) => `daily-assistant\\${id}`;
  if (sub === 'show') {
    let csv = '';
    try { csv = execFileSync('schtasks', ['/Query', '/FO', 'CSV', '/NH'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { /* none */ }
    const rows = csv.split(/\r?\n/).filter((l) => l.includes('\\daily-assistant\\'));
    out(rows.length ? rows.map((l) => l.split('","').slice(0, 2).join('  ').replace(/"/g, '')).join('\n') : 'no scheduled checks installed');
    return;
  }
  for (const { c, t } of plan) {
    if (sub === 'install') {
      if (!t) { out(`skip ${c.id}: cron "${c.cron}" not convertible (fixed minute/hour, day-of-week only)`); continue; }
      const days = t.days.length === 7 ? null : t.days.map((d) => DOW[d].toUpperCase()).join(',');
      const tr = `"${nodePath()}" "${script}" check ${c.id} --notify`;
      const a = ['/Create', '/F', '/TN', name(c.id), '/TR', tr, '/ST', `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`, ...(days ? ['/SC', 'WEEKLY', '/D', days] : ['/SC', 'DAILY'])];
      if (!flags.yes) { out(`would run: schtasks ${a.map((x) => (/\s/.test(x) ? `'${x}'` : x)).join(' ')}`); continue; }
      try { execFileSync('schtasks', a, { stdio: 'ignore' }); out(`installed ${name(c.id)} at ${a[a.indexOf('/ST') + 1]}`); } catch (e) { out(`failed ${c.id}: ${e.message}`); }
    } else if (sub === 'remove') {
      if (!flags.yes) { out(`would run: schtasks /Delete /F /TN ${name(c.id)}`); continue; }
      try { execFileSync('schtasks', ['/Delete', '/F', '/TN', name(c.id)], { stdio: 'ignore' }); out(`removed ${name(c.id)}`); } catch { out(`not found ${name(c.id)}`); }
    }
  }
  if (!flags.yes && sub !== 'show') out('(dry run — add --yes to apply)');
}

// Node path for the OS scheduler, stable across version-manager upgrades. Version managers (proto…) put the
// versioned tool dir first on PATH while running, so skip the running binary; also skip `shims` dirs — a shim
// resolves the version from cwd and fails in the scheduler's cwd without a global pin. proto's `bin/node` is a
// relinked real binary, so it qualifies. Fall back to this process (works, but pinned to the current version).
function nodePath() {
  try {
    const self = process.execPath.toLowerCase();
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', process.platform === 'win32' ? ['node'] : ['-a', 'node'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const stable = found.find((p) => p.toLowerCase() !== self && !/[\\/]shims[\\/]/i.test(p));
    if (stable) return stable;
  } catch { /* not on PATH */ }
  return process.execPath;
}

// ================================================================ dispatch (last: helpers above must be initialized)
const commands = { brief, check, today, mark, todo, commits, 'tidy-plan': tidyPlan, 'tidy-apply': tidyApply, 'git-stale': gitStale, schedule };
if (!commands[cmd]) { out(`unknown command: ${cmd}`); process.exit(2); }
process.exitCode = (await commands[cmd]()) || 0;
