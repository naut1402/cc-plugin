// Thin fetch wrappers around the dev-server API exposed by server/devTeamApi.js.

export async function fetchTasks() {
  const r = await fetch('/api/tasks')
  if (!r.ok) throw new Error(`/api/tasks → ${r.status}`)
  return r.json()
}

export async function fetchArtifact(id, name) {
  const r = await fetch(`/api/artifact?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/artifact ${name} → ${r.status}`)
  return r.json()
}

export async function fetchPipelineExport(id) {
  const r = await fetch(`/api/pipeline-export?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/pipeline-export → ${r.status}`)
  return r.json()
}

export async function fetchPipelineConfig(id) {
  const q = id ? `?id=${encodeURIComponent(id)}` : ''
  const r = await fetch(`/api/pipeline-config${q}`)
  if (!r.ok) throw new Error(`/api/pipeline-config → ${r.status}`)
  return r.json()
}

export async function fetchFlowProfile(id) {
  const r = await fetch(`/api/flow-profile?id=${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(`/api/flow-profile → ${r.status}`)
  return r.json()
}

export async function saveFlowProfile(id, profile) {
  const r = await fetch(`/api/flow-profile?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  })
  if (!r.ok) throw new Error(`/api/flow-profile POST → ${r.status}`)
  return r.json()
}

export async function fetchCatalog() {
  const r = await fetch('/api/catalog')
  if (!r.ok) throw new Error(`/api/catalog → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfiles() {
  const r = await fetch('/api/pipeline-profiles')
  if (!r.ok) throw new Error(`/api/pipeline-profiles → ${r.status}`)
  return r.json()
}

export async function fetchPipelineProfile(name) {
  const r = await fetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`)
  if (!r.ok) throw new Error(`/api/pipeline-profiles?name=${name} → ${r.status}`)
  return r.json()
}

export async function savePipelineProfile(name, pipeline) {
  const r = await fetch('/api/pipeline-profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pipeline }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-profiles POST → ${r.status}`)
  return r.json()
}

export async function deletePipelineProfile(name) {
  const r = await fetch(`/api/pipeline-profiles?name=${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`/api/pipeline-profiles DELETE → ${r.status}`)
  return r.json()
}

export async function writePipelineConfig(scope, pipeline, taskId) {
  const r = await fetch('/api/pipeline-config-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, pipeline, taskId }),
  })
  if (!r.ok) throw new Error(`/api/pipeline-config-write → ${r.status}`)
  return r.json()
}

// Fallback pipeline shape used only when a task has no resolved config (e.g.
// fetch error). Normally phases come from the per-task pipeline config embedded
// in /api/tasks (see phasesFromPipeline). Order = left→right flow; `hitl` is the
// gate that follows the phase.
export const PHASES = [
  { key: 'investigator', label: 'Investigate', artifact: 'investigate.md', hitl: 'hitl-1' },
  { key: 'designer', label: 'Design', artifact: 'design.md', hitl: 'hitl-2' },
  { key: 'implementer', label: 'Implement', artifact: 'phpstan.md', hitl: null },
  { key: 'reviewer', label: 'Review', artifact: 'review.md', hitl: 'hitl-3' },
  { key: 'pr-creator', label: 'PR', artifact: 'pr-desc.md', hitl: null },
]

// Map a resolved pipeline config (steps[]) onto the UI phase shape. `artifact`
// is the first produced file (used to infer "done"); `hitl` is the gate id that
// follows the step, if any.
export function phasesFromPipeline(pipeline) {
  const steps = pipeline?.steps
  if (!Array.isArray(steps) || !steps.length) return PHASES
  return steps.map((s) => ({
    key: s.id,
    label: s.name || s.id,
    artifact: (s.produces && s.produces[0]) || null,
    hitl: s.hitl?.gate_id ?? null,
  }))
}

// Derive a display status for a phase from artifacts + live state. The
// orchestrator's own rule is "status is inferred from artifact existence, not
// encoded" — we mirror that here, then layer the live cursor on top.
export function phaseStatus(phase, task) {
  const artifactDone = task.artifacts?.[phase.artifact]?.exists
  const isWaiting = phase.hitl && task.hitl_pending === phase.hitl
  const isActive = task.current_phase === phase.key && !task.hitl_pending
  if (isWaiting) return 'waiting'
  if (isActive) return 'active'
  if (artifactDone) return 'done'
  return 'pending'
}
