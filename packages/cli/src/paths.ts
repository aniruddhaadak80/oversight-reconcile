import { mkdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { loadConfig, type Config } from '@oversightreconcile/config'

/** The Python module that owns the deterministic core. One value, named once. */
export const ENGINE_MODULE = 'oversight_reconcile'

export const DB_FILENAME = 'oversight.db'

export interface ResolvedPaths {
  readonly cwd: string
  readonly dataDir: string
  readonly database: string
  readonly pluginsDir: string
  readonly skillsDir: string
  readonly config: Config
}

/**
 * Every path the CLI touches is resolved here, once. A command never guesses a path for
 * itself, which is what keeps `oversight-reconcile reconcile` from reading a different
 * corpus than `oversight-reconcile inspect` did.
 */
export function resolvePaths(cwd = process.cwd()): ResolvedPaths {
  const config = loadConfig({ path: join(cwd, 'product.config.json'), env: process.env })
  const dataDir = isAbsolute(config.dataDir) ? config.dataDir : resolve(cwd, config.dataDir)
  mkdirSync(dataDir, { recursive: true })
  return {
    cwd,
    dataDir,
    database: join(dataDir, DB_FILENAME),
    pluginsDir: join(cwd, 'plugins'),
    skillsDir: join(cwd, 'skills'),
    config,
  }
}
