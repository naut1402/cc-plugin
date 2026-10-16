#!/usr/bin/env node
// SilverBullet HTTP API client (/.fs).
// Config: env SB_URL / SB_TOKEN, else first of <skill-dir>/config.json, ~/.config/silverbullet/config.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILES = [join(here, "..", "config.json"), join(homedir(), ".config", "silverbullet", "config.json")];
let cfg = {};
for (const file of CONFIG_FILES) {
  try { cfg = JSON.parse(readFileSync(file, "utf8")); break; } catch {}
}
const BASE = (process.env.SB_URL || cfg.url || "").replace(/\/+$/, "");
const TOKEN = process.env.SB_TOKEN || cfg.token;
const JOURNAL_FOLDER = cfg.journalFolder || "Journal";
const JOURNAL_TEMPLATE = cfg.journalTemplate || "Template-journal";
if (!BASE || !TOKEN) die(`Missing SB_URL/SB_TOKEN — set env vars or create one of:\n  ${CONFIG_FILES.join("\n  ")}`);

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
  journal [YYYY-MM-DD]              print today's (or given) journal, creating it from the journal template if missing
  upload <local-file> <remote-path> upload attachment (image, pdf, ...)
  download <remote-path> <local>    download attachment
Page names omit ".md" (e.g. "Journal/2026-10-16"); paths with another extension are used as-is.`;

function die(msg, code = 1) { process.stderr.write(msg + "\n"); process.exit(code); }

const toPath = (page) => (/\.[A-Za-z0-9]{1,6}$/.test(page) ? page : page + ".md");
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

async function req(method, path, body, extra = {}) {
  const res = await fetch(`${BASE}/.fs/${enc(path)}`, {
    method,
    body,
    headers: { Authorization: `Bearer ${TOKEN}`, "X-Sync-Mode": "true", ...extra },
  });
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

async function list() {
  const res = await fetch(`${BASE}/.fs`, { headers: { Authorization: `Bearer ${TOKEN}`, "X-Sync-Mode": "true" } });
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
    let scope = /^\s*[-*+] \[[ xX]\]/.test(line) ? "task" : /^\s*([-*+]|\d+\.)\s/.test(line) ? "item" : /^#{1,6}\s/.test(line) ? "heading" : "para";
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
    if (!/^[A-Za-z0-9][\w-]*$/.test(id)) die("Block id: letters, digits, '-' or '_' only");
    const path = toPath(page);
    const orig = await readWithMeta(path);
    if (orig === null) die(`Not found: ${page} — create the page first`, 2);
    const anchor = "$" + id;
    const anchorRe = new RegExp(`(^|\\s)\\$${id}(\\s|$)`);
    const isRule = (l) => /^\s*---\s*$/.test(l);

    let body = readInput(file).replace(/\s+$/, "").split("\n");
    if (body.some(isRule)) die("Block content must not contain a '---' line (it ends the block)");
    if (!body.some((l) => anchorRe.test(l))) body[0] += " " + anchor;

    const eol = orig.text.includes("\r\n") ? "\r\n" : "\n";
    const lines = orig.text.split(/\r?\n/);
    const starts = lines.flatMap((l, i) => (anchorRe.test(l) ? [i] : []));
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
    if (out === orig.text) { console.log(`Unchanged ${path}`); break; }
    const latest = await readWithMeta(path);
    if (latest?.mtime !== orig.mtime || latest?.text !== orig.text) die(`${path} changed while editing — re-run`, 4);
    await writeText(path, out);
    const check = await readText(path);
    if (check !== out) die(`Verify failed: ${path} content differs after write`, 6);
    // Report the changed line range
    const a = orig.text.split(/\r?\n/), b = out.split(/\r?\n/);
    let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
    console.log(`Block ${anchor} written to ${path}: lines ${p + 1}-${b.length - q} changed; ${p} lines before and ${q} after untouched`);
    break;
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
    const date = args[0] ?? today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die("Date must be YYYY-MM-DD");
    const path = `${JOURNAL_FOLDER}/${date}.md`;
    let text = await readText(path);
    if (text === null) {
      text = (await readText(toPath(JOURNAL_TEMPLATE))) ?? "---\ntags: journal\n---\n";
      await writeText(path, text);
      process.stderr.write(`Created ${path} from ${JOURNAL_TEMPLATE}\n`);
    }
    process.stdout.write(text);
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
