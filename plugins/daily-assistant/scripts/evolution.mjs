#!/usr/bin/env node
// evolution — what the agent can do (plugins, MCP servers, skills, agents, hooks, rules, CLI tools) and what it has
// learned (Claude Code auto memory per project, learned habits/knowledge), with day-to-day diffs and a profile page.
// Stable path (synced by the SessionStart hook): ~/.daily-assistant/bin/evolution.mjs
// Snapshots: ~/.daily-assistant/evolution/snapshots/<date>.json — only names and content hashes, never file contents.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { loadConfig, configPath, homeDir, expandHome, nowParts, tzOf } from './lib.mjs';

const USAGE = `Usage: node evolution.mjs <command> [options]
  scan [--json]                 inventory counts per kind (--json: every item)
  diff [--since=DATE] [--json]  current state vs the last snapshot before today (or on/before DATE)
  snapshot                      save today's snapshot (replaces an earlier one of the same day)
  page [--push]                 render the profile page to ~/.daily-assistant/evolution/profile.md;
                                --push also writes it to SilverBullet (evolution.silverbullet_page)
Exit codes: 0 ok · 1 error · 2 no snapshot to diff against`;

function die(msg, code = 1) { process.stderr.write(msg + '\n'); process.exit(code); }
const out = (s = '') => process.stdout.write(s + '\n');

const argv = process.argv.slice(2);
const cmd = argv.shift();
const flags = {};
for (const a of argv) {
  const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
  if (!m) die(`Unexpected argument: ${a}\n\n${USAGE}`);
  flags[m[1]] = m[2] ?? true;
}

