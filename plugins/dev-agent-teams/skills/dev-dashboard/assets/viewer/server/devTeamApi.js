import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

// ── Catalog helpers ──────────────────────────────────────────────────────────

// Parse YAML frontmatter from a markdown file (content between first --- fences).
function parseFrontmatter(raw) {
  const lines = raw.split('\n')
  if (lines[0].trim() !== '---') return {}
  const end = lines.indexOf('---', 1)
  if (end < 0) return {}
  try {
    return yaml.load(lines.slice(1, end).join('\n')) || {}
  } catch {
    return {}
  }
}

// Walk up from `startDir` looking for `.claude-plugin/marketplace.json`.
async function findMarketplaceJson(startDir) {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.claude-plugin', 'marketplace.json')
    try {
      const raw = await fs.readFile(candidate, 'utf8')
      return { file: candidate, dir, data: JSON.parse(raw) }
    } catch {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

// Scan a plugin source directory for SKILL.md files and agent .md files.
async function scanPlugin(pluginDir) {
  const pluginName = path.basename(pluginDir)
  const skills = []
  const agents = []

  // Skills: plugins/<name>/skills/*/SKILL.md
  const skillsDir = path.join(pluginDir, 'skills')
  try {
    for (const entry of await fs.readdir(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillMd = path.join(skillsDir, entry.name, 'SKILL.md')
      try {
        const raw = await fs.readFile(skillMd, 'utf8')
        const fm = parseFrontmatter(raw)
        if (!fm.name) continue
        // Skip contract skills (user-invocable: false)
        if (fm['user-invocable'] === false) continue
        skills.push({
          id: `${pluginName}:${fm.name}`,
          name: fm.name,
          plugin: pluginName,
          description: (fm.description || '').slice(0, 140),
        })
      } catch {
        /* skip missing files */
      }
    }
  } catch {
    /* no skills dir */
  }

  // Agents: plugins/<name>/agents/*.md
  const agentsDir = path.join(pluginDir, 'agents')
  try {
    for (const entry of await fs.readdir(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const agentName = entry.name.replace(/\.md$/, '')
      try {
        const raw = await fs.readFile(path.join(agentsDir, entry.name), 'utf8')
        const fm = parseFrontmatter(raw)
        agents.push({
          id: `${pluginName}:${agentName}`,
          name: agentName,
          plugin: pluginName,
          description: (fm.description || '').slice(0, 140),
          skills: Array.isArray(fm.skills) ? fm.skills : [],
        })
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no agents dir */
  }

  return { skills, agents }
}

// Built-in fallback catalog when marketplace.json is not found.
const BUILTIN_CATALOG = {
  skills: [
    { id: 'dev-agent-teams:survey-codebase', name: 'survey-codebase', plugin: 'dev-agent-teams', description: 'Survey codebase, trace call chains' },
    { id: 'dev-agent-teams:write-design', name: 'write-design', plugin: 'dev-agent-teams', description: 'Write design documentation' },
    { id: 'dev-agent-teams:coding-rules', name: 'coding-rules', plugin: 'dev-agent-teams', description: 'Apply coding conventions' },
    { id: 'dev-agent-teams:run-phpstan', name: 'run-phpstan', plugin: 'dev-agent-teams', description: 'Run PHPStan static analysis' },
    { id: 'dev-agent-teams:write-tests', name: 'write-tests', plugin: 'dev-agent-teams', description: 'Write test specifications' },
    { id: 'dev-agent-teams:create-pr', name: 'create-pr', plugin: 'dev-agent-teams', description: 'Create pull request' },
    { id: 'dev-agent-teams:doc-review', name: 'doc-review', plugin: 'dev-agent-teams', description: 'Review documentation quality' },
  ],
  agents: [
    { id: 'dev-agent-teams:investigator', name: 'investigator', plugin: 'dev-agent-teams', description: 'Survey codebase, trace call chains from entry point', skills: ['survey-codebase'] },
    { id: 'dev-agent-teams:designer', name: 'designer', plugin: 'dev-agent-teams', description: 'Write design documentation', skills: ['write-design'] },
    { id: 'dev-agent-teams:implementer', name: 'implementer', plugin: 'dev-agent-teams', description: 'Implement code changes, run PHPStan', skills: ['coding-rules', 'run-phpstan'] },
    { id: 'dev-agent-teams:reviewer', name: 'reviewer', plugin: 'dev-agent-teams', description: 'Review code quality, create test spec', skills: ['coding-rules', 'write-tests'] },
    { id: 'dev-agent-teams:pr-creator', name: 'pr-creator', plugin: 'dev-agent-teams', description: 'Create PR description, amend commit', skills: ['create-pr'] },
    { id: 'dev-agent-teams:doc-reviewer', name: 'doc-reviewer', plugin: 'dev-agent-teams', description: 'Review document quality', skills: ['doc-review'] },
  ],
}

async function buildCatalog(root) {
  // Find marketplace.json relative to the project root (parent of .dev-team-agent/).
  const projectRoot = path.dirname(root)
  const found = await findMarketplaceJson(projectRoot)
  if (!found) return BUILTIN_CATALOG

  const allSkills = []
  const allAgents = []
  const plugins = Array.isArray(found.data.plugins) ? found.data.plugins : []
  for (const p of plugins) {
    if (!p.source) continue
    const pluginDir = path.resolve(found.dir, p.source)
    try {
      const { skills, agents } = await scanPlugin(pluginDir)
      allSkills.push(...skills)
      allAgents.push(...agents)
    } catch {
      /* skip inaccessible plugin */
    }
  }
  return {
    skills: allSkills.length ? allSkills : BUILTIN_CATALOG.skills,
    agents: allAgents.length ? allAgents : BUILTIN_CATALOG.agents,
  }
}

// ── Profile helpers ──────────────────────────────────────────────────────────

function profilesDir(root) {
  return path.join(root, 'pipeline-profiles')
}

function sanitiseProfileName(name) {
  if (typeof name !== 'string' || !name.trim()) return null
  // Reject names containing path separators or null bytes.
  if (/[\\/\0]/.test(name)) return null
  const clean = name.trim().replace(/[^a-zA-Z0-9_\-. ]/g, '').slice(0, 64)
  return clean || null
}

// Vite plugin: exposes a tiny read-only API over the `.dev-team-agent/` data
// root so the dashboard can render orchestrator state without a separate server
// process. Everything is filesystem-backed; the frontend polls for realtime.
//
//   GET /api/tasks                  → all tasks with state + artifact metadata + qa
//   GET /api/artifact?id=..&name=.. → raw text of one artifact (markdown)
//   GET /api/pipeline-config?id=..  → resolved pipeline config (built-in ← global ← per-task)
//   GET /api/pipeline-export?id=..  → structured phase-summary JSON (machine-readable)
//   GET /api/profile                → orchestrator flow profile (future: editable)
//   POST /api/profile               → persist profile (stub)

// Last-resort fallback when NO pipeline.yaml exists anywhere (rare: /dev-dashboard
// setup always scaffolds .dev-team-agent/pipeline.yaml). The canonical source of
// the default flow is dev-team-orchestrator/assets/pipeline.default.yaml — this
// JS literal is a self-contained copy because the viewer is copied out of the
// plugin tree into the project and can't read that asset at runtime. Keep the two
// in sync (only the structure matters here; comments live in the YAML).
const DEFAULT_PIPELINE = {
  version: 1,
  defaults: { review_retry_max: 2, auto_review: false, export_json: false },
  steps: [
    { id: 'investigator', name: 'Investigate', agent: 'dev-agent-teams:investigator', produces: ['investigate.md'], export_key: 'investigator', hitl: { mode: 'manual', gate_id: 'hitl-1', optional_doc_review: true } },
    { id: 'designer', name: 'Design', agent: 'dev-agent-teams:designer', produces: ['design.md'], export_key: 'designer', hitl: { mode: 'manual', gate_id: 'hitl-2', optional_doc_review: true } },
    { id: 'implementer', name: 'Implement', agent: 'dev-agent-teams:implementer', produces: ['phpstan.md'], export_key: 'implementer', hitl: { mode: 'none' } },
    { id: 'reviewer', name: 'Review', agent: 'dev-agent-teams:reviewer', produces: ['review.md', 'test-spec.md'], export_key: 'reviewer', hitl: { mode: 'manual', gate_id: 'hitl-3', blocking: true, retry: { on: 'must_fix', restart_from: 'implementer', max: 2 } } },
    { id: 'pr-creator', name: 'PR', agent: 'dev-agent-teams:pr-creator', produces: ['pr-desc.md'], export_key: 'pr_creator', hitl: { mode: 'none' } },
  ],
  doc_reviewer: { agent: 'dev-agent-teams:doc-reviewer', skills: ['doc-review'], rule_category: 'doc-review', rule_required: true },
}

// Merge one step's fields onto a base step (one level deep for `hitl`).
function mergeStep(base, patch) {
  const out = { ...base, ...patch }
  if (base.hitl || patch.hitl) out.hitl = { ...(base.hitl || {}), ...(patch.hitl || {}) }
  return out
}

// Per-task patch: override by `id`, append new ids, drop on `remove: true`.
function patchSteps(baseSteps, patch) {
  const out = baseSteps.map((s) => ({ ...s }))
  for (const p of patch) {
    const idx = out.findIndex((s) => s.id === p.id)
    if (p.remove) {
      if (idx >= 0) out.splice(idx, 1)
      continue
    }
    if (idx >= 0) out[idx] = mergeStep(out[idx], p)
    else out.push(p)
  }
  return out
}

async function readYamlSafe(p) {
  try {
    const raw = await fs.readFile(p, 'utf8')
    const doc = yaml.load(raw)
    return doc && typeof doc === 'object' ? doc : null
  } catch {
    return null
  }
}

// Resolve pipeline config: built-in default ← global pipeline.yaml (full step
// replace) ← per-task tasks/<id>/pipeline.yaml (patch by id).
async function loadPipelineConfig(root, id) {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_PIPELINE))
  let source = 'builtin'

  const global = await readYamlSafe(path.join(root, 'pipeline.yaml'))
  if (global) {
    if (Array.isArray(global.steps)) cfg.steps = global.steps
    if (global.defaults) cfg.defaults = { ...cfg.defaults, ...global.defaults }
    if (global.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...global.doc_reviewer }
    if (global.version != null) cfg.version = global.version
    source = 'global'
  }

  if (id) {
    const per = await readYamlSafe(path.join(root, 'tasks', id, 'pipeline.yaml'))
    if (per) {
      if (Array.isArray(per.steps)) cfg.steps = patchSteps(cfg.steps, per.steps)
      if (per.defaults) cfg.defaults = { ...cfg.defaults, ...per.defaults }
      if (per.doc_reviewer) cfg.doc_reviewer = { ...cfg.doc_reviewer, ...per.doc_reviewer }
      source = source === 'global' ? 'global+task' : 'task'
    }
  }

  cfg.source = source
  return cfg
}

// Artifacts a pipeline config produces, plus always-present sidecar files
// (qa.md, and *-po.md doc-review outputs for any *.md artifact).
function knownArtifactsFor(cfg) {
  const set = new Set(['qa.md'])
  for (const step of cfg.steps || []) {
    for (const a of step.produces || []) {
      set.add(a)
      const m = /^(.*)\.md$/.exec(a)
      if (m) set.add(`${m[1]}-po.md`)
    }
  }
  return [...set]
}

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

async function listArtifacts(taskDir, knownArtifacts) {
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
  for (const name of knownArtifacts) {
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
    const cfg = await loadPipelineConfig(root, id)
    const { artifacts, subtasks } = await listArtifacts(taskDir, knownArtifactsFor(cfg))

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
      pipeline: cfg,
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

          // Resolved pipeline config for a task (or global when no id).
          if (url.pathname === '/api/pipeline-config' && req.method === 'GET') {
            const id = url.searchParams.get('id') || ''
            const cfg = await loadPipelineConfig(root, id || null)
            return json(res, 200, { id: id || null, pipeline: cfg })
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

          // ── Catalog: available skills & agents from installed plugins ──────
          if (url.pathname === '/api/catalog' && req.method === 'GET') {
            const catalog = await buildCatalog(root)
            return json(res, 200, catalog)
          }

          // ── Pipeline profiles: named reusable pipeline configs ────────────
          if (url.pathname === '/api/pipeline-profiles') {
            const dir = profilesDir(root)

            if (req.method === 'GET') {
              // ?name=<n> → return one profile's pipeline content
              const nameParam = url.searchParams.get('name')
              if (nameParam) {
                const name = sanitiseProfileName(nameParam)
                if (!name) return json(res, 400, { error: 'invalid profile name' })
                try {
                  const raw = await fs.readFile(path.join(dir, `${name}.yaml`), 'utf8')
                  const pipeline = yaml.load(raw)
                  return json(res, 200, { name, pipeline })
                } catch {
                  return json(res, 404, { error: 'profile not found' })
                }
              }
              // No ?name → list all profiles
              try {
                const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml'))
                const profiles = await Promise.all(
                  files.map(async (f) => {
                    const s = await statSafe(path.join(dir, f))
                    return { name: f.replace(/\.yaml$/, ''), mtime: s.mtime }
                  }),
                )
                return json(res, 200, { profiles })
              } catch {
                return json(res, 200, { profiles: [] })
              }
            }

            if (req.method === 'POST') {
              let body = ''
              for await (const chunk of req) body += chunk
              let parsed
              try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
              const name = sanitiseProfileName(parsed.name)
              if (!name) return json(res, 400, { error: 'invalid profile name' })
              if (!parsed.pipeline || !Array.isArray(parsed.pipeline.steps)) {
                return json(res, 400, { error: 'pipeline.steps must be an array' })
              }
              await fs.mkdir(dir, { recursive: true })
              await fs.writeFile(path.join(dir, `${name}.yaml`), yaml.dump(parsed.pipeline, { lineWidth: 120 }), 'utf8')
              return json(res, 200, { saved: true, name })
            }

            if (req.method === 'DELETE') {
              const name = sanitiseProfileName(url.searchParams.get('name') || '')
              if (!name) return json(res, 400, { error: 'invalid profile name' })
              try {
                await fs.unlink(path.join(dir, `${name}.yaml`))
                return json(res, 200, { deleted: true, name })
              } catch {
                return json(res, 404, { error: 'profile not found' })
              }
            }
          }

          // ── Pipeline config write: save global or per-task pipeline.yaml ──
          if (url.pathname === '/api/pipeline-config-write' && req.method === 'POST') {
            let body = ''
            for await (const chunk of req) body += chunk
            let parsed
            try { parsed = JSON.parse(body) } catch { return json(res, 400, { error: 'invalid JSON' }) }
            const { scope, taskId, pipeline } = parsed
            if (!pipeline || !Array.isArray(pipeline.steps)) {
              return json(res, 400, { error: 'pipeline.steps must be an array' })
            }
            let target
            if (scope === 'global') {
              target = path.join(root, 'pipeline.yaml')
            } else if (scope === 'task' && taskId) {
              // Sanitise taskId — only allow alphanumeric and hyphens/underscores
              if (/[^\w\-]/.test(taskId)) return json(res, 400, { error: 'invalid taskId' })
              const taskDir = path.join(root, 'tasks', taskId)
              await fs.mkdir(taskDir, { recursive: true })
              target = path.join(taskDir, 'pipeline.yaml')
            } else {
              return json(res, 400, { error: 'scope must be "global" or "task" (with taskId)' })
            }
            await fs.writeFile(target, yaml.dump(pipeline, { lineWidth: 120 }), 'utf8')
            return json(res, 200, { written: true, scope, target })
          }

          return json(res, 404, { error: 'unknown endpoint' })
        } catch (err) {
          return json(res, 500, { error: String(err && err.message ? err.message : err) })
        }
      })
    },
  }
}
