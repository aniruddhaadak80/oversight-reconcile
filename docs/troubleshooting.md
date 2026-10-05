# Troubleshooting

Start with `doctor`. It is the fastest way to find the failing subsystem and it carries the fix.

```bash
node packages/cli/dist/bin.js doctor
```

## `engine` fails

```
[PASS] engine    parse_claims reachable (oversight_reconcile)
[FAIL] engine    engine unreachable: ...
         fix: check that `python` is on PATH and services/engine/src is intact
```

The probe really spawns the engine, so this row is an observation. In order:

1. `python --version` — the engine needs 3.11 or newer.
2. `python -m pytest services/engine -q` — does the engine itself pass?
3. Call it by hand from `services/engine/src`:
   `echo '{"op":"parse_claims","input":{"text":"We ensure this."}}' | python -m oversight_reconcile`

If you need a different interpreter, set it in `product.config.json` as `engine.python`.

## `engine` warns

```
[WARN] engine    no engine source at .../services/engine/src — this tree does not ship the engine
```

This is **not** a broken engine. You are running the binary outside a source checkout, which is a
supported way to point it at a corpus. The store and the register still work.

## `schema` fails

The store is on an older migration than the code expects. Any command that opens the store
migrates it, so run `doctor` again after any command that touches SQLite. If it persists, the
file at `dataDir` is corrupt — delete it and re-ingest; it is derived state, not evidence.

## `register` fails or warns

```
[PASS] register  27 obligations from EU AI Act (15), NIST AI RMF 1.0 (12)
[FAIL] register  14 obligations, 1 pack problem(s)
         fix: eu-ai-act: plugins/eu-ai-act/obligations.json: obligations.3.id — ...
```

The fix names the file and the JSON path. Common causes:

- a `cues` entry that does not exist in the engine lexicon (the unknown id is printed)
- a `severity` outside `blocker`/`major`/`minor`
- a duplicate obligation `id` within a pack

`register` **warns** when no plugin ships a pack. Every claim would then be `unbacked`, and
`reconcile` refuses to run in that state on purpose.

## `reconcile` exits 3

That is the gate. It means a finding exists at or above `--fail-on`. Read the findings block: each
line is a severity, a verdict, a claim or `(register)`, and the reason. `unmet` rows are the
register-side gaps — duties your framework requires that nothing in your documents addresses.

## `reconcile` refuses to run

```
error: the obligation register is broken: ...
error: no obligations loaded, so every claim would be unbacked and the report would lie
error: no documents ingested. Run: oversight-reconcile ingest <path>
```

All three are deliberate. A reconciliation over an empty register is technically true and
completely useless, so the command fails instead of producing a report nobody should trust.

## The web report says "No oversight report is published yet"

The report is a committed artifact, so the page will not invent one:

```bash
npm run report
npm run build --workspace @oversightreconcile/web
```

## `inspect` says the document is unknown

It accepts a document id or a path that has been ingested:

```bash
node packages/cli/dist/bin.js list_documents
```

via MCP, since there is no top-level command for it:

```bash
node packages/cli/dist/bin.js mcp call list_documents '{}'
```

## `better-sqlite3` cannot find its bindings

```bash
npm rebuild better-sqlite3
```

## A skill change fails CI

`npm run check:skill-version` fails when a `SKILL.md` body changes without a `metadata.version`
bump. An unbumped skill is an update users never receive. Bump the version; do not skip the gate.

## An MCP client cannot connect

The server speaks stdio and expects a real protocol client, not a shell:

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

`npm run prove:mcp` does exactly this and prints what it sees. If it passes, the server is fine
and the problem is the client's configuration.