const HOME = homedir();
const CLAUDE = join(HOME, '.claude');
const hash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const readMaybe = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const readJson = (f) => { const t = readMaybe(f); try { return t ? JSON.parse(t) : null; } catch { return null; } };
const dirs = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
const files = (d, re = /\.md$/i) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => e.name); } catch { return []; } };
const mdate = (f) => { try { return statSync(f).mtime.toISOString().slice(0, 10); } catch { return ''; } };
const oneLine = (s, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// ---------------------------------------------------------------- config

const cfgAll = existsSync(configPath()) ? loadConfig() : die(`daily-assistant config not found at ${configPath()} — run /init-daily-assistant first`);
const ev = cfgAll.evolution || {};
const cfg = {
  tz: tzOf(cfgAll),
  lang: ev.language || cfgAll.persona?.language || cfgAll.report?.language || 'en',
  page: ev.silverbullet_page || 'Agent/Profile',
  toolsRoot: (ev.tools_root || 'Agent/Tools').replace(/^\/+|\/+$/g, ''),
  projects: Array.isArray(ev.projects) ? ev.projects.map((p) => resolve(expandHome(p))) : [],
  memDir: resolve(expandHome(cfgAll.memory?.dir || '~/.daily-assistant/memory')),
  memBackend: cfgAll.memory?.backend || 'file',
  persona: cfgAll.persona?.name || '',
};
const EVDIR = join(homeDir(), 'evolution');
const SNAPDIR = join(EVDIR, 'snapshots');
const today = nowParts(cfg.tz).date;

// ---------------------------------------------------------------- frontmatter

function frontmatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = m ? m[1] : '';
  const get = (k) => {
    const m = fm.match(new RegExp(`^(\\s*)${k}:\\s*(.*)$`, 'm'));
    if (!m) return '';
    const v = m[2].trim();
    if (!/^[>|][-+]?$/.test(v)) return v.replace(/^["']|["']$/g, '');
    // Folded / literal block: the following lines indented deeper than the key.
    const rest = fm.slice(m.index + m[0].length).split(/\r?\n/).slice(1);
    const end = rest.findIndex((l) => l.trim() && l.length - l.trimStart().length <= m[1].length);
    return (end < 0 ? rest : rest.slice(0, end)).map((l) => l.trim()).join(' ').trim();
  };
  const list = (k) => {
    const inline = get(k);
    if (inline.startsWith('[')) return inline.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    const block = fm.match(new RegExp(`^${k}:\\s*\\r?\\n((?:\\s+-.*\\r?\\n?)+)`, 'm'))?.[1] || '';
    return block.split(/\r?\n/).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  };
  return { get, list, body: m ? text.slice(m[0].length) : String(text || '') };
}

// ---------------------------------------------------------------- inventory (capabilities)
// Item: { kind, id, label, detail, version?, hash, src }. key = `${kind}:${id}`. Details never carry args, env or headers.

function mcpDetail(s) {
  if (s?.url) { try { return new URL(s.url).host; } catch { return 'url'; } }
  return s?.command ? basename(String(s.command)) : '';
}

function claudeProjects() {
  const j = readJson(join(HOME, '.claude.json')) || {};
  return { all: j, paths: Object.keys(j.projects || {}) };
}

function plugins(items) {
  const reg = readJson(join(CLAUDE, 'plugins', 'installed_plugins.json'))?.plugins || {};
  const enabled = readJson(join(CLAUDE, 'settings.json'))?.enabledPlugins || {};
  for (const [id, installs] of Object.entries(reg)) {
    const inst = installs?.[0];
    if (!inst) continue;
    const on = enabled[id] !== false;
    const dir = inst.installPath;
    const skills = dirs(join(dir, 'skills')).filter((s) => existsSync(join(dir, 'skills', s, 'SKILL.md')));
    items.push({ kind: 'plugin', id, label: id.split('@')[0], detail: `${inst.scope || ''}${on ? '' : ', disabled'}`, version: inst.version, hash: hash(`${inst.version}|${on}`), src: id.split('@')[1] || '', skills, on });
    if (!on) continue;
    for (const s of skills) {
      const text = readMaybe(join(dir, 'skills', s, 'SKILL.md')) || '';
      items.push({ kind: 'skill', id: `${id.split('@')[0]}:${s}`, label: s, detail: oneLine(frontmatter(text).get('description')), hash: hash(text), src: id });
    }
    for (const a of files(join(dir, 'agents'))) {
      const text = readMaybe(join(dir, 'agents', a)) || '';
      items.push({ kind: 'agent', id: `${id.split('@')[0]}:${a.replace(/\.md$/i, '')}`, label: a.replace(/\.md$/i, ''), detail: oneLine(frontmatter(text).get('description')), hash: hash(text), src: id });
    }
    for (const [name, s] of Object.entries(readJson(join(dir, '.mcp.json'))?.mcpServers || {})) {
      items.push({ kind: 'mcp', id: name, label: name, detail: `plugin ${id.split('@')[0]} · ${mcpDetail(s)}`, hash: hash(JSON.stringify(s)), src: id });
    }
    for (const ev of Object.keys(readJson(join(dir, 'hooks', 'hooks.json'))?.hooks || {})) {
      items.push({ kind: 'hook', id: `${id.split('@')[0]}:${ev}`, label: ev, detail: `plugin ${id.split('@')[0]}`, hash: hash(ev), src: id });
    }
  }
}

function mcpServers(items, cp) {
  for (const [name, s] of Object.entries(cp.all.mcpServers || {})) items.push({ kind: 'mcp', id: name, label: name, detail: `user · ${mcpDetail(s)}`, hash: hash(JSON.stringify(s)), src: 'user' });
  for (const [p, v] of Object.entries(cp.all.projects || {})) {
    for (const [name, s] of Object.entries(v.mcpServers || {})) items.push({ kind: 'mcp', id: `${name}@${basename(p)}`, label: name, detail: `project ${basename(p)} · ${mcpDetail(s)}`, hash: hash(JSON.stringify(s)), src: p });
  }
}

function userLevel(items) {
  const skillsDir = join(CLAUDE, 'skills');
  for (const s of dirs(skillsDir)) {
    const text = readMaybe(join(skillsDir, s, 'SKILL.md'));
    if (text != null) items.push({ kind: 'skill', id: s, label: s, detail: oneLine(frontmatter(text).get('description')), hash: hash(text), src: 'user' });
  }
  for (const a of files(join(CLAUDE, 'agents'))) {
    const text = readMaybe(join(CLAUDE, 'agents', a)) || '';
    items.push({ kind: 'agent', id: a.replace(/\.md$/i, ''), label: a.replace(/\.md$/i, ''), detail: oneLine(frontmatter(text).get('description')), hash: hash(text), src: 'user' });
  }
  for (const f of files(CLAUDE)) items.push({ kind: 'rule', id: `~/.claude/${f}`, label: f, detail: 'user', hash: hash(readMaybe(join(CLAUDE, f)) || ''), src: 'user' });
  for (const f of files(join(CLAUDE, 'rules'))) items.push({ kind: 'rule', id: `~/.claude/rules/${f}`, label: f, detail: 'user', hash: hash(readMaybe(join(CLAUDE, 'rules', f)) || ''), src: 'user' });
  for (const [ev, list] of Object.entries(readJson(join(CLAUDE, 'settings.json'))?.hooks || {})) {
    for (const h of list || []) items.push({ kind: 'hook', id: `user:${ev}:${h.matcher || '*'}`, label: ev, detail: `user · matcher ${h.matcher || '*'}`, hash: hash(JSON.stringify(h)), src: 'user' });
  }
}

function projectLevel(items, projects) {
  for (const p of projects) {
    const name = basename(p);
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']) {
      const text = readMaybe(join(p, f));
      if (text != null) items.push({ kind: 'rule', id: `${name}/${f}`, label: f, detail: `project ${name}`, hash: hash(text), src: p });
    }
    for (const f of files(join(p, '.claude', 'rules'))) items.push({ kind: 'rule', id: `${name}/.claude/rules/${f}`, label: f, detail: `project ${name}`, hash: hash(readMaybe(join(p, '.claude', 'rules', f)) || ''), src: p });
    for (const f of files(join(p, '.claude', 'commands'))) {
      const text = readMaybe(join(p, '.claude', 'commands', f)) || '';
      items.push({ kind: 'skill', id: `${name}/${f.replace(/\.md$/i, '')}`, label: f.replace(/\.md$/i, ''), detail: `project ${name} · (command) ${oneLine(frontmatter(text).get('description'), 100)}`.trim(), hash: hash(text), src: p });
    }
    for (const s of dirs(join(p, '.claude', 'skills'))) {
      const text = readMaybe(join(p, '.claude', 'skills', s, 'SKILL.md'));
      if (text != null) items.push({ kind: 'skill', id: `${name}/${s}`, label: s, detail: `project ${name} · ${oneLine(frontmatter(text).get('description'), 100)}`, hash: hash(text), src: p });
    }
  }
}

function cliTools(items) {
  const uvDir = process.env.UV_TOOL_DIR || (process.platform === 'win32' ? join(process.env.APPDATA || join(HOME, 'AppData', 'Roaming'), 'uv', 'tools') : join(HOME, '.local', 'share', 'uv', 'tools'));
  for (const t of dirs(uvDir)) {
    const norm = t.toLowerCase().replace(/[-.]/g, '_');
    const site = process.platform === 'win32' ? [join(uvDir, t, 'Lib', 'site-packages')] : dirs(join(uvDir, t, 'lib')).map((py) => join(uvDir, t, 'lib', py, 'site-packages'));
    const info = site.flatMap((s) => dirs(s).filter((d) => d.toLowerCase().startsWith(norm + '-') && d.endsWith('.dist-info')))[0] || '';
    const version = info.slice(norm.length + 1, -'.dist-info'.length);
    const receipt = readMaybe(join(uvDir, t, 'uv-receipt.toml')) || '';
    const bins = [...receipt.matchAll(/name = "([^"]+)", install-path/g)].map((m) => m[1]);
    items.push({ kind: 'tool', id: `uv:${t}`, label: t, detail: `uv tool${bins.length ? ` · ${bins.join(', ')}` : ''}`, version, hash: hash(`${version}|${receipt}`), src: 'uv' });
  }
  let npmRoot = '';
  try { npmRoot = execSync('npm root -g', { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no npm */ }
  const pkgs = dirs(npmRoot).flatMap((d) => (d.startsWith('@') ? dirs(join(npmRoot, d)).map((s) => `${d}/${s}`) : [d])).filter((d) => !['npm', 'corepack'].includes(d));
  for (const p of pkgs) {
    const version = readJson(join(npmRoot, p, 'package.json'))?.version || '';
    items.push({ kind: 'tool', id: `npm:${p}`, label: p, detail: 'npm -g', version, hash: hash(version), src: 'npm' });
  }
}

// ---------------------------------------------------------------- learned (memory)
// Entry: { key, group, kind, label, text, date }. group = project name, "daily-assistant", ...

// Claude Code names a project dir by its path with every non-alphanumeric char turned into "-".
const encodeDir = (p) => p.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();

// Rebuild the path of a project dir that ~/.claude.json no longer lists by walking the file system.
function decodeDir(d) {
  const m = d.match(/^([A-Za-z])--(.*)$/);
  let cur = m ? `${m[1].toUpperCase()}:/` : d.startsWith('-') ? '/' : null;
  let toks = m ? m[2].split('-') : d.slice(1).split('-');
  while (cur && toks.length) {
    const children = dirs(cur);
    let hit = null;
    for (let n = toks.length; n >= 1 && !hit; n--) {
      const want = toks.slice(0, n).join('-').toLowerCase();
      const c = children.find((x) => encodeDir(x) === want);
      if (c) hit = [c, n];
    }
    if (!hit) return null;
    cur = join(cur, hit[0]);
    toks = toks.slice(hit[1]);
  }
  return cur;
}

function claudeMemory(learned, cp) {
  const byDir = new Map(cp.paths.map((p) => [encodeDir(p), p]));
  const root = join(CLAUDE, 'projects');
  const found = new Map(); // lower-cased dir -> { d, path, mds }
  for (const d of dirs(root)) {
    const mds = files(join(root, d, 'memory')).filter((f) => f.toUpperCase() !== 'MEMORY.MD');
    if (mds.length && !found.has(d.toLowerCase())) found.set(d.toLowerCase(), { d, path: byDir.get(d.toLowerCase()) || decodeDir(d), mds });
  }
  // Group label: the project folder name, with its parent when two projects share a name.
  const names = [...found.values()].map((x) => x.path && basename(x.path).toLowerCase());
  const label = ({ d, path }) => {
    if (!path) return d.replace(/^[A-Za-z]--users-[^-]+-/i, '');
    return names.filter((n) => n === basename(path).toLowerCase()).length > 1 ? `${basename(dirname(path))}/${basename(path)}` : basename(path);
  };
  for (const x of found.values()) {
    const memDir = join(root, x.d, 'memory');
    const group = label(x);
    for (const f of x.mds) {
      const text = readMaybe(join(memDir, f)) || '';
      const fm = frontmatter(text);
      const desc = fm.get('description') || fm.body.replace(/^#+\s.*$/gm, '').replace(/[*#>`]/g, '');
      learned.push({ key: `mem:${x.d.toLowerCase()}/${f}`, group, kind: fm.get('type') || 'note', label: fm.get('name') || f.replace(/\.md$/i, ''), text: oneLine(desc, 200), date: mdate(join(memDir, f)), hash: hash(text) });
    }
  }
  return [...found.values()].map((x) => x.path).filter((p) => p && existsSync(p));
}

function learnMemory(learned) {
  if (cfg.memBackend !== 'file') return;
  const entries = (file, kind, group) => {
    const text = readMaybe(file);
    if (!text) return;
    for (const m of text.matchAll(/^- \[([hk]-\d+)\]\s*(.+)$/gm)) {
      const meta = m[2].match(/\((?:seen[^)]*?)?last (\d{4}-\d{2}-\d{2})[^)]*\)\s*$/);
      learned.push({ key: `learn:${m[1]}`, group, kind, label: m[1], text: oneLine(m[2].replace(/\s*\((seen|last|src)[^)]*\)\s*$/, ''), 240), date: meta?.[1] || mdate(file), hash: hash(m[2].replace(/\(seen[^)]*\)/, '')) });
    }
  };
  entries(join(cfg.memDir, 'profile.md'), 'habit', 'daily-assistant');
  for (const f of files(join(cfg.memDir, 'knowledge'))) entries(join(cfg.memDir, 'knowledge', f), `knowledge/${f.replace(/\.md$/i, '')}`, 'daily-assistant');
}

