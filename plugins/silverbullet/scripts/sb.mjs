#!/usr/bin/env node
// SilverBullet HTTP API client (/.fs).
// Config: env SB_URL / SB_TOKEN, else first of <plugin-root>/config.json, ~/.config/silverbullet/config.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILES = [join(here, "..", "config.json"), join(homedir(), ".config", "silverbullet", "config.json")];
// Only a missing file moves on to the next one; a broken file stops here, so a typo
// never silently switches to another server.
let cfg = {};
for (const file of CONFIG_FILES) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch (e) {
    if (e.code === "ENOENT") continue;
    die(`Cannot read ${file}: ${e.message}`);
  }
  try { cfg = JSON.parse(raw); } catch (e) { die(`Invalid JSON in ${file}: ${e.message}`); }
  break;
}
const BASE = (process.env.SB_URL || cfg.url || "").replace(/\/+$/, "");
const TOKEN = process.env.SB_TOKEN || cfg.token;
const JOURNAL_FOLDER = cfg.journalFolder || "Journal";
const JOURNAL_TEMPLATE = cfg.journalTemplate || "Template-journal";
// Two-tier journal (on when journalDetailFolder is set): details go to <detail folder>/<date>,
// the day's journal keeps one summary line per entry, linked to its detail block.
const DETAIL_FOLDER = (cfg.journalDetailFolder || "").replace(/\/+$/, "");
const DETAIL_TAG = cfg.journalDetailTag || "journal-detail";
const SUMMARY_HEADING = cfg.journalSummaryHeading || "Work log";
const SUMMARY_BLOCK = cfg.journalSummaryBlock || "worklog";
const DETAIL_LABEL = cfg.journalDetailLabel || "details";
if (!BASE || !TOKEN) die(`Missing SB_URL/SB_TOKEN — set env vars or create one of:\n  ${CONFIG_FILES.join("\n  ")}`);

// The bearer token never travels over plain HTTP, except to this machine or with explicit opt-in.
let baseUrl;
try { baseUrl = new URL(BASE); } catch { die(`Invalid server URL: ${BASE}`); }
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
if (baseUrl.protocol === "http:" && !LOOPBACK.includes(baseUrl.hostname) && process.env.SB_ALLOW_HTTP !== "1")
  die(`Refusing to send the token over plain HTTP to ${baseUrl.host} — use https (or SB_ALLOW_HTTP=1 to accept the risk)`);
if (!["http:", "https:"].includes(baseUrl.protocol)) die(`Unsupported URL scheme: ${baseUrl.protocol}`);

const USAGE = `Usage: node sb.mjs <command> [args]
  ls [prefix] [--all] [--limit N]   list pages (newest first); --all includes attachments
  get <page>                        print page content
  put <page> [file] [--force]       write page from file or stdin; refuses to overwrite without --force
  append <page> [file]              append text (file or stdin) to page, creates page if missing
  block <page> <id> [file] [--adopt <old-file>]
                                    upsert an owned section: from the line with anchor $id up to the next
                                    "---" line. Only that section changes; --adopt wraps existing exact text
  rm <page>                         delete page/file
  search <regex> [--prefix P]       case-insensitive grep across .md pages
  tags [--prefix P] [--sort count|name|recent]
                                    hashtag stats: pages, occurrences per scope, last used
  tagged <tag> [--children] [--scope page|item|task|para|heading]
                                    where a tag is used (--children also matches <tag>/...)
  tasks [--tag T] [--page P] [--done|--all] [--limit N]
                                    list open (or done / all) tasks as page:line [state] text, newest pages first
  task add <text...> [--page P] [--section "## To-do list"]
                                    insert one "- [ ] text" line at the end of that section's list
                                    (default page: today's journal, created if missing)
  task done <page:line> --expect <text> [--undo]
                                    tick (or untick) exactly that task line; refuses if the line no longer matches
  journal [YYYY-MM-DD] [--detail]   print today's (or given) journal, creating it from the journal template if missing;
                                    --detail prints the day's detail page instead (two-tier journal), created if missing
  log <id> <summary...> [--detail <file>] [--date YYYY-MM-DD] [--time HH:MM]
                                    journal entry: upsert block $id from <file> on the day's detail page, then upsert one
                                    "- HH:MM <summary> ([[detail$id|label]])" line in the journal's summary block
  upload <local-file> <remote-path> upload attachment (image, pdf, ...)
  download <remote-path> <local>    download attachment
Page names omit ".md" (e.g. "Journal/2026-10-16"); paths with another extension are used as-is.`;

