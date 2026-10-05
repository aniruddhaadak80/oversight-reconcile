/**
 * The loading state. It mirrors the real layout — tiles, bars, then the canvas — so the
 * transition into content does not reflow the page. Nothing here is a spinner, because a
 * spinner hides whether the page will ever have data.
 */
export default function Loading() {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="section-head">
        <div>
          <p className="eyebrow">loading</p>
          <h1>Claim tree reconciled</h1>
        </div>
      </div>

      <dl className="tiles">
        {[0, 1, 2, 3, 4].map((index) => (
          <div className="tile" key={index}>
            <dt className="skeleton" style={{ width: '4rem' }} />
            <dd>
              <span className="skeleton" style={{ display: 'block', width: '2.5rem', height: '1.75rem' }} />
            </dd>
          </div>
        ))}
      </dl>

      <div className="bars">
        {[0, 1, 2, 3].map((index) => (
          <div className="bar-row" key={index}>
            <dt className="skeleton" style={{ width: '6rem' }} />
            <dd className="skeleton" />
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${30 + index * 15}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="canvas" style={{ marginTop: 'var(--space-6)' }}>
        <div className="canvas-head" aria-hidden="true">
          <span>line:col</span>
          <span>bytes</span>
          <span>claim</span>
        </div>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div className="claim-row" key={index}>
            <span className="claim-gutter skeleton" style={{ width: '4rem' }} />
            <span className="claim-gutter skeleton" style={{ width: '4rem' }} />
            <div className="claim-body">
              <span className="skeleton" style={{ display: 'block', width: `${60 + index * 5}%` }} />
              <span
                className="skeleton"
                style={{ display: 'block', width: '5rem', marginTop: 'var(--space-2)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