// ---------------------------------------------------------------- collect / snapshots

function collect() {
  const cp = claudeProjects();
  const items = [];
  const learned = [];
  const memProjects = claudeMemory(learned, cp);
  learnMemory(learned);
  plugins(items);
  mcpServers(items, cp);
  userLevel(items);
  projectLevel(items, cfg.projects.length ? cfg.projects : memProjects);
  cliTools(items);
  return { items, learned };
}

const keyOf = (i) => `${i.kind}:${i.id}`;

function toSnapshot({ items, learned }) {
  return {
    date: today, time: nowParts(cfg.tz).time, machine: hostname(),
    items: Object.fromEntries(items.map((i) => [keyOf(i), { label: i.label, detail: i.detail, version: i.version || '', hash: i.hash }])),
    learned: Object.fromEntries(learned.map((l) => [l.key, { group: l.group, kind: l.kind, label: l.label, hash: l.hash }])),
  };
}

const snapshotDates = () => files(SNAPDIR, /^\d{4}-\d{2}-\d{2}\.json$/).map((f) => f.slice(0, 10)).sort();

function diffSnap(prev, cur) {
  const d = { added: [], removed: [], changed: [], learnedAdded: [], learnedChanged: [], learnedRemoved: [] };
  for (const [k, v] of Object.entries(cur.items)) {
    if (!prev.items[k]) d.added.push({ key: k, ...v });
    else if (prev.items[k].hash !== v.hash) d.changed.push({ key: k, ...v, from: prev.items[k].version || '' });
  }
  for (const [k, v] of Object.entries(prev.items)) if (!cur.items[k]) d.removed.push({ key: k, ...v });
  for (const [k, v] of Object.entries(cur.learned)) {
    if (!prev.learned[k]) d.learnedAdded.push({ key: k, ...v });
    else if (prev.learned[k].hash !== v.hash) d.learnedChanged.push({ key: k, ...v });
  }
  for (const [k, v] of Object.entries(prev.learned)) if (!cur.learned[k]) d.learnedRemoved.push({ key: k, ...v });
  return d;
}

