<script setup>
import { computed } from 'vue'
import { PHASES, phaseStatus } from '../api.js'

const props = defineProps({
  task: { type: Object, required: true },
})

const steps = computed(() =>
  PHASES.map((p) => ({
    ...p,
    status: phaseStatus(p, props.task),
    hitlWaiting: p.hitl && props.task.hitl_pending === p.hitl,
  })),
)

const STATUS_ICON = { done: '✓', active: '▶', waiting: '⏸', pending: '○' }
</script>

<template>
  <section class="pipeline">
    <template v-for="(s, i) in steps" :key="s.key">
      <div class="step" :class="s.status" :title="s.key">
        <div class="bubble">{{ STATUS_ICON[s.status] }}</div>
        <div class="label">{{ s.label }}</div>
        <div class="sub">{{ s.status }}</div>
      </div>
      <div v-if="i < steps.length - 1" class="connector">
        <span v-if="s.hitl" class="gate" :class="{ waiting: s.hitlWaiting }">{{ s.hitl }}</span>
      </div>
    </template>
  </section>

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
</template>
