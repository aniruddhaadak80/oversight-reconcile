import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ValidationError, type Tool, type ToolRegistry } from '@oversightreconcile/core'
import { loadCatalog } from '@oversightreconcile/skills'
import { buildRegistry as buildPluginRegistry } from '@oversightreconcile/plugins'
import { OversightStore } from '@oversightreconcile/memory'
import { callEngine, loadRegister, sha256 } from './engine.js'
import { resolvePaths, type ResolvedPaths } from './paths.js'

export interface ParseOutput {
  lexiconVersion: string
  claims: ClaimView[]
  sections: string[]
  diagnostics: { code: string; message: string; line: number }[]
  truncated: boolean
  maxDepthReached: number
  counts: Record<string, unknown>
  digest: string
}

export interface ClaimView {
  id: string
  parentId: string | null
  depth: number
  section: string
  kind: string
  polarity: string
  subject: string
  quote: string
  span: { byteStart: number; byteEnd: number; line: number; column: number }
  cues: string[]
}

export interface VerdictView {
  claimId: string | null
  obligationId: string | null
  verdict: string
  severity: string
  reasons: { code: string; detail: string }[]
}

export interface ReconcileOutput {
  rulesVersion: string
  verdicts: VerdictView[]
  counts: Record<string, unknown>
  unmatchedObligationIds: string[]
  digest: string
}

function requireString(input: unknown, field: string): string {
  const value = (input as Record<string, unknown> | null)?.[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`"${field}" must be a non-empty string`, { field })
  }
  return value
}

