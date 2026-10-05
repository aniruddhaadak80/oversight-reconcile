import Link from 'next/link'
import { PageHeader, Tile, Digest, EmptyState, VerdictBadge, SeverityBadge } from '@/components/ui'
import { Inspector, type Sibling } from '@/components/inspector'
import {
  VERDICT_TONE,
  claimsForDocument,
  documentFor,
  loadReport,
  shortDigest,
  sourceFragment,
  totals,
  VERDICTS,
  ReportMissing,
} from '@/lib/oversight'

export const dynamic = 'force-static'

interface Search {
  document?: string
  claim?: string
}

/**
 * The oversight report: the claim canvas with the floating provenance inspector.
 *
 * Server-rendered from a committed artifact. The tree is the primary content because the
 * tree IS the product: a flat list of verdicts would tell a reviewer which claims failed
 * without showing the document they came from.
 */
export default function ReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  let report: ReturnType<typeof loadReport>
  try {
    report = loadReport()
  } catch (cause) {
    if (cause instanceof ReportMissing) {
      return (
        <EmptyState title="No oversight report is published yet" action={<code>npm run report</code>}>
          <p>
            This page renders a committed report artifact, so it cannot invent numbers. Generate one with the
            CLI: it parses <code>docs/policy/*.md</code>, reconciles the claims against the shipped obligation
            packs, and writes the result here.
          </p>
          <p>{cause.message}</p>
        </EmptyState>
      )
    }
    throw cause
  }

  return <Report report={report} search={searchParams} />
}

async function Report({
  report,
  search,
}: {
  report: ReturnType<typeof loadReport>
  search: Promise<Search>
}) {
  const { document: documentId, claim: claimId } = await search
  const documents = report.documents
  const selectedDocumentId = documentId ?? documents[0]?.id
  const claims =
    selectedDocumentId === undefined ? report.claims : claimsForDocument(report, selectedDocumentId)

  const selected = report.claims.find((claim) => claim.id === claimId) ?? claims[0] ?? null
  const selectedDocument = selected === null ? null : documentFor(selected, report)
  const fragment =
    selected === null || selectedDocument === null ? null : sourceFragment(selectedDocument, selected.span)

  const siblingSource = selected === null ? [] : claimsForDocument(report, selected.id.split('#')[0] ?? '')
  const siblings: Sibling[] = siblingSource.map((claim) => ({
    id: claim.id,
    short: claim.id.split('#')[1] ?? claim.id,
  }))

  const summary = totals(report)
  const query = selectedDocumentId === undefined ? '' : `document=${encodeURIComponent(selectedDocumentId)}`

  return (
    <>
      <PageHeader
        eyebrow={`report · ${report.engine}`}
        title="Claim tree reconciled"
        lede={`${report.counts.claims} governance claims parsed from ${documents.length} published document(s), reconciled against ${report.counts.obligations} obligations from ${report.frameworks.length} framework packs. Select a claim to see the bytes it quotes.`}
        aside={
          <span style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Digest label="tree" value={shortDigest(report.treeDigest)} />
            <Digest label="report" value={shortDigest(report.reportDigest)} />
            <Digest label="lexicon" value={report.lexiconVersion} />
            <Digest label="rules" value={report.rulesVersion} />
          </span>
        }
      />

      <dl className="tiles">
        <Tile label="claims" value={String(summary.total)} />
        <Tile label="findings" value={String(summary.findings)} />
        <Tile
          label="blocking"
          value={String(summary.blocking)}
          tone={summary.blocking === 0 ? 'ok' : 'danger'}
        />
        <Tile label="obligations" value={String(report.counts.obligations)} />
        <Tile label="artifacts" value={String(report.counts.evidence)} />
      </dl>

      <div className="section-head" style={{ marginTop: 'var(--space-6)' }}>
        <h2>Verdicts</h2>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          supported is the only verdict that passes
        </span>
      </div>
      <dl className="bars">
        {VERDICTS.map((verdict) => {
          const count = report.counts.byVerdict[verdict] ?? 0
          const width = summary.total === 0 ? 0 : Math.round((count / summary.total) * 100)
          return (
            <div className="bar-row" key={verdict}>
              <dt>{verdict}</dt>
              <dd>{count}</dd>
              <div className="bar-track">
                <div className="bar-fill" data-tone={VERDICT_TONE[verdict]} style={{ width: `${width}%` }} />
              </div>
            </div>
          )
        })}
      </dl>

      <div className="section-head" style={{ marginTop: 'var(--space-6)' }}>
        <h2>Documents</h2>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          {documents.length} in this report
        </span>
      </div>
      {documents.length === 0 ? (
        <EmptyState title="No documents in this report">
          <p>Nothing was ingested, so there is nothing to reconcile.</p>
        </EmptyState>
      ) : (
        <p style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', margin: 0 }}>
          {documents.map((document) => {
            const active = document.id === selectedDocumentId
            return (
              <Link
                key={document.id}
                className="badge"
                href={`/?document=${encodeURIComponent(document.id)}`}
                {...(active ? { 'aria-current': 'true' as const } : {})}
              >
                {document.path} · {document.bytes} B · {document.lines} lines
              </Link>
            )
          })}
        </p>
      )}

      <div className="section-head" style={{ marginTop: 'var(--space-6)' }}>
        <h2>Claim canvas</h2>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          gutter is line:column, then the UTF-8 byte range
        </span>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          title="This document makes no claim the lexicon can reconcile"
          action={<code>oversight-reconcile inspect &lt;path&gt;</code>}
        >
          <p>
            No governance cue matched its text. That is a real result rather than a failure: a document that
            promises nothing cannot be found wanting.
          </p>
        </EmptyState>
      ) : (
        <div className="canvas-grid">
          <div className="canvas">
            <div className="canvas-head" aria-hidden="true">
              <span>line:col</span>
              <span>bytes</span>
              <span>claim</span>
            </div>
            {claims.map((claim) => {
              const active = claim.id === selected?.id
              return (
                <div
                  className="claim-row"
                  key={claim.id}
                  {...(active ? { 'aria-current': 'true' as const } : {})}
                >
                  <span className="claim-gutter">
                    {claim.span.line}:{claim.span.column}
                  </span>
                  <span className="claim-gutter">
                    {claim.span.byteStart}–{claim.span.byteEnd}
                  </span>
                  <div className="claim-body">
                    <p className="claim-quote">
                      <Link className="claim-link" href={`/?${query}&claim=${encodeURIComponent(claim.id)}`}>
                        {claim.quote}
                      </Link>
                    </p>
                    <p className="claim-meta">
                      {claim.kind}/{claim.polarity} · {claim.subject} ·{' '}
                      <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                        <VerdictBadge verdict={claim.verdict} />
                        {claim.verdict === 'supported' ? null : <SeverityBadge severity={claim.severity} />}
                      </span>
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {selected === null || selectedDocument === null ? null : (
            <Inspector
              claim={selected}
              fragment={fragment}
              documentPath={selectedDocument.path}
              query={query}
              siblings={siblings}
            />
          )}
        </div>
      )}
    </>
  )
}
