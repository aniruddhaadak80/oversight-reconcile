import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderRow, renderSummary, renderTree } from './render.js'
import { documentIdFor } from './tools.js'
import type { ClaimView } from './tools.js'

const dirs: string[] = []

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'cli-'))
  dirs.push(root)
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function claim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    id: 'c1',
    parentId: null,
    depth: 1,
    section: 'Controls',
    kind: 'oversight',
    polarity: 'affirmed',
    subject: 'human review',
    quote: 'Human review is available for every adverse decision.',
    span: { byteStart: 8412, byteEnd: 8465, line: 37, column: 14 },
    cues: ['oversight.human-review'],
    ...overrides,
  }
}

describe('documentIdFor', () => {
  it('is stable for the same path', () => {
    expect(documentIdFor('docs/policy/card.md')).toBe(documentIdFor('docs/policy/card.md'))
  })

  it('differs for different paths with the same filename', () => {
    expect(documentIdFor('a/card.md')).not.toBe(documentIdFor('b/card.md'))
  })

  it('normalises windows separators so the same file has one id either way', () => {
    expect(documentIdFor('docs\\policy\\card.md')).toBe(documentIdFor('docs/policy/card.md'))
  })

  it('drops a leading ./ so it is not part of the identity', () => {
    expect(documentIdFor('./docs/card.md')).toBe(documentIdFor('docs/card.md'))
  })

  it('falls back to a digest when the name has no usable characters', () => {
    expect(documentIdFor('___.md')).toMatch(/^doc-[0-9a-f]{10}$/)
  })
})

describe('renderRow', () => {
  it('prints the line, column and byte range in the gutter', () => {
    const row = renderRow({ claim: claim() })
    expect(row).toMatch(/^\s+37:\s+14/)
    expect(row).toContain('8412-8465')
  })

  it('prints the quote verbatim', () => {
    expect(renderRow({ claim: claim() })).toContain('Human review is available')
  })

  it('indents a nested claim under its parent', () => {
    const child = renderRow({ claim: claim({ id: 'c2', parentId: 'c1', depth: 2 }) })
    const parent = renderRow({ claim: claim() })
    expect(parent).toContain('* Human review')
    expect(child).toContain('|- Human review')
  })

  it('shows the verdict and the obligation code when a verdict is known', () => {
    const row = renderRow(
      { claim: claim() },
      {
        verdictFor: () => ({
          verdict: 'unevidenced',
          severity: 'blocker',
          obligationId: 'EU-ART-14',
          reasonCode: 'EVIDENCE_SHORTFALL',
        }),
      },
    )
    expect(row).toContain('unevidenced')
    expect(row).toContain('BLOCKER')
    expect(row).toContain('EU-ART-14')
    expect(row).toContain('EVIDENCE_SHORTFALL')
  })

  it('marks pending when nothing has been reconciled yet', () => {
    expect(renderRow({ claim: claim() })).toContain('pending')
  })

  it('truncates a long quote unless asked not to', () => {
    const long = 'x'.repeat(500)
    expect(renderRow({ claim: claim({ quote: long }) })).not.toContain('x'.repeat(300))
    expect(renderRow({ claim: claim({ quote: long }) }, { maxQuote: 4000 })).toContain('x'.repeat(400))
  })

  it('collapses the whitespace a document may carry', () => {
    const row = renderRow({ claim: claim({ quote: 'We ensure\n   that this holds.' }) })
    expect(row).toContain('We ensure that this holds.')
  })
})

describe('renderTree', () => {
  it('says so plainly when a document makes no claim', () => {
    expect(renderTree([])).toMatch(/no claims in this document/)
  })

  it('lists sections before the claims', () => {
    const tree = renderTree([{ claim: claim() }], { sections: ['Controls', 'Limits'] })
    expect(tree.indexOf('sections')).toBeLessThan(tree.indexOf('1 claim(s)'))
    expect(tree).toContain('Limits')
  })

  it('counts the claims it prints', () => {
    const tree = renderTree([{ claim: claim() }, { claim: claim({ id: 'c2' }) }])
    expect(tree).toContain('2 claim(s)')
  })
})

describe('renderSummary', () => {
  it('bar-charts each verdict', () => {
    const summary = renderSummary({ byVerdict: { supported: 3, unevidenced: 1, contradicted: 2 } }, 1)
    expect(summary).toMatch(/supported\s+3\s+###/)
    expect(summary).toContain('1 blocking finding(s)')
  })

  it('says no blocking findings when there are none', () => {
    expect(renderSummary({ byVerdict: { supported: 9 } }, 0)).toContain('no blocking findings')
  })
})

describe('the scratch directory is usable', () => {
  it('creates and removes cleanly', () => {
    const root = scratch()
    mkdirSync(join(root, 'nested'), { recursive: true })
    writeFileSync(join(root, 'nested', 'file.md'), 'We ensure this.\n', 'utf8')
    expect(scratch()).not.toBe(root)
  })
})
