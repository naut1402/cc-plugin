#!/usr/bin/env node
// usage — token use from Claude Code transcripts, calibrated against plan usage % (status line samples), per-task
// history for estimates, shell-command stats from the activity log, and deterministic facts for a human handover.
// Stable path (synced by the SessionStart hook): ~/.daily-assistant/bin/usage.mjs
// Data: <usage.dir> (default ~/.daily-assistant/usage): samples.jsonl, rate.json, days/<date>.json.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, configPath, homeDir, expandHome, tzOf, nowParts, taskIds, git, logDir, readDay, usageDir,
} from './lib.mjs';

const USAGE = `Usage: node usage.mjs <command> [options]
  status                              current plan usage %, tokens in this 5-hour window, what is left
  day [DATE] [--save] [--json]        tokens of a day by model / task / session (+ command stats with --save)
  rate [--days=N] [--json]            calibrate: weighted tokens per 1% of the 5-hour and weekly limit
  rate --set=<5h>[,<week>]            set the rate by hand (machines without plan samples, e.g. long-lived token)
  budget <pct> [--window=5h|week] [--split=N] [--json]   % of a limit → token budget (split across N agents)
  spent [--sid=S|--cwd=DIR] [--since=HH:MM] [--by-agent] [--json]   session spend, main thread + each subagent, in %
  phase record --task=ID --phase=P --from=T [--to=T] [--agent=A] [--sid=S]   save one phase sample (T = HH:MM | ISO)
  phase scan --task=ID [--sid=S] [--dry-run]   save samples from [phase:<name>:start|end] markers the agents wrote
  phase list [--task=ID] | drop --task=ID [--phase=P]
  task <ID...> [--days=N] [--json]    tokens and % per task (saved days + transcripts still on disk)
  estimate --like=<ID,ID> [--json]    estimate a new task from similar past tasks: per phase with S/M/L and the
                                      time to finish under the plan limits when phase samples exist, else totals
  commands [DATE] [--days=N] [--task=ID] [--sid=S] [--top=N] [--md] [--json]
                                      shell commands run by Claude (activity log), grouped by command head
  facts [--cwd=DIR] [--sid=S] [--task=ID]   handover facts: session, git state, usage, recent commands, open todo
  setup [--yes] | unsetup [--yes]     wrap the Claude Code status line so plan usage % gets sampled
Exit codes: 0 ok · 1 error · 2 missing data / config`;

function die(msg, code = 1) { process.stderr.write(msg + '\n'); process.exit(code); }
const out = (s = '') => process.stdout.write(s + '\n');

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {};
const args = [];
for (const a of argv) {
  const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
  if (m) flags[m[1]] = m[2] ?? true; else args.push(a);
}

const cfg = existsSync(configPath()) ? loadConfig() : die(`daily-assistant config not found at ${configPath()} — run /init-daily-assistant first`, 2);
const u = cfg.usage || {};
const tz = tzOf(cfg);
const now = nowParts(tz);
const patterns = cfg.task_id_patterns || [];
const DIR = usageDir(cfg);
const DAYS = join(DIR, 'days');
const CLAUDE = process.env.CLAUDE_CONFIG_DIR ? resolve(expandHome(process.env.CLAUDE_CONFIG_DIR)) : join(homedir(), '.claude');
const PROJECTS = expandHome(u.transcripts || join(CLAUDE, 'projects'));
const HERE = dirname(fileURLToPath(import.meta.url));
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const fmtK = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : 0; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Local wall-clock time of an instant, same shape as the activity log `t` (YYYY-MM-DDTHH:mm:ss in user.timezone).
const LOCAL = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const localTime = (ms) => { const p = Object.fromEntries(LOCAL.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; };
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- weighting
// Plan limits track compute, not raw tokens: a cache read costs far less than an output token. Ratios follow the
// published per-token price ratios between token types; per-model factors are opt-in (usage.model_weights).
const W = { input: 1, output: 5, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1, ...(u.weights || {}) };
const MW = Object.entries(u.model_weights || {});
const modelWeight = (model) => MW.find(([k]) => String(model).toLowerCase().includes(k.toLowerCase()))?.[1] ?? 1;

// ---------------------------------------------------------------- transcripts
function transcriptFiles(sinceMs) {
  const files = [];
  const add = (f) => { try { if (statSync(f).mtimeMs >= sinceMs) files.push(f); } catch { /* gone */ } };
  let projects = [];
  try { projects = readdirSync(PROJECTS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(PROJECTS, e.name)); } catch { return files; }
  for (const p of projects) {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) add(join(p, e.name));
      else if (e.isDirectory()) {
        const sub = join(p, e.name, 'subagents');
        if (existsSync(sub)) for (const f of readdirSync(sub)) if (f.endsWith('.jsonl')) add(join(sub, f));
      }
    }
  }
  return files;
}

// One record per API response (streamed content blocks repeat the same usage; keep the last copy).
function scan(fromMs, toMs = Date.now(), { sid } = {}) {
  const seen = new Map();
  for (const f of transcriptFiles(fromMs)) {
    if (sid && !f.includes(sid)) continue;
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let x;
      try { x = JSON.parse(line); } catch { continue; }
      const m = x.message, us = m?.usage;
      if (!us || !x.timestamp || m.model === '<synthetic>') continue;
      const ms = Date.parse(x.timestamp);
      if (ms < fromMs || ms > toMs) continue;
      const cw = us.cache_creation_input_tokens || 0;
      const cw1h = us.cache_creation?.ephemeral_1h_input_tokens || 0;
      const r = {
        ms, sid: x.sessionId, model: m.model || '?', sub: !!x.isSidechain, agent: x.agentId, file: x.agentId ? f : undefined,
        in: us.input_tokens || 0, out: us.output_tokens || 0, cw5: cw - cw1h, cw1h, cr: us.cache_read_input_tokens || 0,
      };
      r.w = (r.in * W.input + r.out * W.output + r.cw5 * W.cache_write_5m + r.cw1h * W.cache_write_1h + r.cr * W.cache_read) * modelWeight(r.model);
      seen.set(`${m.id}|${x.requestId}`, r);
    }
  }
  return [...seen.values()].sort((a, b) => a.ms - b.ms);
}

const sum = (rs) => rs.reduce((a, r) => ({ msgs: a.msgs + 1, in: a.in + r.in, out: a.out + r.out, cw: a.cw + r.cw5 + r.cw1h, cr: a.cr + r.cr, w: a.w + r.w }), { msgs: 0, in: 0, out: 0, cw: 0, cr: 0, w: 0 });
const raw = (t) => t.in + t.out + t.cw + t.cr;

