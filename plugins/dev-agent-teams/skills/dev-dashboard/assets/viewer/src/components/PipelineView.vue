<script setup>
import { ref, computed, watch, markRaw } from 'vue'
import { VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { PHASES, phaseStatus, fetchFlowProfile, saveFlowProfile } from '../api.js'
import PipelineNode from './PipelineNode.vue'

const props = defineProps({
  task: { type: Object, required: true },
})

const nodeTypes = { pipeline: markRaw(PipelineNode) }

// Custom flow profile for this task (null = use default PHASES).
const customProfile = ref(null)

async function loadProfile() {
  try {
    const res = await fetchFlowProfile(props.task.task_id)
    customProfile.value = res.exists ? res.profile : null
  } catch {
    customProfile.value = null
  }
}

watch(() => props.task.task_id, () => {
  customProfile.value = null
  loadProfile()
}, { immediate: true })

// Resolve phases: custom profile overrides default.
const phases = computed(() => {
  if (customProfile.value?.phases?.length) return customProfile.value.phases
  return PHASES
})

const NODE_SPACING = 200
const NODE_Y = 40

const nodes = computed(() =>
  phases.value.map((p, i) => {
    const isActivePhase = props.task.current_phase === p.key
    return {
      id: p.key,
      type: 'pipeline',
      position: { x: p.x ?? i * NODE_SPACING, y: p.y ?? NODE_Y },
      data: {
        label: p.label,
        status: phaseStatus(p, props.task),
        // Q&A badge only on the phase that's currently active (the one that created qa.md)
        qa_count: isActivePhase ? (props.task.qa_count ?? 0) : 0,
      },
    }
  }),
)

const edges = computed(() =>
  phases.value.slice(0, -1).map((p, i) => {
    const next = phases.value[i + 1]
    const isWaiting = p.hitl && props.task.hitl_pending === p.hitl
    return {
      id: `e-${p.key}-${next.key}`,
      source: p.key,
      target: next.key,
      animated: phaseStatus(p, props.task) === 'active',
      label: p.hitl || '',
      labelStyle: { fill: isWaiting ? 'var(--waiting)' : 'var(--muted)', fontWeight: isWaiting ? 700 : 400 },
      style: { stroke: isWaiting ? 'var(--waiting)' : 'var(--border)', strokeWidth: 2 },
      markerEnd: { type: 'arrowclosed', color: isWaiting ? 'var(--waiting)' : 'var(--border)' },
    }
  }),
)

// Persist node positions when user drags them.
function onNodeDragStop({ node }) {
  const base = customProfile.value ?? {
    phases: PHASES.map((p, i) => ({ ...p, x: i * NODE_SPACING, y: NODE_Y })),
  }
  const updated = {
    ...base,
    phases: base.phases.map((p) =>
      p.key === node.id ? { ...p, x: Math.round(node.position.x), y: Math.round(node.position.y) } : p,
    ),
  }
  saveFlowProfile(props.task.task_id, updated).then(() => {
    customProfile.value = updated
  })
}

// Profile editor modal.
const editorOpen = ref(false)
const editorJson = ref('')
const editorError = ref('')
const saving = ref(false)

function openEditor() {
  const profile = customProfile.value ?? {
    phases: PHASES.map((p, i) => ({ ...p, x: i * NODE_SPACING, y: NODE_Y })),
  }
  editorJson.value = JSON.stringify(profile, null, 2)
  editorError.value = ''
  editorOpen.value = true
}

async function saveProfile() {
  editorError.value = ''
  let parsed
  try {
    parsed = JSON.parse(editorJson.value)
  } catch (e) {
    editorError.value = `JSON không hợp lệ: ${e.message}`
    return
  }
  saving.value = true
  try {
    await saveFlowProfile(props.task.task_id, parsed)
    customProfile.value = parsed
    editorOpen.value = false
  } catch (e) {
    editorError.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}

async function resetProfile() {
  saving.value = true
  try {
    const defaultProfile = { phases: PHASES.map((p, i) => ({ ...p, x: i * NODE_SPACING, y: NODE_Y })) }
    await saveFlowProfile(props.task.task_id, defaultProfile)
    customProfile.value = null
    editorOpen.value = false
  } catch (e) {
    editorError.value = String(e.message || e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="pipeline-wrap">
    <div class="pipeline-toolbar">
      <span v-if="customProfile" class="chip chip-custom">flow profile tùy chỉnh</span>
      <button class="btn-edit-profile" @click="openEditor">⚙ flow profile</button>
    </div>

    <div class="vflow-container">
      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        fit-view-on-init
        :zoom-on-scroll="false"
        :pan-on-drag="true"
        :nodes-draggable="true"
        :elements-selectable="false"
        @node-drag-stop="onNodeDragStop"
        class="vflow"
      />
    </div>

    <section class="meta-row">
      <span class="chip">doc-review investigate: {{ task.doc_review_round?.investigate ?? 0 }}</span>
      <span class="chip">doc-review design: {{ task.doc_review_round?.design ?? 0 }}</span>
      <span v-if="task.inherit_from_parent?.length" class="chip">
        kế thừa: {{ task.inherit_from_parent.join(', ') }}
      </span>
      <span v-if="task.subtasks?.length" class="chip">
        subtask: {{ task.subtasks.join(', ') }}
      </span>
    </section>
  </section>

  <!-- Flow profile editor modal -->
  <Teleport to="body">
    <div v-if="editorOpen" class="modal-backdrop" @click.self="editorOpen = false">
      <div class="modal">
        <div class="modal-head">
          <span>Flow Profile — {{ task.task_id }}</span>
          <button class="modal-close" @click="editorOpen = false">✕</button>
        </div>
        <p class="modal-hint">
          Định nghĩa các phase và vị trí node. Kéo node trên canvas để cập nhật <code>x</code>/<code>y</code> tự động.
        </p>
        <textarea class="profile-editor" v-model="editorJson" spellcheck="false" />
        <p v-if="editorError" class="editor-error">{{ editorError }}</p>
        <div class="modal-actions">
          <button class="btn-ghost" @click="resetProfile" :disabled="saving">Reset về mặc định</button>
          <button class="btn-primary" @click="saveProfile" :disabled="saving">
            {{ saving ? 'Đang lưu…' : 'Lưu profile' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
