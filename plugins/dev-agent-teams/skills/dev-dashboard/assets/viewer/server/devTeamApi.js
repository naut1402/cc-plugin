import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'

// Vite plugin: exposes a tiny read-only API over the `.dev-team-agent/` data
// root so the dashboard can render orchestrator state without a separate server
// process. Everything is filesystem-backed; the frontend polls for realtime.
//
//   GET /api/tasks                  → all tasks with state + artifact metadata + qa
//   GET /api/artifact?id=..&name=.. → raw text of one artifact (markdown)
//   GET /api/pipeline-export?id=..  → structured phase-summary JSON (machine-readable)
//   GET /api/profile                → orchestrator flow profile (future: editable)
//   POST /api/profile               → persist profile (stub)

// Artifacts we know how to map onto pipeline phases. Anything else found in a
// task directory is still surfaced under "other" so nothing is hidden.
const KNOWN_ARTIFACTS = [
  'project-rules.md',
  'investigate.md',
  'investigate-po.md',
  'design.md',
  'design-po.md',
  'phpstan.md',
  'review.md',
  'test-spec.md',
  'pr-desc.md',
  'qa.md',
]

function json(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

async function statSafe(p) {
  try {
    const s = await fs.stat(p)
    return { exists: true, mtime: s.mtimeMs, size: s.size }
  } catch {
    return { exists: false, mtime: null, size: 0 }
  }
}

// pipeline-export.json is machine-readable only — excluded from the UI artifact list.
const MACHINE_FILES = new Set(['pipeline-export.json'])

async function listArtifacts(taskDir) {
  const out = {}
  let entries = []
  try {
    entries = await fs.readdir(taskDir, { withFileTypes: true })
  } catch {
    return { artifacts: out, subtasks: [] }
  }
  const subtasks = []
  for (const e of entries) {
    if (e.isDirectory()) {
      subtasks.push(e.name)
      continue
    }
    if (MACHINE_FILES.has(e.name)) continue
    if (e.name.endsWith('.md')) {
      const meta = await statSafe(path.join(taskDir, e.name))
      out[e.name] = { exists: true, mtime: meta.mtime, size: meta.size }
    }
  }
  // Ensure known artifacts always appear (as not-yet-created) for a stable UI.
  for (const name of KNOWN_ARTIFACTS) {
    if (!(name in out)) out[name] = { exists: false, mtime: null, size: 0 }
  }
  return { artifacts: out, subtasks }
}

async function readState(stateFile) {
  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    return { ok: true, state: JSON.parse(raw) }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

async function collectTasks(root) {
  const stateDir = path.join(root, '.dev-state')
  const tasksDir = path.join(root, 'tasks')
  const result = []

  let stateFiles = []
  try {
    stateFiles = (await fs.readdir(stateDir)).filter((f) => f.endsWith('.json'))
  } catch {
    stateFiles = []
  }

  // Build the set of task ids from state files first, then fold in any task
  // directories that have artifacts but no state yet (e.g. legacy / mid-init).
  const ids = new Set(stateFiles.map((f) => f.replace(/\.json$/, '')))
  try {
    for (const e of await fs.readdir(tasksDir, { withFileTypes: true })) {
      if (e.isDirectory()) ids.add(e.name)
    }
  } catch {
    /* no tasks dir yet */
  }

  for (const id of [...ids].sort()) {
    const stateFile = path.join(stateDir, `${id}.json`)
    const stateMeta = await statSafe(stateFile)
    const { ok, state, error } = stateMeta.exists
      ? await readState(stateFile)
      : { ok: false, state: null, error: 'no state file' }

    const taskDir = path.join(tasksDir, id)
    const { artifacts, subtasks } = await listArtifacts(taskDir)

    let qa = null
    let qa_count = 0
    if (artifacts['qa.md'] && artifacts['qa.md'].exists) {
      try {
        qa = await fs.readFile(path.join(taskDir, 'qa.md'), 'utf8')
        // Count Q&A items: each question starts with a level-2 heading "## Q"
        qa_count = (qa.match(/^##\s+Q\d/gm) || []).length
      } catch {
        qa = null
      }
    }

    result.push({
      task_id: id,
      state_ok: ok,
      state_error: ok ? null : error,
      state_mtime: stateMeta.mtime,
      // Spread known state fields with safe defaults so the UI never crashes on
      // a partially-written file.
      parent_task_id: state?.parent_task_id ?? null,
      current_phase: state?.current_phase ?? null,
      hitl_pending: state?.hitl_pending ?? null,
      review_round: state?.review_round ?? 0,
      auto_review: state?.auto_review ?? false,
      doc_review_round: state?.doc_review_round ?? { investigate: 0, design: 0 },
      inherit_from_parent: state?.inherit_from_parent ?? [],
      export_json: state?.export_json ?? false,
      artifacts,
      subtasks,
      has_qa: !!(artifacts['qa.md'] && artifacts['qa.md'].exists),
      qa_count,
      qa,
    })
  }
  return result
}

// Resolve an artifact path safely inside tasks/<id>/, blocking traversal.
function resolveArtifact(root, id, name) {
  const taskDir = path.resolve(root, 'tasks', id)
  const target = path.resolve(taskDir, name)
  if (target !== taskDir && !target.startsWith(taskDir + path.sep)) return null
  return target
}

function flowProfilePath(root, id) {
  return path.join(root, 'flow-profiles', `${id}.json`)
}

export function devTeamApi({ root }) {
  const profilePath = path.join(root, 'orchestrator-profile.json')

  return {
    name: 'dev-team-api',
    configureServer(server) {
      // Surface the resolved root once at startup so it's obvious what's served.
      const exists = fsSync.existsSync(root)
      server.config.logger.info(
        `\n  dev-team-dashboard → root: ${root}${exists ? '' : '  (does not exist yet)'}\n`,
      )

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        try {
          if (url.pathname === '/api/tasks' && req.method === 'GET') {
            return json(res, 200, { root, tasks: await collectTasks(root) })
          }

          if (url.pathname === '/api/artifact' && req.method === 'GET') {
            const id = url.searchParams.get('id') || ''
            const name = url.searchParams.get('name') || ''
            const target = resolveArtifact(root, id, name)
            if (!target) return json(res, 400, { error: 'invalid path' })
            try {
              const content = await fs.readFile(target, 'utf8')
              const s = await fs.stat(target)
              return json(res, 200, { id, name, content, mtime: s.mtimeMs })
            } catch {
              return json(res, 404, { error: 'not found', id, name })
            }
          }

          if (url.pathname === '/api/profile') {
            if (req.method === 'GET') {
              try {
                const raw = await fs.readFile(profilePath, 'utf8')
                return json(res, 200, { profile: JSON.parse(raw), exists: true })
              } catch {
                return json(res, 200, { profile: null, exists: false })
              }
            }
            if (req.method === 'POST') {
              return json(res, 501, { error: 'profile editing not implemented yet' })
            }
          }

          // Structured phase-summary export (machine-readable, written by orchestrator
          // when --export-json flag is active).
          if (url.pathname === '/api/pipeline-export' && req.method === 'GET') {
            const id = url.searchParams.get('id') || ''
            if (!id) return json(res, 400, { error: 'missing id' })
            const fp = path.join(root, 'tasks', id, 'pipeline-export.json')
            try {
              const raw = await fs.readFile(fp, 'utf8')
              return json(res, 200, { id, export: JSON.parse(raw), exists: true })
            } catch {
              return json(res, 200, { id, export: null, exists: false })
            }
          }

          // Per-task flow profiles: GET reads, POST creates/updates.
          if (url.pathname === '/api/flow-profile') {
            const id = url.searchParams.get('id') || ''
            if (!id) return json(res, 400, { error: 'missing id' })
            const fp = flowProfilePath(root, id)

            if (req.method === 'GET') {
              try {
                const raw = await fs.readFile(fp, 'utf8')
                return json(res, 200, { id, profile: JSON.parse(raw), exists: true })
              } catch {
                return json(res, 200, { id, profile: null, exists: false })
              }
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try {
                parsed = JSON.parse(body)
              } catch {
                return json(res, 400, { error: 'invalid JSON body' })
              }
              await fs.mkdir(path.dirname(fp), { recursive: true })
              await fs.writeFile(fp, JSON.stringify(parsed, null, 2), 'utf8')
              return json(res, 200, { id, saved: true })
            }
          }

          return json(res, 404, { error: 'unknown endpoint' })
        } catch (err) {
          return json(res, 500, { error: String(err && err.message ? err.message : err) })
        }
      })
    },
  }
}