// ---------------------------------------------------------------- task attribution (activity log)
// A response belongs to the task IDs of the latest prompt in its session that named one, else the session's branch.
function taskResolver(dates) {
  const bySid = new Map();
  for (const d of dates) {
    for (const e of readDay(logDir(cfg), d)) {
      if (!e.sid || !(e.ev === 'session-start' || e.ev === 'prompt')) continue;
      if (!bySid.has(e.sid)) bySid.set(e.sid, { base: [], marks: [] });
      const s = bySid.get(e.sid);
      if (e.ev === 'session-start' && e.tasks?.length) s.base = e.tasks;
      if (e.ev === 'prompt' && e.tasks?.length) s.marks.push(e);
    }
  }
  for (const s of bySid.values()) s.marks.sort((a, b) => a.t.localeCompare(b.t));
  return (r) => {
    const s = bySid.get(r.sid);
    if (!s) return ['other'];
    const t = localTime(r.ms);
    const hit = s.marks.filter((e) => e.t <= t).at(-1);
    return hit?.tasks || (s.base.length ? s.base : ['other']);
  };
}

function groupDay(rs, resolveTasks) {
  const byModel = {}, byTask = {}, bySid = {};
  for (const r of rs) {
    (byModel[r.model] ||= []).push(r);
    const ts = resolveTasks(r);
    for (const t of ts) { const g = (byTask[t] ||= { w: 0, raw: 0, msgs: 0, sessions: new Set() }); g.w += r.w / ts.length; g.raw += (r.in + r.out + r.cw5 + r.cw1h + r.cr) / ts.length; g.msgs++; g.sessions.add(r.sid); }
    const s = (bySid[r.sid] ||= { w: 0, msgs: 0, tasks: new Set(), from: r.ms, to: r.ms });
    s.w += r.w; s.msgs++; s.to = r.ms; ts.forEach((t) => s.tasks.add(t));
  }
  const fix = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
  return {
    totals: sum(rs),
    byModel: fix(byModel, sum),
    byTask: fix(byTask, (g) => ({ w: Math.round(g.w), raw: Math.round(g.raw), msgs: g.msgs, sessions: [...g.sessions] })),
    bySid: fix(bySid, (s) => ({ w: Math.round(s.w), msgs: s.msgs, tasks: [...s.tasks], from: localTime(s.from).slice(11, 16), to: localTime(s.to).slice(11, 16) })),
  };
}

