<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { fetchTasks } from './api.js'
import TaskList from './components/TaskList.vue'
import PipelineView from './components/PipelineView.vue'
import QaPanel from './components/QaPanel.vue'
import ArtifactPanel from './components/ArtifactPanel.vue'

const POLL_MS = 1500

const root = ref('')
const tasks = ref([])
const selectedId = ref(null)
const error = ref(null)
const lastUpdated = ref(null)
const connected = ref(false)
let timer = null

const selected = computed(
  () => tasks.value.find((t) => t.task_id === selectedId.value) || null,
)

async function poll() {
  try {
    const data = await fetchTasks()
    root.value = data.root
    tasks.value = data.tasks
    connected.value = true
    error.value = null
    lastUpdated.value = new Date().toLocaleTimeString()
    // Auto-select the first task that needs attention, else the first task.
    if (!selectedId.value && tasks.value.length) {
      const needsAttention = tasks.value.find((t) => t.has_qa || t.hitl_pending)
      selectedId.value = (needsAttention || tasks.value[0]).task_id
    }
  } catch (e) {
    connected.value = false
    error.value = String(e.message || e)
  }
}

onMounted(() => {
  poll()
  timer = setInterval(poll, POLL_MS)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <header class="brand">
        <h1>Dev Team</h1>
        <span class="dot" :class="{ live: connected }" :title="connected ? 'live' : 'disconnected'"></span>
      </header>
      <p class="root" :title="root">{{ root || '…' }}</p>
      <TaskList :tasks="tasks" :selected-id="selectedId" @select="selectedId = $event" />
      <footer class="status">
        <span v-if="error" class="err">⚠ {{ error }}</span>
        <span v-else-if="lastUpdated">cập nhật {{ lastUpdated }}</span>
      </footer>
    </aside>

    <main class="main">
      <template v-if="selected">
        <div class="task-head">
          <h2>
            {{ selected.task_id }}
            <span v-if="selected.parent_task_id" class="subtask">↳ subtask của {{ selected.parent_task_id }}</span>
          </h2>
          <div class="badges">
            <span v-if="selected.auto_review" class="badge auto">auto-review</span>
            <span v-if="selected.review_round" class="badge">review round {{ selected.review_round }}/2</span>
            <span v-if="selected.hitl_pending" class="badge hitl">⏸ {{ selected.hitl_pending }}</span>
            <span v-if="!selected.state_ok" class="badge err">state lỗi</span>
          </div>
        </div>

        <QaPanel v-if="selected.has_qa" :qa="selected.qa" />

        <PipelineView :task="selected" />

        <ArtifactPanel :task="selected" />
      </template>
      <div v-else class="empty">
        <p v-if="!tasks.length && connected">
          Chưa có task nào trong <code>.dev-team-agent/.dev-state/</code>.<br />
          Chạy <code>/dev-team-orchestrator &lt;task-id&gt;</code> để bắt đầu.
        </p>
        <p v-else-if="!connected">Đang kết nối tới dev server…</p>
        <p v-else>Chọn một task ở bên trái.</p>
      </div>
    </main>
  </div>
</template>
