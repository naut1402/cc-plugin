<script setup>
import { computed } from 'vue'
import { SECTION_TITLES } from '../lib/agentMarkdown.js'
import { useSortable } from '../lib/useSortable.js'

const props = defineProps({
  draft: { type: Object, required: true },
  catalog: { type: Object, default: () => ({ skills: [] }) },
})

const emit = defineEmits(['update:draft'])

const order = computed({
  get: () => props.draft.section_order || [],
  set: (v) => emit('update:draft', { ...props.draft, section_order: v }),
})

const { onDragStart, onDragOver, onDragEnd } = useSortable(order, (items) => {
  emit('update:draft', { ...props.draft, section_order: items })
})

function sectionLabel(key) {
  return SECTION_TITLES[key] || key
}

function updateSection(key, value) {
  emit('update:draft', {
    ...props.draft,
    sections: { ...props.draft.sections, [key]: value },
  })
}

function updateField(field, value) {
  emit('update:draft', { ...props.draft, [field]: value })
}

function addParameter() {
  const parameters = [...(props.draft.parameters || []), { name: '', description: '' }]
  updateField('parameters', parameters)
}

function removeParameter(i) {
  const parameters = [...(props.draft.parameters || [])]
  parameters.splice(i, 1)
  updateField('parameters', parameters)
}

function updateParameter(i, field, value) {
  const parameters = [...(props.draft.parameters || [])]
  parameters[i] = { ...parameters[i], [field]: value }
  updateField('parameters', parameters)
}

function toggleSkill(skillName) {
  const skills = new Set(props.draft.skills || [])
  if (skills.has(skillName)) skills.delete(skillName)
  else skills.add(skillName)
  updateField('skills', [...skills])
}
</script>

<template>
  <div class="agent-section-editor">
    <label class="cfg-label">
      Skills (frontmatter)
      <div class="skill-chips">
        <button
          v-for="sk in (catalog.skills || []).slice(0, 40)"
          :key="sk.id"
          type="button"
          class="chip chip-skill"
          :class="{ active: (draft.skills || []).includes(sk.name) }"
          @click="toggleSkill(sk.name)"
        >
          {{ sk.name }}
        </button>
      </div>
    </label>

    <div class="parameters-block">
      <div class="parameters-head">
        <span class="cfg-label">Parameters</span>
        <button type="button" class="btn-ghost btn-sm" @click="addParameter">+ param</button>
      </div>
      <div v-for="(p, i) in draft.parameters || []" :key="i" class="param-row">
        <input v-model="p.name" class="cfg-input cfg-input-sm" placeholder="name" @input="updateParameter(i, 'name', p.name)" />
        <input v-model="p.description" class="cfg-input" placeholder="description" @input="updateParameter(i, 'description', p.description)" />
        <button type="button" class="btn-ghost btn-sm" @click="removeParameter(i)">✕</button>
      </div>
    </div>

    <div class="section-list">
      <div
        v-for="(key, index) in draft.section_order"
        :key="key"
        class="section-block"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover="onDragOver($event, index)"
        @dragend="onDragEnd"
      >
        <div class="section-head">
          <span class="drag-handle">⋮⋮</span>
          <span>{{ sectionLabel(key) }}</span>
        </div>
        <textarea
          class="cfg-textarea"
          :value="draft.sections?.[key] || ''"
          rows="4"
          @input="updateSection(key, $event.target.value)"
        />
      </div>
    </div>
  </div>
</template>
