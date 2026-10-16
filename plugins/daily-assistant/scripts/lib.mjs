// Shared helpers for daily-assistant scripts (no dependencies).
import { readFileSync, appendFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export const expandHome = (p) => String(p || '').replace(/^~(?=$|[\\/])/, homedir());

export function configPath() {
  return process.env.DAILY_ASSISTANT_CONFIG || join(homedir(), '.daily-assistant', 'config.yaml');
}

export const homeDir = () => dirname(configPath());

// ---------------------------------------------------------------- YAML subset
// Enough for config.yaml: nested maps, scalars, inline [..] lists, block "- x" lists,
// block lists of maps ("- id: x" + indented keys). Folded (>-, |) values become "".
export function readYaml(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw);
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    let body = line.trim();
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    let top = stack.at(-1);
    if (body.startsWith('- ')) {
      if (top.owner && !Array.isArray(top.node) && Object.keys(top.node).length === 0) {
        top.node = top.owner[top.key] = [];
      }
      if (!Array.isArray(top.node)) continue;
      const item = body.slice(2);
      const kv = item.match(/^([\w.-]+):\s*(.*)$/);
      if (!kv) { top.node.push(scalar(item)); continue; }
      const obj = {};
      top.node.push(obj);
      stack.push({ indent, node: obj });
      top = stack.at(-1);
      body = item;
    }
    if (Array.isArray(top.node)) continue;
    const m = body.match(/^([\w.-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    if (rest === '') {
      top.node[key] = {};
      stack.push({ indent: body === line.trim() ? indent : indent + 2, node: top.node[key], owner: top.node, key });
    } else {
      top.node[key] = rest === '>-' || rest === '|' ? '' : scalar(rest);
    }
  }
  return root;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line;
}

function splitList(s) {
  const out = [];
  let depth = 0, quote = null, cur = '';
  for (const c of s) {
    if (quote) { if (c === quote) quote = null; cur += c; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('[{('.includes(c)) depth++;
    else if (']})'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function scalar(v) {
  v = v.trim();
  if (v.startsWith('[') && v.endsWith(']')) return splitList(v.slice(1, -1)).map(scalar);
  if (/^(['"]).*\1$/.test(v)) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

export function loadConfig() {
  const p = configPath();
  return existsSync(p) ? readYaml(readFileSync(p, 'utf8')) : null;
}

// ---------------------------------------------------------------- time
export function tzOf(cfg) {
  return cfg?.user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function nowParts(tz, d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${date}T${p.hour}:${p.minute}:${p.second}`, hm: `${p.hour}:${p.minute}`, dow: p.weekday.toLowerCase().slice(0, 3) };
}

export const toMinutes = (t) => { const [h, m] = t.slice(11, 16).split(':').map(Number); return h * 60 + m; };
export const fmtDur = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------- task ids / git
export function taskIds(text, patterns) {
  const ids = new Set();
  for (const p of patterns || []) {
    for (const m of String(text || '').matchAll(new RegExp(`(?<![A-Za-z0-9])(${p})(?![A-Za-z0-9])`, 'gi'))) ids.add(m[1].toUpperCase());
  }
  return [...ids];
}

export function git(cwd, args, timeout = 3000) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { timeout, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { return undefined; }
}

// ---------------------------------------------------------------- activity log
export const logDir = (cfg) => expandHome(cfg?.watch?.log_dir || '~/.daily-assistant/activity');

export function readDay(dir, date) {
  const f = join(dir, `${date}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

export function appendLog(cfg, entry) {
  const dir = logDir(cfg);
  const { date, time } = nowParts(tzOf(cfg));
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${date}.jsonl`), JSON.stringify({ t: time, ...entry }) + '\n');
}

// ---------------------------------------------------------------- pending reminders
// Written by `check --notify` (OS scheduler); injected once into the next Claude Code prompt by the hook.
const pendingFile = () => join(homeDir(), 'pending.json');

export function readPending() {
  try { return JSON.parse(readFileSync(pendingFile(), 'utf8')); } catch { return []; }
}

export function writePending(items) {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(pendingFile(), JSON.stringify(items.slice(-50), null, 1));
}
