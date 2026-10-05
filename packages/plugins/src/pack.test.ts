import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadObligationPack, packPathFor, ObligationPackSchema } from './pack.js'

const dirs: string[] = []

function packFile(body: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'packs-'))
  dirs.push(root)
  const file = join(root, 'obligations.json')
  writeFileSync(file, JSON.stringify(body), 'utf8')
  return file
}

const valid = {
  framework: 'Test Framework',
  version: '1.0.0',
  description: 'A pack used by the pack loader tests.',
  obligations: [
    {
      id: 'T-1',
      code: 'Rule 1',
      source: 'Test Framework',
      statement: 'the thing must be documented',
      kind: 'disclosure',
      evidenceRequired: 1,
      severity: 'major',
    },
  ],
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('ObligationPackSchema', () => {
  it('accepts a minimal pack and defaults the evidence kind', () => {
    const parsed = ObligationPackSchema.safeParse(valid)
    expect(parsed.success).toBe(true)
    expect(parsed.data?.obligations[0]?.evidenceKind).toBe('document')
    expect(parsed.data?.obligations[0]?.cues).toEqual([])
  })

  it('rejects an unknown severity', () => {
    const parsed = ObligationPackSchema.safeParse({
      ...valid,
      obligations: [{ ...valid.obligations[0], severity: 'apocalyptic' }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a negative evidence requirement', () => {
    const parsed = ObligationPackSchema.safeParse({
      ...valid,
      obligations: [{ ...valid.obligations[0], evidenceRequired: -1 }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty obligation list', () => {
    expect(ObligationPackSchema.safeParse({ ...valid, obligations: [] }).success).toBe(false)
  })
})

describe('loadObligationPack', () => {
  it('loads a valid pack', () => {
    const loaded = loadObligationPack('test', packFile(valid))
    expect(loaded.issues).toEqual([])
    expect(loaded.framework).toBe('Test Framework')
    expect(loaded.obligations).toHaveLength(1)
  })

  it('reports a missing file instead of throwing', () => {
    const loaded = loadObligationPack('test', 'no/such/obligations.json')
    expect(loaded.issues[0]).toMatch(/not found/)
  })

  it('reports invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'packs-'))
    dirs.push(root)
    const file = join(root, 'obligations.json')
    writeFileSync(file, '{not json', 'utf8')
    expect(loadObligationPack('test', file).issues[0]).toMatch(/not valid JSON/)
  })

  it('reports the failing field by JSON path', () => {
    const loaded = loadObligationPack(
      'test',
      packFile({ ...valid, obligations: [{ ...valid.obligations[0], id: 'has space' }] }),
    )
    expect(loaded.issues.join(' ')).toMatch(/obligations\.0\.id/)
  })

  it('reports a duplicate obligation id', () => {
    const loaded = loadObligationPack(
      'test',
      packFile({ ...valid, obligations: [valid.obligations[0], valid.obligations[0]] }),
    )
    expect(loaded.issues.join(' ')).toMatch(/duplicate obligation id/)
    expect(loaded.obligations).toHaveLength(0)
  })

  it('resolves a declared pack path relative to its manifest', () => {
    expect(packPathFor(join('plugins', 'x', 'plugin.json'), 'obligations.json')).toBe(
      join('plugins', 'x', 'obligations.json'),
    )
  })
})
