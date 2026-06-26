import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function buildPrompt(resolvedAgent, userPrompt) {
  const system = resolvedAgent.systemPrompt?.trim()
  if (!system) return userPrompt
  return `## Agent instructions\n\n${system}\n\n## Task\n\n${userPrompt}`
}

function runProcess(cliPath, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const onLog = options.onLog

    child.stdout?.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      onLog?.(text)
    })
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk)
      stderr += text
      onLog?.(text)
    })

    let killed = false
    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            killed = true
            child.kill('SIGTERM')
          }, options.timeoutMs)
        : null

    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })

    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({
        exitCode: killed ? -1 : code,
        stdout,
        stderr,
        killed,
      })
    })
  })
}

export function createClaudeCodeCliProvider() {
  return {
    providerId: 'claude-code-cli',

    validateRunnerConfig(config) {
      const errors = []
      if (!config?.cliPath) errors.push('cliPath is required')
      return { ok: errors.length === 0, errors }
    },

    validateCredential(profile) {
      if (!profile?.secretRef) return { ok: false, errors: ['secretRef required'] }
      return { ok: true, errors: [] }
    },

    capabilities() {
      return {
        supportsAgentFile: true,
        supportsStreaming: false,
        maxConcurrency: 1,
      }
    },

    async execute(req, runnerConfig, _credential, onLog) {
      const started = Date.now()
      const cliPath = String(runnerConfig.cliPath || 'claude')
      const flags = Array.isArray(runnerConfig.flags) ? runnerConfig.flags : ['--bare']
      const prompt = buildPrompt(req.resolvedAgent, req.userPrompt)
      const args = [...flags, '-p', prompt]

      if (runnerConfig.allowedTools) {
        args.push('--allowedTools', String(runnerConfig.allowedTools))
      }
      if (runnerConfig.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions')
      }

      const logPath = req.metadata?.logPath
      const logChunks = []

      const wrappedOnLog = (chunk) => {
        logChunks.push(chunk)
        onLog?.(chunk)
        if (logPath) {
          try {
            fs.appendFileSync(logPath, chunk)
          } catch {
            /* ignore */
          }
        }
      }

      let procResult
      try {
        procResult = await runProcess(cliPath, args, {
          cwd: req.workspace,
          timeoutMs: req.timeoutMs || runnerConfig.timeoutMs || 600_000,
          onLog: wrappedOnLog,
        })
      } catch (err) {
        return {
          ok: false,
          exitCode: null,
          durationMs: Date.now() - started,
          logPath,
          error: String(err.message || err),
        }
      }

      const artifactsFound = []
      if (req.produces?.length) {
        for (const name of req.produces) {
          const fp = path.join(req.workspace, name)
          if (fs.existsSync(fp)) artifactsFound.push(name)
        }
      }

      const ok = procResult.exitCode === 0 && !procResult.killed
      return {
        ok,
        exitCode: procResult.exitCode,
        durationMs: Date.now() - started,
        logPath,
        artifactsFound,
        error: ok
          ? undefined
          : procResult.killed
            ? 'process timed out'
            : procResult.stderr?.slice(0, 500) || `exit code ${procResult.exitCode}`,
      }
    },
  }
}
