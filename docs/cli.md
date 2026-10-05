# CLI reference

```bash
oversight-reconcile <command> [options]
```

Until you `npm link` the workspace, run it as
`node packages/cli/dist/bin.js <command>`. Every example below was run that way.

## Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | success                                                                     |
| `1`  | runtime failure (a check failed, a tool returned an error)                  |
| `2`  | usage error (unknown command, unknown flag, unparseable JSON input)         |
| `3`  | **findings** at or above `--fail-on` — the reconciliation gate, not a crash |

Exit `3` exists so a pipeline can branch on it. A reconciliation that finds a blocker is a
successful run that reports a problem; collapsing that into exit `1` would make it
indistinguishable from a broken install.

## Commands

| Command                        | Purpose                                                           |
| ------------------------------ | ----------------------------------------------------------------- |
| `doctor`                       | probe every subsystem; status, detail and a fix hint per row      |
| `tools`                        | the authoritative capability list                                 |
| `ingest <paths...>`            | parse documents and persist their claim trees                     |
| `inspect <document>`           | **the claim tree with byte-exact provenance**                     |
| `reconcile`                    | reconcile every stored claim against every active obligation pack |
| `runs`                         | the run ledger, newest first, plus a summary from the engine      |
| `compare <beforeId> <afterId>` | per-verdict deltas between two runs                               |
| `report`                       | write the committed report artifact the web app renders           |
| `mcp serve`                    | run the MCP server over stdio                                     |
| `mcp call <tool> <json>`       | invoke one tool directly, without MCP                             |
| `version`                      | version, store schema version, engine protocol                    |

## The `doctor` contract

`doctor` never throws. A failing subsystem becomes a row with a status, a detail and a **fix**
hint. It exits `1` if any required check failed and `0` otherwise.

Two of its rows are worth reading closely:

- **`engine`** is a real probe. It spawns the Python engine and calls `parse_claims` on a
  one-sentence input. A `fail` means the engine answered wrongly or not at all. A `warn` means
  _this tree does not ship the engine_ — a different problem, and the one you get when you point
  the binary at a corpus outside a checkout.
- **`register`** parses every shipped obligation pack and names the failing JSON path, so a typo
  in a pack is a one-line fix rather than an investigation.

## `inspect`, and why it is the flagship

A governance reviewer does not want a table of claims. They want to walk the document's own
structure and, at each claim, see the bytes it came from. So every row prints `line:column`, the
UTF-8 byte range, and the quote **verbatim** — a summary is what an oversight artifact must never
contain.

```
  16:  1     399-479  + oversight/affirmed pending [c4]
            |- Human review is available on request for any classification a customer disputes.
```

Pass `--full` to stop truncating quotes, and `--json` for the machine-readable form. The argument
accepts either a document id or a path that has been ingested.

## `reconcile`

```bash
oversight-reconcile reconcile --evidence evidence/example.json --fail-on blocker
```

| Flag             | Meaning                                                              |
| ---------------- | -------------------------------------------------------------------- |
| `--evidence <f>` | a JSON array of evidence records to reconcile against                |
| `--fail-on <s>`  | `blocker` (default), `major` or `minor` — the threshold for exit `3` |
| `--json`         | one JSON document on stdout                                          |
| `--note <text>`  | recorded with the run so a reviewer can tell two runs apart          |

The command refuses to run rather than produce a misleading report: it fails if the register is
broken, if the register is empty, or if nothing has been ingested. A reconciliation over an empty
register reports every claim as `unbacked`, which is technically true and completely useless.

## Machine-readable output

Every read-only command accepts `--json`, which writes a single JSON document to stdout and
nothing else. Diagnostics always go to stderr, so `--json` output is always safe to pipe into a
parser.

```bash
oversight-reconcile tools --json | jq '.[] | select(.surface == "core")'
```
