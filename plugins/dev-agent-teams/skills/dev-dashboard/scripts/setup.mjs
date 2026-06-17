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

// 2. Migrate legacy layout.
for (const dir of ['tasks', '.dev-state']) {
  const oldPath = path.join(projectRoot, dir)
  const newPath = path.join(dta, dir)
  if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
    fs.renameSync(oldPath, newPath)
    log(`migrated ${dir}/ → .dev-team-agent/${dir}/`)
  }
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

log('done. Next: cd .dev-team-agent/viewer && npm install && npm run dev')
