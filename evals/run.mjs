#!/usr/bin/env node
// The eval suite.
//
// Every case is a governance document plus the verdicts a correct engine must produce. There
// is no model, no network, and no tolerance for "close enough": the engine is deterministic,
// so a case either matches byte for byte or the engine has regressed.
//
//   node evals/run.mjs            # score every case
//   node evals/run.mjs --json     # machine-readable
//
// Exits non-zero on any failure, so it is wired into `npm run check`.

import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CASES_DIR = join(HERE, 'cases')

/** One engine call. The engine is a pure function over stdin/stdout — no server, no port. */
function engine(op, input) {
  const child = spawnSync(process.env.PYTHON ?? 'python', ['-m', 'oversight_reconcile'], {
    cwd: join(ROOT, 'services', 'engine', 'src'),
    input: JSON.stringify({ op, input }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  if (child.status !== 0) {
    throw new Error(`engine exited ${child.status}: ${child.stderr}`)
  }
  const response = JSON.parse(child.stdout.trim())
  if (response.ok !== true) {
    throw new Error(`${op} failed: ${response.error?.code} ${response.error?.message}`)
  }
  return response.value
}

/** `span` is shorthand for the byte range; `line` and `column` live inside the span. */
function resolveClaimField(claim, field) {
  if (field === 'span') return `${claim.span.byteStart}-${claim.span.byteEnd}`
  if (field === 'line' || field === 'column') return claim.span[field]
  return claim[field]
}

function loadCases() {
  return readdirSync(CASES_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({
      name: file.replace(/\.json$/, ''),
      spec: JSON.parse(readFileSync(join(CASES_DIR, file), 'utf8')),
    }))
}

/**
 * Score one case. `expect` states the facts that must hold; everything the engine actually
 * returned is compared against them, and the diff is what gets reported.
 */
function score(spec) {
  const failures = []
  const tree = engine('parse_claims', { text: spec.document })
  const report = engine('reconcile', {
    claims: tree.claims,
    obligations: spec.obligations,
    evidence: spec.evidence,
  })

  for (const expected of spec.expect.claimCount !== undefined
    ? [{ count: tree.claims.length, want: spec.expect.claimCount, what: 'claim count' }]
    : []) {
    if (expected.count !== expected.want) {
      failures.push(`${expected.what}: got ${expected.count}, want ${expected.want}`)
    }
  }

  for (const [quoteFragment, want] of Object.entries(spec.expect.claims ?? {})) {
    const matches = tree.claims.filter((claim) => claim.quote.includes(quoteFragment))
    if (matches.length !== 1) {
      failures.push(`claims containing ${JSON.stringify(quoteFragment)}: got ${matches.length}, want 1`)
      continue
    }
    const claim = matches[0]
    for (const [field, value] of Object.entries(want)) {
      const actual = resolveClaimField(claim, field)
      if (actual !== value) {
        failures.push(
          `${quoteFragment} ${field}: got ${JSON.stringify(actual)}, want ${JSON.stringify(value)}`,
        )
      }
    }
    // The invariant the product exists for, asserted on every case.
    const sliced = Buffer.from(spec.document, 'utf8')
      .subarray(claim.span.byteStart, claim.span.byteEnd)
      .toString('utf8')
    if (sliced !== claim.quote) {
      failures.push(`${quoteFragment} span does not slice back to its quote`)
    }
  }

  const byVerdict = report.counts.byVerdict
  for (const [verdict, want] of Object.entries(spec.expect.byVerdict ?? {})) {
    if ((byVerdict[verdict] ?? 0) !== want) {
      failures.push(`byVerdict.${verdict}: got ${byVerdict[verdict] ?? 0}, want ${want}`)
    }
  }

  if (spec.expect.digest !== undefined && tree.digest !== spec.expect.digest) {
    failures.push(`tree digest: got ${tree.digest}, want ${spec.expect.digest}`)
  }
  if (spec.expect.reportDigest !== undefined && report.digest !== spec.expect.reportDigest) {
    failures.push(`report digest: got ${report.digest}, want ${spec.expect.reportDigest}`)
  }
  for (const code of spec.expect.diagnosticCodes ?? []) {
    if (!tree.diagnostics.some((diagnostic) => diagnostic.code === code)) {
      failures.push(`expected diagnostic ${code}, got ${tree.diagnostics.map((d) => d.code).join(', ')}`)
    }
  }

  return { failures, claims: tree.claims.length, verdicts: report.verdicts.length }
}

function main() {
  const asJson = process.argv.includes('--json')
  const cases = loadCases()
  if (cases.length === 0) {
    console.error('evals: no cases found in evals/cases')
    process.exit(1)
  }

  const results = cases.map(({ name, spec }) => ({ name, ...score(spec) }))
  const failed = results.filter((result) => result.failures.length > 0)
  const checks = results.length * 3

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          cases: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
          checks,
          results,
        },
        null,
        2,
      ),
    )
  } else {
    for (const result of results) {
      if (result.failures.length === 0) {
        console.log(`  PASS  ${result.name.padEnd(28)} ${result.claims} claims, ${result.verdicts} verdicts`)
        continue
      }
      console.log(`  FAIL  ${result.name}`)
      for (const failure of result.failures) console.log(`          ${failure}`)
    }
    console.log('')
    console.log(
      `evals: ${results.length - failed.length}/${results.length} cases passed (${checks} assertions)`,
    )
  }

  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
