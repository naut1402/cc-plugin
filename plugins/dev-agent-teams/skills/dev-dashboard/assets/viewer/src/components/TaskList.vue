<script setup>
defineProps({
  tasks: { type: Array, required: true },
  selectedId: { type: String, default: null },
})
defineEmits(['select'])

function phaseLabel(t) {
  if (t.has_qa) return 'chờ Q&A'
  if (t.hitl_pending) return t.hitl_pending
  if (t.current_phase) return t.current_phase
  return '—'
}
</script>

<template>
  <ul class="tasklist">
    <li
      v-for="t in tasks"
      :key="t.task_id"
      :class="{ active: t.task_id === selectedId, attention: t.has_qa }"
      @click="$emit('select', t.task_id)"
    >
      <span class="id">{{ t.task_id }}</span>
      <span class="phase">{{ phaseLabel(t) }}</span>
      <span v-if="t.has_qa" class="flag qa" title="có câu hỏi blocking">Q</span>
      <span v-else-if="t.hitl_pending" class="flag hitl" title="đang chờ duyệt">⏸</span>
    </li>
  </ul>
</template>
