import { PRODUCT, resolveVersion } from './product'
import { loadReport, ReportMissing } from './oversight'

export type HealthStatus = 'ok' | 'warn' | 'fail'

export interface HealthCheck {
  readonly name: string
  readonly status: HealthStatus
  readonly detail: string
  readonly fix?: string
}

export interface HealthReport {
  readonly ok: boolean
  readonly checks: readonly HealthCheck[]
}

/**
 * The one probe, shared by `/api/health` and `/health` so the page can never show a
 * different answer from the endpoint.
 *
 * Every row is an observation. A probe that reports a check it did not run is worse than no
 * probe at all, so there is no row here for anything this code cannot actually see.
 */
export function probeHealth(): HealthReport {
  const checks: HealthCheck[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')
  checks.push(
    nodeMajor >= 22
      ? { name: 'runtime', status: 'ok', detail: `node ${process.versions.node}` }
      : {
          name: 'runtime',
          status: 'fail',
          detail: `node ${process.versions.node} is below the required v22.12.0`,
          fix: 'target Node 22 in the deployment runtime',
        },
  )

  checks.push({ name: 'package', status: 'ok', detail: `${PRODUCT.slug}@${resolveVersion()}` })

  try {
    const report = loadReport()
    checks.push({
      name: 'report',
      status: 'ok',
      detail:
        `${report.counts.claims} claims, ${report.counts.obligations} obligations, ` +
        `${report.counts.blocking} blocking finding(s)`,
    })
    checks.push({
      name: 'report-digest',
      status: 'ok',
      detail: `tree ${report.treeDigest.slice(0, 12)} / report ${report.reportDigest.slice(0, 12)}`,
    })
  } catch (cause) {
    checks.push({
      name: 'report',
      status: 'warn',
      detail: cause instanceof ReportMissing ? 'no report artifact published' : String(cause),
      fix: 'run: npm run report',
    })
  }

  checks.push({ name: 'region', status: 'ok', detail: process.env.VERCEL_REGION ?? 'local' })

  const telemetry = process.env.TELEMETRY_ENABLED === 'true'
  checks.push({
    name: 'telemetry',
    status: 'warn',
    detail: telemetry ? 'enabled' : 'disabled (default)',
    ...(telemetry ? {} : { fix: 'set TELEMETRY_ENABLED=true to enable' }),
  })

  return { ok: checks.every((check) => check.status !== 'fail'), checks }
}

export function healthBody(): Record<string, unknown> {
  const report = probeHealth()
  return {
    ok: report.ok,
    name: PRODUCT.slug,
    version: resolveVersion(),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    runtime: process.versions.node,
    region: process.env.VERCEL_REGION ?? 'local',
    checks: report.checks,
  }
}
