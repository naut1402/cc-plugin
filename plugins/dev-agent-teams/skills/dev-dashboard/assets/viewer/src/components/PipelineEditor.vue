<script setup>
import { ref, computed, markRaw, onMounted } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import { fetchCatalog, fetchPipelineConfig, writePipelineConfig } from '../api.js'
import { useLocalToggle } from '../lib/useLocalToggle.js'
import PipelineEditorNode from './PipelineEditorNode.vue'
import CatalogPanel from './CatalogPanel.vue'
import StepConfigPanel from './StepConfigPanel.vue'
import ProfileManager from './ProfileManager.vue'

const props = defineProps({
  scope: { type: String, default: 'global' },  // 'global' | 'task'
  taskId: { type: String, default: '' },
})

// ── Vue Flow ──────────────────────────────────────────────────────────────────

const nodeTypes = { pipelineEditor: markRaw(PipelineEditorNode) }
const { addNodes, addEdges, removeNodes, removeEdges, getNodes, getEdges, onConnect, fitView } = useVueFlow()

const nodes = ref([])
const edges = ref([])

// ── Catalog ───────────────────────────────────────────────────────────────────

const catalog = ref({ skills: [], agents: [] })

async function loadCatalog() {
  try {
    catalog.value = await fetchCatalog()
  } catch {
    catalog.value = { skills: [], agents: [], error: true }
  }
}

// ── Pipeline config ───────────────────────────────────────────────────────────

async function loadConfig() {
  try {
    const data = await fetchPipelineConfig(props.scope === 'task' ? props.taskId : null)
    buildFlowFromPipeline(data.pipeline)
  } catch {
    // no-op — canvas stays empty
  }
}

function buildFlowFromPipeline(pipeline) {
  const steps = pipeline?.steps || []
  const newNodes = steps.map((step, i) => ({
    id: step.id,
    type: 'pipelineEditor',
    position: { x: 20 + i * 220, y: 60 },
    data: {
      label: step.name || step.id,
      agent: step.agent || '',
      skills: Array.isArray(step.skills) ? step.skills : [],
      rule_category: step.rule_category || '',
      rule_required: step.rule_required ?? true,
      produces: Array.isArray(step.produces) ? step.produces : [],
      hitl: step.hitl || { mode: 'none' },
    },
  }))

  const newEdges = steps.slice(0, -1).map((step, i) => ({
    id: `e-${step.id}-${steps[i + 1].id}`,
    source: step.id,
    target: steps[i + 1].id,
    markerEnd: { type: 'arrowclosed' },
  }))

  nodes.value = newNodes
  edges.value = newEdges
}

// Auto-connect when user draws an edge.
onConnect((params) => {
  addEdges([{ ...params, markerEnd: { type: 'arrowclosed' } }])
})

onMounted(async () => {
  await Promise.all([loadCatalog(), loadConfig()])
  setTimeout(() => fitView(), 100)
})

// ── Drop from catalog onto canvas ─────────────────────────────────────────────

const canvasRef = ref(null)
let nodeCounter = 0

function onDragOver(event) {
  event.preventDefault()
  event.dataTransfer.dropEffect = 'copy'
}

function onDropOnCanvas(event) {
  event.preventDefault()
  let item
  try {
    item = JSON.parse(event.dataTransfer.getData('application/json'))
  } catch {
    return
  }

  // Convert drop position to flow coordinates.
  const bounds = canvasRef.value?.getBoundingClientRect()
  const x = bounds ? event.clientX - bounds.left - 80 : 100
  const y = bounds ? event.clientY - bounds.top - 30 : 60

  const id = `step-${item.name}-${++nodeCounter}`
  const newNode = {
    id,
    type: 'pipelineEditor',
    position: { x, y },
    data: {
      label: item.name,
      agent: item._type === 'agent' ? item.id : '',
      skills: item._type === 'agent' ? (item.skills || []) : [item.name],
      rule_category: '',
      rule_required: true,
      produces: [],
      hitl: { mode: 'none' },
    },
  }
  addNodes([newNode])
}

