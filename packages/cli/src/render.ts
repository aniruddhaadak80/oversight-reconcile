import type { ClaimView } from './tools.js'

/**
 * The claim-tree inspector: this product's primary interface.
 *
 * A governance reviewer does not want a table of claims. They want to walk the document's
 * own structure and, at each claim, see the exact bytes it came from. So every row carries
 * its provenance in the gutter — line:column and the byte range — and the quote is printed
 * verbatim rather than summarised, because a summary is what an oversight artifact must
 * never contain.
 */

const VERDICT_GLYPH: Record<string, string> = {
  supported: '+',
  unevidenced: '~',
  contradicted: '!',
  unbacked: '?',
  unmet: '-',
}

const SEVERITY_MARK: Record<string, string> = {
  blocker: 'BLOCKER',
  major: 'major',
  minor: 'minor',
}

export interface InspectRow {
  readonly claim: ClaimView
  readonly verdict?: string
  readonly severity?: string
  readonly obligationId?: string | null
  readonly obligationCode?: string
  readonly reasonCode?: string
}

export interface InspectOptions {
  readonly verdictFor?: (claimId: string) => {
    verdict: string
    severity: string
    obligationId: string | null
    reasonCode: string
  }
  readonly obligationCodes?: ReadonlyMap<string, string>
  readonly maxQuote?: number
}

/** One row: gutter, tree, verdict, and the verbatim quote. */
export function renderRow(row: InspectRow, options: InspectOptions = {}): string {
  const { claim } = row
  const maxQuote = options.maxQuote ?? 200
  const indent = '  '.repeat(Math.max(0, claim.depth - 1))
  const branch = claim.parentId === null ? '*' : '|-'
  const found = options.verdictFor?.(claim.id)
  const verdict = found?.verdict ?? row.verdict ?? 'pending'
  const severity = found?.severity ?? row.severity ?? ''
  const code =
    options.obligationCodes?.get(found?.obligationId ?? row.obligationId ?? '') ??
    row.obligationCode ??
    found?.obligationId ??
    row.obligationId ??
    ''
  const glyph = VERDICT_GLYPH[verdict] ?? '?'

  const gutter = `${String(claim.span.line).padStart(4)}:${String(claim.span.column).padStart(3)}`
  const bytes = `${claim.span.byteStart}-${claim.span.byteEnd}`
  const head = [
    glyph,
    `${claim.kind}/${claim.polarity}`,
    verdict,
    severity === '' ? '' : `(${SEVERITY_MARK[severity] ?? severity})`,
    code,
    `[${claim.id}]`,
  ]
    .filter((part) => part !== '')
    .join(' ')

  const quote = truncate(claim.quote.replace(/\s+/g, ' ').trim(), maxQuote)
  const lines = [`${gutter} ${bytes.padStart(11)}  ${head}`]
  lines.push(`${' '.repeat(gutter.length)}  ${indent}${branch} ${quote}`)
  if (found !== undefined && found.reasonCode !== '') {
    lines.push(`${' '.repeat(gutter.length)}      ↳ ${found.reasonCode}`)
  }
  return lines.join('\n')
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * The whole tree, grouped by section so the shape of the document is visible before any
 * claim is. Sections are printed as a path, because a section is what a claim belongs to.
 */
export function renderTree(
  rows: readonly InspectRow[],
  options: InspectOptions & { readonly sections?: readonly string[] } = {},
): string {
  if (rows.length === 0) {
    return [
      'no claims in this document.',
      '',
      'The lexicon found no governance cue in the text, so there is nothing to reconcile.',
      'That is a real result: a document that promises nothing cannot be found wanting.',
    ].join('\n')
  }

  const out: string[] = []
  if (options.sections !== undefined && options.sections.length > 0) {
    out.push('sections')
    for (const section of options.sections) out.push(`  ${section}`)
    out.push('')
  }
  out.push(`${rows.length} claim(s) — gutter is line:column, then the UTF-8 byte range`)
  out.push('')
  for (const row of rows) {
    out.push(renderRow(row, options))
    out.push('')
  }
  return out.join('\n').trimEnd()
}

/** The verdict summary printed under a reconciliation. */
export function renderSummary(counts: Record<string, unknown>, blocking: number): string {
  const byVerdict = (counts['byVerdict'] ?? {}) as Record<string, number>
  const width = Math.max(...Object.keys(byVerdict).map((key) => key.length), 4)
  const lines = Object.entries(byVerdict).map(
    ([verdict, count]) =>
      `  ${verdict.padEnd(width)}  ${String(count).padStart(4)}  ${'#'.repeat(Math.min(40, count))}`,
  )
  lines.push('')
  lines.push(blocking === 0 ? '  no blocking findings' : `  ${blocking} blocking finding(s)`)
  return lines.join('\n')
}