// ---------------------------------------------------------------- SilverBullet (same credential rules as the silverbullet plugin)

function sbClient() {
  const file = resolve(expandHome('~/.config/silverbullet/config.json'));
  const sb = readJson(file) || {};
  const base = (process.env.SB_URL || sb.url || '').replace(/\/+$/, '');
  const token = process.env.SB_TOKEN || sb.token;
  if (!base || !token) die(`Missing SilverBullet url/token — set SB_URL/SB_TOKEN or create ${file} (see the silverbullet plugin)`);
  let url;
  try { url = new URL(base); } catch { die(`Invalid SilverBullet URL: ${base}`); }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && process.env.SB_ALLOW_HTTP !== '1')
    die(`Refusing to send the token over plain HTTP to ${url.host} — use https (or SB_ALLOW_HTTP=1 to accept the risk)`);
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const call = async (method, path, body) => {
    try {
      return await fetch(`${base}/.fs${path ? '/' + enc(path) : ''}`, {
        method, body, redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'X-Sync-Mode': 'true', ...(body != null ? { 'Content-Type': 'text/markdown' } : {}) },
      });
    } catch (e) { die(`SilverBullet ${method} ${path || '/'} failed: ${e.cause?.message ?? e.message}`); }
  };
  return {
    async list(prefix) {
      const res = await call('GET', '');
      if (!res.ok) die(`SilverBullet GET /.fs → ${res.status}`);
      return (await res.json()).map((f) => f.name).filter((n) => n.startsWith(prefix + '/') && n.endsWith('.md'));
    },
    async get(path) { const res = await call('GET', path); return res.ok ? res.text() : null; },
    async put(path, text) { const res = await call('PUT', path, text); if (!res.ok) die(`SilverBullet PUT ${path} → ${res.status}`); },
  };
}

