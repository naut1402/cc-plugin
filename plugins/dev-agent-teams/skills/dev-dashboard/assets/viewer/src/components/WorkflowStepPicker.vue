<script setup>
import { ref, onMounted } from 'vue'
import { fetchPipelineConfig } from '../api.js'

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:modelValue'])

const steps = ref([])

onMounted(async () => {
  try {
    const data = await fetchPipelineConfig(null)
    steps.value = (data.pipeline?.steps || []).map((s) => ({
      id: s.id,
      name: s.name || s.id,
    }))
  } catch {
    steps.value = []
  }
})

function toggle(id) {
  const set = new Set(props.modelValue)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  emit('update:modelValue', [...set])
}
</script>

<template>
  <div class="workflow-step-picker">
    <label class="cfg-label">Workflow steps</label>
    <div class="workflow-steps">
      <label v-for="s in steps" :key="s.id" class="workflow-step-item">
        <input
          type="checkbox"
          :checked="modelValue.includes(s.id)"
          @change="toggle(s.id)"
        />
        <span>{{ s.name }}</span>
      </label>
      <p v-if="!steps.length" class="muted">Không tải được pipeline steps.</p>
    </div>
  </div>
</template>
