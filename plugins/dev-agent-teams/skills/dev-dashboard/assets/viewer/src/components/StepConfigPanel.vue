<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  stepId: { type: String, default: null },
  step: { type: Object, default: null },  // current step data
  catalog: { type: Object, required: true },
})

const emit = defineEmits(['update', 'close'])

// Local draft — reset when step changes.
const draft = ref(null)

watch(
  () => props.step,
  (s) => {
    if (!s) { draft.value = null; return }
    draft.value = {
      name: s.label || '',
      agent: s.agent || '',
      skills: [...(s.skills || [])],
      rule_category: s.rule_category || '',
      rule_required: s.rule_required ?? true,
      produces: [...(s.produces || [])],
      hitl_mode: s.hitl?.mode || 'none',
      hitl_gate_id: s.hitl?.gate_id || '',
      hitl_optional_doc_review: s.hitl?.optional_doc_review ?? false,
      hitl_blocking: s.hitl?.blocking ?? false,
    }
  },
  { immediate: true },
)

// Tag inputs (produces, skills)
const producesInput = ref('')
const skillsInput = ref('')

function addProduces() {
  const v = producesInput.value.trim()
  if (v && draft.value && !draft.value.produces.includes(v)) {
    draft.value.produces.push(v)
  }
  producesInput.value = ''
}

function removeProduces(i) {
  draft.value.produces.splice(i, 1)
}

function addSkill() {
  const v = skillsInput.value.trim()
  if (v && draft.value && !draft.value.skills.includes(v)) {
    draft.value.skills.push(v)
  }
  skillsInput.value = ''
}

function removeSkill(i) {
  draft.value.skills.splice(i, 1)
}

function apply() {
  if (!draft.value) return
  const hitl = draft.value.hitl_mode === 'none'
    ? { mode: 'none' }
    : {
        mode: draft.value.hitl_mode,
        gate_id: draft.value.hitl_gate_id || `hitl-${props.stepId}`,
        optional_doc_review: draft.value.hitl_optional_doc_review,
        blocking: draft.value.hitl_blocking,
      }
  emit('update', props.stepId, {
    label: draft.value.name,
    agent: draft.value.agent,
    skills: draft.value.skills,
    rule_category: draft.value.rule_category,
    rule_required: draft.value.rule_required,
    produces: draft.value.produces,
    hitl,
  })
}
</script>

<template>
  <aside class="step-config-panel" v-if="draft">
    <div class="step-config-head">
      <span>Configure step</span>
      <button class="modal-close" @click="emit('close')">✕</button>
    </div>

    <div class="step-config-body">
      <!-- Name -->
      <label class="cfg-label">
        Name
        <input v-model="draft.name" class="cfg-input" placeholder="Step name" />
      </label>

      <!-- Agent -->
      <label class="cfg-label">
        Agent
        <input
          v-model="draft.agent"
          class="cfg-input"
          list="catalog-agents-list"
          placeholder="plugin:agent-name"
        />
        <datalist id="catalog-agents-list">
          <option v-for="a in (catalog.agents || [])" :key="a.id" :value="a.id">{{ a.name }}</option>
        </datalist>
      </label>

      <!-- Skills -->
      <label class="cfg-label">
        Skills
        <div class="tag-row">
          <span v-for="(sk, i) in draft.skills" :key="sk" class="chip chip-skill chip-rm" @click="removeSkill(i)">
            {{ sk }} ✕
          </span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="skillsInput"
            class="cfg-input cfg-input-sm"
            list="catalog-skills-list"
            placeholder="Add skill…"
            @keydown.enter.prevent="addSkill"
          />
          <datalist id="catalog-skills-list">
            <option v-for="s in (catalog.skills || [])" :key="s.id" :value="s.name">{{ s.name }}</option>
          </datalist>
          <button class="btn-ghost btn-sm" @click="addSkill">+</button>
        </div>
      </label>

      <!-- Rule category -->
      <label class="cfg-label">
        Rule category
        <input v-model="draft.rule_category" class="cfg-input" placeholder="e.g. doc-writing" />
      </label>

      <!-- Rule required -->
      <label class="cfg-label cfg-label-row">
        <input type="checkbox" v-model="draft.rule_required" />
        Rule required (block pipeline if missing)
      </label>

      <!-- Produces -->
      <label class="cfg-label">
        Produces (artifacts)
        <div class="tag-row">
          <span v-for="(f, i) in draft.produces" :key="f" class="chip chip-rm" @click="removeProduces(i)">
            {{ f }} ✕
          </span>
        </div>
        <div class="tag-input-row">
          <input
            v-model="producesInput"
            class="cfg-input cfg-input-sm"
            placeholder="e.g. investigate.md"
            @keydown.enter.prevent="addProduces"
          />
          <button class="btn-ghost btn-sm" @click="addProduces">+</button>
        </div>
      </label>

      <!-- HITL mode -->
      <label class="cfg-label">
        HITL gate
        <select v-model="draft.hitl_mode" class="cfg-input">
          <option value="none">None</option>
          <option value="auto">Auto</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      <template v-if="draft.hitl_mode !== 'none'">
        <label class="cfg-label">
          Gate ID
          <input v-model="draft.hitl_gate_id" class="cfg-input" placeholder="hitl-1" />
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_optional_doc_review" />
          Optional doc review at this gate
        </label>
        <label class="cfg-label cfg-label-row">
          <input type="checkbox" v-model="draft.hitl_blocking" />
          Blocking (requires human even with --auto-review)
        </label>
      </template>
    </div>

    <div class="step-config-footer">
      <button class="btn-ghost" @click="emit('close')">Cancel</button>
      <button class="btn-primary" @click="apply">Apply</button>
    </div>
  </aside>

  <aside class="step-config-panel step-config-empty" v-else>
    <p>Click ✎ on a node to configure it.</p>
  </aside>
</template>
