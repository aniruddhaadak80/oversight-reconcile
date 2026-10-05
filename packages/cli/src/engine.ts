import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EngineBridge } from '@oversightreconcile/engine-client'
import { UpstreamError } from '@oversightreconcile/core'
import { buildRegistry, loadObligationPack, packPathFor, type Obligation } from '@oversightreconcile/plugins'
import type { ObligationInput } from '@oversightreconcile/memory'
import { ENGINE_MODULE, type ResolvedPaths } from './paths.js'

/** One engine call. The bridge is cheap to build, so nothing is cached across calls. */
export function makeEngine(paths: ResolvedPaths): EngineBridge {
  return new EngineBridge({
    module: ENGINE_MODULE,
    cwd: join(paths.cwd, 'services', 'engine', 'src'),
    timeoutMs: paths.config.engine.timeoutMs,
    python: paths.config.engine.python,
  })
}

export async function callEngine<T>(paths: ResolvedPaths, op: string, input: unknown): Promise<T> {
  return await makeEngine(paths).call<T>({ op, input })
}

export type HealthStatus = 'ok' | 'warn' | 'fail'

export interface EngineHealth {
  readonly status: HealthStatus
  readonly detail: string
  readonly fix?: string
}

/**
 * A real probe: it spawns the engine, because a probe that does not call anything is a
 * guess.
 *
 * "The engine is broken" and "this tree does not ship the engine" are different failures and
 * get different statuses: the first is a `fail` that must stop a pipeline, the second is a
 * `warn` because the binary is still useful outside a source checkout (an installed CLI
 * pointed at a corpus, for instance).
 */
export async function probeEngine(paths: ResolvedPaths): Promise<EngineHealth> {
  const sourceDir = join(paths.cwd, 'services', 'engine', 'src')
  if (!existsSync(join(sourceDir, ENGINE_MODULE))) {
    return {
      status: 'warn',
      detail: `no engine source at ${sourceDir} — this tree does not ship the engine`,
      fix: 'run from a checkout, or set PRODUCT_ENGINE_PYTHON to a working interpreter',
    }
  }
  try {
    const result = await callEngine<{ counts: { total: number } }>(paths, 'parse_claims', {
      text: 'We ensure this probe can reach the engine.',
    })
    const total = result.counts.total
    if (total !== 1) {
      return {
        status: 'fail',
        detail: `engine answered, but parsed ${total} claims from a one-sentence probe`,
        fix: 'run: npm run build && python -m pytest services/engine -q',
      }
    }
    return { status: 'ok', detail: `parse_claims reachable (${ENGINE_MODULE})` }
  } catch (cause) {
    const message = cause instanceof UpstreamError ? cause.message : String(cause)
    return {
      status: 'fail',
      detail: `engine unreachable: ${message}`,
      fix: 'check that `python` is on PATH and services/engine/src is intact',
    }
  }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export interface RegisterLoad {
  readonly obligations: readonly ObligationInput[]
  readonly packs: readonly PackSummary[]
  readonly issues: readonly string[]
  readonly disabled: readonly string[]
}

export interface PackSummary {
  readonly plugin: string
  readonly framework: string
  readonly version: string
  readonly obligations: number
}

/**
 * The obligation register is assembled from the plugins that ship a pack. A framework is a
 * plugin because it is optional, versioned, and owned by someone else — and because a
 * reviewer should be able to diff a framework's obligations in a pull request.
 */
export function loadRegister(paths: ResolvedPaths): RegisterLoad {
  const resolved = buildRegistry(paths.pluginsDir)
  const issues: string[] = []
  const obligations: ObligationInput[] = []
  const packs: PackSummary[] = []

  for (const active of resolved.active) {
    const declared = active.manifest.obligations
    if (declared === undefined) continue
    const pack = loadObligationPack(active.manifest.name, packPathFor(active.path, declared))
    issues.push(...pack.issues)
    if (pack.issues.length > 0) continue
    packs.push({
      plugin: active.manifest.name,
      framework: pack.framework,
      version: pack.version,
      obligations: pack.obligations.length,
    })
    for (const obligation of pack.obligations) {
      obligations.push(toRegisterRow(obligation, `${pack.framework} ${pack.version}`))
    }
  }

  obligations.sort((a, b) => a.id.localeCompare(b.id))
  return {
    obligations,
    packs: [...packs].sort((a, b) => a.plugin.localeCompare(b.plugin)),
    issues,
    disabled: resolved.disabled.map((plugin) => plugin.manifest.name),
  }
}

function toRegisterRow(obligation: Obligation, origin: string): ObligationInput {
  return {
    id: obligation.id,
    code: obligation.code,
    source: obligation.source,
    statement: obligation.statement,
    kind: obligation.kind,
    evidenceRequired: obligation.evidenceRequired,
    evidenceKind: obligation.evidenceKind,
    severity: obligation.severity,
    cues: obligation.cues,
    origin,
  }
}

export interface EvidenceFile {
  readonly evidence: readonly {
    readonly id: string
    readonly obligationId: string
    readonly locator: string
    readonly sha256: string
    readonly kind: string
  }[]
}

/** Evidence is read from a JSON file rather than invented: an artifact must exist first. */
export function loadEvidence(file: string): EvidenceFile['evidence'] {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: expected a JSON array of evidence records`)
  }
  return parsed as EvidenceFile['evidence']
}
