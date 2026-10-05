/**
 * Migrations are numbered, ordered, and idempotent. Never edit an applied migration —
 * append a new one. `user_version` is the source of truth for the applied prefix.
 *
 * This is the first release, so migration 1 is the product's real schema rather than a
 * placeholder: nothing has ever been applied to a persistent store, and shipping a
 * throwaway `records` table would be dead schema in every clone of this repository.
 */
export interface Migration {
  readonly version: number
  readonly name: string
  readonly up: readonly string[]
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'oversight_schema',
    up: [
      `CREATE TABLE IF NOT EXISTS documents (
         id          TEXT PRIMARY KEY,
         path        TEXT NOT NULL UNIQUE,
         sha256      TEXT NOT NULL,
         byte_size   INTEGER NOT NULL,
         line_count  INTEGER NOT NULL,
         body        TEXT NOT NULL,
         ingested_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS obligations (
         id                TEXT PRIMARY KEY,
         code              TEXT NOT NULL,
         source            TEXT NOT NULL,
         statement         TEXT NOT NULL,
         kind              TEXT NOT NULL,
         evidence_required INTEGER NOT NULL,
         evidence_kind     TEXT NOT NULL,
         severity          TEXT NOT NULL,
         cues              TEXT NOT NULL,
         origin            TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS obligations_code_idx ON obligations (code)`,
      `CREATE TABLE IF NOT EXISTS claims (
         id          TEXT NOT NULL,
         document_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
         parent_id   TEXT,
         depth       INTEGER NOT NULL,
         section     TEXT NOT NULL,
         kind        TEXT NOT NULL,
         polarity    TEXT NOT NULL,
         subject     TEXT NOT NULL,
         quote       TEXT NOT NULL,
         byte_start  INTEGER NOT NULL,
         byte_end    INTEGER NOT NULL,
         line        INTEGER NOT NULL,
         col         INTEGER NOT NULL,
         cues        TEXT NOT NULL,
         tree_digest TEXT NOT NULL,
         PRIMARY KEY (document_id, id)
       )`,
      `CREATE INDEX IF NOT EXISTS claims_document_idx ON claims (document_id, line, col)`,
      `CREATE INDEX IF NOT EXISTS claims_kind_idx ON claims (kind, polarity)`,
      `CREATE TABLE IF NOT EXISTS evidence (
         id            TEXT PRIMARY KEY,
         obligation_id TEXT NOT NULL REFERENCES obligations (id) ON DELETE CASCADE,
         locator       TEXT NOT NULL,
         sha256        TEXT NOT NULL,
         kind          TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS evidence_obligation_idx ON evidence (obligation_id)`,
      `CREATE TABLE IF NOT EXISTS runs (
         id            TEXT PRIMARY KEY,
         created_at    INTEGER NOT NULL,
         engine        TEXT NOT NULL,
         lexicon       TEXT NOT NULL,
         rules         TEXT NOT NULL,
         tree_digest   TEXT NOT NULL,
         report_digest TEXT NOT NULL,
         verdict_counts TEXT NOT NULL,
         blocking      INTEGER NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS runs_created_idx ON runs (created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS reconciliations (
         run_id        TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
         claim_id      TEXT,
         obligation_id TEXT,
         verdict       TEXT NOT NULL,
         severity      TEXT NOT NULL,
         reason_code   TEXT NOT NULL,
         reason_detail TEXT NOT NULL,
         PRIMARY KEY (run_id, claim_id, obligation_id)
       )`,
      `CREATE INDEX IF NOT EXISTS reconciliations_run_idx ON reconciliations (run_id)`,
      `CREATE INDEX IF NOT EXISTS reconciliations_verdict_idx ON reconciliations (verdict)`,
    ],
  },
  {
    version: 2,
    name: 'claim_search',
    up: [
      // An external-content FTS index over claims. The rowid is synthesised from the pair
      // (document_id, claim_id) so it is stable across re-ingestion and needs no triggers.
      `CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5 (
         document_id UNINDEXED,
         claim_id UNINDEXED,
         subject,
         quote,
         section,
         tokenize = 'porter unicode61'
       )`,
    ],
  },
]

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

export function pendingMigrations(current: number): readonly Migration[] {
  return MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
}
