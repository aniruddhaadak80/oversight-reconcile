import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { Command } from 'commander'
import { isProductError, ValidationError, type Permission } from '@oversightreconcile/core'
import { LATEST_VERSION, OversightStore } from '@oversightreconcile/memory'
import { buildToolRegistry, createContext, pathsFor } from './bootstrap.js'
import { callEngine, loadEvidence, loadRegister, sha256 } from './engine.js'
import { doctor, renderReport } from './doctor.js'
import { renderSummary, renderTree, type InspectRow } from './render.js'
import type { ClaimView, ParseOutput, ReconcileOutput, VerdictView } from './tools.js'

const VERSION = '0.1.0'

/** Exit codes are the contract. A pipeline branches on 3 and nothing else. */
export const EXIT = { ok: 0, failure: 1, usage: 2, findings: 3 } as const

const SEVERITY_ORDER = ['minor', 'major', 'blocker'] as const
type Severity = (typeof SEVERITY_ORDER)[number]

/** The published report the web app renders. Committed, so a reviewer can diff it. */
export const DEFAULT_REPORT_PATH = 'apps/web/content/oversight/latest.json'

function write(stream: NodeJS.WriteStream, text: string): void {
  stream.write(text.endsWith('\n') ? text : `${text}\n`)
}

function fail(message: string, code: number = EXIT.failure): never {
  process.stderr.write(`error: ${message}\n`)
  process.exitCode = code
  throw new ExitSignal(code)
}

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`)
    this.name = 'ExitSignal'
  }
}

function isExitSignal(error: unknown): error is ExitSignal {
  return error instanceof ExitSignal
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action()
  } catch (error) {
    if (isExitSignal(error)) return
    if (isProductError(error)) {
      process.stderr.write(`error: ${error.code}: ${error.message}\n`)
      if (Object.keys(error.details).length > 0) {
        process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`)
      }
      process.exitCode = EXIT.failure
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`error: ${message}\n`)
    process.exitCode = EXIT.failure
  }
}

