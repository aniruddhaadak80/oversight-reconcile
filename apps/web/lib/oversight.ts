import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The typed data layer. Every route reads from here, so no component ever calls `fetch` and
 * the shape of the report is stated exactly once.
 *
 * The report is a **committed artifact**, not a live query. The CLI produces it with the
 * deterministic engine, the bytes are in the repository, and the deploy renders exactly the
 * artifact a reviewer can diff. A governance page whose numbers change under you between two
 * page loads is not evidence.
 */

export interface ReportSpan {
  readonly byteStart: number
  readonly byteEnd: number
  readonly line: number
  readonly column: number
}

export interface ReportClaim {
  readonly id: string
  readonly parentId: string | null
  readonly depth: number
  readonly section: string
  readonly kind: string
  readonly polarity: string
  readonly subject: string
  readonly quote: string
  readonly span: ReportSpan
  readonly cues: readonly string[]
  readonly verdict: string
  readonly severity: string
  readonly obligationId: string | null
  readonly obligationCode: string | null
  readonly reason: { readonly code: string; readonly detail: string } | null
}

export interface ReportObligation {
  readonly id: string
  readonly code: string
  readonly source: string
  readonly statement: string
  readonly kind: string
  readonly evidenceRequired: number
  readonly evidenceKind: string
  readonly severity: string
  readonly cues: readonly string[]
  readonly origin: string
}

export interface ReportDocument {
  readonly id: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly lines: number
  readonly body: string
}

export interface Report {
  readonly generatedBy: string
  readonly engine: string
  readonly rulesVersion: string
  readonly lexiconVersion: string
  readonly treeDigest: string
  readonly reportDigest: string
  readonly counts: {
    readonly verdicts: number
    readonly claims: number
    readonly obligations: number
    readonly evidence: number
    readonly byVerdict: Readonly<Record<string, number>>
    readonly bySeverity: Readonly<Record<string, number>>
    readonly blocking: number
  }
  readonly frameworks: readonly {
    readonly plugin: string
    readonly framework: string
    readonly version: string
    readonly obligations: number
  }[]
  readonly obligations: readonly ReportObligation[]
  readonly documents: readonly ReportDocument[]
  readonly claims: readonly ReportClaim[]
  readonly verdicts: readonly {
    readonly claimId: string | null
    readonly obligationId: string | null
    readonly verdict: string
    readonly severity: string
    readonly reasons: readonly { readonly code: string; readonly detail: string }[]
  }[]
}

export const VERDICTS = ['supported', 'unevidenced', 'contradicted', 'unbacked', 'unmet'] as const

export type VerdictName = (typeof VERDICTS)[number]

export const VERDICT_TONE: Readonly<Record<string, string>> = {
  supported: 'ok',
  unevidenced: 'warn',
  contradicted: 'danger',
  unbacked: 'warn',
  unmet: 'danger',
}

export function isVerdict(value: string): value is VerdictName {
  return (VERDICTS as readonly string[]).includes(value)
}

/** A short digest is easier to compare by eye than a full hash. Never a substitute. */
export function shortDigest(digest: string): string {
  return digest.slice(0, 12)
}

/**
 * The source line a claim came from, and the byte range within it.
 *
 * This is the whole product in one function: the claim is only citable if the exact
 * characters it quotes can be located in the original document, so the line is returned with
 * the offsets resolved relative to that line.
 */
export interface SourceFragment {
  readonly lineNumber: number
  readonly lineText: string
  readonly before: string
  readonly quoted: string
  readonly after: string
  readonly byteStart: number
  readonly byteEnd: number
}

export function sourceFragment(document: ReportDocument, span: ReportSpan): SourceFragment | null {
  const lines = document.body.split('\n')
  const index = span.line - 1
  const lineText = lines[index]
  if (lineText === undefined) return null

  const lineStart = byteOffsetOfLine(document.body, span.line)
  const startInLine = span.byteStart - lineStart
  const endInLine = span.byteEnd - lineStart
  if (startInLine < 0 || endInLine > lineText.length || startInLine > endInLine) return null

  return {
    lineNumber: span.line,
    lineText,
    before: lineText.slice(0, startInLine),
    quoted: lineText.slice(startInLine, endInLine),
    after: lineText.slice(endInLine),
    byteStart: span.byteStart,
    byteEnd: span.byteEnd,
  }
}

/** The UTF-8 byte offset at which a 1-based line begins. */
function byteOffsetOfLine(body: string, lineNumber: number): number {
  let offset = 0
  let line = 1
  while (line < lineNumber) {
    const newline = body.indexOf('\n', offset)
    if (newline === -1) return offset
    offset = newline + 1
    line += 1
  }
  return offset
}

export class ReportMissing extends Error {
  constructor(readonly file: string) {
    super(`No oversight report at ${file}. Run: npm run report (which runs the CLI's report command).`)
    this.name = 'ReportMissing'
  }
}

const REPORT_PATH = join('content', 'oversight', 'latest.json')

let cached: Report | null = null

/**
 * Read the committed report. The result is memoised per process because it cannot change
 * without a redeploy — a claim of freshness here would be false.
 */
export function loadReport(): Report {
  if (cached !== null) return cached
  const file = join(process.cwd(), REPORT_PATH)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    throw new ReportMissing(file)
  }
  cached = JSON.parse(raw) as Report
  return cached
}

export function claimsForDocument(report: Report, documentId: string): readonly ReportClaim[] {
  return report.claims.filter((claim) => claim.id.startsWith(`${documentId}#`))
}

export function documentFor(claim: ReportClaim, report: Report): ReportDocument | null {
  const documentId = claim.id.split('#')[0] ?? ''
  return report.documents.find((document) => document.id === documentId) ?? null
}

export interface Totals {
  readonly total: number
  readonly findings: number
  readonly blocking: number
}

export function totals(report: Report): Totals {
  const byVerdict = report.counts.byVerdict
  const total = Object.values(byVerdict).reduce((sum, value) => sum + value, 0)
  const findings = total - (byVerdict['supported'] ?? 0)
  return { total, findings, blocking: report.counts.blocking }
}
