import Link from 'next/link'
import type { ReportClaim, SourceFragment } from '@/lib/oversight'
import { VerdictBadge, SeverityBadge, Field } from './ui'

/**
 * The provenance inspector.
 *
 * This is the signature element: the exact source line, with the exact bytes the claim
 * quoted highlighted inside it, and the byte range stated numerically. A reviewer can
 * check the claim against the document without trusting anything this app says.
 *
 * Rendered on the server for a `?claim=` query parameter and reached by ordinary links, so
 * the whole flow works with JavaScript disabled.
 */
export interface Sibling {
  readonly id: string
  readonly short: string
}

export function Inspector({
  claim,
  fragment,
  documentPath,
  query,
  siblings,
}: {
  claim: ReportClaim
  fragment: SourceFragment | null
  documentPath: string
  query: string
  siblings: readonly Sibling[]
}) {
  return (
    <aside className="inspector" aria-label="Claim provenance">
      <div className="inspector-head">
        <span className="eyebrow">Provenance</span>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          {claim.id.split('#')[1] ?? claim.id}
        </span>
      </div>

      <dl className="inspector-body">
        <Field label="verdict">
          <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <VerdictBadge verdict={claim.verdict} />
            <SeverityBadge severity={claim.severity} />
            {claim.obligationCode === null ? null : <span className="badge">{claim.obligationCode}</span>}
          </span>
        </Field>

        <Field label="source line">
          {fragment === null ? (
            <p style={{ margin: 0, color: 'var(--fg-muted)' }}>
              The stored document no longer has a line {claim.span.line}, so this claim cannot be shown
              against its source. Re-ingest the document to refresh its spans.
            </p>
          ) : (
            <pre className="source">
              <span className="source-line-no">{String(fragment.lineNumber).padStart(4, ' ')}: </span>
              {fragment.before}
              <mark className="source-mark">{fragment.quoted}</mark>
              {fragment.after}
            </pre>
          )}
        </Field>

        <Field label="byte range">
          <span className="mono">
            {claim.span.byteStart}–{claim.span.byteEnd} (UTF-8, {claim.span.byteEnd - claim.span.byteStart}{' '}
            bytes)
          </span>
        </Field>

        <Field label="position">
          <span className="mono">
            line {claim.span.line}, column {claim.span.column}
          </span>
        </Field>

        <Field label="document">
          <span className="mono">{documentPath}</span>
        </Field>

        <Field label="cue">
          <span className="mono">{claim.cues.join(', ')}</span>
        </Field>

        {claim.reason === null ? null : (
          <Field label={claim.reason.code}>
            <span style={{ color: 'var(--fg-muted)' }}>{claim.reason.detail}</span>
          </Field>
        )}

        <Field label="sibling claims">
          {siblings.length <= 1 ? (
            <span style={{ color: 'var(--fg-muted)' }}>This document makes one claim.</span>
          ) : (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
              {siblings.map((sibling) => (
                <Link
                  key={sibling.id}
                  className="badge"
                  href={`/?${query}&claim=${encodeURIComponent(sibling.id)}`}
                  {...(sibling.id === claim.id ? { 'aria-current': 'true' as const } : {})}
                >
                  {sibling.short}
                </Link>
              ))}
            </span>
          )}
        </Field>
      </dl>
    </aside>
  )
}