/** Exit 3 when a finding is at or above the threshold — this is the CI gate. */
function applyGate(blocking: number, threshold: Severity): void {
  if (blocking > 0 && SEVERITY_ORDER.indexOf('blocker') >= SEVERITY_ORDER.indexOf(threshold)) {
    process.exitCode = EXIT.findings
  }
}

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('oversight-reconcile')
    .description('Reconcile AI governance prose against a machine-checkable obligation register.')
    .version(
      `${VERSION} (node ${process.versions.node}, engine protocol v1)`,
      '-v, --version',
      'print the version',
    )
    .addHelpText(
      'after',
      [
        '',
        'Exit codes:',
        `  ${EXIT.ok}  ok`,
        `  ${EXIT.failure}  runtime failure`,
        `  ${EXIT.usage}  usage error`,
        `  ${EXIT.findings}  findings at or above --fail-on (this is the CI gate)`,
        '',
        'A walkthrough:',
        '  oversight-reconcile doctor',
        '  oversight-reconcile ingest docs/system-card.md',
        '  oversight-reconcile inspect docs/system-card.md',
        '  oversight-reconcile reconcile --fail-on blocker',
        '  oversight-reconcile runs',
      ].join('\n'),
    )
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : EXIT.usage
      throw error
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor()
      write(
        process.stdout,
        process.argv.includes('--json') ? JSON.stringify(report, null, 2) : renderReport(report),
      )
      if (!report.ok) process.exitCode = EXIT.failure
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry()
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name) ?? 'core',
        source: registry.sourceOf(tool.name) ?? 'core',
        permissions: tool.permissions,
      }))
      if (process.argv.includes('--json')) {
        write(process.stdout, JSON.stringify(tools, null, 2))
        return
      }
      const width = Math.max(...tools.map((tool) => tool.name.length), 4)
      for (const tool of tools) {
        write(process.stdout, `  ${tool.name.padEnd(width)}  ${tool.description}`)
      }
    })

  program
    .command('ingest')
    .description('parse governance documents and persist their claim trees')
    .argument('<paths...>', 'document paths to ingest')
    .option('--json', 'machine-readable output')
    .action(async (paths: string[]) => {
      await run(async () => {
        const registry = buildToolRegistry()
        const context = createContext('cli')
        const granted: Permission[] = ['fs:read', 'fs:write', 'proc:spawn']
        const results: unknown[] = []
        for (const path of paths) {
          const value = await registry.invoke('ingest_document', { path }, context, granted)
          results.push(value)
          const row = value as { documentId: string; claims: number; diagnostics: unknown[] }
          const notes = row.diagnostics.length === 0 ? '' : `  (${row.diagnostics.length} diagnostic(s))`
          write(process.stdout, `ingested ${row.documentId}: ${row.claims} claim(s)${notes}`)
        }
        if (process.argv.includes('--json')) write(process.stdout, JSON.stringify(results, null, 2))
      })
    })

  program
    .command('inspect')
    .description('print the claim tree with byte-exact provenance — the flagship view')
    .argument('<document>', 'document id, or a path that has been ingested')
    .option('--json', 'machine-readable output')
    .option('--full', 'print quotes in full instead of truncating them')
    .action(async (document: string, options: { json?: boolean; full?: boolean }) => {
      await run(async () => {
        const paths = pathsFor()
        const store = new OversightStore(paths.database)
        try {
          const row = store.getDocument(document) ?? store.documentByPath(document)
          if (row === undefined) {
            fail(`no document "${document}". Run: oversight-reconcile ingest <path>`, EXIT.usage)
          }
          const rows = store.listClaims(row.id)
          const view: ClaimView[] = rows.map((stored) => ({
            id: stored.id,
            parentId: stored.parent_id,
            depth: stored.depth,
            section: stored.section,
            kind: stored.kind,
            polarity: stored.polarity,
            subject: stored.subject,
            quote: stored.quote,
            span: {
              byteStart: stored.byte_start,
              byteEnd: stored.byte_end,
              line: stored.line,
              column: stored.col,
            },
            cues: JSON.parse(stored.cues) as string[],
          }))

          if (options.json === true) {
            write(
              process.stdout,
              JSON.stringify(
                { documentId: row.id, path: row.path, sha256: row.sha256, claims: view },
                null,
                2,
              ),
            )
            return
          }

          const lines = view.map((claim) => ({ claim }) satisfies InspectRow)
          const sections = [...new Set(view.map((claim) => claim.section))]
          write(
            process.stdout,
            renderTree(lines, {
              sections,
              ...(options.full === true ? { maxQuote: 4000 } : {}),
            }),
          )
        } finally {
          store.close()
        }
      })
    })

  program
    .command('reconcile')
    .description('reconcile every stored claim against the obligation register')
    .option('--json', 'machine-readable output')
    .option('--evidence <file>', 'a JSON array of evidence records to reconcile against')
    .option(
      '--fail-on <severity>',
      `exit ${EXIT.findings} when a finding at this severity or worse exists`,
      'blocker',
    )
    .option('--note <text>', 'recorded with the run, so a reviewer can tell runs apart')
    .action(async (options: { json?: boolean; evidence?: string; failOn?: string; note?: string }) => {
      await run(async () => {
        const threshold = (options.failOn ?? 'blocker') as Severity
        if (!SEVERITY_ORDER.includes(threshold)) {
          fail(`--fail-on must be one of ${SEVERITY_ORDER.join(', ')}`, EXIT.usage)
        }
        const paths = pathsFor()
        const register = loadRegister(paths)
        if (register.issues.length > 0) {
          fail(`the obligation register is broken:\n  ${register.issues.join('\n  ')}`)
        }
        if (register.obligations.length === 0) {
          fail('no obligations loaded, so every claim would be unbacked and the report would lie')
        }

        const store = new OversightStore(paths.database)
        try {
          const documents = store.listDocuments()
          if (documents.length === 0) {
            fail('no documents ingested. Run: oversight-reconcile ingest <path>')
          }

          const claims = readClaims(
            store,
            documents.map((row) => row.id),
          )
          const evidence = options.evidence === undefined ? [] : loadEvidence(options.evidence)
          const report = await callEngine<ReconcileOutput>(paths, 'reconcile', {
            claims,
            obligations: register.obligations,
            evidence,
          })

          const createdAt = Date.now()
          const runId = `run-${createdAt.toString(36)}-${report.digest.slice(0, 8)}`
          const byVerdict = report.counts['byVerdict'] as Record<string, number>
          const treeDigest = treeDigestFor(claims)
          store.replaceObligations(register.obligations)
          if (evidence.length > 0) store.replaceEvidence(evidence)
          store.putRun({
            id: runId,
            createdAt,
            engine: 'oversight_reconcile/0.1.0',
            lexicon: '1.0.0',
            rules: report.rulesVersion,
            treeDigest,
            reportDigest: report.digest,
            verdictCounts: byVerdict,
            blocking: Number(report.counts['blocking'] ?? 0),
          })
          store.putReconciliations(runId, report.verdicts)

          if (options.json === true) {
            write(process.stdout, JSON.stringify({ runId, note: options.note, ...report }, null, 2))
          } else {
            write(process.stdout, `${runId}  ${documents.length} document(s), ${claims.length} claim(s)`)
            write(
              process.stdout,
              `register: ${register.packs.map((p) => `${p.framework} (${p.obligations})`).join(', ')}`,
            )
            write(process.stdout, '')
            write(process.stdout, renderSummary(report.counts, Number(report.counts['blocking'] ?? 0)))
            const findings = report.verdicts.filter((verdict) => verdict.verdict !== 'supported')
            if (findings.length > 0) {
              write(process.stdout, '')
              write(process.stdout, 'findings')
              for (const verdict of findings.slice(0, 40)) {
                write(
                  process.stdout,
                  `  ${verdict.severity.padEnd(8)} ${verdict.verdict.padEnd(12)} ` +
                    `${verdict.claimId ?? '(register)'}  ${verdict.reasons[0]?.detail ?? ''}`,
                )
              }
              if (findings.length > 40) {
                write(process.stdout, `  … and ${findings.length - 40} more`)
              }
            }
          }
          applyGate(Number(report.counts['blocking'] ?? 0), threshold)
        } finally {
          store.close()
        }
      })
    })

  program
    .command('runs')
    .description('list recorded reconciliation runs, newest first')
    .option('--json', 'machine-readable output')
    .option('--limit <n>', 'how many runs to list', '20')
    .action(async (options: { json?: boolean; limit?: string }) => {
      await run(async () => {
        const paths = pathsFor()
        const store = new OversightStore(paths.database)
        try {
          const rows = store.listRuns(Number(options.limit ?? 20))
          const runs = rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            engine: row.engine,
            lexicon: row.lexicon,
            rules: row.rules,
            treeDigest: row.tree_digest,
            reportDigest: row.report_digest,
            blocking: row.blocking,
            verdicts: JSON.parse(row.verdict_counts) as Record<string, number>,
          }))
          if (options.json === true) {
            write(process.stdout, JSON.stringify({ count: runs.length, runs }, null, 2))
            return
          }
          if (runs.length === 0) {
            write(process.stdout, 'no runs recorded. Run: oversight-reconcile reconcile')
            return
          }
          const summary = await callEngine<Record<string, unknown>>(paths, 'summarize', {
            runs: runs.map((run) => ({
              id: run.id,
              createdAt: run.createdAt,
              treeDigest: run.treeDigest,
              reportDigest: run.reportDigest,
              verdicts: run.verdicts,
              blocking: run.blocking,
            })),
          })
          write(process.stdout, `${runs.length} run(s)`)
          for (const run of runs) {
            const blocking = run.blocking === 0 ? '' : `  ${run.blocking} blocking`
            write(process.stdout, `  ${run.id}  ${run.createdAt}${blocking}`)
          }
          write(process.stdout, '')
          write(
            process.stdout,
            `ledger: ${summary['distinctTrees']} distinct claim tree(s) across ${runs.length} run(s)`,
          )
        } finally {
          store.close()
        }
      })
    })

  program
    .command('compare')
    .description('compare two runs and report per-verdict deltas')
    .argument('<beforeId>', 'the earlier run id')
    .argument('<afterId>', 'the later run id')
    .option('--json', 'machine-readable output')
    .action(async (beforeId: string, afterId: string, options: { json?: boolean }) => {
      await run(async () => {
        const paths = pathsFor()
        const store = new OversightStore(paths.database)
        try {
          const before = store.getRun(beforeId)
          const after = store.getRun(afterId)
          if (before === undefined) fail(`no run "${beforeId}"`, EXIT.usage)
          if (after === undefined) fail(`no run "${afterId}"`, EXIT.usage)
          const diff = await callEngine<{
            changed: { id: string; deltas: Record<string, number>; treeChanged: boolean }[]
            added: string[]
            removed: string[]
            unchanged: number
          }>(paths, 'diff', { before: [record(before)], after: [record(after)] })
          if (options.json === true) {
            write(process.stdout, JSON.stringify(diff, null, 2))
            return
          }
          write(process.stdout, `${beforeId} → ${afterId}`)
          for (const change of diff.changed) {
            const deltas = Object.entries(change.deltas)
              .map(([verdict, delta]) => `${verdict} ${delta > 0 ? '+' : ''}${delta}`)
              .join('  ')
            write(
              process.stdout,
              `  ${change.id}  ${deltas}${change.treeChanged ? '  (claim tree changed)' : ''}`,
            )
          }
          write(process.stdout, `  ${diff.unchanged} run(s) unchanged`)
        } finally {
          store.close()
        }
      })
    })

  program
    .command('report')
    .description('write the published oversight report the web app renders')
    .option('--out <path>', `where to write it (default ${DEFAULT_REPORT_PATH})`)
    .option('--open', 'ignored; kept so the command reads the same as the others')
    .action(async (options: { out?: string }) => {
      await run(async () => {
        const paths = pathsFor()
        const target = options.out ?? join(paths.cwd, DEFAULT_REPORT_PATH)
        const register = loadRegister(paths)
        const store = new OversightStore(paths.database)
        try {
          const documents = store.listDocuments()
          if (documents.length === 0) fail('nothing ingested, so there is no report to publish')
          const claims = readClaims(
            store,
            documents.map((row) => row.id),
          )
          const report = await callEngine<ReconcileOutput>(paths, 'reconcile', {
            claims,
            obligations: register.obligations,
            evidence: store.listEvidence(),
          })
          const obligationCodes = new Map(register.obligations.map((row) => [row.id, `${row.code}`]))
          const verdictsByClaim = new Map(
            report.verdicts
              .filter((verdict): verdict is VerdictView & { claimId: string } => verdict.claimId !== null)
              .map((verdict) => [verdict.claimId, verdict]),
          )

          const payload = {
            generatedBy: 'oversight-reconcile report',
            engine: 'oversight_reconcile/0.1.0',
            rulesVersion: report.rulesVersion,
            lexiconVersion: '1.0.0',
            treeDigest: treeDigestFor(claims),
            reportDigest: report.digest,
            counts: report.counts,
            frameworks: register.packs,
            obligations: register.obligations,
            documents: documents.map((row) => ({
              id: row.id,
              path: row.path,
              sha256: row.sha256,
              bytes: row.byte_size,
              lines: row.line_count,
              body: row.body,
            })),
            claims: claims.map((claim) => {
              const verdict = verdictsByClaim.get(claim.id)
              const obligationId = verdict?.obligationId ?? null
              return {
                ...claim,
                verdict: verdict?.verdict ?? 'unbacked',
                severity: verdict?.severity ?? 'major',
                obligationId,
                obligationCode: obligationId === null ? null : (obligationCodes.get(obligationId) ?? null),
                reason: verdict?.reasons[0] ?? null,
              }
            }),
            verdicts: report.verdicts,
          }

          mkdirSync(dirname(target), { recursive: true })
          writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
          write(process.stdout, `wrote ${relative(paths.cwd, target)}`)
          write(
            process.stdout,
            `${claims.length} claim(s), ${report.verdicts.length} verdict(s), ` +
              `${report.counts['blocking']} blocking finding(s)`,
          )
          applyGate(Number(report.counts['blocking'] ?? 0), 'blocker')
        } finally {
          store.close()
        }
      })
    })

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@oversightreconcile/mcp')
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(buildToolRegistry(), createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      await run(async () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (cause) {
          process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
          process.exitCode = EXIT.usage
          return
        }
        const registry = buildToolRegistry()
        try {
          const value = await registry.invoke(tool, parsed, createContext('cli'), [
            'fs:read',
            'fs:write',
            'proc:spawn',
          ] as Permission[])
          write(process.stdout, JSON.stringify(value ?? null, null, 2))
        } catch (cause) {
          const code = (cause as { code?: string }).code ?? 'INTERNAL'
          const message = cause instanceof Error ? cause.message : String(cause)
          process.stderr.write(`error: ${code}: ${message}\n`)
          process.exitCode = EXIT.failure
        }
      })
    })

  program
    .command('version')
    .description('print the version of the CLI, the store schema and the engine contract')
    .action(() => {
      write(process.stdout, `${VERSION}`)
      write(process.stdout, `schema ${LATEST_VERSION}`)
      write(process.stdout, `engine protocol v1`)
    })

  return program
}

