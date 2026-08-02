#!/usr/bin/env node
/**
 * NoteLoom Midscene computer-use runner.
 *
 * Runs outside the Next/WebView bundle. Expects:
 *   MIDSCENE_MODULE_ROOT  — app_data/local-services/midscene (npm prefix install)
 *   MIDSCENE_MODEL_*      — vision model credentials (optional if already in env)
 *
 * Usage:
 *   node runner.mjs <request.json>
 *   node runner.mjs --stdin
 *
 * Request JSON:
 *   { "command": "status" | "act" | "query" | "assert" | "test" | "document", ... }
 *
 * Always prints one JSON object to stdout.
 */

import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { stdin as input } from 'node:process'

const __dirname = dirname(fileURLToPath(import.meta.url))

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }))
  process.stdout.write('\n')
  process.exit(1)
}

function ok(payload) {
  process.stdout.write(JSON.stringify({ ok: true, ...payload }))
  process.stdout.write('\n')
}

async function readRequest() {
  const arg = process.argv[2]
  if (!arg || arg === '--stdin') {
    const chunks = []
    for await (const chunk of input) chunks.push(chunk)
    const text = Buffer.concat(chunks).toString('utf8').trim()
    if (!text) fail('Empty stdin request')
    return JSON.parse(text)
  }
  const text = await readFile(resolve(arg), 'utf8')
  return JSON.parse(text)
}

async function loadComputer() {
  const moduleRoot = process.env.MIDSCENE_MODULE_ROOT
  if (!moduleRoot) {
    fail('MIDSCENE_MODULE_ROOT is not set')
  }

  const entryCandidates = [
    join(moduleRoot, 'node_modules', '@midscene', 'computer', 'dist', 'es', 'index.mjs'),
    join(moduleRoot, 'node_modules', '@midscene', 'computer', 'dist', 'lib', 'index.js'),
  ]

  for (const candidate of entryCandidates) {
    try {
      return await import(pathToFileURL(candidate).href)
    } catch {
      // try next
    }
  }

  // Fallback via createRequire from the install prefix
  try {
    const require = createRequire(join(moduleRoot, 'package.json'))
    return require('@midscene/computer')
  } catch (error) {
    fail(
      `@midscene/computer is not installed under ${moduleRoot}. Use Install Midscene Runtime in Settings → Automations.`,
      { detail: String(error?.message || error) },
    )
  }
}

function stripDataUrl(base64OrDataUrl) {
  if (typeof base64OrDataUrl !== 'string') return ''
  const idx = base64OrDataUrl.indexOf('base64,')
  return idx >= 0 ? base64OrDataUrl.slice(idx + 'base64,'.length) : base64OrDataUrl
}

async function captureScreenshot(agent, outputPath) {
  const page = agent.page || agent.interface
  if (!page || typeof page.screenshotBase64 !== 'function') {
    throw new Error('Midscene agent does not expose screenshotBase64()')
  }
  const raw = await page.screenshotBase64()
  const b64 = stripDataUrl(raw)
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, Buffer.from(b64, 'base64'))
  return outputPath
}

function sanitizeFilename(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^\w\-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}

async function withAgent(computer, request, run) {
  const opts = {
    aiActionContext:
      request.aiActionContext
      || 'You are controlling a desktop computer for NoteLoom Automations. Prefer precise, reversible actions.',
  }
  if (request.displayId) opts.displayId = String(request.displayId)

  const agent = await computer.agentForComputer(opts)
  try {
    return await run(agent)
  } finally {
    try {
      await agent.destroy()
    } catch {
      // ignore destroy errors
    }
  }
}

async function commandStatus(computer) {
  const accessibility = computer.checkAccessibilityPermission?.(false) || {
    hasPermission: true,
    platform: process.platform,
  }
  const screenRecording = computer.checkScreenRecordingPermission?.(false) || {
    hasPermission: true,
    platform: process.platform,
  }
  let environment = null
  try {
    environment = await computer.checkComputerEnvironment?.()
  } catch (error) {
    environment = { error: String(error?.message || error) }
  }

  let displays = []
  try {
    displays = await computer.ComputerDevice.listDisplays()
  } catch {
    displays = []
  }

  return {
    platform: process.platform,
    accessibility,
    screenRecording,
    environment,
    displays,
    modelConfigured: Boolean(
      process.env.MIDSCENE_MODEL_API_KEY
      && process.env.MIDSCENE_MODEL_NAME
      && process.env.MIDSCENE_MODEL_BASE_URL
      && process.env.MIDSCENE_MODEL_FAMILY,
    ),
  }
}

