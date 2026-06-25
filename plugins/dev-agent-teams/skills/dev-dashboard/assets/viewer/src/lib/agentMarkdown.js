/**
 * Parse / compile custom agent markdown ↔ AgentDraft JSON.
 */

const DEFAULT_SECTION_ORDER = ['role', 'skills', 'workflow', 'guardrail', 'output']

const SECTION_TITLES = {
  role: 'Vai trò',
  skills: 'Skills',
  workflow: 'Workflow',
  guardrail: 'Guardrail',
  output: 'Report output',
}

export function emptyDraft(overrides = {}) {
  return {
    name: '',
    description: '',
    model: 'claude-sonnet-4-6',
    skills: [],
    parameters: [],
    sections: {
      role: '',
      skills: '',
      workflow: '',
      guardrail: '',
      output: '',
    },
    section_order: [...DEFAULT_SECTION_ORDER],
    workflow_steps: [],
    ...overrides,
  }
}

/** Parse agent markdown (pass js-yaml `yaml` on server). */
export function parseAgentMarkdown(raw, yaml) {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return emptyDraft({ sections: { role: raw } })
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return emptyDraft()
  const fmText = lines.slice(1, end).join('\n')
  const body = lines.slice(end + 1).join('\n').trim()
  let fm = {}
  if (yaml) {
    try {
      fm = yaml.load(fmText) || {}
    } catch {
      fm = {}
    }
  }

  const draft = emptyDraft({
    name: fm.name || '',
    description: fm.description || '',
    model: fm.model || 'claude-sonnet-4-6',
    skills: Array.isArray(fm.skills) ? fm.skills : [],
    parameters: Array.isArray(fm.parameters) ? fm.parameters : [],
    section_order: Array.isArray(fm.section_order) ? fm.section_order : [...DEFAULT_SECTION_ORDER],
    workflow_steps: Array.isArray(fm.workflow_steps) ? fm.workflow_steps : [],
  })

  const sections = { ...draft.sections }
  if (!body) return { ...draft, sections, editable: fm.editable !== false, created_by: fm.created_by }

  const parts = body.split(/^## /m).filter(Boolean)
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const heading = (nl >= 0 ? part.slice(0, nl) : part).trim()
    const content = (nl >= 0 ? part.slice(nl + 1) : '').trim()
    const key = Object.entries(SECTION_TITLES).find(([, t]) => t === heading)?.[0]
      || Object.keys(SECTION_TITLES).find((k) => heading.toLowerCase().includes(k))
    if (key) sections[key] = content
    else if (!sections.role) sections.role = `## ${heading}\n\n${content}`
    else sections.role += `\n\n## ${heading}\n\n${content}`
  }

  return {
    ...draft,
    sections,
    editable: fm.editable !== false,
    created_by: fm.created_by,
  }
}

export function compileAgentMarkdown(draft, yaml) {
  const fm = {
    name: draft.name,
    description: draft.description || '',
    model: draft.model || 'claude-sonnet-4-6',
    skills: draft.skills || [],
    created_by: 'dashboard',
    editable: true,
    section_order: draft.section_order || [...DEFAULT_SECTION_ORDER],
    workflow_steps: draft.workflow_steps || [],
  }
  if (draft.parameters?.length) fm.parameters = draft.parameters

  const order = fm.section_order.filter((k) => SECTION_TITLES[k])
  const bodyParts = order.map((key) => {
    const text = (draft.sections?.[key] || '').trim()
    if (!text) return ''
    return `## ${SECTION_TITLES[key]}\n\n${text}`
  }).filter(Boolean)

  const fmYaml = yaml.dump(fm, { lineWidth: 120 }).trim()
  return `---\n${fmYaml}\n---\n\n${bodyParts.join('\n\n')}\n`
}

export function draftFromCatalogAgent(agent) {
  const skills = agent.skills || []
  return emptyDraft({
    name: `${agent.name}-copy`,
    description: agent.description || '',
    skills: [...skills],
    sections: {
      role: `Agent dựa trên **${agent.name}** (${agent.source || agent.plugin}).\n\nMô tả gốc: ${agent.description || '—'}`,
      skills: skills.length ? skills.map((s) => `- ${s}`).join('\n') : '',
    },
  })
}

export function heuristicDraftFromDescription(description) {
  const lower = (description || '').toLowerCase()
  const draft = emptyDraft({
    name: 'custom-agent',
    description: description.slice(0, 200),
  })
  draft.sections.role = description
  if (/review|đánh giá/.test(lower)) {
    draft.skills = ['coding-rules']
    draft.sections.workflow = '1. Đọc diff\n2. Ghi review.md'
  } else if (/investigat|điều tra|survey/.test(lower)) {
    draft.skills = ['survey-codebase']
    draft.sections.workflow = '1. Survey codebase\n2. Ghi investigate.md'
  } else if (/design|thiết kế/.test(lower)) {
    draft.skills = ['write-design']
    draft.sections.workflow = '1. Đọc investigate.md\n2. Viết design.md'
  }
  draft.sections.guardrail = '- Không đoán mò — cần code evidence\n- Dừng nếu blocking question'
  draft.sections.output = '- Artifact markdown trong `.dev-team-agent/tasks/<id>/`'
  return draft
}

export { DEFAULT_SECTION_ORDER, SECTION_TITLES }
