#!/usr/bin/env node
// memory-sync — sync the assistant's memory with a hub, three-way per machine.
// Stable path (synced by the SessionStart hook): ~/.daily-assistant/bin/memory-sync.mjs
// Local stores: learned memory (memory.dir) and top-level sections of config.yaml (persona, user, ...).
// Hub (config sync.source): a SilverBullet space (/.fs API) or a staging folder (--remote-dir) that the skill mirrors
// to the task-memory working-memory backend. Each machine keeps the last synced copy of every item (base) under
// ~/.daily-assistant/sync/ so it can tell "changed here" from "changed there".
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync, openSync, closeSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { loadConfig, configPath, homeDir, expandHome } from './lib.mjs';

const USAGE = `Usage: node memory-sync.mjs <command> [options]
  status                                 like plan, but saves nothing
  plan                                   compare local / hub / base, save a plan, print it
  apply --plan=ID [--resolve=ITEM[#KEY]=local|remote|both|skip ...] [--prefer=local|remote] [--allow-delete]
        [--only=ITEM,..] [--skip=ITEM,..]  re-check the plan's items are unchanged, then write
  commit --plan=ID [--failed=PATH,..]    record pushes done by the agent (working-memory staging only)
Options for status/plan/apply:
  --scope=memory,persona,config          limit scopes (default: sync.scopes)
  --source=silverbullet|working-memory   override sync.source
  --remote-dir=DIR                       hub is a staging folder (required for working-memory)
  --prefer=local|remote                  side taken for every conflict without its own --resolve
  --pull-only                            never write to the hub (bootstrap of a new machine); kept with the plan
  --verbose                              also list in-sync items
Exit codes: 0 ok · 1 error · 3 plan stale (something changed since plan) · 4 another sync is running`;

const SCOPES = ['memory', 'persona', 'config'];
const DEFAULT_SECTIONS = ['user', 'task_id_patterns', 'tracker', 'logwork', 'lookup', 'todo'];
const SECRET_PATTERNS = [
  /(api[_-]?key|token|password|passwd|secret)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-.]{12,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
];

function die(msg, code = 1) { process.stderr.write(msg + '\n'); process.exit(code); }

// Compare and store text with LF line ends and exactly one trailing newline.
const norm = (t) => (t == null ? null : t.replace(/\r\n?/g, '\n').replace(/\s*$/, '\n'));
const hash = (t) => (t == null ? null : createHash('sha256').update(t).digest('hex').slice(0, 12));

