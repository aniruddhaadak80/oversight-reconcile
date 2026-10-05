'use client'

import { useEffect } from 'react'

/**
 * The error state. It says what failed and what to run, because an error page that only says
 * "something went wrong" costs the reader a deploy log.
 */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // Diagnostics belong on stderr so they show up in the platform log, never in the page.
    console.error(error)
  }, [error])

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">error</p>
          <h1>The report could not be rendered</h1>
        </div>
      </div>

      <div className="state" data-kind="error">
        <h2>{error.name}</h2>
        <p>{error.message}</p>
        <p>
          If this mentions a missing report artifact, the fix is <code>npm run report</code>: the report is a
          committed file, so this page will not invent one.
        </p>
        <p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </p>
      </div>
    </section>
  )
}
