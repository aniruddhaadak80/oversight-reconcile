import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader, EmptyState, SeverityBadge } from '@/components/ui'
import { loadReport, totals, VERDICT_TONE, ReportMissing } from '@/lib/oversight'

export const metadata: Metadata = { title: 'Obligation register' }
export const dynamic = 'force-static'

/**
 * The register: every obligation, and whether the published documents actually address it.
 *
 * The `unmet` rows are the point of the page. A framework list that reads as a checklist of
 * things you have done is worse than useless; what a reviewer needs is the list of duties
 * nothing in your documentation speaks to.
 */
export default function RegisterPage() {
  let report: ReturnType<typeof loadReport>
  try {
    report = loadReport()
  } catch (cause) {
    if (cause instanceof ReportMissing) {
      return (
        <EmptyState title="No register is published yet" action={<code>npm run report</code>}>
          <p>{cause.message}</p>
        </EmptyState>
      )
    }
    throw cause
  }

  const unmetById = new Map(
    report.verdicts
      .filter((verdict) => verdict.verdict === 'unmet' && verdict.obligationId !== null)
      .map((verdict) => [verdict.obligationId as string, verdict]),
  )

  const summary = totals(report)
  const unmetCount = unmetById.size

  return (
    <>
      <PageHeader
        eyebrow={`register · ${report.frameworks.map((f) => f.framework).join(' + ')}`}
        title="The obligation register"
        lede={`${report.counts.obligations} obligations from ${report.frameworks.length} framework pack(s). ${unmetCount} of them are addressed by nothing in the published documents.`}
        aside={
          <Link href="/" className="badge">
            ← back to the report
          </Link>
        }
      />

      <div className="section-head">
        <h2>Frameworks</h2>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          shipped as plugins, so a framework is data you can diff
        </span>
      </div>
      <dl className="tiles">
        {report.frameworks.map((framework) => (
          <div className="tile" key={framework.plugin}>
            <dt>{framework.plugin}</dt>
            <dd style={{ fontSize: 'var(--text-lg)' }}>
              {framework.framework} {framework.version}
            </dd>
            <dd className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
              {framework.obligations} obligations
            </dd>
          </div>
        ))}
      </dl>

      <div className="section-head" style={{ marginTop: 'var(--space-6)' }}>
        <h2>Obligations</h2>
        <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
          {report.counts.obligations - unmetCount} addressed · {unmetCount} unmet
        </span>
      </div>

      {report.obligations.length === 0 ? (
        <EmptyState title="No obligations loaded" action={<code>ls plugins</code>}>
          <p>
            Nothing shipped an obligation pack, so every claim would be unbacked. That would make the report
            lie rather than fail.
          </p>
        </EmptyState>
      ) : (
        <div className="canvas">
          <div className="canvas-head" aria-hidden="true">
            <span>status</span>
            <span>code</span>
            <span>obligation</span>
          </div>
          {report.obligations.map((obligation) => {
            const unmet = unmetById.get(obligation.id)
            return (
              <div className="claim-row" key={obligation.id}>
                <span className="claim-state">
                  <span className="badge" data-tone={unmet === undefined ? 'ok' : VERDICT_TONE['unmet']}>
                    {unmet === undefined ? 'addressed' : 'unmet'}
                  </span>
                  <SeverityBadge severity={obligation.severity} />
                </span>
                <span className="claim-gutter">{obligation.code}</span>
                <div className="claim-body">
                  <p className="claim-quote">{obligation.statement}</p>
                  <p className="claim-meta">
                    {obligation.source} · kind {obligation.kind} · needs {obligation.evidenceRequired}{' '}
                    {obligation.evidenceKind} artifact(s)
                    {obligation.cues.length === 0
                      ? ' · cues implied by kind'
                      : ` · pins ${obligation.cues.join(', ')}`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="claim-meta" style={{ marginTop: 'var(--space-5)' }}>
        {summary.total} verdicts over {report.counts.claims} claims. Report digest{' '}
        {report.reportDigest.slice(0, 12)}.
      </p>
    </>
  )
}
