#!/usr/bin/env node
// Scaffold the dev-team dashboard into a project.
//
//   node setup.mjs [projectRoot]
//
// Steps (all idempotent):
//   1. Ensure <projectRoot>/.dev-team-agent/ exists.
//   2. Migrate legacy top-level `tasks/` and `.dev-state/` into it (if present
//      at the project root and not already migrated).
//   3. Copy the bundled Vue+Vite viewer into `.dev-team-agent/viewer/`
//      (preserving an existing node_modules so re-runs don't trigger reinstall).
//   4. Add `.dev-team-agent/` to the project's .gitignore.
//
// It does NOT run npm — the SKILL drives install + dev so the user sees output.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const viewerSrc = path.resolve(__dirname, '../assets/viewer')
const projectRoot = path.resolve(process.argv[2] || process.cwd())
const dta = path.join(projectRoot, '.dev-team-agent')
const viewerDst = path.join(dta, 'viewer')

function log(msg) {
  console.log(`[dev-dashboard] ${msg}`)
}

fs.mkdirSync(dta, { recursive: true })
fs.mkdirSync(path.join(dta, 'pipeline-profiles'), { recursive: true })

// 2. Migrate legacy layout.
for (const dir of ['tasks', '.dev-state']) {
  const oldPath = path.join(projectRoot, dir)
  const newPath = path.join(dta, dir)
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    fs.renameSync(oldPath, newPath)
    log(`migrated ${dir}/ → .dev-team-agent/${dir}/`)
  }
}

// 2b. Scaffold a default pipeline.yaml (idempotent — never clobber an edited one).
//     Reads the canonical asset that the orchestrator + /init-dev-pipeline also
//     use, so there is one source of truth the user can then customise.
const pipelinePath = path.join(dta, 'pipeline.yaml')
const defaultPipelineAsset = path.resolve(
  __dirname,
  '../../dev-team-orchestrator/assets/pipeline.default.yaml',
)
const DEFAULT_PIPELINE_YAML = fs.readFileSync(defaultPipelineAsset, 'utf8')
if (fs.existsSync(pipelinePath)) {
  log('pipeline.yaml already exists — skipped')
} else {
  fs.writeFileSync(pipelinePath, DEFAULT_PIPELINE_YAML)
  log('scaffolded default pipeline.yaml → .dev-team-agent/pipeline.yaml')
}

// 3. Copy viewer, never clobbering an installed node_modules.
fs.cpSync(viewerSrc, viewerDst, {
  recursive: true,
  filter: (src) => !src.split(path.sep).includes('node_modules'),
})
log(`viewer copied → ${path.relative(projectRoot, viewerDst)}/`)

// 4. .gitignore
const giPath = path.join(projectRoot, '.gitignore')
const entry = '.dev-team-agent/'
let gi = ''
try {
  gi = fs.readFileSync(giPath, 'utf8')
} catch {
  /* no .gitignore yet */
}
const has = gi.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ''))
if (!has) {
  const sep = gi && !gi.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(giPath, `${gi}${sep}\n# dev-agent-teams dashboard + state\n${entry}\n`)
  log(`added "${entry}" to .gitignore`)
}

// 5. Inject rule-reference placeholders into CLAUDE.md (idempotent).
const RULES_MARKER = '<!-- dev-team-agent:rules -->'
const RULES_SECTION = `
${RULES_MARKER}
## Dev Team — Tham chiếu Rule & Cấu trúc

> Orchestrator nạp các rule này qua skill \`read-project-rules\` ở đầu pipeline.
> Điền đường dẫn / nội dung cụ thể bên dưới. Mục có ⚠ là **bắt buộc** — pipeline sẽ dừng nếu thiếu.

### Rule coding
<!-- Điền đường dẫn hoặc mô tả quy tắc coding của project (naming, style, lint rules) -->
Chưa thiết lập

### Rule viết tài liệu (doc-writing) ⚠ Bắt buộc
<!-- Investigator và designer đọc rule này để format investigate.md / design.md.
     Ví dụ: "xem coding-conventions.md §Doc" hoặc paste nội dung trực tiếp. -->
Chưa thiết lập

### Rule trình bày (presentation)
<!-- Quy tắc format tài liệu: heading style, ngôn ngữ (vn/jp), bảng vs list, độ dài mục -->
Chưa thiết lập

### Rule viết test case
<!-- Framework (PHPUnit/Jest/…), cấu trúc (AAA), coverage targets, naming convention -->
Chưa thiết lập

### File cấu trúc dự án
<!-- Đường dẫn file mô tả kiến trúc project, e.g. docs/STRUCTURE.md hoặc src/README.md -->
Chưa thiết lập
`

const claudeMdPath = path.join(projectRoot, 'CLAUDE.md')
let claudeMd = ''
try {
  claudeMd = fs.readFileSync(claudeMdPath, 'utf8')
} catch {
  /* CLAUDE.md may not exist yet — will be created */
}

if (claudeMd.includes(RULES_MARKER)) {
  log('CLAUDE.md rules section already exists — skipped')
} else {
  const sep = claudeMd && !claudeMd.endsWith('\n') ? '\n' : ''
  fs.writeFileSync(claudeMdPath, `${claudeMd}${sep}${RULES_SECTION}\n`)
  log('added rule placeholders → CLAUDE.md')
}

log('done. Next: cd .dev-team-agent/viewer && npm install && npm run dev')
