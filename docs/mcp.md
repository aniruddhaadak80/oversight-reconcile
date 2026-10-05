# MCP

Oversight Reconcile is both an MCP **client** and an MCP **server**. The server is the more
interesting half: it turns this product into a tool provider for other agents.

## Run the server

```bash
node packages/cli/dist/bin.js mcp serve
```

Speaks MCP over **stdio**. Diagnostics go to stderr, because stdout belongs to the protocol.

## Connect an agent

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

## The tools

Ten, all derived from the core registry — there is no second list to keep in sync. Inspect them
with `oversight-reconcile tools --json`, or read them off the wire:

| Tool                  | What it is for                                                              |
| --------------------- | --------------------------------------------------------------------------- |
| `parse_claims`        | prose → claim tree with byte-exact spans. Start here.                       |
| `reconcile_oversight` | claims + obligations + evidence → one verdict per claim, with a reason code |
| `ingest_document`     | read a document from disk, parse it, persist the claim tree                 |
| `list_documents`      | what has been ingested                                                      |
| `list_claims`         | stored claims with their spans                                              |
| `list_obligations`    | the register assembled from every active pack, and which packs loaded       |
| `list_runs`           | recorded reconciliations, newest first                                      |
| `compare_runs`        | per-verdict deltas between two runs                                         |
| `list_skills`         | the skill catalog                                                           |
| `list_plugins`        | the resolved plugin registry, including shadowed and rejected plugins       |

The first two reach the Python engine, which is what makes this a governance tool rather than a
document viewer: an agent can parse a policy document and reconcile it without ever seeing a
summary of one.

## Prove it

```bash
npm run prove:mcp
```

That script starts the built server as a child process, speaks real MCP to it with the
`@modelcontextprotocol/sdk` client, and calls tools that reach the engine:

```console
  [PASS] initialize over stdio
  [PASS] tools/list
         10 tools: compare_runs, ingest_document, list_claims, list_documents, list_obligations, list_plugins, list_runs, list_skills, parse_claims, reconcile_oversight
  [PASS] tools/call parse_claims reached the engine
         1 claim, tree digest b42366a143c1cc6f
  [PASS] tools/call reconcile_oversight reached the engine
         byVerdict {"contradicted":0,"supported":0,"unbacked":0,"unevidenced":1,"unmet":0}
  [PASS] invalid input returns an error envelope, not a crash
         VALIDATION_FAILED: "text" must be a non-empty string

  7 passed, 0 failed
```

## Rules

1. **A new model-facing CLI command must also ship as an MCP tool.** If an agent can do it from
   the terminal, another agent must be able to do it over MCP.
2. **MCP tools are stateless.** No session state may span calls. Everything persistent goes
   through `packages/memory`.
3. **Tool names must match `^[a-z][a-z0-9_]{0,63}$`.** A core tool named `fs.read` cannot be
   exposed without an explicit mapping, and the server refuses to start rather than renaming
   silently.
4. **Descriptions are written for a model**: what it does, when to use it, what it returns. A
   test asserts every description is over 60 characters and ends in a full stop, because a
   description that says nothing is a tool another agent cannot choose.
5. **No tool reaches the network.** A test asserts no tool declares `net:fetch` or
   `secrets:read`.

## Errors

Failures come back as an MCP error envelope carrying the stable code:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "VALIDATION_FAILED: \"text\" must be a non-empty string" }]
}
```

Engine errors keep their own stable codes in the same envelope: `BAD_SHAPE`, `MISSING_FIELD`,
`UNKNOWN_OP`, `INPUT_TOO_LARGE`.