const readMaybe = (file) => { try { return readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const writeFile = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = { resolve: [] };
for (const a of argv) {
  const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
  if (!m) die(`Unexpected argument: ${a}\n\n${USAGE}`);
  if (m[1] === 'resolve') flags.resolve.push(m[2] ?? '');
  else flags[m[1]] = m[2] ?? true;
}
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------- config (sync section of config.yaml)

const HOME = join(homeDir(), 'sync');

function syncConfig() {
  const file = configPath();
  if (!existsSync(file)) die(`daily-assistant config not found at ${file} — run /init-daily-assistant first`);
  const all = loadConfig();
  const s = all.sync || {};
  const source = flags.source || s.source || 'none';
  if (source === 'none') die('sync.source is "none" — pick silverbullet or working-memory with /init-daily-assistant --section=sync');
  if (!['silverbullet', 'working-memory'].includes(source)) die(`Unknown sync.source "${source}" (silverbullet | working-memory)`);
  return {
    file,
    source,
    machine: s.machine || hostname(),
    sbRoot: s.silverbullet_root || 'Assistant Memory',
    wmPrefix: s.working_memory_prefix || 'assistant-memory',
    scopes: Array.isArray(s.scopes) && s.scopes.length ? s.scopes : SCOPES,
    // sync itself is machine-local; persona has its own scope.
    sections: (Array.isArray(s.config_sections) ? s.config_sections : DEFAULT_SECTIONS).filter((k) => k !== 'persona' && k !== 'sync'),
    includeInbox: s.include_inbox === true,
    memBackend: all.memory?.backend || 'file',
    memDir: resolve(expandHome(all.memory?.dir || '~/.daily-assistant/memory')),
  };
}

// ---------------------------------------------------------------- config.yaml sections (line based, byte-preserving)

// A top-level section runs from "<key>:" to the next top-level key; trailing blank and comment lines
// belong to the next section's header, so they are left out.
function sectionRange(lines, key) {
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) end++;
  while (end > start + 1 && (/^\s*$/.test(lines[end - 1]) || /^#/.test(lines[end - 1]))) end--;
  return [start, end];
}

function readSection(file, key) {
  const text = readMaybe(file);
  if (text === null) return null;
  const lines = norm(text).split('\n');
  const r = sectionRange(lines, key);
  return r ? norm(lines.slice(r[0], r[1]).join('\n')) : null;
}

function writeSection(file, key, section) {
  const text = readMaybe(file);
  if (text === null) throw new Error(`${file} not found — run /init-daily-assistant on this machine first`);
  const lines = norm(text).split('\n');
  const body = norm(section).replace(/\n$/, '').split('\n');
  const r = sectionRange(lines, key);
  if (r) lines.splice(r[0], r[1] - r[0], ...body);
  else lines.splice(lines.length - 1, 0, '', ...body);
  writeFileSync(file, norm(lines.join('\n')));
}

// ---------------------------------------------------------------- scopes (local side)
// A scope owns hub ids under a prefix and maps each id to a local store:
//   kind entries learned memory: "- [h-007] ..." lines keyed by id, merged
//   kind yaml    one top-level section of config.yaml (never deleted by sync)

const mdFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md') && statSync(join(dir, f)).isFile()) : []);

function buildScopes(cfg, notes) {
  const wanted = list(flags.scope);
  for (const s of wanted) if (!SCOPES.includes(s)) die(`Unknown scope "${s}" (${SCOPES.join(', ')})`);
  const on = (name) => cfg.scopes.includes(name) && (!wanted.length || wanted.includes(name));
  const scopes = [];

  if (on('memory')) {
    if (cfg.memBackend !== 'file') notes.push(`memory.backend is "${cfg.memBackend}" — learned memory is already shared, skipped`);
    else {
      const dir = cfg.memDir;
      const inbox = cfg.includeInbox;
      scopes.push({
        name: 'memory', prefix: 'memory/',
        localIds: () => [
          ...['profile.md', ...(inbox ? ['inbox.md'] : [])].filter((f) => existsSync(join(dir, f))),
          ...mdFiles(join(dir, 'knowledge')).map((f) => `knowledge/${f}`),
        ].map((f) => `memory/${f}`),
        resolve: (rest) => (rest === 'profile.md' || (inbox && rest === 'inbox.md') || /^knowledge\/[^/]+\.md$/.test(rest) ? { kind: 'entries', file: join(dir, rest) } : null),
      });
    }
  }

  const sections = [...(on('persona') ? ['persona'] : []), ...(on('config') ? cfg.sections : [])];
  for (const key of sections) {
    scopes.push({
      name: key === 'persona' ? 'persona' : 'config', prefix: `config/${key}`, exact: true,
      localIds: () => (readSection(cfg.file, key) !== null ? [`config/${key}`] : []),
      resolve: () => ({ kind: 'yaml', file: cfg.file, section: key }),
    });
  }
  return scopes;
}

function scopeFor(scopes, id) {
  for (const s of scopes) {
    if (s.exact ? id === s.prefix : id.startsWith(s.prefix)) {
      const local = s.resolve(s.exact ? '' : id.slice(s.prefix.length));
      if (local) return { scope: s.name, ...local };
    }
  }
  return null;
}

function readLocal(item) {
  return item.kind === 'yaml' ? readSection(item.file, item.section) : norm(readMaybe(item.file));
}
function writeLocal(item, text) {
  if (item.kind === 'yaml') writeSection(item.file, item.section, text);
  else writeFile(item.file, text);
}
function removeLocal(item) { rmSync(item.file, { force: true }); }

// ---------------------------------------------------------------- hub (remote side)
// Hub path = id (+ ".md" for config sections). Config sections are stored wrapped in a yaml fence so the
// page renders in SilverBullet; read/write unwrap and wrap them.

const toPath = (id) => (id.endsWith('.md') ? id : `${id}.md`);
const toId = (path) => (path.startsWith('config/') ? path.replace(/\.md$/, '') : path);

function wrap(id, text) {
  if (!id.startsWith('config/')) return text;
  return `# Config: ${id.slice(7)}\nSynced by memory-sync from the daily-assistant config. Edit only inside the yaml block.\n\n\`\`\`yaml\n${text}\`\`\`\n`;
}
function unwrap(id, text) {
  if (text == null || !id.startsWith('config/')) return norm(text);
  const m = norm(text).match(/```yaml\n([\s\S]*?)```/);
  return m ? norm(m[1]) : null;
}

function folderHub(dir) {
  const walk = (d, pre = '') => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name), `${pre}${e.name}/`) : e.name.endsWith('.md') ? [`${pre}${e.name}`] : []) : []);
  return {
    label: `folder ${dir}`,
    key: null,
    deferred: true,
    async ids() { return walk(dir).map(toId); },
    async read(id) { return unwrap(id, readMaybe(join(dir, toPath(id)))); },
    async write(id, text) { writeFile(join(dir, toPath(id)), wrap(id, text)); },
    async remove(id) { rmSync(join(dir, toPath(id)), { force: true }); },
  };
}

