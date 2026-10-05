import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader, EmptyState } from '@/components/ui'
import { SURFACES } from '@/lib/product'

export const metadata: Metadata = { title: 'Surfaces' }
export const dynamic = 'force-static'

/**
 * What ships and what does not. Omission is a decision, so each one carries its reason
 * rather than being quietly absent.
 */
export default function SurfacesPage() {
  const shipped = SURFACES.filter((surface) => surface.status === 'shipped')
  const omitted = SURFACES.filter((surface) => surface.status === 'omitted')

  return (
    <>
      <PageHeader
        eyebrow="capability"
        title="Surfaces"
        lede="Every capability in this product is a tool in one registry, reachable identically from the CLI, this web report, and the MCP server. A surface is a transport, never a second implementation."
      />

      {SURFACES.length === 0 ? (
        <EmptyState title="No surfaces registered">
          <p>This is a bug in the product manifest, not a state the product can be in.</p>
        </EmptyState>
      ) : (
        <>
          <div className="section-head" style={{ marginTop: 'var(--space-5)' }}>
            <h2>Ships</h2>
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
              {shipped.length} surface(s)
            </span>
          </div>
          <div className="canvas">
            {shipped.map((surface) => (
              <div className="claim-row" key={surface.id}>
                <span className="claim-state">
                  <span className="badge" data-tone="ok">
                    shipped
                  </span>
                </span>
                <span className="claim-gutter">{surface.id}</span>
                <div className="claim-body">
                  <p className="claim-quote">{surface.title}</p>
                  <p className="claim-meta">{surface.summary}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="section-head" style={{ marginTop: 'var(--space-6)' }}>
            <h2>Deliberately omitted</h2>
            <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
              {omitted.length} surface(s)
            </span>
          </div>
          <div className="canvas">
            {omitted.map((surface) => (
              <div className="claim-row" key={surface.id}>
                <span className="claim-state">
                  <span className="badge" data-tone="warn">
                    omitted
                  </span>
                </span>
                <span className="claim-gutter">{surface.id}</span>
                <div className="claim-body">
                  <p className="claim-quote">{surface.title}</p>
                  <p className="claim-meta">{surface.note ?? surface.summary}</p>
                </div>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 'var(--space-5)' }}>
            <Link href="/">← back to the report</Link>
          </p>
        </>
      )}
    </>
  )
}
