import type { Metadata } from 'next'
import { PageHeader, ErrorState } from '@/components/ui'
import { probeHealth, type HealthStatus } from '@/lib/health'

export const metadata: Metadata = { title: 'Health' }
export const dynamic = 'force-dynamic'

const TONE: Record<HealthStatus, string> = { ok: 'ok', warn: 'warn', fail: 'danger' }

/**
 * The same probe the endpoint uses, rendered. It reads the report artifact, so a page that
 * renders means the deploy carries real data.
 */
export default function HealthPage() {
  const report = probeHealth()

  return (
    <>
      <PageHeader
        eyebrow="diagnostics"
        title="Health"
        lede="Live probe results from the same code that serves /api/health on this deployment."
      />

      {report.ok ? null : (
        <ErrorState title="A required check failed">
          <p>
            The deployment is serving, but at least one check is failing. The failing rows below carry the
            fix.
          </p>
        </ErrorState>
      )}

      {report.checks.length === 0 ? (
        <ErrorState title="No probes ran">
          <p>The probe returned nothing, which is itself the failure.</p>
        </ErrorState>
      ) : (
        <div className="canvas" style={{ marginTop: 'var(--space-5)' }}>
          <div className="canvas-head" aria-hidden="true">
            <span>status</span>
            <span>check</span>
            <span>observation</span>
          </div>
          {report.checks.map((check) => (
            <div className="claim-row" key={check.name}>
              <span className="claim-state">
                <span className="badge" data-tone={TONE[check.status]}>
                  {check.status}
                </span>
              </span>
              <span className="claim-gutter">{check.name}</span>
              <div className="claim-body">
                <p className="claim-quote">{check.detail}</p>
                {check.fix === undefined ? null : <p className="claim-meta">fix: {check.fix}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="claim-meta" style={{ marginTop: 'var(--space-5)' }}>
        Machine-readable at <code>/api/health</code>. A failing probe answers 503.
      </p>
    </>
  )
}