// Guide pages under tools_root declare what they cover in frontmatter: `covers: [gemini-notebook-mcp, uv:notebooklm-mcp-cli]`.
async function guides(sb) {
  const map = new Map();
  if (!sb) return map;
  for (const name of await sb.list(cfg.toolsRoot)) {
    const page = name.replace(/\.md$/, '');
    for (const c of frontmatter(await sb.get(name)).list('covers')) map.set(c.toLowerCase(), page);
  }
  return map;
}

// ---------------------------------------------------------------- page

const LABELS = {
  en: {
    title: 'Agent profile', updated: 'Updated', machine: 'machine', assistant: 'assistant', generated: 'Generated by daily-assistant evolution — manual edits are overwritten.',
    caps: 'Capabilities', plugins: 'Plugins', mcp: 'MCP servers', skills: 'Skills (user & project)', agents: 'Agents', hooks: 'Hooks', rules: 'Rules', tools: 'CLI tools',
    name: 'Name', version: 'Version', where: 'Where', desc: 'Description', guide: 'Guide', count: 'Skills',
    learned: 'Learned per project', master: 'About the master', portrait: 'Portrait', habits: 'Habits (learn)', prefs: 'Profile & working preferences (Claude memory: user / feedback)',
    knowledge: 'Knowledge (learn)', history: 'Evolution history', date: 'Date', add: 'Added', change: 'Changed', remove: 'Removed', learnedNew: 'Learned', none: '_None_',
  },
  vi: {
    title: 'Hồ sơ agent', updated: 'Cập nhật', machine: 'máy', assistant: 'trợ lý', generated: 'Sinh tự động bởi daily-assistant evolution — sửa tay sẽ bị ghi đè.',
    caps: 'Năng lực', plugins: 'Plugin', mcp: 'MCP server', skills: 'Skill (cá nhân & dự án)', agents: 'Agent', hooks: 'Hook', rules: 'Rule', tools: 'CLI tool',
    name: 'Tên', version: 'Phiên bản', where: 'Phạm vi', desc: 'Mô tả', guide: 'Hướng dẫn', count: 'Skill',
    learned: 'Học được theo dự án', master: 'Về master', portrait: 'Chân dung', habits: 'Thói quen (learn)', prefs: 'Hồ sơ & cách làm việc (Claude memory: user / feedback)',
    knowledge: 'Kiến thức (learn)', history: 'Lịch sử tiến hoá', date: 'Ngày', add: 'Thêm', change: 'Đổi', remove: 'Gỡ', learnedNew: 'Học thêm', none: '_Không có_',
  },
};
const L = LABELS[cfg.lang] || LABELS.en;
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)] : [L.none]);