function die(msg, code = 1) { process.stderr.write(msg + "\n"); process.exit(code); }

const toPath = (page) => (/\.[A-Za-z0-9]{1,6}$/.test(page) ? page : page + ".md");
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

// Authenticated fetch that never follows redirects: a 307/308 would replay the token
// or a page body to another endpoint, and a redirected success would be misreported.
async function authFetch(url, init = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: "error",
      headers: { Authorization: `Bearer ${TOKEN}`, "X-Sync-Mode": "true", ...init.headers },
    });
  } catch (e) {
    const why = e.cause?.message ?? e.message;
    die(`Request to ${url} failed: ${why}${/redirect/i.test(why) ? " — the server redirected; point SB_URL at the final https address" : ""}`);
  }
}

async function req(method, path, body, extra = {}) {
  const res = await authFetch(`${BASE}/.fs/${enc(path)}`, { method, body, headers: extra });
  if (res.status === 401) die("401 Unauthorized — check token");
  return res;
}

async function readText(path) {
  const res = await req("GET", path);
  if (res.status === 404) return null;
  if (!res.ok) die(`GET ${path} → ${res.status}`);
  return res.text();
}

async function readWithMeta(path) {
  const res = await req("GET", path);
  if (res.status === 404) return null;
  if (!res.ok) die(`GET ${path} → ${res.status}`);
  return { text: await res.text(), mtime: res.headers.get("x-last-modified") };
}

async function writeText(path, text) {
  const res = await req("PUT", path, text, { "Content-Type": "text/markdown" });
  if (!res.ok) die(`PUT ${path} → ${res.status}`);
}

// Write `out` only if the page is still exactly `orig`, then read back to verify.
// Returns the changed line range so callers can report it.
async function guardedWrite(path, orig, out) {
  const latest = await readWithMeta(path);
  if (latest?.mtime !== orig.mtime || latest?.text !== orig.text) die(`${path} changed while editing — re-run`, 4);
  await writeText(path, out);
  if ((await readText(path)) !== out) die(`Verify failed: ${path} content differs after write`, 6);
  const a = orig.text.split(/\r?\n/), b = out.split(/\r?\n/);
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return `lines ${p + 1}-${b.length - q} changed; ${p} lines before and ${q} after untouched`;
}

async function ensureJournal(date) {
  const path = `${JOURNAL_FOLDER}/${date}.md`;
  if ((await readText(path)) === null) {
    await writeText(path, (await readText(toPath(JOURNAL_TEMPLATE))) ?? "---\ntags: journal\n---\n");
    process.stderr.write(`Created ${path} from ${JOURNAL_TEMPLATE}\n`);
  }
  return path;
}

// Page holding a day's journal details: the detail page when two-tier is on, else the journal itself.
async function ensureDetail(date) {
  if (!DETAIL_FOLDER) return ensureJournal(date);
  const path = `${DETAIL_FOLDER}/${date}.md`;
  if ((await readText(path)) === null) {
    await writeText(path, `---\ntags: ${DETAIL_TAG}\n---\n← [[${JOURNAL_FOLDER}/${date}]]\n`);
    process.stderr.write(`Created ${path}\n`);
  }
  return path;
}

const BLOCK_ID = /^[A-Za-z0-9][\w-]*$/;
const anchorRe = (id) => new RegExp(`(^|\\s)\\$${id}(\\s|$)`);
const isRule = (l) => /^\s*---\s*$/.test(l);

