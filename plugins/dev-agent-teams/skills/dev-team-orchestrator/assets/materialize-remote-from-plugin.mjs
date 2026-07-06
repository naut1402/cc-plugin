#!/usr/bin/env node
/**
 * Workaround (#45): đọc plugin userConfig từ Claude/Cursor settings → ghi ~/.dev-team-dashboard/remote.json
 *
 * Usage:
 *   node materialize-remote-from-plugin.mjs [--write] [--dry-run]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dashboardHomeDir, globalRemoteConfigPath, readJsonFile } from './remote-config.mjs'

const PLUGIN_KEY_SUFFIX = 'dev-agent-teams@'

const FIELD_MAP = [
  ['dashboardServerUrl', 'serverUrl'],
  ['dashboardApiToken', 'apiToken'],
  ['dashboardProjectId', 'projectId'],
  ['dashboardProjectName', 'projectName'],
  ['dashboardApp', 'dashboardApp'],
  ['dashboardHome', 'dashboardHome'],
]

function parseArgs(argv) {
  return {
    write: argv.includes('--write'),
    dryRun: argv.includes('--dry-run'),
  }
}

function claudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function cursorSettingsCandidates() {
  const base = path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor', 'User')
  return [
    path.join(base, 'settings.json'),
    path.join(base, 'globalStorage', 'storage.json'),
  ]
}

function pickPluginOptions(pluginConfigs) {
  if (!pluginConfigs || typeof pluginConfigs !== 'object') return null
  for (const [key, value] of Object.entries(pluginConfigs)) {
    if (!key.includes('dev-agent-teams')) continue
    const options = value?.options
    if (options && typeof options === 'object') return { key, options }
  }
  return null
}

function mapOptions(options) {
  const out = { runnerMode: 'local' }
  for (const [from, to] of FIELD_MAP) {
    const v = options[from]
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      out[to] = typeof v === 'string' ? v.trim() : v
    }
  }
  return out
}

function readPluginOptionsFromFile(file) {
  const data = readJsonFile(file)
  if (!data) return null
  const fromPluginConfigs = pickPluginOptions(data.pluginConfigs)
  if (fromPluginConfigs) return { source: file, ...fromPluginConfigs }
  // Cursor có thể lồng khác — quét nông
  if (data['dev-agent-teams@tttuan-plugins-official']?.options) {
    return {
      source: file,
      key: 'dev-agent-teams@tttuan-plugins-official',
      options: data['dev-agent-teams@tttuan-plugins-official'].options,
    }
  }
  return null
}

function discoverPluginOptions() {
  const tried = []
  const claude = claudeSettingsPath()
  tried.push(claude)
  const fromClaude = readPluginOptionsFromFile(claude)
  if (fromClaude?.options?.dashboardServerUrl) return { ...fromClaude, tried }

  for (const file of cursorSettingsCandidates()) {
    tried.push(file)
    const hit = readPluginOptionsFromFile(file)
    if (hit?.options?.dashboardServerUrl) return { ...hit, tried }
  }

  return { options: null, tried, key: null, source: null }
}

function main() {
  const { write, dryRun } = parseArgs(process.argv.slice(2))
  const discovered = discoverPluginOptions()

  if (!discovered.options) {
    console.error('no plugin userConfig found with dashboardServerUrl')
    console.error('tried:', discovered.tried.join('\n  '))
    process.exit(1)
  }

  const mapped = mapOptions(discovered.options)
  if (!mapped.serverUrl) {
    console.error(`plugin config in ${discovered.source} missing dashboardServerUrl`)
    process.exit(1)
  }

  const globalPath = globalRemoteConfigPath()
  const existing = readJsonFile(globalPath) || {}
  const merged = {
    ...existing,
    ...mapped,
    _materializedFrom: discovered.source,
    _materializedAt: new Date().toISOString(),
    _pluginKey: discovered.key,
  }

  const payload = JSON.stringify(merged, null, 2)
  console.error(`source: ${discovered.source} (${discovered.key})`)
  console.error(`target: ${globalPath}`)
  console.log(payload)

  if (dryRun) return

  if (write) {
    fs.mkdirSync(dashboardHomeDir(), { recursive: true })
    fs.writeFileSync(globalPath, `${payload}\n`, 'utf8')
    console.error(`wrote ${globalPath}`)
    console.error('next: node resolve-remote.mjs --dev-team-root .dev-team-agent')
  } else {
    console.error('dry-run only — re-run with --write to save')
  }
}

main()
