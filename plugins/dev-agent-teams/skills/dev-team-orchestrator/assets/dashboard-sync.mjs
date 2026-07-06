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
import { formatMissingRemoteHint, mergeRemoteConfig, parseCliArgs } from './remote-config.mjs'

// agent-workflow/shared/schemas/artifact-sync.ts
const ARTIFACT_SYNC_ALLOWED_EXACT_FILES = [
  'pipeline.yaml',
  'knowledge.config.yaml',
  'project-rules.md',
]
const ARTIFACT_SYNC_ALLOWED_PREFIXES = ['.dev-state/', 'tasks/', 'knowledge/']
const ARTIFACT_SYNC_MAX_TOTAL_BYTES = 50_000_000
const ARTIFACT_MAX_FILE_BYTES = 5_000_000
const FETCH_TIMEOUT_MS = 30_000

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
    const byteLength = Buffer.byteLength(content, 'utf8')
    if (byteLength > ARTIFACT_MAX_FILE_BYTES) {
      throw new Error(
        `file ${relPath} is ${byteLength} bytes — exceeds per-file limit of ${ARTIFACT_MAX_FILE_BYTES}`,
      )
    }
    files.push({ relPath, content, byteLength })
  }
  return files
}

function batchFilesByTotalBytes(files, maxTotalBytes) {
  const batches = []
  let current = []
  let currentSize = 0

  for (const file of files) {
    const size = file.byteLength
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
    body: JSON.stringify({ files: files.map(({ relPath, content }) => ({ relPath, content })) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
  const args = parseCliArgs(process.argv.slice(2))
  const devTeamRoot = path.resolve(args['dev-team-root'] || '.dev-team-agent')
  const remoteCfg = mergeRemoteConfig({ cli: args, devTeamRoot })
  const projectId = (remoteCfg.projectId || '').trim()
  const serverUrl = remoteCfg.serverUrl
  const apiToken = remoteCfg.apiToken

  if (!projectId || !serverUrl) {
    console.error(formatMissingRemoteHint(remoteCfg))
    console.error('hint: run resolve-remote.mjs first to resolve projectId and cache orchestrator-remote.json')
    process.exit(1)
  }

  const entries = walkAllowedFiles(devTeamRoot)
  const files = readArtifactFiles(entries)
  const batches = batchFilesByTotalBytes(files, ARTIFACT_SYNC_MAX_TOTAL_BYTES)
  const totalBytes = files.reduce((sum, f) => sum + f.byteLength, 0)

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
    const batchBytes = batch.reduce((sum, f) => sum + f.byteLength, 0)
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
