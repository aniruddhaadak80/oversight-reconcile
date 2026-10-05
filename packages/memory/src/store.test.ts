import { describe, expect, it } from 'vitest'
import { LATEST_VERSION, pendingMigrations } from './migrations.js'
import { OversightStore, type ClaimInput, type RunInput } from './store.js'

function claim(id: string, overrides: Partial<ClaimInput> = {}): ClaimInput {
  return {
    id,
    parentId: null,
    depth: 1,
    section: 'Controls',
    kind: 'oversight',
    polarity: 'affirmed',
    subject: 'human review',
    quote: 'Human review is available.',
    span: { byteStart: 0, byteEnd: 28, line: 3, column: 1 },
    cues: ['oversight.human-review'],
    ...overrides,
  }
}

function run(id: string, createdAt: number, overrides: Partial<RunInput> = {}): RunInput {
  return {
    id,
    createdAt,
    engine: 'oversight_reconcile/0.1.0',
    lexicon: '1.0.0',
    rules: '1.0.0',
    treeDigest: 'a'.repeat(64),
    reportDigest: 'b'.repeat(64),
    verdictCounts: {
      supported: 1,
      unevidenced: 2,
      contradicted: 3,
      unbacked: 4,
      unmet: 5,
    },
    blocking: 1,
    ...overrides,
  }
}

function seeded(): OversightStore {
  const store = new OversightStore()
  store.putDocument({ id: 'doc-1', path: 'docs/card.md', sha256: 'x', body: 'Hello\n', now: 100 })
  return store
}

describe('migrations', () => {
  it('migrates an empty database to the latest version', () => {
    const store = new OversightStore()
    expect(store.version).toBe(LATEST_VERSION)
    expect(store.isPending).toBe(false)
    store.close()
  })

  it('is idempotent — migrating twice changes nothing', () => {
    const store = new OversightStore()
    expect(store.migrate()).toBe(LATEST_VERSION)
    expect(store.migrate()).toBe(LATEST_VERSION)
    expect(pendingMigrations(LATEST_VERSION)).toHaveLength(0)
    store.close()
  })

  it('reports what is pending when a prefix has been applied', () => {
    expect(pendingMigrations(0).map((m) => m.version)).toEqual([1, 2])
    expect(pendingMigrations(1).map((m) => m.name)).toEqual(['claim_search'])
    expect(pendingMigrations(LATEST_VERSION)).toHaveLength(0)
  })
})

