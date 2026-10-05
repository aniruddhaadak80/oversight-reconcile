# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Nothing yet.

## [0.1.0] - 2026-10-05

### Added

- **The product.** `parse_claims` turns untrusted AI governance prose into a typed claim tree
  where every claim carries a byte-exact span — `(byteStart, byteEnd, line, column)` into the
  source document. `reconcile` turns that tree plus an obligation register into one verdict per
  claim: `supported`, `unevidenced`, `contradicted`, `unbacked`, or `unmet`, each with a reason
  code.
- **The deterministic engine** (`services/engine`): a dependency-free Python package called as a
  pure function over stdin/stdout. Five operations — `parse_claims`, `reconcile`, `normalize`,
  `diff`, `summarize` — with no clock, no network, no randomness, no filesystem and no model.
  `mypy --strict` clean, 114 tests including property tests and a golden file.
- **The claim-tree inspector** (`oversight-reconcile inspect`): the flagship surface. Prints each
  claim with its line, column, UTF-8 byte range and verbatim quote, grouped by section, so a claim
  is citable before it is judged.
- **The reconciliation gate** (`oversight-reconcile reconcile`): `--fail-on <severity>` exits `3`
  when a finding exists at or above the threshold, which makes it usable directly in a pipeline.
- **Ten product tools** in one registry, reachable from the CLI, the web app and an MCP server.
- **An MCP server and client** over stdio, proven against a real client by
  `npm run prove:mcp` — including `tools/call` paths that reach the Python engine.
- **Obligation packs as plugins**: EU AI Act (15 obligations) and NIST AI RMF 1.0 (12), shipped as
  data so a framework can be diffed in a pull request.
- **A SQLite store** with the product's real schema — documents with their bodies, claims with
  their spans, obligations, evidence, runs and verdicts — numbered idempotent migrations and FTS5
  over claim text.
- **A web report** on Vercel: server-rendered from a committed report artifact, with a
  canvas-and-inspector layout where the selected claim's exact bytes are highlighted in its
  source line. Zero client JavaScript in the primary flow.
- **A run ledger** (`runs`, `compare`) answering "what changed since last quarter", with a digest
  that makes "nothing changed" provable.
- **An eval suite** over real governance prose, and four skills: `product-overview`,
  `reconcile-oversight`, `author-obligation-pack`, `diagnose`.

### Deliberately omitted

- **Desktop (Electron).** An oversight review happens in a terminal and a browser; a native menu
  around a web app with no desktop-only behaviour is not a feature.
- **Channel adapters.** Findings are read by a person accountable for them. Outbound delivery
  would make this an alerting product with a different liability.
- **Model providers.** Only the deterministic local provider ships. Nothing in the parse or
  reconcile path calls a model, which is the credibility claim itself.

### Notes

- The obligation packs are this project's own machine-checkable reading of those frameworks, for
  demonstration and for diffing. They are not legal advice and have not been reviewed by counsel.
- The article references in the packs are the deployer's own mapping. Verify them against the
  current text of each instrument before relying on them.