function silverbulletHub(cfg) {
  const file = resolve(expandHome('~/.config/silverbullet/config.json'));
  let sb = {};
  const raw = readMaybe(file);
  if (raw !== null) { try { sb = JSON.parse(raw); } catch (e) { die(`Invalid JSON in ${file}: ${e.message}`); } }
  const base = (process.env.SB_URL || sb.url || '').replace(/\/+$/, '');
  const token = process.env.SB_TOKEN || sb.token;
  if (!base || !token) die(`Missing SilverBullet url/token — set SB_URL/SB_TOKEN or create ${file} (see the silverbullet plugin)`);
  let url;
  try { url = new URL(base); } catch { die(`Invalid SilverBullet URL: ${base}`); }
  // Same rules as the silverbullet plugin: the token never travels over plain HTTP except to this machine.
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.SB_ALLOW_HTTP !== '1')
    die(`Refusing to send the token over plain HTTP to ${url.host} — use https (or SB_ALLOW_HTTP=1 to accept the risk)`);
  const root = cfg.sbRoot.replace(/^\/+|\/+$/g, '');
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(`${base}/.fs${path ? '/' + enc(path) : ''}`, {
        method, body, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'X-Sync-Mode': 'true', ...(body != null ? { 'Content-Type': 'text/markdown' } : {}) },
      });
    } catch (e) { die(`SilverBullet ${method} ${path || '/'} failed: ${e.cause?.message ?? e.message}`); }
    if (res.status === 401) die('SilverBullet: 401 Unauthorized — check the token');
    return res;
  }
  return {
    label: `silverbullet ${url.host} "${root}"`,
    key: `sb-${url.host}-${root}`,
    deferred: false,
    async ids() {
      const res = await call('GET', '');
      if (!res.ok) die(`SilverBullet GET /.fs → ${res.status}`);
      return (await res.json()).map((f) => f.name).filter((n) => n.startsWith(`${root}/`) && n.endsWith('.md')).map((n) => toId(n.slice(root.length + 1)));
    },
    async read(id) {
      const res = await call('GET', `${root}/${toPath(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) die(`SilverBullet GET ${id} → ${res.status}`);
      return unwrap(id, await res.text());
    },
    async write(id, text) {
      const out = wrap(id, text);
      const res = await call('PUT', `${root}/${toPath(id)}`, out);
      if (!res.ok) throw new Error(`PUT → ${res.status}`);
      if ((await this.read(id)) !== norm(text)) throw new Error('verify failed after write');
    },
    async remove(id) {
      const res = await call('DELETE', `${root}/${toPath(id)}`);
      if (!res.ok && res.status !== 404) throw new Error(`DELETE → ${res.status}`);
    },
  };
}

function openHub(cfg) {
  if (flags['remote-dir']) {
    const hub = folderHub(resolve(expandHome(flags['remote-dir'])));
    hub.key = cfg.source === 'working-memory' ? `wm-${cfg.wmPrefix}` : `dir-${resolve(expandHome(flags['remote-dir']))}`;
    return hub;
  }
  if (cfg.source === 'working-memory') die('Source working-memory needs --remote-dir=<staging folder> filled by the skill');
  return silverbulletHub(cfg);
}

// ---------------------------------------------------------------- base store (last synced copy per item)

const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
const baseDir = (hubKey) => join(HOME, 'state', safe(hubKey), 'base');
const baseStore = (hubKey) => ({
  ids() {
    const walk = (d, pre = '') => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name), `${pre}${e.name}/`) : [toId(`${pre}${e.name}`)]) : []);
    return walk(baseDir(hubKey));
  },
  read: (id) => norm(readMaybe(join(baseDir(hubKey), toPath(id)))),
  write: (id, text) => (text == null ? rmSync(join(baseDir(hubKey), toPath(id)), { force: true }) : writeFile(join(baseDir(hubKey), toPath(id)), text)),
});

// ---------------------------------------------------------------- merge

function keyOf(line) {
  return line.match(/^\s*- \[([A-Za-z]+-\d+)\]/)?.[1] ?? null;
}

function keyedLines(text) {
  const map = new Map();
  for (const line of (text ?? '').split('\n')) {
    const k = keyOf(line);
    if (k && !map.has(k)) map.set(k, line);
  }
  return map;
}

// "- [h-007] text (seen 4×, last 2026-10-16, src: x)": when both sides only bumped the counters,
// keep the edited text (if only one side edited it), the highest count and the latest date.
function mergeMeta(lv, rv, bv) {
  const re = /^(.*?)\s*\(seen (\d+)×, last (\d{4}-\d{2}-\d{2})(.*)\)\s*$/;
  const [l, r, b] = [lv, rv, bv ?? ''].map((v) => v.match(re));
  if (!l || !r) return null;
  const tb = b?.[1];
  const text = l[1] === r[1] ? l[1] : l[1] === tb ? r[1] : r[1] === tb ? l[1] : null;
  if (text === null) return null;
  const newer = r[3] > l[3] ? r : l;
  return `${text} (seen ${Math.max(+l[2], +r[2])}×, last ${newer[3]}${newer[4]})`;
}

function mergeKeyed(L, R, B, pick) {
  const l = keyedLines(L), r = keyedLines(R), b = keyedLines(B);
  const out = new Map();
  const conflicts = [];
  for (const k of new Set([...l.keys(), ...r.keys(), ...b.keys()])) {
    const lv = l.get(k), rv = r.get(k), bv = b.get(k);
    let v;
    if (lv === rv) v = [lv];
    else if (lv === bv) v = [rv];
    else if (rv === bv) v = [lv];
    else if (lv && rv && (v = mergeMeta(lv, rv, bv))) v = [v];
    else {
      const p = pick(k);
      if (p === 'local') v = [lv];
      else if (p === 'remote') v = [rv];
      else if (p === 'both') v = [lv, rv];
      else { conflicts.push({ key: k, local: lv ?? null, remote: rv ?? null }); v = [lv]; }
    }
    out.set(k, v.filter(Boolean));
  }
  // "both": the hub's entry gets the next free id of its prefix.
  const used = new Set(out.keys());
  for (const [k, vals] of out) {
    if (vals.length < 2) continue;
    const prefix = k.replace(/\d+$/, '');
    let n = 1;
    while (used.has(`${prefix}${String(n).padStart(3, '0')}`)) n++;
    const id = `${prefix}${String(n).padStart(3, '0')}`;
    used.add(id);
    vals[1] = vals[1].replace(`[${k}]`, `[${id}]`);
  }
  // Rebuild on the local layout; hub-only lines go after the last keyed line.
  const lines = [];
  let lastKeyed = -1;
  const done = new Set();
  for (const line of (L ?? '').split('\n')) {
    const k = keyOf(line);
    if (k && out.has(k)) {
      if (done.has(k)) continue;
      done.add(k);
      lines.push(...out.get(k));
      lastKeyed = lines.length;
    } else lines.push(line);
  }
  const extra = [...r.keys()].filter((k) => !done.has(k) && out.has(k)).flatMap((k) => out.get(k));
  lines.splice(lastKeyed < 0 ? lines.length : lastKeyed, 0, ...extra);
  return { text: norm(lines.join('\n')), conflicts };
}

// ---------------------------------------------------------------- decide

function decide(item, L, R, B, pick) {
  if (L === R) return { action: L === null ? 'gone' : 'same', result: L };
  if (item.kind === 'yaml' && (L === null || R === null)) B = null; // sections are re-created, never deleted
  if (L === null || R === null) {
    if (B === null) return L === null ? { action: 'pull', result: R, note: 'new on hub' } : { action: 'push', result: L, note: 'new here' };
    if ((L ?? R) === B) return L === null ? { action: 'delete-remote', note: 'deleted here' } : { action: 'delete-local', note: 'deleted on hub' };
    const p = pick();
    if (p === 'local') return L === null ? { action: 'delete-remote', note: 'resolved: local' } : { action: 'push', result: L, note: 'resolved: local' };
    if (p === 'remote') return R === null ? { action: 'delete-local', note: 'resolved: remote' } : { action: 'pull', result: R, note: 'resolved: remote' };
    return { action: 'conflict', note: L === null ? 'deleted here, changed on hub' : 'changed here, deleted on hub' };
  }
  if (item.kind === 'entries') {
    const { text, conflicts } = mergeKeyed(L, R, B, (k) => pick(k));
    if (conflicts.length) return { action: 'conflict', conflicts, note: `${conflicts.length} entr${conflicts.length > 1 ? 'ies' : 'y'} changed on both sides` };
    if (text === L) return { action: 'push', result: text, note: 'merged' };
    if (text === R) return { action: 'pull', result: text, note: 'merged' };
    return { action: 'merge', result: text, note: 'merged both ways' };
  }
  if (B !== null && L === B) return { action: 'pull', result: R, note: 'changed on hub' };
  if (B !== null && R === B) return { action: 'push', result: L, note: 'changed here' };
  const p = pick();
  if (p === 'local') return { action: 'push', result: L, note: 'resolved: local' };
  if (p === 'remote') return { action: 'pull', result: R, note: 'resolved: remote' };
  return { action: 'conflict', note: B === null ? 'differs, never synced' : 'changed on both sides' };
}

// ---------------------------------------------------------------- diff (for conflict display)

function lineDiff(a, b, max = 30) {
  const x = (a ?? '').replace(/\n$/, '').split('\n'), y = (b ?? '').replace(/\n$/, '').split('\n');
  if (x.length * y.length > 250000) return [`  (too large to diff: ${x.length} vs ${y.length} lines)`];
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (i < x.length && (j >= y.length || dp[i + 1][j] >= dp[i][j + 1])) out.push(`  - ${x[i++]}`);
    else out.push(`  + ${y[j++]}`);
  }
  return out.length > max ? [...out.slice(0, max), `  … ${out.length - max} more lines`] : out;
}

// ---------------------------------------------------------------- plan / apply

const PLANS = join(HOME, 'plans');
const newPlanId = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + randomBytes(2).toString('hex');

function resolutions() {
  const map = new Map();
  for (const r of flags.resolve) {
    const m = r.match(/^(.+?)(?:#([^=]+))?=(local|remote|both|skip)$/);
    if (!m) die(`Bad --resolve "${r}" — use ITEM[#KEY]=local|remote|both|skip`);
    map.set(m[2] ? `${m[1]}#${m[2]}` : m[1], m[3]);
  }
  if (flags.prefer && !['local', 'remote'].includes(flags.prefer)) die('--prefer must be local or remote');
  return (id) => (key) => map.get(key ? `${id}#${key}` : id) ?? (key ? map.get(id) : undefined) ?? flags.prefer;
}

async function collect(cfg, hub) {
  const notes = [];
  const scopes = buildScopes(cfg, notes);
  const base = baseStore(hub.key);
  const inScope = (id) => scopeFor(scopes, id);
  const hubIds = await hub.ids();
  const ids = [...new Set([...scopes.flatMap((s) => s.localIds()), ...hubIds, ...base.ids()])].filter(inScope).sort();
  const items = [];
  for (const id of ids) {
    const item = { id, ...inScope(id) };
    items.push({ item, L: readLocal(item), R: await hub.read(id), B: base.read(id) });
  }
  return { items, notes, base };
}

function secretIn(cfg, text) {
  return text != null && SECRET_PATTERNS.some((p) => p.test(text));
}

function evaluate(cfg, rows, pickFor) {
  return rows.map((row) => {
    const d = decide(row.item, row.L, row.R, row.B, pickFor(row.item.id));
    const pick = pickFor(row.item.id)();
    if (d.action === 'conflict' && pick === 'skip') return { ...row, ...d, action: 'skip', note: 'resolved: skip' };
    // Pull-only: nothing goes to the hub; a merge is written here only and the base stays, so the next sync pushes it.
    if (flags['pull-only'] && (d.action === 'push' || d.action === 'delete-remote')) return { ...row, ...d, action: 'keep', note: 'kept here (pull only)' };
    if (flags['pull-only'] && d.action === 'merge') return { ...row, ...d, action: 'pull', localOnly: true, note: 'merged here (pull only)' };
    if ((d.action === 'push' || d.action === 'merge') && d.result !== row.R && secretIn(cfg, d.result))
      return { ...row, ...d, action: 'blocked', note: 'looks like it contains a secret — not pushed' };
    return { ...row, ...d };
  });
}

const ORDER = ['conflict', 'blocked', 'push', 'pull', 'merge', 'delete-local', 'delete-remote', 'keep', 'skip', 'same', 'gone'];

function printPlan(cfg, hub, id, rows, notes) {
  console.log(`memory-sync ${id ? `plan ${id}` : 'status'} · hub ${hub.label} · machine ${cfg.machine}`);
  const shown = rows.filter((r) => flags.verbose || !['same', 'gone'].includes(r.action)).sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action) || a.item.id.localeCompare(b.item.id));
  const w = Math.max(10, ...shown.map((r) => r.item.id.length));
  for (const r of shown) console.log(`  ${r.action.padEnd(13)} ${r.item.id.padEnd(w)}  ${r.note ?? ''}`);
  const count = (a) => rows.filter((r) => r.action === a).length;
  console.log(`summary: ${ORDER.filter((a) => a !== 'gone' && count(a)).map((a) => `${count(a)} ${a}`).join(' · ') || 'nothing tracked'}`);
  for (const n of notes) console.log(`note: ${n}`);
  for (const r of rows.filter((r) => r.action === 'conflict')) {
    console.log(`\nCONFLICT ${r.item.id} — ${r.note}  (- here, + hub)`);
    if (r.conflicts) for (const c of r.conflicts) console.log(`  #${c.key}\n    - ${c.local ?? '(deleted)'}\n    + ${c.remote ?? '(deleted)'}`);
    else console.log(lineDiff(r.L, r.R).join('\n'));
  }
  if (id) {
    const conflict = rows.some((r) => r.action === 'conflict');
    const del = rows.some((r) => r.action.startsWith('delete'));
    console.log(`\nnext: apply --plan=${id}${conflict ? ' --resolve=ITEM[#KEY]=local|remote|both|skip' : ''}${del ? ' [--allow-delete]' : ''}`);
  }
}

