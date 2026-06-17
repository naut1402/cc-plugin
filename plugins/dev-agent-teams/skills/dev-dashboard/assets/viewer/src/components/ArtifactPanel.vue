<script setup>
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import { fetchArtifact } from '../api.js'

const props = defineProps({
  task: { type: Object, required: true },
})

const openName = ref(null)
const content = ref('')
const loadedMtime = ref(null)

// Stable display order: known pipeline docs first, then anything else.
const ORDER = [
  'investigate.md',
  'investigate-po.md',
  'design.md',
  'design-po.md',
  'phpstan.md',
  'review.md',
  'test-spec.md',
  'pr-desc.md',
  'project-rules.md',
  'qa.md',
]

const items = computed(() => {
  const a = props.task.artifacts || {}
  const names = Object.keys(a)
  names.sort((x, y) => {
    const ix = ORDER.indexOf(x)
    const iy = ORDER.indexOf(y)
    return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy) || x.localeCompare(y)
  })
  return names.map((name) => ({ name, ...a[name] }))
})

const html = computed(() => marked.parse(content.value || ''))

async function open(name) {
  openName.value = name
  const res = await fetchArtifact(props.task.task_id, name)
  content.value = res.content
  loadedMtime.value = res.mtime
}

function fmtTime(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString()
}

// Realtime: if the currently-open artifact changed on disk, reload it.
watch(
  () => props.task.artifacts?.[openName.value]?.mtime,
  (mtime) => {
    if (openName.value && mtime && mtime !== loadedMtime.value) open(openName.value)
  },
)
// If the selected task changes, reset the viewer.
watch(
  () => props.task.task_id,
  () => {
    openName.value = null
    content.value = ''
    loadedMtime.value = null
  },
)
</script>

<template>
  <section class="artifacts">
    <div class="art-list">
      <button
        v-for="it in items"
        :key="it.name"
        class="art"
        :class="{ missing: !it.exists, active: it.name === openName }"
        :disabled="!it.exists"
        @click="open(it.name)"
      >
        <span class="tick">{{ it.exists ? '●' : '○' }}</span>
        <span class="name">{{ it.name }}</span>
        <span class="time">{{ fmtTime(it.mtime) }}</span>
      </button>
    </div>

    <div class="art-view">
      <div v-if="!openName" class="art-empty">Chọn một tài liệu để xem.</div>
      <div v-else class="md" v-html="html"></div>
    </div>
  </section>
</template>