// ── Step config panel ─────────────────────────────────────────────────────────

const selectedNodeId = ref(null)
const selectedNodeData = ref(null)

function openConfig(nodeId, data) {
  selectedNodeId.value = nodeId
  selectedNodeData.value = { ...data }
}

function closeConfig() {
  selectedNodeId.value = null
  selectedNodeData.value = null
}

function applyStepUpdate(nodeId, updatedData) {
  nodes.value = nodes.value.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...updatedData } } : n,
  )
  closeConfig()
}

function deleteNode(nodeId) {
  removeNodes([nodeId])
  if (selectedNodeId.value === nodeId) closeConfig()
}

// Handle events emitted by PipelineEditorNode via node data callbacks.
// Vue Flow passes node events through data; we use a wrapper approach.
function onNodeEvent(event) {
  if (event.type === 'edit') openConfig(event.nodeId, event.data)
  if (event.type === 'delete') deleteNode(event.nodeId)
}

// ── Topological sort → pipeline steps ─────────────────────────────────────────

function topoSort(nodeList, edgeList) {
  const adj = {}
  const inDeg = {}
  for (const n of nodeList) { adj[n.id] = []; inDeg[n.id] = 0 }
  for (const e of edgeList) {
    adj[e.source].push(e.target)
    inDeg[e.target] = (inDeg[e.target] || 0) + 1
  }
  const queue = nodeList.filter((n) => inDeg[n.id] === 0).map((n) => n.id)
  const sorted = []
  while (queue.length) {
    const id = queue.shift()
    sorted.push(id)
    for (const next of adj[id]) {
      inDeg[next]--
      if (inDeg[next] === 0) queue.push(next)
    }
  }
  // Append any remaining (disconnected) nodes preserving x-order.
  const remaining = nodeList.filter((n) => !sorted.includes(n.id)).sort((a, b) => a.position.x - b.position.x)
  return [...sorted, ...remaining.map((n) => n.id)]
}

function buildPipelineFromFlow() {
  const nodeList = getNodes.value
  const edgeList = getEdges.value
  const order = topoSort(nodeList, edgeList)
  const nodeMap = Object.fromEntries(nodeList.map((n) => [n.id, n]))
  const steps = order.map((id) => {
    const n = nodeMap[id]
    if (!n) return null
    const d = n.data
    return {
      id,
      name: d.label || id,
      agent: d.agent || '',
      skills: d.skills || [],
      rule_category: d.rule_category || '',
      rule_required: d.rule_required ?? true,
      produces: d.produces || [],
      hitl: d.hitl || { mode: 'none' },
    }
  }).filter(Boolean)
  return { version: 1, steps }
}

// ── Auto-layout ───────────────────────────────────────────────────────────────

function autoLayout() {
  const nodeList = getNodes.value
  const edgeList = getEdges.value
  const order = topoSort(nodeList, edgeList)
  const nodeMap = Object.fromEntries(nodeList.map((n) => [n.id, n]))
  nodes.value = nodes.value.map((n) => {
    const idx = order.indexOf(n.id)
    return { ...n, position: { x: 20 + Math.max(0, idx) * 220, y: 60 } }
  })
  setTimeout(() => fitView(), 50)
}

// ── Save to file ──────────────────────────────────────────────────────────────

const saving = ref(false)
const saveMsg = ref('')

async function saveToFile() {
  saving.value = true
  saveMsg.value = ''
  try {
    const pipeline = buildPipelineFromFlow()
    await writePipelineConfig(props.scope, pipeline, props.taskId || undefined)
    saveMsg.value = '✓ Saved'
    setTimeout(() => { saveMsg.value = '' }, 2500)
  } catch (e) {
    saveMsg.value = `✗ ${e.message}`
  } finally {
    saving.value = false
  }
}