function history() {
  const dates = snapshotDates();
  const rows = [];
  for (let i = 1; i < dates.length; i++) {
    const d = diffSnap(readJson(join(SNAPDIR, `${dates[i - 1]}.json`)), readJson(join(SNAPDIR, `${dates[i]}.json`)));
    const names = (l) => oneLine(l.map((x) => x.key.replace(/^(\w+):/, '$1 ')).join(', '), 160);
    if (d.added.length + d.changed.length + d.removed.length + d.learnedAdded.length) rows.push([dates[i], names(d.added), names(d.changed), names(d.removed), d.learnedAdded.length || '']);
  }
  return rows.reverse().slice(0, 30);
}

function render({ items, learned }, guideMap) {
  const of = (k) => items.filter((i) => i.kind === k).sort((a, b) => a.id.localeCompare(b.id));
  const g = (i) => { const p = guideMap.get(i.id.toLowerCase()) || guideMap.get(i.label.toLowerCase()); return p ? `[[${p}]]` : ''; };
  const now = nowParts(cfg.tz);
  const lines = ['---', 'tags: agent-profile', '---', '', `# ${L.title}`, '',
    `_${L.updated}: ${now.date} ${now.hm} · ${L.machine}: ${hostname()}${cfg.persona ? ` · ${L.assistant}: ${cfg.persona}` : ''}_  `, `_${L.generated}_`, '',
    `## ${L.caps}`, '',
    `### ${L.plugins} (${of('plugin').length})`, ...table([L.name, L.version, L.where, L.count, L.guide], of('plugin').map((i) => [`${i.label}${i.on ? '' : ' ⏸'}`, i.version, `${i.src}${i.detail ? ` · ${i.detail}` : ''}`, i.skills.join(', '), g(i)])), '',
    `### ${L.mcp} (${of('mcp').length})`, ...table([L.name, L.where, L.guide], of('mcp').map((i) => [i.label, i.detail, g(i)])), '',
    `### ${L.tools} (${of('tool').length})`, ...table([L.name, L.version, L.where, L.guide], of('tool').map((i) => [i.label, i.version, i.detail, g(i)])), '',
    `### ${L.skills} (${of('skill').filter((i) => !i.src.includes('@')).length})`, ...table([L.name, L.where, L.desc], of('skill').filter((i) => !i.src.includes('@')).sort((a, b) => (a.src === 'user' ? 0 : 1) - (b.src === 'user' ? 0 : 1)).map((i) => [i.label, i.src === 'user' ? 'user' : basename(i.src), i.src === 'user' ? i.detail : i.detail.replace(/^project [^·]*· ?/, '')])), '',
    `### ${L.agents} (${of('agent').length})`, ...table([L.name, L.where, L.desc], of('agent').map((i) => [i.label, i.src === 'user' ? 'user' : i.src.split('@')[0], oneLine(i.detail, 100)])), '',
    `### ${L.hooks} (${of('hook').length})`, ...table([L.name, L.where], of('hook').map((i) => [i.label, i.detail])), '',
    `### ${L.rules} (${of('rule').length})`, ...table([L.name, L.where], of('rule').map((i) => [i.id, i.detail])), '',
    `## ${L.learned}`, ''];
  const groups = [...new Set(learned.filter((l) => !['user', 'feedback'].includes(l.kind) && l.group !== 'daily-assistant').map((l) => l.group))].sort();
  for (const grp of groups) {
    const ls = learned.filter((l) => l.group === grp && !['user', 'feedback'].includes(l.kind)).sort((a, b) => b.date.localeCompare(a.date));
    lines.push(`### ${grp} (${ls.length})`, ...ls.map((l) => `- **${l.label}** — ${l.text} _(${l.kind}, ${l.date})_`), '');
  }
  const know = learned.filter((l) => l.kind.startsWith('knowledge/'));
  lines.push(`### ${L.knowledge} (${know.length})`, ...(know.length ? know.map((l) => `- [${l.label}] ${l.text} _(${l.kind.slice(10)}, ${l.date})_`) : [L.none]), '');
  const habits = learned.filter((l) => l.kind === 'habit');
  const prefs = learned.filter((l) => ['user', 'feedback'].includes(l.kind)).sort((a, b) => a.kind.localeCompare(b.kind) || b.date.localeCompare(a.date));
  // portrait.md: short synthesis of the master written by the skill (user-approved); kept across renders.
  const portrait = readMaybe(join(EVDIR, 'portrait.md'));
  lines.push(`## ${L.master}`, '', ...(portrait ? [`### ${L.portrait}`, portrait.trim(), ''] : []), `### ${L.habits} (${habits.length})`, ...(habits.length ? habits.map((l) => `- [${l.label}] ${l.text} _(${l.date})_`) : [L.none]), '',
    `### ${L.prefs} (${prefs.length})`, ...(prefs.length ? prefs.map((l) => `- **${l.label}** — ${l.text} _(${l.kind}, ${l.group}, ${l.date})_`) : [L.none]), '',
    `## ${L.history}`, '', ...table([L.date, L.add, L.change, L.remove, L.learnedNew], history()), '');
  return lines.join('\n');
}

