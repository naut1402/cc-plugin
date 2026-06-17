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

// Pipeline definition shared by the UI. Order matters — it's the left→right
// flow. `hitl` is the gate that follows the phase (if any).
export const PHASES = [
  { key: 'investigator', label: 'Investigate', artifact: 'investigate.md', hitl: 'hitl-1' },
  { key: 'designer', label: 'Design', artifact: 'design.md', hitl: 'hitl-2' },
  { key: 'implementer', label: 'Implement', artifact: 'phpstan.md', hitl: null },
  { key: 'reviewer', label: 'Review', artifact: 'review.md', hitl: 'hitl-3' },
  { key: 'pr-creator', label: 'PR', artifact: 'pr-desc.md', hitl: null },
]

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
