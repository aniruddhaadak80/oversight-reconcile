import { ToolRegistry, type ToolContext } from '@oversightreconcile/core'
import { registerProductTools } from './tools.js'
import { resolvePaths, type ResolvedPaths } from './paths.js'

/**
 * Builds the one registry every surface shares.
 *
 * There is exactly one place a capability is declared, so `oversight-reconcile tools`,
 * `mcp serve` and `/api/tools` cannot disagree about what this product can do.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  return registerProductTools(new ToolRegistry(), resolvePaths(cwd))
}

export function pathsFor(cwd = process.cwd()): ResolvedPaths {
  return resolvePaths(cwd)
}

/** A minimal, dependency-free logger for the tool context. Diagnostics go to stderr. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: resolvePaths().dataDir,
  }
}
