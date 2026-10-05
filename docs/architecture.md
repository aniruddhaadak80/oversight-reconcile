# Architecture

## The narrow waist

Every capability is a `Tool`. One registry. One interface. Three transports.

```
                    +--------------+
   CLI ------------>|              |
   Web ------------>|  ToolRegistry|--> packages/memory  (SQLite, WAL, FTS5)
   MCP server ----->|              |
                    +--------------+
                          |
                          +--> services/engine  (pure Python, stdin/stdout)
                          +--> plugins/*        (obligation packs, data not code)
```

The CLI, the web report and the MCP server are transports. None of them contains product logic.
If one of them needs a behaviour, that behaviour belongs in a tool.

## What the product actually computes

Two pure functions carry the credibility of the product, and both live in `services/engine`:

| Function                                   | Input                      | Output                                                            |
| ------------------------------------------ | -------------------------- | ----------------------------------------------------------------- |
| `parse_claims(text, limits)`               | untrusted governance prose | a typed claim tree; every claim has a **byte-exact** span         |
| `reconcile(claims, obligations, evidence)` | the tree plus a register   | one verdict per claim and per obligation, each with a reason code |

`parse_claims` is a bounded structural parser, not a classifier: it walks physical lines, tracks
the heading stack for section paths, splits sentences with an abbreviation guard, and matches a
small reviewable cue lexicon. The invariant it must never break is

```
text.encode("utf-8")[claim.span.byteStart : claim.span.byteEnd].decode("utf-8") == claim.quote
```

which is asserted in the test suite, in the eval suite, and by the golden file.

`reconcile` is a total function of its input. Permuting `claims`, `obligations` or `evidence`
does not change the output, and re-running it produces an identical report digest. Three
properties make that true: a declared scoring rule for obligation/claim matching with an explicit
tie-break, verdicts sorted into a canonical order, and a digest computed over that canonical
order rather than over input order.

See [adr/0002-python-engine-boundary.md](adr/0002-python-engine-boundary.md) and
[adr/0004-provenance-as-the-currency.md](adr/0004-provenance-as-the-currency.md).

## Invariants

1. **Tools are stateless.** State lives in `packages/memory`, addressed through the context.
2. **Input is validated before the handler runs.** Never after, never partially.
3. **Permissions are declared, not assumed.** An ungranted permission refuses the call _before_
   invocation, and an empty grant list is a sandbox with nothing in it — not "grant the lowest
   rank", which is how `fs:read` would leak into every unconfigured call.
4. **Duplicate tool names throw**, naming both registrants. A silent overwrite is an
   undebuggable product bug.
5. **No cross-package deep imports.** Only declared entry points. Enforced by
   `check:boundaries`.
6. **No tool reaches the network.** No tool declares `net:fetch` or `secrets:read`, and a test
   asserts it, because a governance verdict that phoned out could not be replayed.

## The footprint ladder

Where new capability goes, in order of preference:

1. Extend an existing tool's input schema
2. Add a CLI command plus a skill
3. Add a plugin-gated tool
4. Add an MCP server tool
5. Add a new Python engine operation
6. Add a new core tool — last resort

Every core tool is paid for in context window on every request, forever. Plugins are free. That
asymmetry is the whole reason for the ladder.

## Packages

| Package         | Responsibility                                                               |
| --------------- | ---------------------------------------------------------------------------- |
| `core`          | the `Tool` interface, the registry, permissions, the error taxonomy. No I/O. |
| `config`        | layered config; the zod schema is the source of truth                        |
| `memory`        | SQLite storage, numbered migrations, FTS5 over claim text                    |
| `skills`        | `SKILL.md` discovery, frontmatter parsing, catalog validation                |
| `plugins`       | manifest loading, schema validation, priority resolution, obligation packs   |
| `engine-client` | typed subprocess bridge to the Python engine                                 |
| `mcp`           | MCP server (stdio) and MCP client, both over the core registry               |
| `cli`           | commander CLI; the claim-tree inspector is the flagship surface              |
| `sdk`           | the public facade — the stable surface and nothing else                      |
| `channels`      | one `Channel` interface; **no adapter ships** — see the omission below       |
| `providers`     | one `Provider` interface; **only the deterministic local one ships**         |

## Deliberate omissions, and why they are not gaps

**`apps/web` has no workspace-package dependencies.** The deployed bundle is self-contained,
which removes build-order coupling between the monorepo and the deployment target. The cost is
that the web app reads its own data layer rather than importing `packages/memory`; the benefit is
a deploy that cannot break because a workspace build reordered itself.

See [adr/0003-web-app-self-contained.md](adr/0003-web-app-self-contained.md).

**No channel adapter ships.** The interface, the base class and the local adapter exist and are
tested, but a shipping adapter would mean this product can push findings at someone. Findings are
read by a person who is accountable for them.

**No model provider adapter ships.** `LocalProvider` is deterministic and offline. It exists so
the provider seam is real and so nothing in the parse or reconcile path can quietly acquire a
network dependency.

**No desktop shell.** `apps/desktop` is not part of this product. An oversight review happens in
a terminal and in a browser; an Electron wrapper would add a native menu around a web app with no
desktop-only behaviour behind it.
