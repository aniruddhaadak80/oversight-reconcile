import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The product's identity, in one typed place. The version is read from the committed
 * package.json so the page cannot claim a version nobody built.
 */
export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'omitted'
  /** Why it is absent. Omission is a decision, so it gets stated. */
  readonly note?: string
}

export const PRODUCT = {
  name: 'Oversight Reconcile',
  slug: 'oversight-reconcile',
  tagline:
    'Every AI governance claim, reconciled against a machine-checkable obligation register, cited to the exact bytes it came from.',
} as const

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI — the claim-tree inspector',
    summary:
      'The primary interface. `inspect` prints the claim tree with line, column and UTF-8 byte range for every claim, so a reviewer reads provenance before prose.',
    status: 'shipped',
  },
  {
    id: 'engine',
    title: 'Deterministic engine',
    summary:
      'A dependency-free Python package. parse_claims turns prose into a typed tree with byte-exact spans; reconcile turns that tree plus a register into verdicts. Pure: no clock, no network, no model.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Web report',
    summary:
      'This app. Server-rendered from a committed report artifact, so the numbers on screen are the numbers in the repository.',
    status: 'shipped',
  },
  {
    id: 'mcp',
    title: 'MCP server and client',
    summary:
      'Ten tools over stdio, so any MCP client can parse a policy document and reconcile it. Stateless, and backed by the same registry as the CLI.',
    status: 'shipped',
  },
  {
    id: 'memory',
    title: 'SQLite store',
    summary:
      'Documents with their bodies, claims with their spans, obligations, evidence, runs and verdicts. Numbered migrations, FTS5 over claim text.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Obligation packs as plugins',
    summary:
      'EU AI Act and NIST AI RMF ship as plugins carrying data, not code, so a framework can be diffed in a pull request.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary: 'Markdown skills loaded from disk with frontmatter validation and a version-bump gate.',
    status: 'shipped',
  },
  {
    id: 'evals',
    title: 'Evals',
    summary: 'Scored cases over real governance prose, run against the engine with no network and no model.',
    status: 'shipped',
  },
  {
    id: 'desktop',
    title: 'Desktop (Electron)',
    summary: 'An oversight review happens in a terminal and a browser.',
    status: 'omitted',
    note: 'An Electron shell would wrap this web app in a native menu with no desktop-only behaviour behind it. The two surfaces that matter — the inspector and the report — are already both.',
  },
  {
    id: 'channels',
    title: 'Channels',
    summary: 'Findings are read by a person who is accountable for them.',
    status: 'omitted',
    note: 'Outbound delivery would turn this into an alerting product. A governance finding that pages someone at 3am is a different product with a different liability.',
  },
  {
    id: 'providers',
    title: 'Model providers',
    summary: 'A verdict must be reproducible with no model version pinned.',
    status: 'omitted',
    note: 'Only the deterministic local provider ships. Nothing in the parse or reconcile path calls a model, which is the whole credibility claim.',
  },
]

/**
 * The version, read from whichever package.json is reachable.
 *
 * The deployed app is uploaded with `apps/web` as its root, so `../../package.json` does not
 * exist there and only the app's own manifest resolves. Reporting the root version locally and
 * the app's version on Vercel would be an honest difference nobody wants; falling back through
 * both paths and reporting the app's own version in both is one value that never lies about
 * which build is running.
 */
function packageVersion(): string {
  const candidates = [join(process.cwd(), 'package.json'), join(process.cwd(), '..', '..', 'package.json')]
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: string }
      if (typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
    } catch {
      /* try the next candidate */
    }
  }
  return 'unknown'
}

export function resolveVersion(): string {
  return packageVersion()
}