// ── Preview / demo mode ───────────────────────────────────────────────────────

const { state: previewing, setTrue: startPreview, setFalse: stopPreview } = useLocalToggle(false)
const previewNodeId = ref(null)
let previewTimer = null

async function runPreview() {
  if (previewing.value) return
  startPreview()
  const order = topoSort(getNodes.value, getEdges.value)
  previewNodeId.value = null

  for (const id of order) {
    if (!previewing.value) break
    previewNodeId.value = id
    await sleep(600)
    if (!previewing.value) break
    // Pause at HITL nodes.
    const node = getNodes.value.find((n) => n.id === id)
    const hitlMode = node?.data?.hitl?.mode
    if (hitlMode && hitlMode !== 'none') {
      await sleep(1200)
    }
  }
  previewNodeId.value = null
  stopPreview()
}

function stopDemo() {
  clearTimeout(previewTimer)
  stopPreview()
  previewNodeId.value = null
}

function sleep(ms) {
  return new Promise((res) => { previewTimer = setTimeout(res, ms) })
}

// ── Profile load ──────────────────────────────────────────────────────────────

function onProfileLoad(pipeline) {
  buildFlowFromPipeline(pipeline)
  setTimeout(() => fitView(), 100)
}

// ── Current pipeline (for ProfileManager save) ────────────────────────────────

const currentPipeline = computed(() => buildPipelineFromFlow())
</script>

<template>
  <div class="editor-root" :class="{ 'preview-active': previewing }">
    <!-- Toolbar -->
    <div class="editor-toolbar">
      <ProfileManager :current-pipeline="currentPipeline" @load="onProfileLoad" />

      <div class="editor-toolbar-actions">
        <button class="btn-ghost btn-sm" @click="autoLayout">Auto-layout</button>
        <button
          v-if="!previewing"
          class="btn-ghost btn-sm"
          @click="runPreview"
        >▶ Preview</button>
        <button
          v-else
          class="btn-danger btn-sm"
          @click="stopDemo"
        >■ Stop</button>
        <button
          class="btn-primary btn-sm"
          :disabled="saving"
          @click="saveToFile"
        >{{ saving ? 'Saving…' : 'Save to file' }}</button>
        <span v-if="saveMsg" class="save-msg">{{ saveMsg }}</span>
      </div>
    </div>

    <!-- 3-column layout -->
    <div class="editor-layout">
      <!-- Left: catalog -->
      <CatalogPanel :catalog="catalog" />

      <!-- Center: canvas -->
      <div
        class="vflow-container editor-canvas"
        ref="canvasRef"
        @dragover="onDragOver"
        @drop="onDropOnCanvas"
      >
        <VueFlow
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          fit-view-on-init
          :zoom-on-scroll="false"
          :pan-on-drag="true"
          :nodes-draggable="!previewing"
          :nodes-connectable="!previewing"
          :elements-selectable="true"
          class="vflow"
        >
          <template #node-pipelineEditor="nodeProps">
            <PipelineEditorNode
              v-bind="nodeProps"
              :class="{
                'node-preview-active': previewing && previewNodeId === nodeProps.id,
                'node-preview-done': previewing && previewNodeId !== null && topoSort(getNodes, getEdges).indexOf(nodeProps.id) < topoSort(getNodes, getEdges).indexOf(previewNodeId),
              }"
              @edit="openConfig"
              @delete="deleteNode"
            />
          </template>
        </VueFlow>

        <div v-if="previewing" class="preview-banner">
          Simulation — no files written &nbsp;
          <button class="btn-danger btn-xs" @click="stopDemo">Stop</button>
        </div>
      </div>

      <!-- Right: step config -->
      <StepConfigPanel
        :step-id="selectedNodeId"
        :step="selectedNodeData"
        :catalog="catalog"
        @update="applyStepUpdate"
        @close="closeConfig"
      />
    </div>
  </div>
</template>
