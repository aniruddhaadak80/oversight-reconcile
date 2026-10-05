import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { LATEST_VERSION, OversightStore } from '@oversightreconcile/memory'
import { loadCatalog } from '@oversightreconcile/skills'
import { buildRegistry as buildPluginRegistry } from '@oversightreconcile/plugins'
import { probeEngine } from './engine.js'
import { loadRegister } from './engine.js'
import { resolvePaths, type ResolvedPaths } from './paths.js'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

const pkg = { name: 'oversight-reconcile', version: '0.1.0' }

/**
 * The flagship command. An agent that mutates its own configuration must be able to
 * diagnose itself, and every failing row carries a fix hint rather than only a status.
 *
 * Every row here is an observation, not an assertion: the engine row spawns the engine, the
 * schema row reads `user_version`, and the register row parses every shipped pack.
 */
export async function doctor(cwd = process.cwd()): Promise<DoctorReport> {
  const checks: Check[] = []
  const paths = resolvePaths(cwd)

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(
    nodeMajor >= 22
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          name: 'node',
          status: 'fail',
          detail: `v${process.versions.node} is below the required v22.12.0`,
          fix: 'install Node 22.12 or newer (see .nvmrc)',
        },
  )

  checks.push({ name: 'package', status: 'ok', detail: `${pkg.name}@${pkg.version}` })

  checks.push(await engineRow(paths))
  checks.push(schemaRow(paths))
  checks.push(registerRow(paths))
  checks.push(skillsRow(paths))
  checks.push(pluginsRow(paths))
  checks.push(configRow(cwd, paths))

  return { ok: checks.every((check) => check.status !== 'fail'), checks }
}

function engineRow(paths: ResolvedPaths): Promise<Check> {
  return probeEngine(paths).then((health) => ({
    name: 'engine',
    status: health.status,
    detail: health.detail,
    ...(health.fix === undefined ? {} : { fix: health.fix }),
  }))
}

function schemaRow(paths: ResolvedPaths): Check {
  const store = new OversightStore(paths.database)
  try {
    return store.version === LATEST_VERSION
      ? {
          name: 'schema',
          status: 'ok',
          detail: `sqlite at ${paths.database} on version ${store.version}`,
        }
      : {
          name: 'schema',
          status: 'fail',
          detail: `sqlite is on version ${store.version}, expected ${LATEST_VERSION}`,
          fix: `run any command that opens the store, or apply: ${store.pending.join(', ')}`,
        }
  } finally {
    store.close()
  }
}

function registerRow(paths: ResolvedPaths): Check {
  const register = loadRegister(paths)
  if (register.issues.length > 0) {
    return {
      name: 'register',
      status: 'fail',
      detail: `${register.obligations.length} obligations, ${register.issues.length} pack problem(s)`,
      fix: register.issues[0] ?? 'inspect plugins/*/obligations.json',
    }
  }
  if (register.obligations.length === 0) {
    return {
      name: 'register',
      status: 'warn',
      detail: 'no plugin ships an obligation pack, so nothing governs any claim',
      fix: 'add plugins/<framework>/plugin.json declaring "obligations": "obligations.json"',
    }
  }
  const frameworks = register.packs.map((pack) => `${pack.framework} (${pack.obligations})`).join(', ')
  return {
    name: 'register',
    status: 'ok',
    detail: `${register.obligations.length} obligations from ${frameworks}`,
  }
}

function skillsRow(paths: ResolvedPaths): Check {
  const { skills, issues } = loadCatalog(paths.skillsDir)
  return issues.length === 0
    ? { name: 'skills', status: 'ok', detail: `${skills.length} skills, 0 invalid` }
    : {
        name: 'skills',
        status: 'fail',
        detail: `${skills.length} valid, ${issues.length} invalid`,
        fix: issues[0] ?? 'run npm run check:skill-version',
      }
}

function pluginsRow(paths: ResolvedPaths): Check {
  const plugins = buildPluginRegistry(paths.pluginsDir)
  return plugins.rejected.length === 0
    ? {
        name: 'plugins',
        status: 'ok',
        detail: `${plugins.active.length} active, ${plugins.disabled.length} disabled`,
      }
    : {
        name: 'plugins',
        status: 'warn',
        detail: `${plugins.rejected.length} rejected`,
        fix: plugins.rejected[0]?.issues[0] ?? 'inspect plugins/*/plugin.json',
      }
}

function configRow(cwd: string, paths: ResolvedPaths): Check {
  const configPath = join(cwd, 'product.config.json')
  return existsSync(configPath)
    ? {
        name: 'config',
        status: 'ok',
        detail: `${configPath} (dataDir ${paths.config.dataDir})`,
      }
    : {
        name: 'config',
        status: 'warn',
        detail: `no product.config.json — defaults (dataDir ${paths.config.dataDir})`,
        fix: 'copy product.config.json.example to product.config.json',
      }
}

export function renderReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.name.length), 5)
  const icon = (status: Status): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const lines = report.checks.map((check) => {
    const head = `  [${icon(check.status)}] ${check.name.padEnd(width)}  ${check.detail}`
    return check.fix === undefined ? head : `${head}\n         fix: ${check.fix}`
  })
  return [
    `${pkg.name} doctor`,
    ...lines,
    '',
    report.ok ? 'all required checks passed' : 'one or more checks failed',
  ].join('\n')
}
