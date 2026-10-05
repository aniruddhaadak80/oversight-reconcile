import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/**
 * An obligation pack: the machine-checkable half of a governance framework.
 *
 * A pack is deliberately data, not code. A reviewer can read every obligation, its
 * severity, and how many artifacts it demands without running anything, and a pack can be
 * diffed in a pull request like any other artifact. The plugin that carries it gets no
 * privileged path — it declares a capability and points at this file.
 */
export const ObligationSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  code: z.string().min(1),
  source: z.string().min(1),
  statement: z.string().min(8),
  kind: z.string().min(1),
  evidenceRequired: z.number().int().min(0).max(10),
  evidenceKind: z.enum(['document', 'run', 'manual']).default('document'),
  severity: z.enum(['blocker', 'major', 'minor']),
  cues: z.array(z.string().min(1)).default([]),
})

export const ObligationPackSchema = z.object({
  framework: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(10),
  obligations: z.array(ObligationSchema).min(1),
})

export type Obligation = z.infer<typeof ObligationSchema>
export type ObligationPack = z.infer<typeof ObligationPackSchema>

export interface LoadedPack {
  readonly plugin: string
  readonly framework: string
  readonly version: string
  readonly path: string
  readonly obligations: readonly Obligation[]
  readonly issues: readonly string[]
}

const EMPTY: readonly Obligation[] = []

/** Reads one pack and reports every problem rather than throwing on the first one. */
export function loadObligationPack(plugin: string, file: string): LoadedPack {
  const unresolved = {
    plugin,
    framework: '',
    version: '',
    path: file,
    obligations: EMPTY,
    issues: [] as string[],
  }

  if (!existsSync(file)) {
    return { ...unresolved, issues: [`${plugin}: obligations file not found at ${file}`] }
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (cause) {
    return { ...unresolved, issues: [`${plugin}: ${file} is not valid JSON — ${String(cause)}`] }
  }

  const parsed = ObligationPackSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ...unresolved,
      issues: parsed.error.issues.map(
        (issue) => `${plugin}: ${file}: ${issue.path.join('.') || '(root)'} — ${issue.message}`,
      ),
    }
  }

  const pack = parsed.data
  const seen = new Set<string>()
  const issues: string[] = []
  for (const obligation of pack.obligations) {
    if (seen.has(obligation.id)) {
      issues.push(`${plugin}: duplicate obligation id "${obligation.id}" in ${pack.framework}`)
    }
    seen.add(obligation.id)
  }
  if (issues.length > 0) return { ...unresolved, issues }

  return {
    plugin,
    framework: pack.framework,
    version: pack.version,
    path: file,
    obligations: pack.obligations.map((obligation) => ({ ...obligation })),
    issues: [],
  }
}

/** Resolves the pack path declared by a plugin manifest, relative to its own directory. */
export function packPathFor(manifestPath: string, declared: string): string {
  return join(dirname(manifestPath), declared)
}