async function commandAct(computer, request) {
  const prompt = String(request.prompt || '').trim()
  if (!prompt) fail('act requires prompt')
  return withAgent(computer, request, async (agent) => {
    const result = await agent.aiAct(prompt)
    return { result: result ?? null, prompt }
  })
}

async function commandQuery(computer, request) {
  const prompt = String(request.prompt || '').trim()
  if (!prompt) fail('query requires prompt')
  return withAgent(computer, request, async (agent) => {
    const result = await agent.aiQuery(prompt)
    return { result, prompt }
  })
}

async function commandAssert(computer, request) {
  const prompt = String(request.prompt || '').trim()
  if (!prompt) fail('assert requires prompt')
  return withAgent(computer, request, async (agent) => {
    try {
      const result = await agent.aiAssert(prompt, request.message || undefined)
      return { passed: true, result: result ?? null, prompt }
    } catch (error) {
      return {
        passed: false,
        prompt,
        error: String(error?.message || error),
      }
    }
  })
}

async function commandTest(computer, request) {
  const steps = Array.isArray(request.steps) ? request.steps : []
  if (steps.length === 0) fail('test requires a non-empty steps array')
  const title = String(request.title || 'Midscene test').trim() || 'Midscene test'
  const outputDir = request.outputDir ? resolve(String(request.outputDir)) : null

  return withAgent(computer, request, async (agent) => {
    const results = []
    let passed = 0
    let failed = 0

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] || {}
      const kind = String(step.type || 'act').toLowerCase()
      const prompt = String(step.prompt || step.action || step.assert || '').trim()
      const entry = {
        index: index + 1,
        type: kind,
        prompt,
        ok: false,
        startedAt: new Date().toISOString(),
      }

      try {
        if (!prompt) throw new Error('Step is missing prompt')
        if (kind === 'assert') {
          await agent.aiAssert(prompt, step.message || undefined)
          entry.ok = true
          entry.message = 'Assertion passed'
        } else if (kind === 'query') {
          entry.result = await agent.aiQuery(prompt)
          entry.ok = true
        } else if (kind === 'wait') {
          await agent.aiWaitFor?.(prompt)
          entry.ok = true
        } else {
          entry.result = (await agent.aiAct(prompt)) ?? null
          entry.ok = true
        }
        passed += 1
      } catch (error) {
        entry.ok = false
        entry.error = String(error?.message || error)
        failed += 1
        if (request.stopOnFailure !== false) {
          results.push(entry)
          break
        }
      }

      if (outputDir && step.screenshot !== false) {
        try {
          const shotPath = join(
            outputDir,
            'screenshots',
            `step-${String(index + 1).padStart(2, '0')}-${sanitizeFilename(kind, 'step')}.png`,
          )
          entry.screenshotPath = await captureScreenshot(agent, shotPath)
        } catch (error) {
          entry.screenshotError = String(error?.message || error)
        }
      }

      entry.finishedAt = new Date().toISOString()
      results.push(entry)
    }

    const report = {
      title,
      status: failed === 0 ? 'passed' : 'failed',
      passed,
      failed,
      total: steps.length,
      completed: results.length,
      steps: results,
      generatedAt: new Date().toISOString(),
    }

    if (outputDir) {
      await mkdir(outputDir, { recursive: true })
      const reportPath = join(outputDir, 'report.json')
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      const mdLines = [
        `# ${title}`,
        '',
        `Status: **${report.status}** (${passed} passed, ${failed} failed)`,
        '',
        '| # | Type | Result | Prompt |',
        '| --- | --- | --- | --- |',
        ...results.map((step) => {
          const status = step.ok ? 'PASS' : 'FAIL'
          const prompt = String(step.prompt || '').replace(/\|/g, '\\|')
          return `| ${step.index} | ${step.type} | ${status} | ${prompt} |`
        }),
        '',
      ]
      const mdPath = join(outputDir, 'report.md')
      await writeFile(mdPath, `${mdLines.join('\n')}\n`, 'utf8')
      report.reportJsonPath = reportPath
      report.reportMarkdownPath = mdPath
    }

    return { report }
  })
}

