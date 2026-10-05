<div align="center">

# Oversight Reconcile

**Every AI governance claim, reconciled against a machine-checkable obligation register, cited to the exact bytes it came from.**

[CI](https://github.com/aniruddhaadak80/oversight-reconcile/actions/workflows/ci.yml) ·
[License](https://github.com/aniruddhaadak80/oversight-reconcile/blob/main/LICENSE) ·
[Issues](https://github.com/aniruddhaadak80/oversight-reconcile/issues)

</div>

---

## What this is

You hand it the prose your organisation publishes about its own AI — model cards, system cards,
impact assessments, fairness policies. It parses that prose into a **claim tree** where every claim
carries a byte-exact span into the source, then reconciles each claim against an **obligation
register** and reports one verdict per claim:

| Verdict        | Means                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| `supported`    | an obligation governs it and enough artifacts are on record               |
| `unevidenced`  | an obligation governs it and the artifacts are short                      |
| `contradicted` | the same document affirms and denies it                                   |
| `unbacked`     | no obligation in the register governs it at all                           |
| `unmet`        | nothing in your documents addresses an obligation your framework requires |

### The one thing a chatbot cannot do here

Ask "which line in our system card supports the claim that human review is available?" and the
answer has to be `(byte 8412, line 37, column 14)` — and it has to be the same answer in two
years, from the same bytes, with no model version pinned. That is a correctness property, not a
generation property, so it is code:

```console
$ echo '{"op":"parse_claims","input":{"text":"# Card\n\n## Oversight\n\nHuman review is available for every adverse decision.\n"}}' | python -m oversight_reconcile
{"ok":true,"value":{"lexiconVersion":"1.0.0","claims":[{"id":"c1","parentId":null,"depth":2,"section":"Card › Oversight","kind":"oversight","polarity":"affirmed","subject":"human review","quote":"Human review is available for every adverse decision.","span":{"byteStart":22,"byteEnd":75,"line":5,"column":1},"cues":["oversight.human-review"]}],"sections":["Card","Card › Oversight"],"diagnostics":[],"truncated":false,"maxDepthReached":2,"counts":{"total":1,"byKind":{"oversight":1},"byPolarity":{"affirmed":1}},"digest":"e7de4355888a7439d9b89d48207806d9d28b2bbb69655eae908ac91ccc4bc076"},"durationMs":12}
```

That engine is a dependency-free Python package called as a pure function over stdin/stdout. No
server, no port, no daemon, no clock, no network, no randomness, **no model**. Everything in that
`span` is a property of the bytes you fed it.

## Quick start

```bash
git clone https://github.com/aniruddhaadak80/oversight-reconcile.git
cd oversight-reconcile
npm install
npm run build
node packages/cli/dist/bin.js doctor
```

`doctor` spawns the engine, opens the store, and parses every shipped obligation pack. If it exits
`0`, the install is good:

```console
$ node packages/cli/dist/bin.js doctor
oversight-reconcile doctor
  [PASS] node      v22.23.2
  [PASS] package   oversight-reconcile@0.1.0
  [PASS] engine    parse_claims reachable (oversight_reconcile)
  [PASS] schema    sqlite at .data/oversight.db on version 2
  [PASS] register  27 obligations from EU AI Act (15), NIST AI RMF 1.0 (12)
  [PASS] skills    4 skills, 0 invalid
  [PASS] plugins   2 active, 0 disabled
  [WARN] config    no product.config.json — defaults (dataDir .data)
         fix: copy product.config.json.example to product.config.json

all required checks passed
```

## Walkthrough

Every command below was run against this repository. `node packages/cli/dist/bin.js` is written out
in full because the binary is not on your `PATH` until you `npm link` it; if you have, drop the
prefix.

### 1. See the capability list

```bash
node packages/cli/dist/bin.js tools --json
```

Ten tools, each with an input schema, declared permissions, and a description written for a model.

### 2. Ingest the published policies

```bash
node packages/cli/dist/bin.js ingest docs/policy/meridian-system-card.md docs/policy/northwind-fairness-policy.md
```

```console
ingested meridian-system-card-7eddbf4fcb: 10 claim(s)  (1 diagnostic(s))
ingested northwind-fairness-policy-cbe85d6003: 10 claim(s)  (1 diagnostic(s))
```

The diagnostic is `NON_ASCII` — these documents contain an em dash, so a byte offset is not a
character offset. The engine tells you when that is true rather than letting you assume it.

### 3. Read the claim tree before the verdicts

```bash
node packages/cli/dist/bin.js inspect docs/policy/northwind-fairness-policy.md
```

```console
sections
  Northwind Support — Fairness and Access Policy › Data provenance
  Northwind Support — Fairness and Access Policy › Retention
  Northwind Support — Fairness and Access Policy › Human oversight
  ...

10 claim(s) — gutter is line:column, then the UTF-8 byte range

   7: 54     220-252  ? exclusion/denied pending [c1]
            * We do not train on ticket bodies

  12:  1     290-332  ? retention/affirmed pending [c2]
            * We retain ticket transcripts for 400 days.

  16:  1     399-479  ? oversight/affirmed pending [c4]
            * Human review is available on request for any classification a customer disputes.
```

This is the flagship view, and it is the reason the product exists: every claim is citable before
you judge it. `byte 220–252` is the exact range of `We do not train on ticket bodies` in that file,
and you can check it yourself.

### 4. Reconcile, and let the exit code be the gate

```bash
node packages/cli/dist/bin.js reconcile --evidence evidence/example.json --fail-on blocker
```

```console
run-muup7inx-218a5eec  2 document(s), 20 claim(s)
register: EU AI Act (15), NIST AI RMF 1.0 (12)

  contradicted     0
  supported       14  ##############
  unbacked         1  #
  unevidenced      5  #####
  unmet           16  ################

  7 blocking finding(s)

findings
  blocker  unevidenced  meridian-system-card-7eddbf4fcb#c5  'the oversight person must be able to stop the system or override its output' needs 1 document artifact(s); 0 on record
  major    unbacked     northwind-fairness-policy-cbe85d6003#c7  a consent claim about 'consent' is not governed by any obligation in the register
  blocker  unmet        (register)  nothing in the documents addresses 'a fundamental-rights impact assessment must accompany the deployment'
  ...
```

This exits **3**. That is not a crash — it is the CI gate. Exit codes are `0` ok, `1` runtime
failure, `2` usage error, `3` findings at or above `--fail-on`.

The `unmet` rows are the ones a checklist review skips, and they are the point: 16 duties your
framework requires that neither document mentions.

### 5. Compare against a previous run

```bash
node packages/cli/dist/bin.js runs
node packages/cli/dist/bin.js compare <beforeRunId> <afterRunId>
```

Per-verdict deltas, plus whether the claim tree itself changed — so a verdict delta caused by a
typo is distinguishable from one caused by a governance change.

### 6. Publish the report the web app renders

```bash
npm run report
```

Writes `apps/web/content/oversight/latest.json`: a committed artifact. The web report renders the
committed bytes rather than running a live query, because a governance page whose numbers change
between two page loads is not evidence.

```bash
npm run build --workspace @oversightreconcile/web
cd apps/web && npx next start -p 4317
```

Then read it, or read the deployed copy:

```console
$ curl -s localhost:4317/api/health
{"ok":true,"name":"oversight-reconcile","version":"0.1.0","commit":"local","runtime":"22.23.2","region":"local","checks":[{"name":"runtime","status":"ok","detail":"node 22.23.2"},{"name":"package","status":"ok","detail":"oversight-reconcile@0.1.0"},{"name":"report","status":"ok","detail":"20 claims, 27 obligations, 7 blocking finding(s)"},{"name":"report-digest","status":"ok","detail":"tree 3aa5d7980bb1 / report 218a5eec2d10"},{"name":"region","status":"ok","detail":"local"},{"name":"telemetry","status":"warn","detail":"disabled (default)","fix":"set TELEMETRY_ENABLED=true to enable"}],"uptimeSeconds":53}
```

### 7. Let another agent use it

This is a tool **provider**, not just a tool consumer. `npm run prove:mcp` starts the built server
as a child process, speaks real MCP over stdio, and calls tools that reach the Python engine:

```bash
npm run prove:mcp
```

```console
  [PASS] initialize over stdio
  [PASS] tools/list
         10 tools: compare_runs, ingest_document, list_claims, list_documents, list_obligations, list_plugins, list_runs, list_skills, parse_claims, reconcile_oversight
  [PASS] engine-backed tool is exposed
  [PASS] tools/call parse_claims reached the engine
         1 claim, tree digest b42366a143c1cc6f
  [PASS] tools/call reconcile_oversight reached the engine
         byVerdict {"contradicted":0,"supported":0,"unbacked":0,"unevidenced":1,"unmet":0}
  [PASS] tools/call list_documents read the store
         2 document(s)
  [PASS] invalid input returns an error envelope, not a crash
         VALIDATION_FAILED: "text" must be a non-empty string

  7 passed, 0 failed
```

To connect it to an MCP client:

```json
{
  "mcpServers": {
    "oversight-reconcile": {
      "command": "node",
      "args": ["/absolute/path/to/oversight-reconcile/packages/cli/dist/bin.js", "mcp", "serve"]
    }
  }
}
```

### 8. Run the whole gate

```bash
npm run check
```

This is the exact command CI runs, in the same order. It covers format, lint, typecheck, six policy
gates, Python lint/format/types, the TypeScript tests, the Python tests including property and
golden tests, the build, the eval suite, and the MCP proof.

## How it works

```
                 ┌──────────────┐
   CLI ─────────▶│              │
   Web ─────────▶│  ToolRegistry│───▶ packages/memory  (SQLite, WAL, FTS5)
   MCP server ──▶│              │
                 └──────────────┘
                        │
                        └──▶ services/engine  (pure Python, stdin/stdout)
                        └──▶ plugins/*        (obligation packs, data not code)
```

Six invariants hold this together:

1. **One registry.** Every capability is a `Tool`, reachable identically from every surface. A
   second code path is a bug even when it works.
2. **Tools are stateless.** State lives in `packages/memory` or arrives in `ctx`.
3. **Input is validated before the handler runs**, never caught afterwards.
4. **Permissions are declared**, and an ungranted permission refuses the call _before_ invocation.
   An empty grant list is a sandbox with nothing in it — not "grant the lowest rank".
5. **A duplicate tool name throws**, naming both registrants.
6. **The engine is pure.** No clock, no network, no randomness, no filesystem.

### The footprint ladder

Where new capability goes, in order of preference:

1. Extend an existing tool's input schema
2. Add a CLI command plus a skill
3. Add a plugin-gated tool
4. Add an MCP server tool
5. Add a new Python engine operation
6. Add a new core tool — **last resort**

Every core tool is paid for in context window on every request, forever. That asymmetry is why
adding to `packages/core` first is the most common review comment here.

## What ships

| Surface              | Status  | What it is                                                 |
| -------------------- | ------- | ---------------------------------------------------------- |
| CLI                  | shipped | the claim-tree inspector and the reconciliation gate       |
| Deterministic engine | shipped | pure Python over stdin/stdout, `mypy --strict` clean       |
| Web report           | shipped | server-rendered Next.js, deployed to Vercel                |
| MCP server           | shipped | ten tools over stdio, stateless                            |
| MCP client           | shipped | connects to configured servers                             |
| Skills catalog       | shipped | `SKILL.md` discovery, validation, version gating           |
| Plugin registry      | shipped | manifest validation, priority resolution, obligation packs |
| Memory               | shipped | SQLite, WAL, numbered migrations, FTS5 over claim text     |
| Evals                | shipped | scored cases over real governance prose                    |

### Deliberate omissions

Each of these is a decision with a reason, not a gap.

**No desktop shell.** An oversight review happens in a terminal and in a browser. An Electron
wrapper would add a native menu around a web app with no desktop-only behaviour behind it.

**No channels.** Findings are read by a person who is accountable for them. Outbound delivery
would turn this into an alerting product, with a different liability.

**No model providers.** Only the deterministic local provider ships. Nothing in the parse or
reconcile path calls a model — that is the entire credibility claim, and a pinned model version
in the verdict path would quietly break it.

**No telemetry.** `TELEMETRY_ENABLED` defaults to unset and `/api/health` reports `warn` while it
is off. A local-first governance tool that phones home by default is a different product.

## Configuration

Layered, later wins: **defaults → `product.config.json` → environment**.

| Key                | Default       | Meaning                         |
| ------------------ | ------------- | ------------------------------- |
| `productEnv`       | `development` | runtime mode                    |
| `dataDir`          | `.data`       | where SQLite lives              |
| `engine.python`    | `python`      | interpreter for the engine      |
| `engine.timeoutMs` | `10000`       | hard ceiling on one engine call |
| `logLevel`         | `info`        | log verbosity                   |

An invalid value raises a `ValidationError` naming the field — it is never coerced. See
[docs/configuration.md](docs/configuration.md).

## Documentation

| Page                                       | Read it when                              |
| ------------------------------------------ | ----------------------------------------- |
| [getting-started](docs/getting-started.md) | you have just cloned this                 |
| [architecture](docs/architecture.md)       | you need the map before changing anything |
| [cli](docs/cli.md)                         | you are scripting the CLI                 |
| [mcp](docs/mcp.md)                         | you are connecting an agent               |
| [skills](docs/skills.md)                   | you are writing or editing a skill        |
| [plugins](docs/plugins.md)                 | you are adding a framework or extension   |
| [ci](docs/ci.md)                           | you are adding a gate                     |
| [troubleshooting](docs/troubleshooting.md) | something is broken                       |
| [adr/](docs/adr/)                          | you want the reasoning behind a decision  |
| [notes/](docs/notes/)                      | you want the honest contributor manual    |

## Development

```bash
npm install
npm run build              # turbo build across every package
npm run typecheck          # tsc --noEmit, every package
npm run lint               # eslint
npm run format             # prettier --write
npm test                   # vitest, every package
npm run pytest             # the Python engine, including property and golden tests
npm run evals              # scored cases over real governance prose
npm run prove:mcp          # a real MCP client over stdio, against the built server
npm run check              # everything CI runs
```

Python gates run separately and are part of `npm run check`:

```bash
npm run lint:python
npm run format:check:python
npm run typecheck:python
```

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). The rules that are not negotiable are in
[AGENTS.md](AGENTS.md), and the reasoning behind each decision is in [docs/adr/](docs/adr/).

## License

MIT — see [LICENSE](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
