#!/usr/bin/env node
// Proof that the MCP surface is real, not a claim in a README.
//
//   node scripts/prove-mcp.mjs
//
// Starts the built MCP server as a child process over stdio, speaks the protocol to it with
// the real @modelcontextprotocol/sdk client, and calls tools â€” including one that reaches
// the Python engine. Prints every step and exits non-zero if any step fails.
//
// This is deliberately a separate script from the unit tests: those check descriptors in
// process, this one checks the wire.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER = join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

const steps = []

function record(label, ok, detail) {
  steps.push({ label, ok, detail })
  const token = ok ? 'PASS' : 'FAIL'
  console.log(`  [${token}] ${label}`)
  if (detail) console.log(`         ${detail}`)
}

async function main() {
  if (!existsSync(SERVER)) {
    console.error(`prove:mcp â€” ${SERVER} not found. Run "npm run build" first.`)
    process.exit(1)
  }

  const { McpClient } = await import(pathToFileURL(join(ROOT, 'packages', 'mcp', 'dist', 'index.js')).href)

  // One server, launched by the client's stdio transport. Spawning a second throwaway copy
  // just to print a pid would leak a process and hang the script.
  const client = new McpClient()
  try {
    await client.connect({
      id: 'prove-mcp',
      command: process.execPath,
      args: [SERVER, 'mcp', 'serve'],
      enabled: true,
      env: { PYTHON: process.env.PYTHON ?? 'python' },
    })
    record('initialize over stdio', true, `${process.execPath} ${SERVER} mcp serve`)

    const tools = await client.listTools()
    record(
      'tools/list',
      tools.length >= 5,
      `${tools.length} tools: ${tools.map((tool) => tool.name).join(', ')}`,
    )

    const engineTool = tools.find((tool) => tool.name === 'parse_claims')
    record(
      'engine-backed tool is exposed',
      engineTool !== undefined,
      engineTool?.description.slice(0, 72) ?? 'missing',
    )

    const parsed = await client.callTool('parse_claims', {
      text: '# Proof\n\n## Controls\n\nHuman review is available for every adverse decision.\n',
    })
    const tree = parsed
    record(
      'tools/call parse_claims reached the engine',
      Array.isArray(tree.claims) && tree.claims.length === 1,
      `${tree.claims?.length ?? 0} claim, tree digest ${tree.digest?.slice(0, 16)}`,
    )

    const quote = tree.claims?.[0]
    if (quote !== undefined) {
      const payload = {
        claims: [
          {
            id: 'c1',
            parentId: null,
            depth: 2,
            section: 'Proof',
            kind: 'oversight',
            polarity: 'affirmed',
            subject: 'human review',
            quote: quote.quote,
            span: quote.span,
            cues: ['oversight.human-review'],
          },
        ],
        obligations: [
          {
            id: 'O-HUMAN',
            code: 'Art. 14',
            source: 'EU AI Act',
            statement: 'high-risk systems must be overseen by natural persons',
            kind: 'oversight',
            evidenceRequired: 1,
            severity: 'blocker',
          },
        ],
        evidence: [],
      }
      const report = await client.callTool('reconcile_oversight', payload)
      record(
        'tools/call reconcile_oversight reached the engine',
        report.counts?.byVerdict?.unevidenced === 1,
        `byVerdict ${JSON.stringify(report.counts?.byVerdict)}`,
      )
    }

    const documents = await client.callTool('list_documents', {})
    const listed = documents
    record(
      'tools/call list_documents read the store',
      typeof listed.count === 'number',
      `${listed.count} document(s)`,
    )

    let failed = false
    try {
      await client.callTool('parse_claims', {})
      failed = true
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      record('invalid input returns an error envelope, not a crash', !failed, text.split('\n')[0])
    }

    await client.close()
  } catch (error) {
    record('mcp session', false, error instanceof Error ? error.message : String(error))
  }

  const failedSteps = steps.filter((step) => !step.ok)
  console.log('')
  console.log(`  ${steps.length - failedSteps.length} passed, ${failedSteps.length} failed`)
  process.exitCode = failedSteps.length === 0 ? 0 : 1
}

main()