async function commandDocument(computer, request) {
  const steps = Array.isArray(request.steps) ? request.steps : []
  if (steps.length === 0) fail('document requires a non-empty steps array')
  const title = String(request.title || 'Step-by-step guide').trim() || 'Step-by-step guide'
  const outputDir = resolve(String(request.outputDir || ''))
  if (!outputDir) fail('document requires outputDir')
  const noteFileName = sanitizeFilename(request.noteFileName || title, 'guide') + '.md'
  const screenshotsDir = join(outputDir, 'screenshots')
  await mkdir(screenshotsDir, { recursive: true })

  return withAgent(computer, request, async (agent) => {
    const documented = []

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index] || {}
      const prompt = String(step.prompt || step.action || '').trim()
      const description = String(step.description || step.title || prompt || `Step ${index + 1}`).trim()
      const entry = {
        index: index + 1,
        description,
        prompt,
        ok: false,
      }

      try {
        if (prompt) {
          entry.result = (await agent.aiAct(prompt)) ?? null
        }
        entry.ok = true
      } catch (error) {
        entry.ok = false
        entry.error = String(error?.message || error)
        if (request.continueOnError === false) {
          documented.push(entry)
          break
        }
      }

      try {
        const shotName = `step-${String(index + 1).padStart(2, '0')}-${sanitizeFilename(description, 'step')}.png`
        const shotPath = join(screenshotsDir, shotName)
        await captureScreenshot(agent, shotPath)
        entry.screenshotPath = shotPath
        entry.screenshotRelativePath = `screenshots/${shotName}`
      } catch (error) {
        entry.screenshotError = String(error?.message || error)
      }

      documented.push(entry)
    }

    const lines = [
      `# ${title}`,
      '',
      `_Generated by NoteLoom Automations (Midscene) on ${new Date().toISOString()}_`,
      '',
      '## Steps',
      '',
    ]

    for (const step of documented) {
      lines.push(`### ${step.index}. ${step.description}`)
      lines.push('')
      if (step.prompt && step.prompt !== step.description) {
        lines.push(`Action: ${step.prompt}`)
        lines.push('')
      }
      if (step.ok) {
        lines.push('Status: completed')
      } else {
        lines.push(`Status: failed — ${step.error || 'unknown error'}`)
      }
      lines.push('')
      if (step.screenshotRelativePath) {
        lines.push(`![Step ${step.index}](${step.screenshotRelativePath})`)
        lines.push('')
      }
    }

    const notePath = join(outputDir, noteFileName)
    await writeFile(notePath, `${lines.join('\n')}\n`, 'utf8')

    return {
      title,
      notePath,
      noteFileName,
      screenshotsDir,
      steps: documented,
      completed: documented.filter((s) => s.ok).length,
      failed: documented.filter((s) => !s.ok).length,
    }
  })
}

async function main() {
  let request
  try {
    request = await readRequest()
  } catch (error) {
    fail(`Invalid request JSON: ${error?.message || error}`)
  }

  const command = String(request.command || '').toLowerCase()
  if (!command) fail('Missing command')

  // Progress heartbeats for long runs (Tauri listens on stderr lines).
  const rl = createInterface({ input: process.stderr })
  rl.on('line', () => {})

  const computer = await loadComputer()

  try {
    let payload
    switch (command) {
      case 'status':
        payload = await commandStatus(computer)
        break
      case 'act':
        payload = await commandAct(computer, request)
        break
      case 'query':
        payload = await commandQuery(computer, request)
        break
      case 'assert':
        payload = await commandAssert(computer, request)
        break
      case 'test':
        payload = await commandTest(computer, request)
        break
      case 'document':
        payload = await commandDocument(computer, request)
        break
      default:
        fail(`Unknown command: ${command}`)
    }
    ok({ command, ...payload })
  } catch (error) {
    fail(String(error?.message || error), { command })
  }
}

main()