function requireArray(input: unknown, field: string): readonly unknown[] {
  const value = (input as Record<string, unknown> | null)?.[field]
  if (!Array.isArray(value)) {
    throw new ValidationError(`"${field}" must be an array`, { field })
  }
  return value
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(input: unknown, field: string): string | undefined {
  const value = (input as Record<string, unknown> | null)?.[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function optionalInt(input: unknown, field: string, fallback: number): number {
  const value = (input as Record<string, unknown> | null)?.[field]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
}

const STRING_ARRAY = { type: 'array', items: { type: 'string' } }
const OBJECT = { type: 'object' }

/**
 * Every tool this product exposes, in one place, reachable from the CLI, the MCP server and
 * anything else that speaks to the registry. Names match `^[a-z][a-z0-9_]*$` so they are
 * directly exposable over MCP without a mapping layer.
 *
 * The first two are the deterministic core and declare `proc:spawn` because reaching them
 * means spawning the Python engine. Nothing here reaches the network.
 */
export function productTools(paths: ResolvedPaths): readonly Tool<never, unknown>[] {
  const openStore = (): OversightStore => new OversightStore(paths.database)

  const parseClaims: Tool<{ text: string; limits?: object }, ParseOutput> = {
    name: 'parse_claims',
    description:
      'Parse AI governance prose into a claim tree where every claim carries a byte-exact span (byteStart, byteEnd, line, column) into the source. Use this before anything else about a policy document: it is the only step that can cite the exact bytes a claim came from. Returns claims, section paths, diagnostics, a tree digest, and the lexicon version used.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The document text to parse. Any UTF-8, up to 1 MiB.',
        },
        limits: {
          type: 'object',
          description: 'Optional bounds. Omitted means the defaults (512 claims, depth 6).',
          properties: { maxClaims: { type: 'number' }, maxDepth: { type: 'number' } },
          additionalProperties: false,
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        lexiconVersion: { type: 'string' },
        claims: { type: 'array', items: OBJECT },
        sections: STRING_ARRAY,
        diagnostics: { type: 'array', items: OBJECT },
        truncated: { type: 'boolean' },
        maxDepthReached: { type: 'number' },
        counts: OBJECT,
        digest: { type: 'string' },
      },
      required: ['lexiconVersion', 'claims', 'sections', 'diagnostics', 'digest'],
    },
    permissions: ['proc:spawn'],
    surface: 'core',
    handler: async (input) => {
      requireString(input, 'text')
      const limits = (input as { limits?: unknown }).limits
      if (limits !== undefined && !isPlainObject(limits)) {
        throw new ValidationError('"limits" must be an object when present', { field: 'limits' })
      }
      return await callEngine<ParseOutput>(paths, 'parse_claims', input)
    },
  }

  const reconcileOversight: Tool<
    { claims: ClaimView[]; obligations: object[]; evidence: object[] },
    ReconcileOutput
  > = {
    name: 'reconcile_oversight',
    description:
      'Reconcile a claim tree against an obligation register and return one verdict per claim and per obligation: supported, unevidenced, contradicted, unbacked, or unmet â€” each with a reason code. Use this to decide whether a published policy is actually evidenced. Deterministic and order-independent: permuting the input does not change the output.',
    inputSchema: {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          description: 'Claims, normally straight from parse_claims.',
          items: OBJECT,
        },
        obligations: {
          type: 'array',
          description:
            'Obligations. Each needs id, statement, kind, evidenceRequired and severity; code, source, evidenceKind and an explicit cues list are optional.',
          items: OBJECT,
        },
        evidence: {
          type: 'array',
          description: 'Evidence records: id, obligationId, locator, sha256, kind.',
          items: OBJECT,
        },
      },
      required: ['claims', 'obligations', 'evidence'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        rulesVersion: { type: 'string' },
        verdicts: { type: 'array', items: OBJECT },
        counts: OBJECT,
        unmatchedObligationIds: STRING_ARRAY,
        digest: { type: 'string' },
      },
      required: ['rulesVersion', 'verdicts', 'counts', 'digest'],
    },
    permissions: ['proc:spawn'],
    surface: 'core',
    handler: async (input) => {
      requireArray(input, 'claims')
      requireArray(input, 'obligations')
      requireArray(input, 'evidence')
      return await callEngine<ReconcileOutput>(paths, 'reconcile', input)
    },
  }

  const ingestDocument: Tool<
    { path: string; text?: string; documentId?: string },
    Record<string, unknown>
  > = {
    name: 'ingest_document',
    description:
      'Read a governance document from disk, parse it into a claim tree, and persist the document plus its claims. Re-ingesting a changed file replaces its claims, because a stale span points into bytes that no longer exist. Returns the document id, sha256, claim count, tree digest and any diagnostics.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the document, absolute or relative to cwd.' },
        text: {
          type: 'string',
          description:
            'Provide the text directly instead of reading the path. Use for a document not on disk.',
        },
        documentId: {
          type: 'string',
          description: 'Stable id for the document. Defaults to the path with separators replaced.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read', 'fs:write', 'proc:spawn'],
    surface: 'core',
    handler: async (input) => {
      const path = requireString(input, 'path')
      const text = input.text ?? readFileSync(join(paths.cwd, path), 'utf8')
      const documentId = input.documentId ?? documentIdFor(path)
      const tree = await callEngine<ParseOutput>(paths, 'parse_claims', { text })
      const store = openStore()
      try {
        store.putDocument({ id: documentId, path, sha256: sha256(text), body: text, now: Date.now() })
        store.putClaims(documentId, tree.digest, tree.claims)
        return {
          documentId,
          path,
          sha256: sha256(text),
          bytes: Buffer.byteLength(text, 'utf8'),
          claims: tree.claims.length,
          sections: tree.sections.length,
          maxDepthReached: tree.maxDepthReached,
          truncated: tree.truncated,
          diagnostics: tree.diagnostics,
          treeDigest: tree.digest,
          lexiconVersion: tree.lexiconVersion,
        }
      } finally {
        store.close()
      }
    },
  }

  const listDocuments: Tool<Record<string, never>, Record<string, unknown>> = {
    name: 'list_documents',
    description:
      'List every governance document in the oversight store with its id, path, sha256, byte size and line count. Use this to find a documentId for ingest-free inspection, or to see what has been ingested at all.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async () => {
      const store = openStore()
      try {
        const documents = store.listDocuments()
        return {
          count: documents.length,
          documents: documents.map((row) => ({
            id: row.id,
            path: row.path,
            sha256: row.sha256,
            bytes: row.byte_size,
            lines: row.line_count,
            ingestedAt: row.ingested_at,
          })),
        }
      } finally {
        store.close()
      }
    },
  }

  const listClaims: Tool<{ documentId?: string; limit?: number }, Record<string, unknown>> = {
    name: 'list_claims',
    description:
      'List stored claims with their byte spans, section path and cues, optionally narrowed to one document. Use this to answer "what does the store already know" without re-parsing, and to cite a claim by its id.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Narrow to one document.' },
        limit: { type: 'number', description: 'Maximum claims to return. Default 500.' },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input) => {
      const store = openStore()
      try {
        const documentId = optionalString(input, 'documentId')
        const rows = store.listClaims(documentId, optionalInt(input, 'limit', 500))
        return {
          count: rows.length,
          documentId: documentId ?? null,
          claims: rows.map((row) => ({
            id: row.id,
            documentId: row.document_id,
            parentId: row.parent_id,
            depth: row.depth,
            section: row.section,
            kind: row.kind,
            polarity: row.polarity,
            subject: row.subject,
            quote: row.quote,
            span: {
              byteStart: row.byte_start,
              byteEnd: row.byte_end,
              line: row.line,
              column: row.col,
            },
            cues: JSON.parse(row.cues) as string[],
            treeDigest: row.tree_digest,
          })),
        }
      } finally {
        store.close()
      }
    },
  }

  const listObligations: Tool<{ framework?: string }, Record<string, unknown>> = {
    name: 'list_obligations',
    description:
      'List the obligation register assembled from every active plugin that ships an obligation pack, plus which packs loaded and which were skipped. Use this to see what a claim tree will be measured against before reconciling.',
    inputSchema: {
      type: 'object',
      properties: {
        framework: { type: 'string', description: 'Narrow to one framework, e.g. "EU AI Act".' },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input) => {
      const register = loadRegister(paths)
      const framework = optionalString(input, 'framework')
      const rows =
        framework === undefined
          ? register.obligations
          : register.obligations.filter((row) => row.source === framework)
      return {
        count: rows.length,
        packs: register.packs,
        disabled: register.disabled,
        issues: register.issues,
        obligations: rows,
      }
    },
  }

  const listRuns: Tool<{ limit?: number }, Record<string, unknown>> = {
    name: 'list_runs',
    description:
      "List recorded reconciliation runs newest first, with each run's tree digest, report digest, verdict counts and blocking-finding count. Use this to find two run ids to compare, or to see whether the posture has changed.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Maximum runs. Default 20.' } },
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input) => {
      const store = openStore()
      try {
        const rows = store.listRuns(optionalInt(input, 'limit', 20))
        return {
          count: rows.length,
          runs: rows.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            engine: row.engine,
            lexicon: row.lexicon,
            rules: row.rules,
            treeDigest: row.tree_digest,
            reportDigest: row.report_digest,
            blocking: row.blocking,
            verdicts: JSON.parse(row.verdict_counts) as Record<string, number>,
          })),
        }
      } finally {
        store.close()
      }
    },
  }

  const compareRuns: Tool<{ beforeId: string; afterId: string }, Record<string, unknown>> = {
    name: 'compare_runs',
    description:
      'Compare two recorded reconciliation runs and report per-verdict deltas and whether the underlying claim tree changed. Use this to answer "what changed since last week" without re-reading the documents.',
    inputSchema: {
      type: 'object',
      properties: {
        beforeId: { type: 'string', description: 'The earlier run id.' },
        afterId: { type: 'string', description: 'The later run id.' },
      },
      required: ['beforeId', 'afterId'],
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read', 'proc:spawn'],
    surface: 'core',
    handler: async (input) => {
      const beforeId = requireString(input, 'beforeId')
      const afterId = requireString(input, 'afterId')
      const store = openStore()
      try {
        const before = store.getRun(beforeId)
        const after = store.getRun(afterId)
        if (before === undefined || after === undefined) {
          throw new ValidationError(`run not found: ${[beforeId, afterId].join(', ')}`, {
            beforeId,
            afterId,
          })
        }
        return await callEngine<Record<string, unknown>>(paths, 'diff', {
          before: [toRunRecord(before)],
          after: [toRunRecord(after)],
        })
      } finally {
        store.close()
      }
    },
  }

  const listSkills: Tool<{ includeBodies?: boolean }, Record<string, unknown>> = {
    name: 'list_skills',
    description:
      'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
    inputSchema: {
      type: 'object',
      properties: { includeBodies: { type: 'boolean', description: 'Include each skill body.' } },
      additionalProperties: false,
    },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async (input) => {
      const { skills, issues } = loadCatalog(paths.skillsDir)
      return {
        count: skills.length,
        issues: [...issues],
        skills: skills.map((skill) => ({
          name: skill.name,
          version: skill.version,
          description: skill.description,
          ...(input.includeBodies === true ? { body: skill.body } : {}),
        })),
      }
    },
  }

  const listPlugins: Tool<Record<string, never>, Record<string, unknown>> = {
    name: 'list_plugins',
    description:
      'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected framework or capability is missing.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: OBJECT,
    permissions: ['fs:read'],
    surface: 'core',
    handler: async () => {
      const result = buildPluginRegistry(paths.pluginsDir)
      return {
        active: result.active.map((plugin) => ({
          name: plugin.manifest.name,
          version: plugin.manifest.version,
          capabilities: plugin.manifest.capabilities,
          obligations: plugin.manifest.obligations ?? null,
          shadowed: plugin.shadowed,
        })),
        disabled: result.disabled.map((plugin) => plugin.manifest.name),
        rejected: result.rejected.map((plugin) => ({ path: plugin.path, issues: plugin.issues })),
      }
    },
  }

  return [
    parseClaims,
    reconcileOversight,
    ingestDocument,
    listDocuments,
    listClaims,
    listObligations,
    listRuns,
    compareRuns,
    listSkills,
    listPlugins,
  ] as unknown as readonly Tool<never, unknown>[]
}

/** A stable id for a document path, so re-ingesting the same file is the same document. */
export function documentIdFor(path: string): string {
  const normalised = path.replace(/\\/g, '/').replace(/^\.\//, '')
  const digest = createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 10)
  const stem = normalised
    .replace(/^.*\//, '')
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return stem === '' ? `doc-${digest}` : `${stem}-${digest}`
}

function toRunRecord(row: {
  id: string
  created_at: number
  tree_digest: string
  report_digest: string
  verdict_counts: string
  blocking: number
}): Record<string, unknown> {
  return {
    id: row.id,
    createdAt: row.created_at,
    treeDigest: row.tree_digest,
    reportDigest: row.report_digest,
    blocking: row.blocking,
    verdicts: JSON.parse(row.verdict_counts) as Record<string, number>,
  }
}

export function registerProductTools(registry: ToolRegistry, paths = resolvePaths()): ToolRegistry {
  registry.registerAll(productTools(paths), { source: 'core' })
  return registry
}