// ---------------------------------------------------------------- commands

function printDiff(d, since) {
  out(`since ${since}: +${d.added.length} ~${d.changed.length} -${d.removed.length} capabilities · +${d.learnedAdded.length} ~${d.learnedChanged.length} -${d.learnedRemoved.length} learned`);
  for (const x of d.added) out(`+ ${x.key}${x.version ? ` ${x.version}` : ''}${x.detail ? ` — ${x.detail}` : ''}`);
  for (const x of d.changed) out(`~ ${x.key}${x.version ? ` ${x.from || '?'} → ${x.version}` : ' (content changed)'}`);
  for (const x of d.removed) out(`- ${x.key}`);
  for (const x of d.learnedAdded) out(`+ learned [${x.group}] ${x.kind}: ${x.label}`);
  for (const x of d.learnedChanged) out(`~ learned [${x.group}] ${x.kind}: ${x.label}`);
  for (const x of d.learnedRemoved) out(`- learned [${x.group}] ${x.kind}: ${x.label}`);
}

switch (cmd) {
  case 'scan': {
    const data = collect();
    if (flags.json) { out(JSON.stringify(data, null, 1)); break; }
    const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
    out(`capabilities: ${Object.entries(count(data.items, (i) => i.kind)).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    out(`learned: ${Object.entries(count(data.learned, (l) => l.group)).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    break;
  }
  case 'diff': {
    const cur = toSnapshot(collect());
    const limit = typeof flags.since === 'string' ? flags.since : null;
    const base = snapshotDates().filter((d) => (limit ? d <= limit : d < today)).pop();
    if (!base) die('No snapshot to compare with — run `snapshot` once to create the baseline.', 2);
    const d = diffSnap(readJson(join(SNAPDIR, `${base}.json`)), cur);
    if (flags.json) out(JSON.stringify({ since: base, ...d }, null, 1));
    else printDiff(d, base);
    break;
  }
  case 'snapshot': {
    const snap = toSnapshot(collect());
    mkdirSync(SNAPDIR, { recursive: true });
    const file = join(SNAPDIR, `${today}.json`);
    writeFileSync(file, JSON.stringify(snap, null, 1) + '\n');
    out(`saved ${file} (${Object.keys(snap.items).length} capabilities, ${Object.keys(snap.learned).length} learned)`);
    break;
  }
  case 'page': {
    const sb = flags.push ? sbClient() : null;
    const text = render(collect(), await guides(sb));
    mkdirSync(EVDIR, { recursive: true });
    const file = join(EVDIR, 'profile.md');
    writeFileSync(file, text);
    out(`rendered ${file} (${text.split('\n').length} lines)`);
    if (sb) { await sb.put(`${cfg.page}.md`, text); out(`pushed SilverBullet page "${cfg.page}"`); }
    break;
  }
  default:
    die(USAGE, cmd ? 1 : 0);
}
