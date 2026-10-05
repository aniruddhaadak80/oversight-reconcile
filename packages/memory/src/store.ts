import Database from 'better-sqlite3'
import { MIGRATIONS, LATEST_VERSION, pendingMigrations } from './migrations.js'

/** A claim exactly as the engine produced it. Spans are UTF-8 byte offsets. */
export interface ClaimInput {
  readonly id: string
  readonly parentId: string | null
  readonly depth: number
  readonly section: string
  readonly kind: string
  readonly polarity: string
  readonly subject: string
  readonly quote: string
  readonly span: {
    readonly byteStart: number
    readonly byteEnd: number
    readonly line: number
    readonly column: number
  }
  readonly cues: readonly string[]
}

export interface ObligationInput {
  readonly id: string
  readonly code: string
  readonly source: string
  readonly statement: string
  readonly kind: string
  readonly evidenceRequired: number
  readonly evidenceKind: string
  readonly severity: string
  readonly cues?: readonly string[]
  readonly origin?: string
}

export interface EvidenceInput {
  readonly id: string
  readonly obligationId: string
  readonly locator: string
  readonly sha256: string
  readonly kind: string
}

export interface VerdictInput {
  readonly claimId: string | null
  readonly obligationId: string | null
  readonly verdict: string
  readonly severity: string
  readonly reasons: readonly { readonly code: string; readonly detail: string }[]
}

export interface RunInput {
  readonly id: string
  readonly createdAt: number
  readonly engine: string
  readonly lexicon: string
  readonly rules: string
  readonly treeDigest: string
  readonly reportDigest: string
  readonly verdictCounts: Readonly<Record<string, number>>
  readonly blocking: number
}

export interface DocumentRow {
  id: string
  path: string
  sha256: string
  byte_size: number
  line_count: number
  body: string
  ingested_at: number
}

export interface ClaimRow {
  id: string
  document_id: string
  parent_id: string | null
  depth: number
  section: string
  kind: string
  polarity: string
  subject: string
  quote: string
  byte_start: number
  byte_end: number
  line: number
  col: number
  cues: string
  tree_digest: string
}

export interface ObligationRow {
  id: string
  code: string
  source: string
  statement: string
  kind: string
  evidence_required: number
  evidence_kind: string
  severity: string
  cues: string
  origin: string
}

export interface ReconciliationRow {
  run_id: string
  claim_id: string | null
  obligation_id: string | null
  verdict: string
  severity: string
  reason_code: string
  reason_detail: string
}

export interface RunRow {
  id: string
  created_at: number
  engine: string
  lexicon: string
  rules: string
  tree_digest: string
  report_digest: string
  verdict_counts: string
  blocking: number
}

/**
 * The store. Every write goes through `transaction()` — no ad-hoc `db.exec` outside it —
 * which is what makes concurrent writers safe and a failed write leave no partial state.
 *
 * Provenance is why the document body is stored rather than a path to it: a claim is only
 * citable while the bytes it cites are still on hand, so an oversight artifact outlives the
 * working copy it was produced from.
 */
export class OversightStore {
  readonly #db: Database.Database

  constructor(path = ':memory:') {
    this.#db = new Database(path)
    this.#db.pragma('journal_mode = WAL')
    this.#db.pragma('foreign_keys = ON')
    this.migrate()
  }

  get version(): number {
    return (this.#db.pragma('user_version', { simple: true }) as number) ?? 0
  }

  get isPending(): boolean {
    return pendingMigrations(this.version).length > 0
  }

  get pending(): readonly string[] {
    return pendingMigrations(this.version).map((m) => `${m.version}-${m.name}`)
  }

  migrate(): number {
    for (const migration of pendingMigrations(this.version)) {
      this.transaction(() => {
        for (const statement of migration.up) this.#db.exec(statement)
        this.#db.pragma(`user_version = ${migration.version}`)
      })
    }
    return this.version
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)()
  }

  // ------------------------------------------------------------------ documents