function lock() {
  mkdirSync(HOME, { recursive: true });
  const file = join(HOME, 'lock');
  try {
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs > 10 * 60 * 1000) rmSync(file, { force: true });
    closeSync(openSync(file, 'wx'));
  } catch { die(`Another sync is running (${file}); delete it if that is not true`, 4); }
  process.on('exit', () => rmSync(file, { force: true }));
}

async function planCmd(save) {
  const cfg = syncConfig();
  const hub = openHub(cfg);
  const { items, notes } = await collect(cfg, hub);
  const rows = evaluate(cfg, items, resolutions());
  let id = null;
  if (save) {
    id = newPlanId();
    writeFile(join(PLANS, `${id}.json`), JSON.stringify({
      id, created: new Date().toISOString(), hub: hub.key, remoteDir: flags['remote-dir'] ?? null, scope: flags.scope ?? null, pullOnly: !!flags['pull-only'],
      items: rows.map((r) => ({ id: r.item.id, action: r.action, local: hash(r.L), remote: hash(r.R) })),
    }, null, 2));
  }
  printPlan(cfg, hub, id, rows, notes);
}

function loadPlan() {
  if (!flags.plan) die('Missing --plan=ID');
  const raw = readMaybe(join(PLANS, `${safe(String(flags.plan))}.json`));
  if (raw === null) die(`Plan ${flags.plan} not found`);
  return JSON.parse(raw);
}