// Upsert the section owned by anchor $id: from the anchor line up to the next "---" line.
async function upsertBlock(path, id, text, adoptFile) {
  const orig = await readWithMeta(path);
  if (orig === null) die(`Not found: ${path} — create the page first`, 2);
  const anchor = "$" + id;
  const re = anchorRe(id);

  let body = text.replace(/\s+$/, "").split("\n");
  if (body.some(isRule)) die("Block content must not contain a '---' line (it ends the block)");
  if (!body.some((l) => re.test(l))) body[0] += " " + anchor;

  const eol = orig.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = orig.text.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (re.test(l) ? [i] : []));
  if (starts.length > 1) die(`Anchor ${anchor} occurs ${starts.length} times — fix the page by hand`, 5);

  let next;
  if (starts.length === 1) {
    const s = starts[0];
    let e = lines.findIndex((l, i) => i > s && isRule(l));
    if (e < 0) e = lines.length;
    while (e - 1 > s && lines[e - 1].trim() === "") e--; // keep blank lines before the rule
    next = [...lines.slice(0, s), ...body, ...lines.slice(e)];
  } else if (adoptFile) {
    const old = readFileSync(adoptFile, "utf8").replace(/\r\n/g, "\n").replace(/\s+$/, "");
    const flat = lines.join("\n");
    const at = flat.indexOf(old);
    if (at < 0 || flat.indexOf(old, at + 1) >= 0) die("--adopt text must occur exactly once in the page", 5);
    const before = flat.slice(0, at).split("\n");
    const after = flat.slice(at + old.length).split("\n");
    if (before.pop() !== "" || after.shift() !== "") die("--adopt text must cover whole lines", 5);
    const closed = after.find((l) => l.trim() !== "");
    next = [...before, ...body, ...(closed !== undefined && isRule(closed) ? after : ["", "---", ...after])];
  } else {
    const trimmed = [...lines];
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") trimmed.pop();
    const lastRule = trimmed.length && isRule(trimmed[trimmed.length - 1]);
    next = [...trimmed, ...(lastRule ? [] : ["", "---"]), "", ...body, "", "---", ""];
  }

  const out = next.join(eol);
  if (out === orig.text) return `Unchanged ${path}`;
  return `Block ${anchor} written to ${path}: ${await guardedWrite(path, orig, out)}`;
}

// One summary line per entry in the journal's summary block, keyed by the $id in its link:
// replaced when present, else added after the block's last line. Creates the block if missing.
async function upsertSummaryLine(path, date, id, line) {
  const blockId = `${SUMMARY_BLOCK}-${date}`;
  const orig = await readWithMeta(path);
  if (orig === null) die(`Not found: ${path}`, 2);
  const eol = orig.text.includes("\r\n") ? "\r\n" : "\n";
  const lines = orig.text.split(/\r?\n/);
  const s = lines.findIndex((l) => anchorRe(blockId).test(l));
  if (s < 0) return upsertBlock(path, blockId, `## ${SUMMARY_HEADING}\n${line}`);
  let e = lines.findIndex((l, i) => i > s && isRule(l));
  if (e < 0) e = lines.length;
  const own = lines.findIndex((l, i) => i > s && i < e && (l.includes(`$${id}|`) || l.includes(`$${id}]]`)));
  if (own >= 0) {
    if (lines[own] === line) return `Unchanged summary line in ${path}`;
    lines[own] = line;
  } else {
    let at = s + 1;
    for (let i = s + 1; i < e; i++) if (lines[i].trim() !== "") at = i + 1;
    lines.splice(at, 0, line);
  }
  return `Summary line ${own >= 0 ? "updated" : "added"} in ${path}: ${await guardedWrite(path, orig, lines.join(eol))}`;
}

async function list() {
  const res = await authFetch(`${BASE}/.fs`);
  if (!res.ok) die(`GET /.fs → ${res.status}`);
  return res.json();
}

function readInput(file) {
  if (file) return readFileSync(file, "utf8");
  if (process.stdin.isTTY) die("Provide a file or pipe content via stdin");
  return readFileSync(0, "utf8");
}

