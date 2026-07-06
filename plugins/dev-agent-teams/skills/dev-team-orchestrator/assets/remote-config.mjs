/**
 * Merge remote dashboard config từ nhiều nguồn.
 *
 * Precedence (cao → thấp):
 *   CLI flags → .dev-team-agent/orchestrator-remote.json → ~/.dev-team-dashboard/remote.json
 *   → DEV_TEAM_* env
 *
 * Workaround (B0001): global remote.json cho trường hợp plugin userConfig UI
 * không inject vào shell agent / MCP lỗi — copy giá trị từ plugin settings một lần.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function parseCliArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const body = a.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      const key = body.slice(0, eq)
      const val = body.slice(eq + 1)
      out[key] = val === '' ? true : val
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[body] = next
      i++
    } else {
      out[body] = true
    }
  }
  return out
}

export function dashboardHomeDir() {
  const fromEnv = process.env.DEV_TEAM_DASHBOARD_HOME?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(os.homedir(), '.dev-team-dashboard')
}

export function globalRemoteConfigPath() {
  return path.join(dashboardHomeDir(), 'remote.json')
}

export function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

export function loadConfigLayers(devTeamRoot) {
  const root = path.resolve(devTeamRoot || '.dev-team-agent')
  const globalPath = globalRemoteConfigPath()
  return {
    devTeamRoot: root,
    globalPath,
    globalCfg: readJsonFile(globalPath) || {},
    repoCfg: readJsonFile(path.join(root, 'orchestrator-remote.json')) || {},
  }
}

function firstNonEmpty(...values) {
  for (const v of values) {
    const s = typeof v === 'string' ? v.trim() : v
    if (s !== undefined && s !== null && s !== '') return typeof s === 'string' ? s.trim() : s
  }
  return ''
}

/**
 * @param {{ cli?: Record<string, unknown>, devTeamRoot?: string }} opts
 */
export function mergeRemoteConfig(opts = {}) {
  const cli = opts.cli || {}
  const { globalCfg, repoCfg } = loadConfigLayers(opts.devTeamRoot)

  const serverUrl = firstNonEmpty(
    cli.server,
    repoCfg.serverUrl,
    globalCfg.serverUrl,
    process.env.DEV_TEAM_SERVER_URL,
  )
  const projectId = firstNonEmpty(
    cli.project,
    repoCfg.projectId,
    globalCfg.projectId,
    process.env.DEV_TEAM_PROJECT_ID,
  )
  const projectName = firstNonEmpty(
    cli['project-name'],
    repoCfg.projectName,
    globalCfg.projectName,
    process.env.DEV_TEAM_PROJECT_NAME,
  )
  const apiToken =
    cli['api-token'] ??
    repoCfg.apiToken ??
    globalCfg.apiToken ??
    process.env.DEV_TEAM_API_TOKEN?.trim() ??
    null

  const runnerMode = cli['runner-mode'] || repoCfg.runnerMode || globalCfg.runnerMode || 'local'
  const runnerId = cli.runner || repoCfg.runnerId || globalCfg.runnerId || null

  return {
    serverUrl,
    projectId: projectId || null,
    projectName: projectName || null,
    apiToken,
    runnerMode,
    runnerId,
    syncAfterState: repoCfg.syncAfterState ?? globalCfg.syncAfterState ?? true,
    syncAfterStep: repoCfg.syncAfterStep ?? globalCfg.syncAfterStep ?? true,
    syncMessage:
      repoCfg.syncMessage ||
      globalCfg.syncMessage ||
      'chore(dev-team): sync orchestrator artifacts',
    configSources: {
      global: globalRemoteConfigPath(),
      globalLoaded: Boolean(globalCfg.serverUrl),
      repo: path.join(loadConfigLayers(opts.devTeamRoot).devTeamRoot, 'orchestrator-remote.json'),
      repoLoaded: Boolean(repoCfg.serverUrl || repoCfg.projectId),
    },
  }
}

export function formatMissingRemoteHint(merged) {
  const lines = [
    'missing remote config — tried:',
    `  1. CLI --server / --project`,
    `  2. ${merged.configSources.repo}`,
    `  3. ${merged.configSources.global} (workaround: copy plugin UI settings here)`,
    '  4. DEV_TEAM_SERVER_URL / DEV_TEAM_PROJECT_ID env',
    '',
    'Workaround: cp plugins/dev-agent-teams/skills/dev-team-orchestrator/assets/user-remote.example.json ~/.dev-team-dashboard/remote.json',
    'then fill serverUrl, apiToken, projectName from plugin settings and run resolve-remote.mjs',
  ]
  return lines.join('\n')
}