function record(row: {
  id: string
  created_at: number
  tree_digest: string
  report_digest: string
  verdict_counts: string
  blocking: number
}): Record<string, unknown> {
  return {
    id: row.id,
    createdAt: row.created_at,
    treeDigest: row.tree_digest,
    reportDigest: row.report_digest,
    blocking: row.blocking,
    verdicts: JSON.parse(row.verdict_counts) as Record<string, number>,
  }
}

function readClaims(store: OversightStore, documentIds: readonly string[]): ClaimView[] {
  const out: ClaimView[] = []
  for (const documentId of documentIds) {
    for (const row of store.listClaims(documentId)) {
      out.push({
        id: `${documentId}#${row.id}`,
        parentId: row.parent_id === null ? null : `${documentId}#${row.parent_id}`,
        depth: row.depth,
        section: row.section,
        kind: row.kind,
        polarity: row.polarity,
        subject: row.subject,
        quote: row.quote,
        span: { byteStart: row.byte_start, byteEnd: row.byte_end, line: row.line, column: row.col },
        cues: JSON.parse(row.cues) as string[],
      })
    }
  }
  return out
}

/**
 * One digest for the whole corpus. Identical bytes in every document produce an identical
 * tree digest, which is what makes "nothing changed" a provable claim rather than a feeling.
 */
function treeDigestFor(claims: readonly ClaimView[]): string {
  const canonical = [...claims]
    .map((claim) => ({
      id: claim.id,
      kind: claim.kind,
      polarity: claim.polarity,
      quote: claim.quote,
      span: claim.span,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return sha256(JSON.stringify(canonical))
}

export { ValidationError }
export type { ParseOutput }