describe('OversightStore', () => {
  it('round-trips a document with its body intact', () => {
    const store = seeded()
    const document = store.getDocument('doc-1')
    expect(document?.body).toBe('Hello\n')
    expect(document?.byte_size).toBe(6)
    expect(document?.line_count).toBe(2)
    store.close()
  })

  it('re-ingesting a document replaces its claims rather than duplicating them', () => {
    const store = seeded()
    store.putClaims('doc-1', 'digest-a', [claim('c1'), claim('c2')])
    store.putClaims('doc-1', 'digest-b', [claim('c1', { quote: 'Changed.' })])
    const claims = store.listClaims('doc-1')
    expect(claims).toHaveLength(1)
    expect(claims[0]?.quote).toBe('Changed.')
    expect(claims[0]?.tree_digest).toBe('digest-b')
    store.close()
  })

  it('stores byte spans exactly as given', () => {
    const store = seeded()
    store.putClaims('doc-1', 'digest', [
      claim('c1', { span: { byteStart: 8412, byteEnd: 8437, line: 37, column: 14 } }),
    ])
    const row = store.getClaim('doc-1', 'c1')
    expect(row?.byte_start).toBe(8412)
    expect(row?.col).toBe(14)
    store.close()
  })

  it('refuses claims for a document that was never ingested', () => {
    const store = new OversightStore()
    expect(() => store.putClaims('ghost', 'digest', [claim('c1')])).toThrow(/unknown document/)
    store.close()
  })

  it('finds claims with full-text search', () => {
    const store = seeded()
    store.putClaims('doc-1', 'digest', [
      claim('c1', { quote: 'Human review is available.', subject: 'human review' }),
      claim('c2', {
        quote: 'Event logs are retained.',
        subject: 'retention',
        kind: 'retention',
        cues: ['commitment.retain'],
      }),
    ])
    expect(store.searchClaims('review').map((r) => r.id)).toEqual(['c1'])
    expect(store.searchClaims('retained').map((r) => r.id)).toEqual(['c2'])
    store.close()
  })

  it('replaces the register wholesale', () => {
    const store = new OversightStore()
    store.replaceObligations([
      {
        id: 'O1',
        code: 'ART-14',
        source: 'EU AI Act',
        statement: 'human review must exist',
        kind: 'oversight',
        evidenceRequired: 1,
        evidenceKind: 'document',
        severity: 'blocker',
      },
    ])
    expect(store.listObligations()).toHaveLength(1)
    store.replaceObligations([])
    expect(store.listObligations()).toHaveLength(0)
    store.close()
  })

  it('refuses evidence for an obligation that is not in the register', () => {
    const store = new OversightStore()
    expect(() =>
      store.replaceEvidence([
        { id: 'e1', obligationId: 'ghost', locator: 'x', sha256: 'y', kind: 'document' },
      ]),
    ).toThrow(/unknown obligation/)
    store.close()
  })

  it('round-trips evidence against a real obligation', () => {
    const store = new OversightStore()
    store.replaceObligations([
      {
        id: 'O1',
        code: 'ART-14',
        source: 'EU AI Act',
        statement: 'human review must exist',
        kind: 'oversight',
        evidenceRequired: 1,
        evidenceKind: 'document',
        severity: 'blocker',
      },
    ])
    store.replaceEvidence([
      { id: 'e1', obligationId: 'O1', locator: '/policy#hr', sha256: 'z', kind: 'document' },
    ])
    expect(store.listEvidence()).toEqual([
      { id: 'e1', obligationId: 'O1', locator: '/policy#hr', sha256: 'z', kind: 'document' },
    ])
    store.close()
  })

  it('stores a run and lists it newest first', () => {
    const store = new OversightStore()
    store.putRun(run('r1', 100))
    store.putRun(run('r2', 300))
    store.putRun(run('r3', 200))
    expect(store.listRuns().map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
    store.close()
  })

  it('serialises verdict counts so the ledger ops can read them back', () => {
    const store = new OversightStore()
    store.putRun(run('r1', 100))
    expect(JSON.parse(store.getRun('r1')?.verdict_counts ?? '{}')).toEqual({
      supported: 1,
      unevidenced: 2,
      contradicted: 3,
      unbacked: 4,
      unmet: 5,
    })
    store.close()
  })

  it('stores verdicts and refuses them for an unknown run', () => {
    const store = new OversightStore()
    store.putRun(run('r1', 100))
    const written = store.putReconciliations('r1', [
      {
        claimId: 'c1',
        obligationId: 'O1',
        verdict: 'supported',
        severity: 'blocker',
        reasons: [{ code: 'EVIDENCE_SUFFICIENT', detail: '1 on record' }],
      },
      {
        claimId: null,
        obligationId: 'O2',
        verdict: 'unmet',
        severity: 'major',
        reasons: [{ code: 'NO_CLAIM_ADDRESSES_OBLIGATION', detail: 'nothing addresses it' }],
      },
    ])
    expect(written).toBe(2)
    expect(store.listReconciliations('r1').map((r) => r.verdict)).toEqual(['supported', 'unmet'])
    expect(() => store.putReconciliations('ghost', [])).toThrow(/unknown run/)
    store.close()
  })

  it('cascades a document delete to its claims and its search rows', () => {
    const store = seeded()
    store.putClaims('doc-1', 'digest', [claim('c1')])
    expect(store.searchClaims('review')).toHaveLength(1)
    expect(store.deleteDocument('doc-1')).toBe(true)
    expect(store.listClaims('doc-1')).toHaveLength(0)
    expect(store.searchClaims('review')).toHaveLength(0)
    expect(store.deleteDocument('doc-1')).toBe(false)
    store.close()
  })

  it('rolls a failed transaction back completely', () => {
    const store = new OversightStore()
    expect(() =>
      store.transaction(() => {
        store.putRun(run('r1', 1))
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(store.getRun('r1')).toBeUndefined()
    store.close()
  })
})