function opt(args, name, hasValue = true) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = hasValue ? args[i + 1] : true;
  args.splice(i, hasValue ? 2 : 1);
  return v;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// All content pages (Library/ excluded) with their text, fetched 8 at a time.
async function loadPages(prefix = "") {
  const pages = (await list()).filter((f) => f.name.endsWith(".md") && f.name.startsWith(prefix) && !f.name.startsWith("Library/"));
  const out = [];
  for (let i = 0; i < pages.length; i += 8) {
    await Promise.all(pages.slice(i, i + 8).map(async (f) => {
      out.push({ name: f.name.slice(0, -3), lastModified: f.lastModified, text: (await readText(f.name)) ?? "" });
    }));
  }
  return out;
}

// Hashtags per SilverBullet scope rules: a paragraph of only hashtags tags the page,
// a list item / task / paragraph tags that object; frontmatter `tags:` tags the page.
const HASHTAG = /(^|[\s(])#([^\s!@#$%^&*(),.?":{}|<>\x5c]+)/gu;
// Blank out ${...} Lua directives (Lua `#` is the length operator, not a tag), keeping newlines.
function stripDirectives(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "$" && text[i + 1] === "{") {
      let depth = 0, j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) break;
      }
      out += text.slice(i, j + 1).replace(/[^\n]/g, " ");
      i = j;
    } else out += text[i];
  }
  return out;
}

// Task line, as SilverBullet parses it: list marker + non-empty [state] + space/tab or end of line.
// "[text](url)" links and "[]" are not tasks; states cannot contain ":".
const TASK = /^(\s*(?:[-*+]|\d+\.)\s+)\[([^\]:]+)\]([ \t]+|$)(.*)$/;