  /** Idempotent by path: re-ingesting a changed file replaces its claims in one transaction. */
  putDocument(document: { id: string; path: string; sha256: string; body: string; now: number }): void {
    const byteSize = Buffer.byteLength(document.body, 'utf8')
    const lineCount = document.body.split('\n').length
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO documents (id, path, sha256, byte_size, line_count, body, ingested_at)
           VALUES (@id, @path, @sha256, @byteSize, @lineCount, @body, @now)
           ON CONFLICT (id) DO UPDATE SET
             path = excluded.path,
             sha256 = excluded.sha256,
             byte_size = excluded.byte_size,
             line_count = excluded.line_count,
             body = excluded.body,
             ingested_at = excluded.ingested_at`,
        )
        .run({ ...document, byteSize, lineCount })
      // A stale claim is worse than a missing one: the old spans point into the old bytes.
      this.#clearClaims(document.id)
    })
  }

  getDocument(id: string): DocumentRow | undefined {
    return this.#db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined
  }

  documentByPath(path: string): DocumentRow | undefined {
    return this.#db.prepare('SELECT * FROM documents WHERE path = ?').get(path) as DocumentRow | undefined
  }

  listDocuments(limit = 100): readonly DocumentRow[] {
    return this.#db
      .prepare('SELECT * FROM documents ORDER BY ingested_at DESC, id LIMIT ?')
      .all(limit) as DocumentRow[]
  }

  /** Claims and the search index go with it: `foreign_keys = ON` cascades both. */
  deleteDocument(id: string): boolean {
    return this.transaction(() => {
      this.#clearClaims(id)
      const result = this.#db.prepare('DELETE FROM documents WHERE id = ?').run(id)
      return result.changes > 0
    })
  }

  /** Every claim for one document, so re-ingestion can never leave a stale span behind. */
  #clearClaims(documentId: string): void {
    this.#db.prepare('DELETE FROM claims WHERE document_id = ?').run(documentId)
    this.#db.prepare('DELETE FROM claims_fts WHERE document_id = ?').run(documentId)
  }

  // ------------------------------------------------------------------ claims

  putClaims(documentId: string, treeDigest: string, claims: readonly ClaimInput[]): number {
    if (!this.getDocument(documentId)) {
      throw new Error(`cannot store claims for unknown document "${documentId}"`)
    }
    return this.transaction(() => {
      this.#clearClaims(documentId)
      const insert = this.#db.prepare(
        `INSERT INTO claims (
           id, document_id, parent_id, depth, section, kind, polarity, subject, quote,
           byte_start, byte_end, line, col, cues, tree_digest
         ) VALUES (
           @id, @documentId, @parentId, @depth, @section, @kind, @polarity, @subject, @quote,
           @byteStart, @byteEnd, @line, @col, @cues, @treeDigest
         )`,
      )
      const index = this.#db.prepare(
        'INSERT INTO claims_fts (document_id, claim_id, subject, quote, section) VALUES (?, ?, ?, ?, ?)',
      )
      for (const claim of claims) {
        insert.run({
          id: claim.id,
          documentId,
          parentId: claim.parentId,
          depth: claim.depth,
          section: claim.section,
          kind: claim.kind,
          polarity: claim.polarity,
          subject: claim.subject,
          quote: claim.quote,
          byteStart: claim.span.byteStart,
          byteEnd: claim.span.byteEnd,
          line: claim.span.line,
          col: claim.span.column,
          cues: JSON.stringify([...claim.cues]),
          treeDigest,
        })
        index.run(documentId, claim.id, claim.subject, claim.quote, claim.section)
      }
      return claims.length
    })
  }

  getClaim(documentId: string, claimId: string): ClaimRow | undefined {
    return this.#db
      .prepare('SELECT * FROM claims WHERE document_id = ? AND id = ?')
      .get(documentId, claimId) as ClaimRow | undefined
  }

  listClaims(documentId?: string, limit = 500): readonly ClaimRow[] {
    return documentId === undefined
      ? (this.#db
          .prepare('SELECT * FROM claims ORDER BY document_id, line, col LIMIT ?')
          .all(limit) as ClaimRow[])
      : (this.#db
          .prepare('SELECT * FROM claims WHERE document_id = ? ORDER BY line, col LIMIT ?')
          .all(documentId, limit) as ClaimRow[])
  }

  /** FTS5 search across claim text. A match returns the claim, never the raw index row. */
  searchClaims(query: string, limit = 50): readonly ClaimRow[] {
    return this.#db
      .prepare(
        `SELECT c.* FROM claims_fts f
           JOIN claims c ON c.document_id = f.document_id AND c.id = f.claim_id
          WHERE claims_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit) as ClaimRow[]
  }

  // ------------------------------------------------------------------ register

  /** Replaces the register wholesale: a register is a reviewed artifact, not a log. */
  replaceObligations(obligations: readonly ObligationInput[]): number {
    return this.transaction(() => {
      this.#db.prepare('DELETE FROM obligations').run()
      const insert = this.#db.prepare(
        `INSERT INTO obligations (
           id, code, source, statement, kind, evidence_required, evidence_kind, severity, cues, origin
         ) VALUES (
           @id, @code, @source, @statement, @kind, @evidenceRequired, @evidenceKind, @severity,
           @cues, @origin
         )`,
      )
      for (const obligation of obligations) {
        insert.run({
          id: obligation.id,
          code: obligation.code,
          source: obligation.source,
          statement: obligation.statement,
          kind: obligation.kind,
          evidenceRequired: obligation.evidenceRequired,
          evidenceKind: obligation.evidenceKind,
          severity: obligation.severity,
          cues: JSON.stringify([...(obligation.cues ?? [])]),
          origin: obligation.origin ?? 'unspecified',
        })
      }
      return obligations.length
    })
  }

  listObligations(): readonly ObligationRow[] {
    return this.#db.prepare('SELECT * FROM obligations ORDER BY source, code, id').all() as ObligationRow[]
  }

  getObligation(id: string): ObligationRow | undefined {
    return this.#db.prepare('SELECT * FROM obligations WHERE id = ?').get(id) as ObligationRow | undefined
  }

  replaceEvidence(evidence: readonly EvidenceInput[]): number {
    return this.transaction(() => {
      this.#db.prepare('DELETE FROM evidence').run()
      const insert = this.#db.prepare(
        `INSERT INTO evidence (id, obligation_id, locator, sha256, kind)
         VALUES (@id, @obligationId, @locator, @sha256, @kind)`,
      )
      for (const item of evidence) {
        if (this.getObligation(item.obligationId) === undefined) {
          throw new Error(`evidence "${item.id}" references unknown obligation "${item.obligationId}"`)
        }
        insert.run(item)
      }
      return evidence.length
    })
  }

  listEvidence(): readonly EvidenceInput[] {
    const rows = this.#db.prepare('SELECT * FROM evidence ORDER BY id').all() as {
      id: string
      obligation_id: string
      locator: string
      sha256: string
      kind: string
    }[]
    return rows.map((row) => ({
      id: row.id,
      obligationId: row.obligation_id,
      locator: row.locator,
      sha256: row.sha256,
      kind: row.kind,
    }))
  }

  // ------------------------------------------------------------------ runs

  putRun(run: RunInput): void {
    this.transaction(() => {
      this.#db
        .prepare(
          `INSERT INTO runs (
             id, created_at, engine, lexicon, rules, tree_digest, report_digest, verdict_counts, blocking
           ) VALUES (
             @id, @createdAt, @engine, @lexicon, @rules, @treeDigest, @reportDigest,
             @verdictCounts, @blocking
           )
           ON CONFLICT (id) DO UPDATE SET
             created_at = excluded.created_at,
             engine = excluded.engine,
             lexicon = excluded.lexicon,
             rules = excluded.rules,
             tree_digest = excluded.tree_digest,
             report_digest = excluded.report_digest,
             verdict_counts = excluded.verdict_counts,
             blocking = excluded.blocking`,
        )
        .run({ ...run, verdictCounts: JSON.stringify(run.verdictCounts) })
    })
  }

  getRun(id: string): RunRow | undefined {
    return this.#db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
  }

  listRuns(limit = 100): readonly RunRow[] {
    return this.#db.prepare('SELECT * FROM runs ORDER BY created_at DESC, id LIMIT ?').all(limit) as RunRow[]
  }

  putReconciliations(runId: string, verdicts: readonly VerdictInput[]): number {
    return this.transaction(() => {
      if (this.getRun(runId) === undefined) {
        throw new Error(`cannot store verdicts for unknown run "${runId}"`)
      }
      this.#db.prepare('DELETE FROM reconciliations WHERE run_id = ?').run(runId)
      const insert = this.#db.prepare(
        `INSERT INTO reconciliations (
           run_id, claim_id, obligation_id, verdict, severity, reason_code, reason_detail
         ) VALUES (@runId, @claimId, @obligationId, @verdict, @severity, @reasonCode, @reasonDetail)`,
      )
      for (const verdict of verdicts) {
        const first = verdict.reasons[0]
        insert.run({
          runId,
          claimId: verdict.claimId,
          obligationId: verdict.obligationId,
          verdict: verdict.verdict,
          severity: verdict.severity,
          reasonCode: first?.code ?? 'UNSPECIFIED',
          reasonDetail: first?.detail ?? '',
        })
      }
      return verdicts.length
    })
  }

  listReconciliations(runId: string): readonly ReconciliationRow[] {
    return this.#db
      .prepare(
        `SELECT * FROM reconciliations WHERE run_id = ?
          ORDER BY claim_id IS NULL, claim_id, obligation_id`,
      )
      .all(runId) as ReconciliationRow[]
  }

  close(): void {
    this.#db.close()
  }
}

export { LATEST_VERSION, MIGRATIONS }
