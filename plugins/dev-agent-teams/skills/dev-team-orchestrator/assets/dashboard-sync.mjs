#!/usr/bin/env node
/**
 * Upload .dev-team-agent/ artifacts to remote dashboard via HTTP API (Luồng B).
 * B0001 / cc-plugin#41 — thay git push + POST /sync.
 *
 * Whitelist mirror agent-workflow/shared/schemas/artifact-sync.ts (single source of truth on server).
 *
 * Usage:
 *   node dashboard-sync.mjs --dev-team-root .dev-team-agent [--project=<id>] [--server=<url>] [--api-token=<token>]
 */
import fs from 'node:fs'
import path from 'node:path'

// agent-workflow/shared/schemas/artifact-sync.ts
const ARTIFACT_SYNC_ALLOWED_EXACT_FILES = [
  'pipeline.yaml',
  'knowledge.config.yaml',
  'project-rules.md',
]
const ARTIFACT_SYNC_ALLOWED_PREFIXES = ['.dev-state/', 'tasks/', 'knowledge/']
const ARTIFACT_SYNC_MAX_TOTAL_BYTES = 50_000_000
const ARTIFACT_MAX_FILE_BYTES = 5_000_000

function parseArgs(argv) {
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

function loadRemoteConfig(devTeamRoot) {
  const file = path.join(devTeamRoot, 'orchestrator-remote.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function resolveConnection(args, devTeamRoot) {
  const remoteCfg = loadRemoteConfig(devTeamRoot)
  const projectId = (
    args.project ||
    remoteCfg.projectId ||
    process.env.DEV_TEAM_PROJECT_ID ||
    ''
  ).trim()
  const serverUrl = (
    args.server ||
    remoteCfg.serverUrl ||
    process.env.DEV_TEAM_SERVER_URL ||
    ''
  ).trim()
  const apiToken = args['api-token'] || remoteCfg.apiToken || process.env.DEV_TEAM_API_TOKEN?.trim() || null
  return { projectId, serverUrl, apiToken }
}

function isArtifactPathAllowed(relPath) {
  if (ARTIFACT_SYNC_ALLOWED_EXACT_FILES.includes(relPath)) return true
  return ARTIFACT_SYNC_ALLOWED_PREFIXES.some((p) => relPath.startsWith(p))
}

function walkAllowedFiles(devTeamRoot) {
  const root = path.resolve(devTeamRoot)
  const out = []

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const relPath = path.relative(root, full).replace(/\\/g, '/')
      if (isArtifactPathAllowed(relPath)) {
        out.push({ relPath, fullPath: full })
      }
    }
  }

  if (fs.existsSync(root)) walk(root)
  out.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return out
}

function readArtifactFiles(entries) {
  const files = []
  for (const { relPath, fullPath } of entries) {
    let content
    try {
      content = fs.readFileSync(fullPath, 'utf8')
    } catch (err) {
      throw new Error(`cannot read ${relPath}: ${err.message || err}`)
    }
    if (content.length > ARTIFACT_MAX_FILE_BYTES) {
      throw new Error(
        `file ${relPath} is ${content.length} bytes — exceeds per-file limit of ${ARTIFACT_MAX_FILE_BYTES}`,
      )
    }
    files.push({ relPath, content })
  }
  return files
}

function batchFilesByTotalBytes(files, maxTotalBytes) {
  const batches = []
  let current = []
  let currentSize = 0

  for (const file of files) {
    const size = file.content.length
    if (size > maxTotalBytes) {
      throw new Error(
        `file ${file.relPath} exceeds batch limit of ${maxTotalBytes} bytes — split files or raise server cap`,
      )
    }
    if (currentSize + size > maxTotalBytes && current.length > 0) {
      batches.push(current)
      current = []
      currentSize = 0
    }
    current.push(file)
    currentSize += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function authHeaders(token) {
  if (!token) return {}
  return { Authorization: `Bearer ${token}`, 'X-Dev-Team-Token': token }
}

async function uploadArtifacts({ serverBaseUrl, projectId, token, files }) {
  const base = serverBaseUrl.replace(/\/$/, '')
  const url = `${base}/api/projects/${encodeURIComponent(projectId)}/artifacts`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ files }),
  })
  const body = await res.text().catch(() => '')
  let data = {}
  try {
    data = body ? JSON.parse(body) : {}
  } catch {
    data = { raw: body }
  }
  if (!res.ok) {
    const msg = data.error || body || res.statusText
    throw new Error(`artifact upload failed: HTTP ${res.status} ${msg}`.slice(0, 500))
  }
  return data
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const devTeamRoot = path.resolve(args['dev-team-root'] || '.dev-team-agent')
  const { projectId, serverUrl, apiToken } = resolveConnection(args, devTeamRoot)

  if (!projectId) {
    console.error(
      'missing projectId — run resolve-remote.mjs first, or pass --project=<id> / DEV_TEAM_PROJECT_ID',
    )
    process.exit(1)
  }
  if (!serverUrl) {
    console.error(
      'missing serverUrl — run resolve-remote.mjs first, or pass --server=<url> / DEV_TEAM_SERVER_URL',
    )
    process.exit(1)
  }

  const entries = walkAllowedFiles(devTeamRoot)
  const files = readArtifactFiles(entries)
  const batches = batchFilesByTotalBytes(files, ARTIFACT_SYNC_MAX_TOTAL_BYTES)
  const totalBytes = files.reduce((sum, f) => sum + f.content.length, 0)

  if (batches.length > 1) {
    console.error(
      `payload ${totalBytes} bytes exceeds ${ARTIFACT_SYNC_MAX_TOTAL_BYTES} per request — uploading ${batches.length} batches`,
    )
  }

  if (batches.length === 0) {
    const result = await uploadArtifacts({ serverBaseUrl: serverUrl, projectId, token: apiToken, files: [] })
    console.log(`${projectId}: artifact sync OK (no files)`)
    console.log(JSON.stringify({ ok: true, filesUploaded: 0, batches: 0, syncedAt: result.syncedAt ?? null }, null, 2))
    return
  }

  let totalUploaded = 0
  let lastResult = {}
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const batchBytes = batch.reduce((sum, f) => sum + f.content.length, 0)
    console.error(`uploading batch ${i + 1}/${batches.length}: ${batch.length} files, ${batchBytes} bytes`)
    lastResult = await uploadArtifacts({
      serverBaseUrl: serverUrl,
      projectId,
      token: apiToken,
      files: batch,
    })
    totalUploaded += batch.length
  }

  console.log(`${projectId}: artifact sync OK`, lastResult.syncedAt ? `@ ${lastResult.syncedAt}` : '')
  console.log(
    JSON.stringify(
      {
        ok: true,
        filesUploaded: totalUploaded,
        batches: batches.length,
        totalBytes,
        filesWritten: lastResult.filesWritten ?? null,
        filesDeleted: lastResult.filesDeleted ?? null,
        syncedAt: lastResult.syncedAt ?? null,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
