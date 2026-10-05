import Link from 'next/link'

export default function NotFound() {
  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">404</p>
          <h1>Not found</h1>
        </div>
      </div>
      <div className="state" data-kind="empty">
        <h2>No such route</h2>
        <p>
          This product has four routes: the report, the obligation register, the surfaces list, and health.
          Nothing else exists, so there is nothing to fall back to.
        </p>
        <p>
          <Link href="/">Go to the report →</Link>
        </p>
      </div>
    </section>
  )
}
