import type { Permission } from './types.js'

/** Ordered least- to most-privileged. Index is the escalation rank. */
export const PERMISSION_RANK: readonly Permission[] = [
  'fs:read',
  'net:fetch',
  'env:read',
  'fs:write',
  'proc:spawn',
  'secrets:read',
] as const

export function rank(permission: Permission): number {
  const index = PERMISSION_RANK.indexOf(permission)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * The product runs sandboxed by default. A tool may only use permissions the caller
 * granted; anything beyond that is refused before the handler runs, not caught after.
 *
 * An EMPTY grant list is a sandbox with nothing in it, not "grant everything up to the
 * lowest rank". `fs:read` is rank 0, so treating an empty ceiling as 0 would silently
 * hand out the one permission that has no rank below it.
 */
export function isSatisfied(required: readonly Permission[], granted: readonly Permission[]): boolean {
  if (granted.length === 0) return required.length === 0
  const ceiling = Math.max(...granted.map(rank))
  return required.every((p) => rank(p) <= ceiling)
}

export function describePermissions(permissions: readonly Permission[]): string {
  return permissions.length === 0 ? 'none' : [...permissions].sort((a, b) => rank(a) - rank(b)).join(', ')
}
