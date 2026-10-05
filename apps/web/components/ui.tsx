import type { ReactNode } from 'react'
import Link from 'next/link'
import { VERDICT_TONE } from '@/lib/oversight'

export function VerdictBadge({ verdict }: { verdict: string }) {
  return (
    <span className="badge" data-tone={VERDICT_TONE[verdict] ?? 'info'}>
      {verdict}
    </span>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === 'blocker' ? 'danger' : severity === 'major' ? 'warn' : 'info'
  return (
    <span className="badge" data-tone={tone}>
      {severity}
    </span>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="state" data-kind="empty">
      <h2>{title}</h2>
      {children}
      {action === undefined ? null : <p>{action}</p>}
    </div>
  )
}

export function ErrorState({
  title,
  children,
  action,
}: {
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="state" data-kind="error">
      <h2>{title}</h2>
      {children}
      {action === undefined ? null : <p>{action}</p>}
    </div>
  )
}

export function Tile({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="tile" {...(tone === undefined ? {} : { 'data-tone': tone })}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow: string
  title: string
  lede: string
  aside?: ReactNode
}) {
  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        {aside === undefined ? null : aside}
      </div>
      <p className="lede">{lede}</p>
    </>
  )
}

export function Digest({ label, value }: { label: string; value: string }) {
  return (
    <span className="mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-subtle)' }}>
      {label} {value}
    </span>
  )
}

export function BackToReport() {
  return (
    <Link href="/" className="badge">
      ← back to the report
    </Link>
  )
}
