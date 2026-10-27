#!/usr/bin/env node
// Claude Code status line wrapper: node statusline.mjs   (stdin = status line JSON)
// Records plan usage (rate_limits.five_hour / seven_day used_percentage) to <usage.dir>/samples.jsonl whenever it
// changes, raises one handover reminder per 5-hour window at usage.handover_at %, then prints the output of the
// status line command it replaced (<daily-assistant home>/statusline-wrapped.txt, written by `usage.mjs setup`)
// or a compact "5h 42% · 7d 18%" line. Must stay fast and never break the status line.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, tzOf, nowParts, homeDir, usageDir, readPending, writePending } from './lib.mjs';

const raw = readFileSync(0, 'utf8');
let input = {};
try { input = JSON.parse(raw || '{}'); } catch { /* not JSON: still run the wrapped command */ }

const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : undefined);
const cfg = loadConfig();

try { record(); } catch { /* sampling is best effort */ }

let line = '';
let wrapped = '';
try { wrapped = readFileSync(join(homeDir(), 'statusline-wrapped.txt'), 'utf8').trim(); } catch { /* none */ }
if (wrapped) {
  try { line = execSync(wrapped, { input: raw, stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 }).toString().replace(/\s+$/, ''); }
  catch (e) { line = e.stdout?.toString().replace(/\s+$/, '') || ''; }
}
process.stdout.write((line || compact()) + '\n');

function record() {
  const rl = input.rate_limits;
  if (!rl || cfg?.usage?.enabled === false) return;
  const s = { p5: r1(rl.five_hour?.used_percentage), r5: rl.five_hour?.resets_at, p7: r1(rl.seven_day?.used_percentage), r7: rl.seven_day?.resets_at };
  if (s.p5 === undefined && s.p7 === undefined) return;
  const dir = usageDir(cfg);
  const lastFile = join(dir, 'last-sample.json');
  let last = {};
  try { last = JSON.parse(readFileSync(lastFile, 'utf8')); } catch { /* first sample */ }
  if (s.p5 === last.p5 && s.p7 === last.p7 && s.r5 === last.r5 && s.r7 === last.r7) return;
  mkdirSync(dir, { recursive: true });
  const t = new Date().toISOString();
  appendFileSync(join(dir, 'samples.jsonl'), JSON.stringify({ t, sid: input.session_id, model: input.model?.id, ...s }) + '\n');
  // One reminder per 5-hour window; delivered into the next prompt by the activity-log hook.
  const at = Number(cfg?.usage?.handover_at ?? 85);
  let flagged = last.flagged;
  if (at > 0 && s.p5 >= at && s.r5 && last.flagged !== s.r5) {
    const reset = s.r5 ? nowParts(tzOf(cfg), new Date(s.r5 * 1000)).hm : '?';
    const pending = readPending();
    pending.push({ t: nowParts(tzOf(cfg)).time, id: 'usage-handover', msg: `5-hour plan usage at ${s.p5}% (resets ${reset}) → offer /daily-assistant:human-handover task before tokens run out`, seen: false });
    writePending(pending);
    flagged = s.r5;
  }
  writeFileSync(lastFile, JSON.stringify({ ...s, t, flagged }));
}

function compact() {
  const rl = input.rate_limits || {};
  const parts = [input.model?.display_name].filter(Boolean);
  if (rl.five_hour) parts.push(`5h ${r1(rl.five_hour.used_percentage)}%${rl.five_hour.resets_at ? ` ↻${nowParts(tzOf(cfg), new Date(rl.five_hour.resets_at * 1000)).hm}` : ''}`);
  if (rl.seven_day) parts.push(`7d ${r1(rl.seven_day.used_percentage)}%`);
  return parts.join(' · ');
}
