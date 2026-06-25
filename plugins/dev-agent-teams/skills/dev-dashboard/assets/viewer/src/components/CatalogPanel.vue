<script setup>
import { ref, computed } from 'vue'
import { useSearch } from '../lib/useSearch.js'

const props = defineProps({
  catalog: { type: Object, required: true }, // { skills: [], agents: [] }
})

const activeTab = ref('agents') // 'agents' | 'skills'

const agentItems = computed(() => props.catalog.agents || [])
const skillItems = computed(() => props.catalog.skills || [])

const { query: agentQuery, setQuery: setAgentQuery, filteredItems: filteredAgents } =
  useSearch(agentItems, (a) => `${a.name} ${a.description} ${a.plugin}`)

const { query: skillQuery, setQuery: setSkillQuery, filteredItems: filteredSkills } =
  useSearch(skillItems, (s) => `${s.name} ${s.description} ${s.plugin}`)

function onDragStart(event, item, type) {
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData('application/json', JSON.stringify({ ...item, _type: type }))
}
</script>

<template>
  <aside class="catalog-panel">
    <div class="catalog-tabs">
      <button
        class="catalog-tab"
        :class="{ active: activeTab === 'agents' }"
        @click="activeTab = 'agents'"
      >
        Agents ({{ agentItems.length }})
      </button>
      <button
        class="catalog-tab"
        :class="{ active: activeTab === 'skills' }"
        @click="activeTab = 'skills'"
      >
        Skills ({{ skillItems.length }})
      </button>
    </div>

    <!-- Agents tab -->
    <template v-if="activeTab === 'agents'">
      <input
        class="catalog-search"
        :value="agentQuery"
        placeholder="Search agents…"
        @input="setAgentQuery($event.target.value)"
      />
      <div class="catalog-list">
        <div
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="catalog-item"
          draggable="true"
          @dragstart="onDragStart($event, agent, 'agent')"
          :title="agent.description"
        >
          <div class="catalog-item-name">{{ agent.name }}</div>
          <div class="catalog-item-meta">{{ agent.plugin }}</div>
          <div v-if="agent.skills?.length" class="catalog-item-skills">
            <span v-for="sk in agent.skills" :key="sk" class="chip chip-xs">{{ sk }}</span>
          </div>
        </div>
        <div v-if="!filteredAgents.length" class="catalog-empty">No agents found</div>
      </div>
    </template>

    <!-- Skills tab -->
    <template v-else>
      <input
        class="catalog-search"
        :value="skillQuery"
        placeholder="Search skills…"
        @input="setSkillQuery($event.target.value)"
      />
      <div class="catalog-list">
        <div
          v-for="skill in filteredSkills"
          :key="skill.id"
          class="catalog-item"
          draggable="true"
          @dragstart="onDragStart($event, skill, 'skill')"
          :title="skill.description"
        >
          <div class="catalog-item-name">{{ skill.name }}</div>
          <div class="catalog-item-meta">{{ skill.plugin }}</div>
          <div v-if="skill.description" class="catalog-item-desc">{{ skill.description }}</div>
        </div>
        <div v-if="!filteredSkills.length" class="catalog-empty">No skills found</div>
      </div>
    </template>
  </aside>
</template>
