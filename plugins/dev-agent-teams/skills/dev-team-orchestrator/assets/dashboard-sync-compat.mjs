#!/usr/bin/env node
/**
 * LEGACY — git push + POST /sync cho server chưa deploy B0001 /artifacts.
 * Không thuộc phạm vi issue #41. Dùng tạm khi production còn v0.1.0.
 *
 * Usage:
 *   node dashboard-sync-compat.mjs --dev-team-root .dev-team-agent [--no-push] [--message=<msg>]
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { mergeRemoteConfig, parseCliArgs } from './remote-config.mjs'

const DEFAULT_MESSAGE = 'chore(dev-team): sync orchestrator artifacts'

function findGitRoot(startDir) {
  let dir = path.resolve(startDir)
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`)
  }
  return (r.stdout || '').trim()
}

function resolveDevTeamRel(devTeamRoot, gitRoot) {
  const rel = path.relative(gitRoot, path.resolve(devTeamRoot)).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..')) throw new Error('dev-team-root is not inside git repository')
  return rel
}

function authHeaders(token) {
  if (!token) return {}
  return { Authorization: `Bearer ${token}`, 'X-Dev-Team-Token': token }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2))
  const skipPush = args['no-push'] === true
  const devTeamRoot = path.resolve(args['dev-team-root'] || '.dev-team-agent')
  const remoteCfg = mergeRemoteConfig({ cli: args, devTeamRoot })
  const projectId = (remoteCfg.projectId || '').trim()
  const serverUrl = remoteCfg.serverUrl
  const apiToken = remoteCfg.apiToken
  const message = args.message || remoteCfg.syncMessage || DEFAULT_MESSAGE

  if (!projectId || !serverUrl) {
    console.error('missing projectId or serverUrl — run resolve-remote.mjs first')
    process.exit(1)
  }

  let pushResult = { pushed: false, branch: null, commit: null }
  if (!skipPush) {
    const gitRoot = findGitRoot(devTeamRoot)
    if (!gitRoot) {
      console.error('not in git repo — use --no-push for sync-only')
      process.exit(1)
    }
    const devTeamRel = resolveDevTeamRel(devTeamRoot, gitRoot)
    runGit(['add', '--', devTeamRel], gitRoot)
    const status = runGit(['status', '--porcelain', '--', devTeamRel], gitRoot)
    if (status) {
      runGit(['commit', '-m', message, '--', devTeamRel], gitRoot)
      const commit = runGit(['rev-parse', 'HEAD'], gitRoot)
      const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], gitRoot)
      runGit(['push', 'origin', branch], gitRoot)
      pushResult = { pushed: true, branch, commit }
      console.error(`pushed ${commit} to origin/${branch}`)
    }
  }

  const url = `${serverUrl.replace(/\/$/, '')}/api/projects/${encodeURIComponent(projectId)}/sync`
  const res = await fetch(url, { method: 'POST', headers: authHeaders(apiToken) })
  const body = await res.text().catch(() => '')
  const data = body ? JSON.parse(body) : {}
  if (!res.ok) {
    throw new Error(`server sync failed: HTTP ${res.status} ${data.error || body}`.slice(0, 500))
  }

  console.log(JSON.stringify({ ok: true, ...pushResult, syncedAt: data.syncedAt ?? null, mode: 'legacy-git-sync' }, null, 2))
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