async function applyCmd() {
  const plan = loadPlan();
  // Re-run with the plan's own scope and hub; an explicit --remote-dir/--scope must match it.
  for (const k of ['remote-dir', 'scope']) if (flags[k] && flags[k] !== (plan[k === 'scope' ? 'scope' : 'remoteDir'])) die(`--${k} differs from plan ${plan.id}`);
  if (plan.remoteDir) flags['remote-dir'] = plan.remoteDir;
  if (plan.scope) flags.scope = plan.scope;
  flags['pull-only'] = plan.pullOnly;
  const cfg = syncConfig();
  const hub = openHub(cfg);
  if (hub.key !== plan.hub) die(`Plan ${plan.id} was made for hub ${plan.hub}, current hub is ${hub.key}`);
  lock();
  const { items, notes, base } = await collect(cfg, hub);
  const planned = new Map(plan.items.map((p) => [p.id, p]));
  const only = list(flags.only), skip = list(flags.skip);
  const stale = items.filter((r) => {
    const p = planned.get(r.item.id);
    return p ? p.local !== hash(r.L) || p.remote !== hash(r.R) : r.L !== r.R;
  });
  if (stale.length) die(`Changed since plan ${plan.id}: ${stale.map((r) => r.item.id).join(', ')} — run plan again`, 3);

  const rows = evaluate(cfg, items, resolutions());
  const pending = [];
  const log = [];
  let personaPulled = false;
  for (const r of rows) {
    const id = r.item.id;
    if ((only.length && !only.includes(id)) || skip.includes(id)) { if (!['same', 'gone'].includes(r.action)) log.push(`${'skipped'.padEnd(13)} ${id}`); continue; }
    if (r.action.startsWith('delete') && !flags['allow-delete']) { log.push(`${'kept'.padEnd(13)} ${id}  (${r.action} needs --allow-delete)`); continue; }
    try {
      switch (r.action) {
        case 'same': if (r.B !== r.L) base.write(id, r.L); break;
        case 'gone': if (r.B !== null) base.write(id, null); break;
        case 'push':
        case 'merge':
          if (r.result !== r.R) await hub.write(id, r.result);
          if (r.result !== r.L) writeLocal(r.item, r.result);
          if (hub.deferred && r.result !== r.R) pending.push({ id, path: toPath(id), op: 'write' });
          else base.write(id, r.result);
          log.push(`${r.action.padEnd(13)} ${id}`);
          break;
        case 'pull':
          writeLocal(r.item, r.result);
          if (!r.localOnly) base.write(id, r.result);
          if (id === 'config/persona') personaPulled = true;
          log.push(`${'pull'.padEnd(13)} ${id}`);
          break;
        case 'delete-local':
          removeLocal(r.item);
          base.write(id, null);
          log.push(`${'delete-local'.padEnd(13)} ${id}`);
          break;
        case 'delete-remote':
          await hub.remove(id);
          if (hub.deferred) pending.push({ id, path: toPath(id), op: 'delete' });
          else base.write(id, null);
          log.push(`${'delete-remote'.padEnd(13)} ${id}`);
          break;
        case 'conflict': log.push(`${'unresolved'.padEnd(13)} ${id}  (pass --resolve=${id}${r.conflicts ? '[#KEY]' : ''}=local|remote${r.conflicts ? '|both' : ''}|skip)`); break;
        case 'blocked': log.push(`${'blocked'.padEnd(13)} ${id}  (${r.note})`); break;
        case 'skip': log.push(`${'skipped'.padEnd(13)} ${id}`); break;
        case 'keep': log.push(`${'kept'.padEnd(13)} ${id}  (pull only — not sent to the hub)`); break;
      }
    } catch (e) { log.push(`${'FAILED'.padEnd(13)} ${id}  ${e.message}`); }
  }
  console.log(`memory-sync apply ${plan.id} · hub ${hub.label}`);
  console.log(log.length ? log.map((l) => `  ${l}`).join('\n') : '  nothing to do');
  for (const n of notes) console.log(`note: ${n}`);
  if (personaPulled && loadConfig().persona?.alias_agent)
    console.log('note: persona changed and alias_agent is set — regenerate the alias agent with /init-daily-assistant --section=persona');
  if (pending.length) {
    writeFile(join(PLANS, `${plan.id}.json`), JSON.stringify({ ...plan, pending }, null, 2));
    console.log(`\nstaged in ${resolve(expandHome(plan.remoteDir))} — push to the hub, then run: commit --plan=${plan.id} [--failed=PATH,..]`);
    for (const p of pending) console.log(`  REMOTE-${p.op.toUpperCase()} ${p.path}`);
  }
  if (log.some((l) => l.startsWith('FAILED'))) process.exitCode = 1;
}

async function commitCmd() {
  const plan = loadPlan();
  if (!plan.pending?.length) die(`Plan ${plan.id} has nothing pending`);
  const failed = new Set(list(flags.failed));
  const base = baseStore(plan.hub);
  const dir = resolve(expandHome(plan.remoteDir));
  const left = [];
  for (const p of plan.pending) {
    if (failed.has(p.path)) { left.push(p); continue; }
    base.write(p.id, p.op === 'write' ? unwrap(p.id, readMaybe(join(dir, p.path))) : null);
  }
  writeFile(join(PLANS, `${plan.id}.json`), JSON.stringify({ ...plan, pending: left }, null, 2));
  console.log(`committed ${plan.pending.length - left.length} item(s)${left.length ? `; ${left.length} left pending (they will be pushed again next time)` : ''}`);
}

switch (cmd) {
  case 'status': await planCmd(false); break;
  case 'plan': await planCmd(true); break;
  case 'apply': await applyCmd(); break;
  case 'commit': await commitCmd(); break;
  default: console.log(USAGE); if (cmd) process.exitCode = 1;
}