// Responses of local days [from..to] (dates in user.timezone).
function scanDays(from, to) {
  const start = Date.parse(`${addDays(from, -1)}T00:00:00Z`), end = Date.parse(`${addDays(to, 1)}T23:59:59Z`);
  const byDate = new Map();
  for (const r of scan(start, end)) {
    const d = localTime(r.ms).slice(0, 10);
    if (d < from || d > to) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  return byDate;
}

// ---------------------------------------------------------------- plan usage samples / rate
function samples() {
  try { return readFileSync(join(DIR, 'samples.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); }
  catch { return []; }
}

// For each limit window (same resets_at) with enough movement: tokens spent between its first and last sample / Δ%.
// Usage from other machines or claude.ai also moves the % but is not in local transcripts → ratio skews low.
function calibrate(days) {
  const ss = samples().filter((s) => Date.parse(s.t) >= Date.now() - days * 864e5);
  if (ss.length < 2) return null;
  const rs = scan(Date.parse(ss[0].t), Date.parse(ss.at(-1).t));
  const between = (a, b) => { let w = 0, n = 0; for (const r of rs) if (r.ms > a && r.ms <= b) { w += r.w; n += raw({ in: r.in, out: r.out, cw: r.cw5 + r.cw1h, cr: r.cr }); } return { w, n }; };
  const res = {};
  for (const [key, p, rk, minD] of [['five_hour', 'p5', 'r5', Number(u.min_delta_pct ?? 3)], ['seven_day', 'p7', 'r7', 1]]) {
    const wins = new Map();
    for (const s of ss) if (s[rk] && typeof s[p] === 'number') { if (!wins.has(s[rk])) wins.set(s[rk], []); wins.get(s[rk]).push(s); }
    const rows = [];
    for (const [reset, w] of wins) {
      const a = w[0], b = w.at(-1), dp = b[p] - a[p];
      if (dp < minD) continue;
      const tk = between(Date.parse(a.t), Date.parse(b.t));
      if (!tk.w) continue;
      rows.push({ resets: localTime(reset * 1000).slice(0, 16), from: localTime(Date.parse(a.t)).slice(0, 16), to: localTime(Date.parse(b.t)).slice(0, 16), dp: Math.round(dp * 10) / 10, w: Math.round(tk.w), perPct: Math.round(tk.w / dp), rawPerPct: Math.round(tk.n / dp) });
    }
    if (rows.length) {
      const totW = rows.reduce((a, r) => a + r.w, 0), totP = rows.reduce((a, r) => a + r.dp, 0);
      res[key] = { perPct: Math.round(totW / totP), median: Math.round(median(rows.map((r) => r.perPct))), rawPerPct: Math.round(median(rows.map((r) => r.rawPerPct))), windows: rows };
    }
  }
  return { computed: new Date().toISOString(), days, weights: W, ...res };
}

// Calibrated rate, else usage.per_pct from config. A long-lived token (claude setup-token / CI) gives the status line
// no rate_limits, so such machines take the rate calibrated elsewhere — config can travel with /sync-memory.
function cachedRate() {
  const r = readJson(join(DIR, 'rate.json'));
  if (r?.five_hour || r?.seven_day) return r;
  const c = u.per_pct || {};
  if (!Number(c.five_hour) && !Number(c.seven_day)) return null;
  return { source: 'config', ...(Number(c.five_hour) ? { five_hour: { perPct: Number(c.five_hour) } } : {}), ...(Number(c.seven_day) ? { seven_day: { perPct: Number(c.seven_day) } } : {}) };
}
const pct = (w, rate, key) => (rate?.[key]?.perPct ? Math.round((w / rate[key].perPct) * 10) / 10 : null);
const pctStr = (w, rate) => { const a = pct(w, rate, 'five_hour'), b = pct(w, rate, 'seven_day'); return [a !== null && `${a}% of 5h`, b !== null && `${b}% of week`].filter(Boolean).join(' · ') || '% n/a (run rate)'; };

// ---------------------------------------------------------------- shell commands
const SUBCMD = new Set('git gh npm pnpm yarn npx bunx uv uvx pip pip3 docker kubectl cargo go composer rtk claude winget scoop brew az gcloud aws terraform make dotnet artisan systemctl schtasks'.split(' '));
const RUNTIME = new Set(['node', 'python', 'python3', 'py', 'bun', 'deno', 'php', 'tsx', 'ts-node', 'pwsh', 'powershell', 'bash', 'sh']);
const SCRIPT = /\.(m?js|cjs|ts|py|php|sh|ps1)$/i;
const SKIP = new Set(['cd', 'pushd', 'popd', 'true', 'set', 'export']);

function words(s) {
  const out = [];
  let cur = '', q = null, has = false;
  for (const c of s) {
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

function segments(cmd) {
  const segs = [];
  let cur = '', q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '\n' || c === ';' || c === '|' || (c === '&' && cmd[i + 1] === '&')) { segs.push(cur); cur = ''; if (cmd[i + 1] === c) i++; continue; }
    cur += c;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
}

// "git -C repo diff --stat" → "git diff"; "node ~/.daily-assistant/bin/usage.mjs day" → "node usage.mjs day".
function head(seg) {
  let w = words(seg);
  while (w.length && /^\w+=/.test(w[0])) w.shift();
  while (['sudo', 'time', 'nohup', 'exec', 'command'].includes(w[0])) w.shift();
  if (w[0] === 'rtk' && w[1] === 'proxy') w = w.slice(2);
  if (!w.length) return null;
  const prog = basename(w[0]).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (SKIP.has(prog)) return null;
  const rest = w.slice(1);
  const next = (from = 0) => {
    for (let i = from; i < rest.length; i++) {
      if (rest[i].startsWith('-')) { if (['-C', '-c', '--prefix', '--cwd', '--dir'].includes(rest[i]) && prog !== 'bash' && prog !== 'sh') i++; continue; }
      return i;
    }
    return -1;
  };
  if (RUNTIME.has(prog)) {
    const m = rest.indexOf('-m');
    if (m >= 0 && rest[m + 1]) return `${prog} -m ${rest[m + 1]}`;
    const i = next();
    if (i >= 0 && SCRIPT.test(rest[i])) {
      const j = next(i + 1);
      const sub = j >= 0 && /^[a-z][\w:-]*$/i.test(rest[j]) ? ` ${rest[j]}` : '';
      return `${prog} ${basename(rest[i])}${sub}`;
    }
    if (prog === 'bun' && i >= 0) return `bun ${rest[i]}`;
    return prog;
  }
  if (SUBCMD.has(prog)) {
    const i = next();
    if (i < 0) return prog;
    const sub = rest[i];
    if (['npx', 'bunx', 'uvx'].includes(prog)) return `${prog} ${sub}`;
    if (['npm', 'pnpm', 'yarn'].includes(prog) && ['run', 'exec'].includes(sub) && rest[i + 1]) return `${prog} ${sub} ${rest[i + 1]}`;
    if (prog === 'gh' && rest[i + 1] && /^[a-z-]+$/.test(rest[i + 1])) return `gh ${sub} ${rest[i + 1]}`;
    return /^[a-z][\w:.-]*$/i.test(sub) ? `${prog} ${sub}` : prog;
  }
  return prog;
}

// Secrets never leave the machine: applied to every command shown in reports, journal and runbooks.
const REDACT = [
  [/(authorization:\s*(?:bearer|basic|token)\s+)(?![$%])[^\s'"]+/gi, '$1***'],
  [/(\bbearer\s+)(?![$%])[A-Za-z0-9._~+/-]{8,}=*/gi, '$1***'],
  [/((?:^|[\s&?;,{])["']?[\w.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|apikey|credential)[\w.-]*["']?\s*[=:]\s*)(?![$%])("[^"]*"|'[^']*'|[^\s&;,}]+)/gi, '$1***'],
  [/(--?(?:token|password|passwd|secret|api-key|apikey|auth|pat)(?:=|\s+))(?![$%-])("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  [/(\/\/[^/\s:@]+:)[^@\s/]+@/g, '$1***@'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\b/g, '***'],
];
const redact = (s) => REDACT.reduce((a, [re, to]) => a.replace(re, to), String(s));
const oneLine = (s, n = 160) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

function commandStats(entries) {
  const heads = {}, programs = {};
  const sids = new Set();
  for (const e of entries) {
    sids.add(e.sid);
    const seen = new Set();
    for (const seg of segments(e.cmd)) {
      const h = head(seg);
      if (!h || seen.has(h)) continue;
      seen.add(h);
      const g = (heads[h] ||= { n: 0, example: '', tasks: new Set(), last: '' });
      g.n++; g.last = e.t;
      if (seg.length > g.example.length && seg.length < 200) g.example = redact(oneLine(seg, 200));
      for (const t of taskIds(`${e.cmd}`, patterns)) g.tasks.add(t);
      const p = h.split(' ')[0];
      programs[p] = (programs[p] || 0) + 1;
    }
  }
  return {
    calls: entries.length, sessions: sids.size,
    heads: Object.fromEntries(Object.entries(heads).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, { n: v.n, example: v.example, tasks: [...v.tasks], last: v.last }])),
    programs: Object.fromEntries(Object.entries(programs).sort((a, b) => b[1] - a[1])),
  };
}

function bashEntries(dates, { task, sid } = {}) {
  const all = [];
  for (const d of dates) {
    const day = readDay(logDir(cfg), d);
    let tasksBySid = null;
    if (task) {
      tasksBySid = new Map();
      for (const e of day) if (e.sid && e.tasks?.length) { if (!tasksBySid.has(e.sid)) tasksBySid.set(e.sid, new Set()); e.tasks.forEach((t) => tasksBySid.get(e.sid).add(t)); }
    }
    for (const e of day) {
      if (e.ev !== 'bash' || !e.cmd) continue;
      if (sid && e.sid !== sid) continue;
      if (task && !tasksBySid.get(e.sid)?.has(task.toUpperCase()) && !taskIds(e.cmd, patterns).includes(task.toUpperCase())) continue;
      all.push(e);
    }
  }
  return all;
}

// ---------------------------------------------------------------- commands
async function status() {
  const s = samples().at(-1);
  const rate = cachedRate();
  if (!s) { out('no plan usage sample yet — run `setup` (status line wrapper), then use Claude Code for a while'); return 2; }
  const age = Math.round((Date.now() - Date.parse(s.t)) / 60000);
  const reset5 = s.r5 ? localTime(s.r5 * 1000) : null;
  out(`plan usage: 5h ${s.p5 ?? '?'}%${reset5 ? ` (resets ${reset5.slice(5, 16).replace('T', ' ')})` : ''} · week ${s.p7 ?? '?'}%${s.r7 ? ` (resets ${localTime(s.r7 * 1000).slice(5, 16).replace('T', ' ')})` : ''} · sampled ${age} min ago`);
  if (s.r5 && s.r5 * 1000 > Date.now()) {
    const t = sum(scan(s.r5 * 1000 - 5 * 3600e3));
    out(`this 5h window (local transcripts): ${fmtK(t.w)} weighted · ${fmtK(raw(t))} raw tokens · ${t.msgs} responses`);
  }
  if (rate?.five_hour) {
    const left5 = Math.max(0, 100 - (s.p5 ?? 0)) * rate.five_hour.perPct;
    const left7 = rate.seven_day && s.p7 !== undefined ? Math.max(0, 100 - s.p7) * rate.seven_day.perPct : null;
    out(`1% ≈ ${fmtK(rate.five_hour.perPct)} weighted (5h)${rate.seven_day ? ` · ${fmtK(rate.seven_day.perPct)} (week)` : ''} → left ≈ ${fmtK(left5)} (5h)${left7 !== null ? ` · ${fmtK(left7)} (week)` : ''}`);
  } else out('rate not calibrated yet — run `rate` once a few windows have samples');
}

async function day() {
  const date = args[0] || now.date;
  if (!isDate(date)) die(`invalid date ${date}`, 2);
  const rs = scanDays(date, date).get(date) || [];
  const g = groupDay(rs, taskResolver([addDays(date, -1), date]));
  const rate = cachedRate();
  const rec = { date, weights: W, rate: rate ? { five_hour: rate.five_hour?.perPct, seven_day: rate.seven_day?.perPct } : null, usage: g };
  if (flags.save) {
    rec.commands = commandStats(bashEntries([date]));
    mkdirSync(DAYS, { recursive: true });
    writeFileSync(join(DAYS, `${date}.json`), JSON.stringify(rec, null, 1) + '\n');
  }
  if (flags.json) { out(JSON.stringify(rec)); return; }
  const t = g.totals;
  out(`${date} · ${t.msgs} responses · ${fmtK(t.w)} weighted (${pctStr(t.w, rate)}) · raw ${fmtK(raw(t))} = in ${fmtK(t.in)} / out ${fmtK(t.out)} / cache write ${fmtK(t.cw)} / cache read ${fmtK(t.cr)}`);
  for (const [m, v] of Object.entries(g.byModel)) out(`  model ${m.padEnd(22)} ${fmtK(v.w).padStart(7)} weighted · ${v.msgs} responses`);
  for (const [k, v] of Object.entries(g.byTask).sort((a, b) => b[1].w - a[1].w)) out(`  task  ${k.padEnd(22)} ${fmtK(v.w).padStart(7)} weighted · ${pctStr(v.w, rate)} · ${v.sessions.length} session(s)`);
  if (flags.save) out(`saved ${join(DAYS, `${date}.json`)} (with ${rec.commands.calls} shell commands)`);
}

async function rateCmd() {
  if (flags.set) {
    // Manual rate, e.g. copied from a machine that can sample (`rate` there prints it).
    const [p5, p7] = String(flags.set).split(',').map((s) => Number(s.replace(/k$/i, '')) * (/k$/i.test(s) ? 1e3 : 1));
    if (!(p5 > 0)) die('usage: rate --set=<weighted tokens per 1% of 5h>[,<per 1% of week>]  (e.g. --set=120k,600k)', 2);
    const r = { computed: new Date().toISOString(), source: 'manual', weights: W, five_hour: { perPct: Math.round(p5) }, ...(p7 > 0 ? { seven_day: { perPct: Math.round(p7) } } : {}) };
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, 'rate.json'), JSON.stringify(r, null, 1) + '\n');
    out(`rate set: 1% of 5h ≈ ${fmtK(r.five_hour.perPct)}${r.seven_day ? ` · 1% of week ≈ ${fmtK(r.seven_day.perPct)}` : ''} weighted tokens`);
    return;
  }
  const days = Number(flags.days) || Number(u.rate_days) || 30;
  const r = calibrate(days);
  if (!r || (!r.five_hour && !r.seven_day)) {
    out(`not enough samples in the last ${days} days (need ≥2 samples in one window with ≥${u.min_delta_pct ?? 3}% movement) — keep the status line wrapper on`);
    return 2;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'rate.json'), JSON.stringify(r, null, 1) + '\n');
  if (flags.json) { out(JSON.stringify(r)); return; }
  for (const k of ['five_hour', 'seven_day']) {
    const x = r[k];
    if (!x) { out(`${k}: no window with enough movement yet`); continue; }
    out(`${k}: 1% ≈ ${fmtK(x.perPct)} weighted tokens (median ${fmtK(x.median)}, raw ≈ ${fmtK(x.rawPerPct)}) from ${x.windows.length} window(s)`);
    for (const w of x.windows.slice(-6)) out(`  ${w.from}→${w.to.slice(11)} +${w.dp}% · ${fmtK(w.w)} → ${fmtK(w.perPct)}/1%`);
  }
  out('note: usage from other machines / claude.ai moves the % too, so local tokens per 1% may read low');
}

// Per task, per day: saved day files first, then live transcripts for days not saved.
function taskHistory(ids, days) {
  const want = new Set(ids.map((x) => x.toUpperCase()));
  const res = Object.fromEntries([...want].map((id) => [id, { w: 0, raw: 0, msgs: 0, days: {} }]));
  const saved = new Set();
  if (existsSync(DAYS)) {
    for (const f of readdirSync(DAYS).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
      const d = readJson(join(DAYS, f));
      if (!d?.usage) continue;
      saved.add(d.date);
      for (const id of want) { const v = d.usage.byTask?.[id]; if (v) { res[id].w += v.w; res[id].raw += v.raw || 0; res[id].msgs += v.msgs; res[id].days[d.date] = v.w; } }
    }
  }
  const from = addDays(now.date, -(days - 1));
  const live = [];
  for (let d = from; d <= now.date; d = addDays(d, 1)) if (!saved.has(d)) live.push(d);
  if (live.length) {
    const byDate = scanDays(live[0], live.at(-1));
    for (const d of live) {
      const rs = byDate.get(d);
      if (!rs) continue;
      const g = groupDay(rs, taskResolver([addDays(d, -1), d]));
      for (const id of want) { const v = g.byTask[id]; if (v) { res[id].w += v.w; res[id].raw += v.raw; res[id].msgs += v.msgs; res[id].days[d] = v.w; } }
    }
  }
  return res;
}

async function task() {
  if (!args.length) die('usage: task <ID...> [--days=N]', 2);
  const rate = cachedRate();
  const h = taskHistory(args, Number(flags.days) || 30);
  if (flags.json) { out(JSON.stringify({ rate: rate ? { five_hour: rate.five_hour?.perPct, seven_day: rate.seven_day?.perPct } : null, tasks: h })); return; }
  for (const [id, v] of Object.entries(h)) {
    if (!v.msgs) { out(`${id}: no recorded usage`); continue; }
    out(`${id}: ${fmtK(v.w)} weighted · ${pctStr(v.w, rate)} · ${v.msgs} responses over ${Object.keys(v.days).length} day(s)`);
    out(`  ${Object.entries(v.days).sort().map(([d, w]) => `${d.slice(5)} ${fmtK(w)}`).join(' · ')}`);
  }
}

// ---------------------------------------------------------------- phases
// A phase sample = tokens and time one agent spent on one phase of a task (investigate / code / test …), cut by the
// start/end times its agent reported. Samples feed per-phase estimates, S/M/L sizing and the time simulation.
const PHASES = join(DIR, 'phases.jsonl');
const MARKER = new RegExp(u.phase_marker || String.raw`\[phase:(?<phase>[\w-]+):(?<edge>start|end)(?:@(?<time>[\dT:.+Z-]+))?\]`, 'g');
const metaCache = new Map();
const agentMeta = (file) => { if (!file) return null; if (!metaCache.has(file)) metaCache.set(file, readJson(file.replace(/\.jsonl$/, '.meta.json'))); return metaCache.get(file); };
const agentMatches = (r, a) => {
  if (!a) return true;
  if (a === 'main') return !r.agent;
  const m = agentMeta(r.file) || {};
  return [r.agent, m.name, m.agentType, m.spawnedAgentType].some((v) => v && String(v).toLowerCase().includes(a.toLowerCase()));
};
// Time the agent actually worked: gaps between its responses, each capped at 5 minutes.
const activeMin = (rs) => Math.round(rs.reduce((a, r, i) => a + (i ? Math.min(r.ms - rs[i - 1].ms, 300e3) : 60e3), 0) / 60000);
const parseTime = (s) => (/^\d{1,2}:\d{2}$/.test(s) ? new Date(`${now.date}T${s.padStart(5, '0')}:00`).getTime() : Date.parse(s));

function readPhases() {
  try { return readFileSync(PHASES, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); } catch { return []; }
}

function savePhases(samples) {
  const key = (p) => `${p.task}|${p.phase}|${p.sid}|${p.agent}`;
  const fresh = new Set(samples.map(key));
  const kept = readPhases().filter((p) => !fresh.has(key(p)));
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PHASES, [...kept, ...samples].map((p) => JSON.stringify(p)).join('\n') + '\n');
}

function phaseSample({ task, phase, sid, agent, from, to, src, open }) {
  const rate = cachedRate();
  const rs = scan(from - 60e3, to, { sid }).filter((r) => r.sid === sid && r.ms >= from && agentMatches(r, agent));
  const t = sum(rs);
  const meta = agentMeta(rs.find((r) => r.file)?.file);
  return {
    t: new Date().toISOString(), task: task.toUpperCase(), phase: phase.toLowerCase(), sid, agent: agent || 'all', name: meta?.name || meta?.agentType || '',
    from: new Date(from).toISOString(), to: new Date(to).toISOString(), minutes: Math.round((to - from) / 60000), active: activeMin(rs),
    w: Math.round(t.w), raw: raw(t), msgs: t.msgs, pct5: pct(t.w, rate, 'five_hour'), pctWeek: pct(t.w, rate, 'seven_day'), src, ...(open ? { open: true } : {}),
  };
}

// Phase markers the agents wrote in their own messages (text or the input of a message to the orchestrator).
function findMarkers(sid) {
  const found = new Map();
  const files = transcriptFiles(Date.now() - 30 * 864e5).filter((f) => f.includes(sid));
  // Subagent transcripts first: a marker relayed to the main thread then counts once, for the agent that wrote it.
  files.sort((a, b) => Number(b.includes('subagents')) - Number(a.includes('subagents')));
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"assistant"') || !MARKER.test(line)) continue;
      MARKER.lastIndex = 0;
      let x;
      try { x = JSON.parse(line); } catch { continue; }
      if (x.type !== 'assistant' || x.sessionId !== sid) continue;
      for (const m of line.matchAll(MARKER)) {
        const g = m.groups || {};
        const agent = g.agent || (x.agentId ? x.agentId : 'main');
        const k = `${String(g.phase).toLowerCase()}|${agent}`;
        if ([...found.values()].some((v) => v.phase === String(g.phase).toLowerCase() && v.agent !== agent && v.agent !== 'main' && agent === 'main')) continue;
        const at = g.time ? parseTime(g.time) : Date.parse(x.timestamp);
        const v = found.get(k) || { phase: String(g.phase).toLowerCase(), agent };
        if (g.edge === 'start') v.from = Math.min(v.from ?? at, at); else v.to = Math.max(v.to ?? at, at);
        found.set(k, v);
      }
    }
  }
  return [...found.values()];
}

async function phaseCmd() {
  const [sub = 'list'] = args;
  if (sub === 'list') {
    const ps = readPhases().filter((p) => !flags.task || p.task === String(flags.task).toUpperCase());
    if (flags.json) { out(JSON.stringify(ps)); return; }
    if (!ps.length) { out('no phase samples'); return; }
    for (const p of ps) out(`${p.task.padEnd(10)} ${p.phase.padEnd(12)} ${fmtK(p.w).padStart(7)} · ${p.pct5 ?? '?'}% 5h · active ${p.active}m / wall ${p.minutes}m · ${p.name || p.agent}${p.open ? ' (open)' : ''}`);
    return;
  }
  if (!flags.task) die('usage: phase record|scan|drop --task=<ID> …', 2);
  if (sub === 'drop') {
    const keep = readPhases().filter((p) => !(p.task === String(flags.task).toUpperCase() && (!flags.phase || p.phase === String(flags.phase).toLowerCase())));
    mkdirSync(DIR, { recursive: true });
    writeFileSync(PHASES, keep.map((p) => JSON.stringify(p)).join('\n') + (keep.length ? '\n' : ''));
    out(`dropped samples of ${String(flags.task).toUpperCase()}${flags.phase ? ` / ${flags.phase}` : ''}`);
    return;
  }
  const { sid } = currentSession();
  if (!sid) { out('no session found — pass --sid=<session id> or --cwd=<folder of the session>'); return 2; }
  let samples = [];
  if (sub === 'record') {
    const from = parseTime(String(flags.from || '')), to = flags.to ? parseTime(String(flags.to)) : Date.now();
    if (!flags.phase || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) die('usage: phase record --task=<ID> --phase=<name> --from=<HH:MM|ISO> [--to=<HH:MM|ISO>] [--agent=<id|name|main>] [--sid=S]', 2);
    samples = [phaseSample({ task: flags.task, phase: flags.phase, sid, agent: flags.agent, from, to, src: 'range' })];
  } else if (sub === 'scan') {
    const ms = findMarkers(sid);
    if (!ms.length) { out(`no phase markers in session ${sid} (pattern ${MARKER.source})`); return 2; }
    for (const m of ms) {
      if (m.from === undefined) { out(`skip ${m.phase} (${m.agent}): end without start`); continue; }
      samples.push(phaseSample({ task: flags.task, phase: m.phase, sid, agent: m.agent, from: m.from, to: m.to ?? Date.now(), src: 'marker', open: m.to === undefined }));
    }
  } else die('usage: phase list|record|scan|drop …', 2);
  if (!flags['dry-run']) savePhases(samples);
  if (flags.json) { out(JSON.stringify(samples)); return; }
  for (const p of samples) out(`${flags['dry-run'] ? 'would record' : 'recorded'} ${p.task} ${p.phase} (${p.name || p.agent}): ${fmtK(p.w)} weighted · ${p.pct5 ?? '?'}% 5h · active ${p.active}m / wall ${p.minutes}m${p.open ? ' · still open' : ''}`);
}

// Sizes are relative to past work: S/M/L = below / between / above the usage.size_quantiles of recorded samples.
function sizer(values) {
  if (values.length < 3) return () => null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => { const i = p * (s.length - 1), lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
  const [a, b] = (Array.isArray(u.size_quantiles) ? u.size_quantiles : [0.33, 0.67]).map(Number).map(q);
  return (v) => (v <= a ? 'S' : v <= b ? 'M' : 'L');
}

// Walks the phases through the 5-hour windows from the current plan usage: when a window fills, wait for its reset.
function simulate(steps, rate) {
  const per5 = rate?.five_hour?.perPct;
  if (!per5) return null;
  const s = samples().at(-1);
  const H5 = 5 * 3600e3, cap = 100 * per5;
  let t = Date.now(), wait = 0;
  let winEnd = s?.r5 && s.r5 * 1000 > t ? s.r5 * 1000 : null;
  let used = winEnd ? (s.p5 || 0) * per5 : 0;
  const res = [];
  for (const st of steps) {
    let need = st.w;
    const speed = st.w / Math.max(60e3, st.active * 60e3);
    const start = t;
    for (let guard = 0; need > 1 && guard < 500; guard++) {
      if (winEnd && t >= winEnd) { winEnd = null; used = 0; }
      if (!winEnd) winEnd = t + H5;
      const room = cap - used;
      if (room <= 1) { wait += winEnd - t; t = winEnd; continue; }
      const take = Math.min(need, room, speed * (winEnd - t));
      t += take / speed; used += take; need -= take;
    }
    res.push({ phase: st.phase, start, end: t });
  }
  const total = steps.reduce((a, x) => a + x.w, 0);
  const weekLeft = rate.seven_day?.perPct && s?.p7 !== undefined ? (100 - s.p7) * rate.seven_day.perPct : null;
  return { end: t, wait, steps: res, overWeek: weekLeft !== null && total > weekLeft, weekReset: s?.r7 ? s.r7 * 1000 : null, p5: s?.p5, p7: s?.p7, r5: s?.r5 };
}

function phaseEstimate(like, rate) {
  const all = readPhases().filter((p) => !p.open);
  const byTaskPhase = new Map();
  for (const p of all) { const k = `${p.task}|${p.phase}`; const v = byTaskPhase.get(k) || { task: p.task, phase: p.phase, w: 0, active: 0, first: p.from }; v.w += p.w; v.active += p.active; if (p.from < v.first) v.first = p.from; byTaskPhase.set(k, v); }
  const rows = [...byTaskPhase.values()];
  const refs = rows.filter((r) => like.includes(r.task));
  if (!refs.length) return null;
  // Phase order = typical start order in the reference tasks.
  const order = [...new Set(refs.sort((a, b) => a.first.localeCompare(b.first)).map((r) => r.phase))];
  const phases = order.map((ph) => {
    const rs = refs.filter((r) => r.phase === ph);
    const w = Math.round(median(rs.map((r) => r.w))), active = Math.round(median(rs.map((r) => r.active)));
    return { phase: ph, w, max: Math.max(...rs.map((r) => r.w)), active, n: rs.length, size: sizer(rows.filter((r) => r.phase === ph).map((r) => r.w))(w), pct5: pct(w, rate, 'five_hour'), pctWeek: pct(w, rate, 'seven_day') };
  });
  const totals = new Map();
  for (const r of rows) totals.set(r.task, (totals.get(r.task) || 0) + r.w);
  const w = phases.reduce((a, p) => a + p.w, 0), active = phases.reduce((a, p) => a + p.active, 0);
  return { refs: [...new Set(refs.map((r) => r.task))], phases, total: { w, active, size: sizer([...totals.values()])(w), pct5: pct(w, rate, 'five_hour'), pctWeek: pct(w, rate, 'seven_day'), windows5: pct(w, rate, 'five_hour') !== null ? Math.round((pct(w, rate, 'five_hour') / 100) * 100) / 100 : null, history: totals.size }, time: simulate(phases, rate) };
}

const fmtDur = (min) => `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}`;

async function estimate() {
  const like = String(flags.like || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (!like.length) die('usage: estimate --like=<ID,ID,...>  (similar finished tasks)', 2);
  const rate = cachedRate();
  const pe = phaseEstimate(like, rate);
  if (pe) {
    if (flags.json) { out(JSON.stringify(pe)); return; }
    out(`by phase, from ${pe.refs.length} similar task(s) with phase samples: ${pe.refs.join(', ')}${like.filter((x) => !pe.refs.includes(x)).length ? ` (no phase data: ${like.filter((x) => !pe.refs.includes(x)).join(', ')})` : ''}`);
    for (const p of pe.phases) out(`  ${p.phase.padEnd(12)} ${fmtK(p.w).padStart(7)} (max ${fmtK(p.max)}) · ${pctStr(p.w, rate)} · size ${p.size || '?'} · active ≈${fmtDur(p.active)}`);
    const t = pe.total;
    out(`  ${'total'.padEnd(12)} ${fmtK(t.w).padStart(7)} · ${pctStr(t.w, rate)}${t.windows5 !== null ? ` = ${t.windows5} × 5h window` : ''} · size ${t.size || `? (need ≥3 tasks, have ${t.history})`} · active ≈${fmtDur(t.active)}`);
    const sim = pe.time;
    if (!sim) out('time with limits: n/a (no rate — run `rate`)');
    else {
      out(`now: 5h ${sim.p5 ?? '?'}%${sim.r5 ? ` (resets ${localTime(sim.r5 * 1000).slice(11, 16)})` : ''} · week ${sim.p7 ?? '?'}%`);
      out(`time with limits ≈ ${fmtDur((sim.end - Date.now()) / 60000)} (active ${fmtDur(t.active)} + waiting for resets ${fmtDur(sim.wait / 60000)}) → done ≈ ${localTime(sim.end).slice(5, 16).replace('T', ' ')} if started now`);
      for (const st of sim.steps) out(`  ${st.phase.padEnd(12)} ${localTime(st.start).slice(5, 16).replace('T', ' ')} → ${localTime(st.end).slice(5, 16).replace('T', ' ')}`);
      if (sim.overWeek) out(`⚠ more than what is left of the weekly limit${sim.weekReset ? ` — the rest waits for the weekly reset ${localTime(sim.weekReset).slice(5, 16).replace('T', ' ')}` : ''}`);
    }
    return;
  }
  const h = taskHistory(like, Number(flags.days) || 120);
  const used = Object.entries(h).filter(([, v]) => v.msgs);
  if (!used.length) { out('none of these tasks has recorded usage'); return 2; }
  const ws = used.map(([, v]) => v.w);
  const est = { refs: Object.fromEntries(used.map(([id, v]) => [id, Math.round(v.w)])), missing: Object.keys(h).filter((id) => !h[id].msgs), median: Math.round(median(ws)), mean: Math.round(ws.reduce((a, b) => a + b, 0) / ws.length), max: Math.round(Math.max(...ws)) };
  for (const k of ['median', 'mean', 'max']) est[`${k}Pct`] = { five_hour: pct(est[k], rate, 'five_hour'), seven_day: pct(est[k], rate, 'seven_day') };
  if (flags.json) { out(JSON.stringify(est)); return; }
  out(`based on ${used.length} task(s): ${used.map(([id, v]) => `${id} ${fmtK(v.w)}`).join(' · ')}${est.missing.length ? ` (no data: ${est.missing.join(', ')})` : ''}`);
  for (const k of ['median', 'mean', 'max']) out(`  ${k.padEnd(6)} ${fmtK(est[k]).padStart(7)} weighted · ${pctStr(est[k], rate)}`);
}

async function commands() {
  const to = args[0] || now.date;
  if (!isDate(to)) die(`invalid date ${to}`, 2);
  const n = Number(flags.days) || 1;
  const dates = Array.from({ length: n }, (_, i) => addDays(to, -(n - 1 - i)));
  let st = commandStats(bashEntries(dates, { task: flags.task, sid: flags.sid }));
  // Days past the activity-log retention survive only as saved aggregates.
  if (n > 1 && !flags.task && !flags.sid) {
    const missing = dates.filter((d) => !readDay(logDir(cfg), d).length && existsSync(join(DAYS, `${d}.json`)));
    for (const d of missing) {
      const c = readJson(join(DAYS, `${d}.json`))?.commands;
      if (!c) continue;
      st.calls += c.calls; st.sessions += c.sessions;
      for (const [h, v] of Object.entries(c.heads || {})) { const g = (st.heads[h] ||= { n: 0, example: v.example, tasks: [], last: v.last }); g.n += v.n; }
      for (const [p, v] of Object.entries(c.programs || {})) st.programs[p] = (st.programs[p] || 0) + v;
    }
    st.heads = Object.fromEntries(Object.entries(st.heads).sort((a, b) => b[1].n - a[1].n));
  }
  if (flags.json) { out(JSON.stringify({ dates: [dates[0], to], ...st })); return; }
  const top = Object.entries(st.heads).slice(0, Number(flags.top) || 20);
  const range = n > 1 ? `${dates[0]}…${to}` : to;
  if (flags.md) {
    out(`${st.calls} shell calls in ${st.sessions} session(s) · ${range}`);
    out('');
    out('| # | Command | Times | Example |');
    out('|---|---------|------:|---------|');
    top.forEach(([h, v], i) => out(`| ${i + 1} | \`${h}\` | ${v.n} | \`${v.example.replace(/\|/g, '\\|').replace(/`/g, "'")}\` |`));
    return;
  }
  out(`${range} · ${st.calls} shell calls · ${Object.values(st.heads).reduce((a, v) => a + v.n, 0)} commands · ${st.sessions} session(s)`);
  for (const [h, v] of top) out(`${String(v.n).padStart(4)}  ${h.padEnd(28)} ${oneLine(v.example, 90)}`);
  out(`programs: ${Object.entries(st.programs).slice(0, 12).map(([p, c]) => `${p} ${c}`).join(' · ')}`);
}

// A token budget given as % of a plan limit: "10%/5h for this task", "1% each for 5 subagents".
async function budget() {
  const p = Number(String(args[0] || '').replace('%', ''));
  if (!(p > 0)) die('usage: budget <pct> [--window=5h|week] [--split=N]', 2);
  const key = /^w|7d|seven/i.test(String(flags.window || '')) ? 'seven_day' : 'five_hour';
  const rate = cachedRate();
  if (!rate?.[key]) { out(`no rate for ${key} — run \`rate\` (or \`rate --set=…\` / usage.per_pct on a machine without plan samples)`); return 2; }
  const n = Math.max(1, Number(flags.split) || 1);
  const w = p * rate[key].perPct;
  const rawPer = rate[key].rawPerPct;
  const res = { pct: p, window: key, weighted: Math.round(w), raw: rawPer ? Math.round(p * rawPer) : null, split: n, each: { pct: p / n, weighted: Math.round(w / n), raw: rawPer ? Math.round((p * rawPer) / n) : null }, rate: { perPct: rate[key].perPct, source: rate.source || 'calibrated', computed: rate.computed } };
  if (flags.json) { out(JSON.stringify(res)); return; }
  const label = key === 'five_hour' ? '5h' : 'week';
  out(`${p}% of ${label} ≈ ${fmtK(res.weighted)} weighted tokens${res.raw ? ` (≈ ${fmtK(res.raw)} raw)` : ''} · 1% = ${fmtK(rate[key].perPct)} (${res.rate.source})`);
  if (n > 1) out(`split ${n} ways: ${Math.round((p / n) * 100) / 100}% each ≈ ${fmtK(res.each.weighted)} weighted${res.each.raw ? ` (≈ ${fmtK(res.each.raw)} raw)` : ''}`);
}

// Spend of one session (main thread + each subagent) against the plan limits, optionally since a checkpoint.
async function spent() {
  const { sid } = currentSession();
  if (!sid) { out('no session found — pass --sid=<session id> or --cwd=<folder of the session>'); return 2; }
  let from = Date.now() - 2 * 864e5;
  // HH:MM is read in the machine's zone (normally user.timezone).
  if (flags.since) from = /^\d{1,2}:\d{2}$/.test(flags.since) ? new Date(`${now.date}T${flags.since.padStart(5, '0')}:00`).getTime() : Date.parse(flags.since);
  if (!Number.isFinite(from)) die(`invalid --since ${flags.since} (HH:MM today or ISO time)`, 2);
  const rs = scan(from, Date.now(), { sid }).filter((r) => r.sid === sid);
  const rate = cachedRate();
  const groups = new Map([['main', []]]);
  for (const r of rs) { const k = r.agent || 'main'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const rows = [...groups].map(([k, g]) => {
    const meta = k === 'main' ? null : readJson(g[0].file.replace(/\.jsonl$/, '.meta.json'));
    const t = sum(g);
    return { agent: k, name: meta?.name || meta?.agentType || '', description: meta?.description || '', ...t, w: Math.round(t.w), pct5: pct(t.w, rate, 'five_hour'), pctWeek: pct(t.w, rate, 'seven_day') };
  }).filter((r) => r.msgs);
  const total = sum(rs);
  if (flags.json) { out(JSON.stringify({ sid, since: new Date(from).toISOString(), total: { ...total, pct5: pct(total.w, rate, 'five_hour'), pctWeek: pct(total.w, rate, 'seven_day') }, agents: rows })); return; }
  out(`session ${sid}${flags.since ? ` since ${flags.since}` : ''}: ${fmtK(total.w)} weighted · ${pctStr(total.w, rate)} · ${total.msgs} responses`);
  if (flags['by-agent'] || rows.length > 1) for (const r of rows.sort((a, b) => b.w - a.w)) out(`  ${(r.agent === 'main' ? 'main' : `${r.name || r.agent}`).padEnd(22)} ${fmtK(r.w).padStart(7)} · ${pctStr(r.w, rate)}${r.description ? ` · ${oneLine(r.description, 50)}` : ''}`);
}

// --sid, else the latest session started in --cwd (default: current dir) today or yesterday.
function currentSession() {
  const cwd = resolve(expandHome(flags.cwd || process.cwd()));
  const dates = [addDays(now.date, -1), now.date];
  const entries = dates.flatMap((d) => readDay(logDir(cfg), d));
  const same = (p) => p && resolve(p).toLowerCase() === cwd.toLowerCase();
  const starts = entries.filter((e) => e.ev === 'session-start' && (flags.sid ? e.sid === flags.sid : same(e.cwd)));
  const sid = flags.sid || starts.at(-1)?.sid;
  return { cwd, dates, entries, same, sid, start: starts.find((e) => e.sid === sid) };
}

async function facts() {
  const { cwd, dates, entries, same, sid, start } = currentSession();
  const sesTasks = new Set([...(start?.tasks || []), ...entries.filter((e) => e.sid === sid && e.tasks?.length).flatMap((e) => e.tasks)]);
  const taskId = (flags.task || [...sesTasks][0] || '').toUpperCase();
  out(`# Handover facts · ${now.time.replace('T', ' ')}`);
  out(`session: ${sid || '(none found for this folder today)'}${start ? ` · since ${start.t.slice(11, 16)}` : ''} · tasks: ${[...sesTasks].join(', ') || '-'}${taskId ? ` · focus ${taskId}` : ''}`);
  out(`cwd: ${cwd}`);

  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch) {
    const name = cfg.archive?.git?.main_branch || 'main';
    const main = git(cwd, ['rev-parse', '--verify', '--quiet', `origin/${name}`]) ? `origin/${name}` : name;
    // -b puts a header first, so git()'s trim cannot eat the leading space of the first file line.
    const lines = (git(cwd, ['status', '--short', '-b']) || '').split('\n').slice(1).filter(Boolean);
    const ahead = git(cwd, ['rev-list', '--count', `${main}..HEAD`]);
    const up = git(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}']);
    const unpushed = up ? git(cwd, ['rev-list', '--count', `${up}..HEAD`]) : null;
    out(`\n## Git\nbranch ${branch} · ${ahead ?? '?'} commit(s) ahead of ${main} · ${up ? `upstream ${up}, ${unpushed} unpushed` : 'no upstream (not pushed)'}`);
    out(`uncommitted: ${lines.length} file(s)`);
    for (const l of lines.slice(0, 30)) out(`  ${l}`);
    if (lines.length > 30) out(`  … ${lines.length - 30} more`);
    const log = git(cwd, ['log', '--format=%h %ad %s', '--date=format:%m-%d %H:%M', `${main}..HEAD`, '-8']) || git(cwd, ['log', '--format=%h %ad %s', '--date=format:%m-%d %H:%M', '-5']);
    if (log) { out('recent commits:'); for (const l of log.split('\n')) out(`  ${l}`); }
  } else out('\n## Git\nnot a git repository');

  out('\n## Plan usage');
  const s = samples().at(-1);
  const rate = cachedRate();
  if (s) out(`5h ${s.p5 ?? '?'}%${s.r5 ? ` (resets ${localTime(s.r5 * 1000).slice(11, 16)})` : ''} · week ${s.p7 ?? '?'}% · sampled ${localTime(Date.parse(s.t)).slice(11, 16)}`);
  else out('no sample (status line wrapper not set up)');
  if (sid) { const t = sum(scan(Date.now() - 2 * 864e5, Date.now(), { sid })); out(`this session: ${fmtK(t.w)} weighted · ${pctStr(t.w, rate)} · ${t.msgs} responses`); }

  const cmds = sid ? bashEntries(dates, { sid }) : [];
  if (cmds.length) {
    out(`\n## Commands run in this session (last ${Math.min(25, cmds.length)} of ${cmds.length}, secrets redacted)`);
    let prev = '';
    for (const e of cmds.slice(-25)) { const c = redact(oneLine(e.cmd, 220)); if (c !== prev) out(`- ${e.t.slice(11, 16)} \`${c.replace(/`/g, "'")}\`${e.cwd && !same(e.cwd) ? ` (in ${e.cwd})` : ''}`); prev = c; }
  }

  const todo = expandHome(cfg.todo?.file || '~/.daily-assistant/todo.md');
  if ((!cfg.todo?.backend || cfg.todo.backend === 'file') && existsSync(todo)) {
    const open = readFileSync(todo, 'utf8').split(/\r?\n/).filter((l) => /^\s*- \[ \]/.test(l) && (!taskId || l.toUpperCase().includes(taskId)));
    if (open.length) { out(`\n## Open todo${taskId ? ` (${taskId})` : ''}`); for (const l of open.slice(0, 10)) out(l.trim()); }
  }
}

// ---------------------------------------------------------------- status line setup
const SETTINGS = join(CLAUDE, 'settings.json');
const WRAPPED = join(homeDir(), 'statusline-wrapped.txt');
const BIN = join(homeDir(), 'bin');
const OURS = `node "${join(BIN, 'statusline.mjs').replace(/\\/g, '/')}"`;

async function setup() {
  const s = readJson(SETTINGS);
  if (!s) die(`cannot read ${SETTINGS}`, 2);
  const cur = s.statusLine?.command || '';
  if (cur.includes('statusline.mjs')) { out(`already installed: ${cur}${existsSync(WRAPPED) ? ` (wraps: ${readFileSync(WRAPPED, 'utf8').trim()})` : ''}`); return; }
  out(`settings: ${SETTINGS}`);
  out(`statusLine.command: ${cur || '(none)'} → ${OURS}`);
  out(cur ? `kept and still displayed via ${WRAPPED}: ${cur}` : 'no previous status line: shows "model · 5h N% · 7d N%"');
  if (!flags.yes) { out('(dry run — add --yes to apply; takes effect on the next status line refresh)'); return; }
  mkdirSync(BIN, { recursive: true });
  for (const f of ['statusline.mjs', 'lib.mjs']) if (resolve(HERE) !== resolve(BIN)) copyFileSync(join(HERE, f), join(BIN, f));
  if (cur) writeFileSync(WRAPPED, cur + '\n');
  copyFileSync(SETTINGS, `${SETTINGS}.da-bak-${now.date}`);
  s.statusLine = { ...(s.statusLine || {}), type: 'command', command: OURS, padding: s.statusLine?.padding ?? 0 };
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  out(`installed (backup ${SETTINGS}.da-bak-${now.date})`);
}

async function unsetup() {
  const s = readJson(SETTINGS);
  if (!s) die(`cannot read ${SETTINGS}`, 2);
  const cur = s.statusLine?.command || '';
  if (!cur.includes('statusline.mjs')) { out(`not installed (statusLine.command: ${cur || 'none'})`); return; }
  const prev = existsSync(WRAPPED) ? readFileSync(WRAPPED, 'utf8').trim() : '';
  out(`statusLine.command: ${cur} → ${prev || '(removed)'}`);
  if (!flags.yes) { out('(dry run — add --yes to apply)'); return; }
  copyFileSync(SETTINGS, `${SETTINGS}.da-bak-${now.date}`);
  if (prev) s.statusLine.command = prev; else delete s.statusLine;
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  out('restored');
}

const COMMANDS = { status, day, rate: rateCmd, budget, spent, phase: phaseCmd, task, estimate, commands, facts, setup, unsetup };
if (!COMMANDS[cmd]) die(USAGE, cmd ? 1 : 0);
process.exitCode = (await COMMANDS[cmd]()) || 0;