function scanTasks(text) {
  const found = [];
  const raw = text.split(/\r?\n/);
  const lines = stripDirectives(text).split(/\r?\n/);
  let n = 0;
  if (lines[0] === "---") { const end = lines.indexOf("---", 1); if (end > 0) n = end + 1; }
  let fence = false;
  for (; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) { fence = !fence; continue; }
    if (fence) continue;
    const m = lines[n].match(TASK);
    if (!m) continue;
    const body = raw[n].match(TASK)?.[4] ?? m[4];
    const tags = [...body.replace(/`[^`]*`/g, "").matchAll(HASHTAG)].map((x) => x[2]);
    found.push({ line: n + 1, state: m[2], done: /^[xX]$/.test(m[2]), text: body.trim(), tags });
  }
  return found;
}

function scanTags(text) {
  const found = [];
  const lines = stripDirectives(text).split(/\r?\n/);
  let start = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      const fm = lines.slice(1, end);
      const i = fm.findIndex((l) => /^tags:/.test(l));
      if (i >= 0) {
        const vals = [fm[i].replace(/^tags:/, "")];
        for (let j = i + 1; j < fm.length && /^\s*-\s/.test(fm[j]); j++) vals.push(fm[j].replace(/^\s*-\s/, ""));
        vals.join(" ").replace(/["']/g, "").split(/[\s,]+/).filter(Boolean)
          .forEach((t) => found.push({ tag: t.replace(/^#/, ""), scope: "page", line: i + 2, text: "(frontmatter)" }));
      }
      start = end + 1;
    }
  }
  let fence = false;
  for (let n = start; n < lines.length; n++) {
    const line = lines[n];
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const tags = [...line.replace(/`[^`]*`/g, "").matchAll(HASHTAG)].map((m) => m[2]).filter((t) => !/^\d+$/.test(t));
    if (!tags.length) continue;
    let scope = TASK.test(line) ? "task" : /^\s*([-*+]|\d+\.)\s/.test(line) ? "item" : /^#{1,6}\s/.test(line) ? "heading" : "para";
    if (scope === "para") {
      let a = n, b = n;
      while (a > start && lines[a - 1].trim() !== "") a--;
      while (b < lines.length - 1 && lines[b + 1].trim() !== "") b++;
      const words = lines.slice(a, b + 1).join(" ").trim().split(/\s+/);
      if (words.every((w) => w.startsWith("#"))) scope = "page";
    }
    tags.forEach((tag) => found.push({ tag, scope, line: n + 1, text: line.trim().slice(0, 160) }));
  }
  return found;
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "ls": {
    const all = opt(args, "--all", false);
    const limit = Number(opt(args, "--limit") ?? 0);
    const prefix = args[0] ?? "";
    let files = (await list()).filter((f) => f.name.startsWith(prefix) && (all || f.name.endsWith(".md")));
    files.sort((a, b) => b.lastModified - a.lastModified);
    if (limit) files = files.slice(0, limit);
    for (const f of files) {
      const date = new Date(f.lastModified).toISOString().slice(0, 10);
      console.log(`${date}\t${all ? f.name : f.name.slice(0, -3)}${all ? `\t${f.size}B` : ""}`);
    }
    break;
  }
  case "get": {
    if (!args[0]) die(USAGE);
    const text = await readText(toPath(args[0]));
    if (text === null) die(`Not found: ${args[0]}`, 2);
    process.stdout.write(text);
    break;
  }
  case "put": {
    const force = opt(args, "--force", false);
    if (!args[0]) die(USAGE);
    const path = toPath(args[0]);
    if (!force && (await readText(path)) !== null) die(`Exists: ${args[0]} — read it first, then re-run with --force to overwrite`, 3);
    await writeText(path, readInput(args[1]));
    console.log(`Saved ${path}`);
    break;
  }
  case "append": {
    if (!args[0]) die(USAGE);
    const path = toPath(args[0]);
    const old = (await readText(path)) ?? "";
    const add = readInput(args[1]);
    const sep = old === "" || old.endsWith("\n") ? "" : "\n";
    await writeText(path, old + sep + add);
    console.log(`Appended to ${path}`);
    break;
  }
  case "block": {
    const adoptFile = opt(args, "--adopt");
    const [page, id, file] = args;
    if (!page || !id) die(USAGE);
    if (!BLOCK_ID.test(id)) die("Block id: letters, digits, '-' or '_' only");
    console.log(await upsertBlock(toPath(page), id, readInput(file), adoptFile));
    break;
  }
  case "log": {
    const date = opt(args, "--date") ?? today();
    const d = new Date();
    const time = opt(args, "--time") ?? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const detailFile = opt(args, "--detail");
    const [id, ...words] = args;
    const summary = words.join(" ").trim();
    if (!id || !summary) die(USAGE);
    if (!BLOCK_ID.test(id)) die("Entry id: letters, digits, '-' or '_' only");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("Date must be YYYY-MM-DD");
    if (!/^\d{2}:\d{2}$/.test(time)) die("Time must be HH:MM");
    if (/[\r\n]/.test(summary)) die("Summary must be a single line");
    const journalPath = await ensureJournal(date);
    const detailPath = await ensureDetail(date);
    if (detailFile) console.log(await upsertBlock(detailPath, id, readInput(detailFile)));
    else if (!((await readText(detailPath)) ?? "").split(/\r?\n/).some((l) => anchorRe(id).test(l)))
      die(`No block $${id} in ${detailPath} — pass --detail <file> to write it`, 2);
    const line = `- ${time} ${summary} ([[${detailPath.slice(0, -3)}$${id}|${DETAIL_LABEL}]])`;
    console.log(await upsertSummaryLine(journalPath, date, id, line));
    break;
  }
  case "tasks": {
    const tag = opt(args, "--tag")?.replace(/^#/, "");
    const prefix = opt(args, "--page") ?? "";
    const done = opt(args, "--done", false), all = opt(args, "--all", false);
    const limit = Number(opt(args, "--limit") ?? 0);
    const isTemplate = (name) => name === JOURNAL_TEMPLATE || name.startsWith("Template/");
    const pages = (await loadPages(prefix)).filter((p) => !isTemplate(p.name)).sort((a, b) => b.lastModified - a.lastModified);
    let rows = [];
    for (const p of pages) {
      for (const t of scanTasks(p.text)) {
        if (!all && t.done !== Boolean(done)) continue;
        if (tag && !t.tags.some((x) => x === tag || x.startsWith(tag + "/"))) continue;
        rows.push(`${p.name}:${t.line}\t[${t.state}]\t${t.text}`);
      }
    }
    const total = rows.length;
    if (limit) rows = rows.slice(0, limit);
    console.log(rows.join("\n") || "No tasks");
    if (total) console.log(`-- ${total} task(s)${limit && total > limit ? `, showing ${limit}` : ""}`);
    break;
  }
  case "task": {
    const sub = args.shift();
    if (sub === "add") {
      const pageArg = opt(args, "--page");
      const section = (opt(args, "--section") ?? "## To-do list").trim();
      const text = args.join(" ").trim();
      if (!text) die(USAGE);
      const path = pageArg ? toPath(pageArg) : await ensureJournal(today());
      const orig = await readWithMeta(path);
      if (orig === null) die(`Not found: ${path}`, 2);
      const eol = orig.text.includes("\r\n") ? "\r\n" : "\n";
      const lines = orig.text.split(/\r?\n/);
      const h = lines.findIndex((l) => l.trim() === section);
      if (h < 0) die(`Section "${section}" not found in ${path} — pass --section or add the heading first`, 2);
      const level = (section.match(/^#+/) ?? [""])[0].length;
      let end = lines.findIndex((l, i) => i > h && (/^\s*---\s*$/.test(l) || (level && /^(#+)\s/.test(l) && l.match(/^#+/)[0].length <= level)));
      if (end < 0) end = lines.length;
      let at = h + 1; // after the last list line (or its indented continuation) in the section
      for (let i = h + 1; i < end; i++) if (lines[i].trim() !== "" && /^(\s+\S|\s*([-*+]|\d+\.)\s)/.test(lines[i])) at = i + 1;
      lines.splice(at, 0, `- [ ] ${text}`);
      console.log(`Added task at ${path.slice(0, -3)}:${at + 1} — ${await guardedWrite(path, orig, lines.join(eol))}`);
      break;
    }
    if (sub === "done") {
      const expect = opt(args, "--expect"), undo = opt(args, "--undo", false);
      const spec = args[0] ?? "";
      const sep = spec.lastIndexOf(":");
      const page = spec.slice(0, sep), ln = Number(spec.slice(sep + 1));
      if (sep < 1 || !ln || !expect) die("Usage: task done <page:line> --expect <text> [--undo]");
      const path = toPath(page);
      const orig = await readWithMeta(path);
      if (orig === null) die(`Not found: ${page}`, 2);
      const tasks = scanTasks(orig.text);
      let t = tasks.find((x) => x.line === ln && x.text.includes(expect));
      if (!t) {
        const cands = tasks.filter((x) => x.text.includes(expect));
        if (cands.length !== 1) die(`Line ${ln} is not a task containing "${expect}" and ${cands.length} other tasks match — re-run tasks to get the current line`, 5);
        t = cands[0];
        process.stderr.write(`Task moved: line ${ln} → ${t.line}\n`);
      }
      if (t.done === !undo) { console.log(`Already ${undo ? "open" : "done"}: ${page}:${t.line}`); break; }
      const eol = orig.text.includes("\r\n") ? "\r\n" : "\n";
      const lines = orig.text.split(/\r?\n/);
      lines[t.line - 1] = lines[t.line - 1].replace(TASK, (m, pre, st, sp, rest) => `${pre}[${undo ? " " : "x"}]${sp}${rest}`);
      console.log(`${undo ? "Reopened" : "Done"} ${page}:${t.line} — ${await guardedWrite(path, orig, lines.join(eol))}`);
      break;
    }
    die(USAGE);
  }
  case "rm": {
    if (!args[0]) die(USAGE);
    const path = toPath(args[0]);
    const res = await req("DELETE", path);
    if (!res.ok) die(`DELETE ${path} → ${res.status}`);
    console.log(`Deleted ${path}`);
    break;
  }
  case "search": {
    const prefix = opt(args, "--prefix") ?? "";
    if (!args[0]) die(USAGE);
    const re = new RegExp(args[0], "i");
    const pages = (await list()).filter((f) => f.name.endsWith(".md") && f.name.startsWith(prefix));
    const hits = [];
    for (let i = 0; i < pages.length; i += 8) {
      await Promise.all(pages.slice(i, i + 8).map(async (f) => {
        const name = f.name.slice(0, -3);
        if (re.test(name)) hits.push(`${name}\t(title)`);
        const text = (await readText(f.name)) ?? "";
        text.split("\n").forEach((line, n) => { if (re.test(line)) hits.push(`${name}:${n + 1}\t${line.trim().slice(0, 200)}`); });
      }));
    }
    console.log(hits.sort().join("\n") || "No matches");
    break;
  }
  case "tags": {
    const prefix = opt(args, "--prefix") ?? "";
    const sort = opt(args, "--sort") ?? "count";
    const stats = {};
    for (const p of await loadPages(prefix)) {
      for (const { tag, scope } of scanTags(p.text)) {
        const s = (stats[tag] ??= { pages: new Set(), scopes: {}, last: 0 });
        s.pages.add(p.name);
        s.scopes[scope] = (s.scopes[scope] || 0) + 1;
        s.last = Math.max(s.last, p.lastModified);
      }
    }
    const rows = Object.entries(stats);
    const by = { count: (a, b) => b[1].pages.size - a[1].pages.size || a[0].localeCompare(b[0]), name: (a, b) => a[0].localeCompare(b[0]), recent: (a, b) => b[1].last - a[1].last };
    rows.sort(by[sort] ?? by.count);
    console.log("tag\tpages\tscopes\tlast used");
    for (const [tag, s] of rows) {
      const scopes = Object.entries(s.scopes).map(([k, v]) => `${k}:${v}`).join(" ");
      console.log(`#${tag}\t${s.pages.size}\t${scopes}\t${new Date(s.last).toISOString().slice(0, 10)}`);
    }
    break;
  }
  case "tagged": {
    const children = opt(args, "--children", false);
    const scopeFilter = opt(args, "--scope");
    if (!args[0]) die(USAGE);
    const want = args[0].replace(/^#/, "");
    const hits = [];
    for (const p of await loadPages()) {
      for (const h of scanTags(p.text)) {
        if (h.tag !== want && !(children && h.tag.startsWith(want + "/"))) continue;
        if (scopeFilter && h.scope !== scopeFilter) continue;
        hits.push(`${p.name}:${h.line}\t[${h.scope}${h.tag !== want ? ` #${h.tag}` : ""}]\t${h.text}`);
      }
    }
    console.log(hits.sort().join("\n") || "No matches");
    break;
  }
  case "journal": {
    const detail = opt(args, "--detail", false);
    const date = args[0] ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("Date must be YYYY-MM-DD");
    if (detail && !DETAIL_FOLDER) die("--detail needs journalDetailFolder in the config (two-tier journal is off)");
    const path = await ensureJournal(date);
    process.stdout.write(await readText(detail ? await ensureDetail(date) : path));
    break;
  }
  case "upload": {
    const [local, remote] = args;
    if (!local || !remote) die(USAGE);
    const res = await req("PUT", remote, readFileSync(local), { "Content-Type": "application/octet-stream" });
    if (!res.ok) die(`PUT ${remote} → ${res.status}`);
    console.log(`Uploaded ${remote} — embed with ![${basename(remote)}](${remote.split("/").map(encodeURIComponent).join("/")})`);
    break;
  }
  case "download": {
    const [remote, local] = args;
    if (!remote || !local) die(USAGE);
    const res = await req("GET", remote);
    if (!res.ok) die(`GET ${remote} → ${res.status}`, res.status === 404 ? 2 : 1);
    writeFileSync(local, Buffer.from(await res.arrayBuffer()));
    console.log(`Saved ${local}`);
    break;
  }
  default:
    die(USAGE, cmd ? 1 : 0);
}
