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
  rm <page>                         delete page/file
  search <regex> [--prefix P]       case-insensitive grep across .md pages
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
