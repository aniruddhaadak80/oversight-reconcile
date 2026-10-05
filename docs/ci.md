# CI and quality gates

## Job names

Branch protection keys on exact names. Renaming one silently disables the protection.

| Job                 | Runs                                                      |
| ------------------- | --------------------------------------------------------- |
| `Format`            | `prettier --check .`                                      |
| `Lint`              | `eslint .`                                                |
| `Typecheck`         | `tsc --noEmit` across every package                       |
| `Policy gates`      | the six `check:*` scripts                                 |
| `Test`              | `vitest` across every package, Node 22 and 24             |
| `Python test`       | `pytest` + `ruff` + `mypy --strict`, Python 3.11 and 3.12 |
| `Build`             | turbo build + the Next.js production build                |
| `Evals`             | `node evals/run.mjs` over real governance prose           |
| `MCP proof`         | `node scripts/prove-mcp.mjs` — a real client over stdio   |
| `Doctor smoke test` | `oversight-reconcile doctor` must exit 0                  |
| `Secret scan`       | gitleaks over full history                                |
| `CodeQL`            | javascript-typescript and python                          |

The last two are the ones that cannot be faked by a passing unit test. `prove-mcp` spawns the
built server and speaks MCP to it; `doctor` spawns the Python engine. A green build with a broken
engine would still be caught by `Python test`, but a green build with a server that only works
in-process would not be caught without the proof.

## The aggregate gate

`npm run check` is the exact command CI runs, in the same order. That is deliberate: local and CI
cannot drift, so a green local run means a green CI run.

Policy gates run **before** the expensive ones. A stray hex literal should fail in 200ms, not
after a three-minute build.

## The policy gates

| Gate                    | Fails when                                                       |
| ----------------------- | ---------------------------------------------------------------- |
| `check:skill-version`   | a `SKILL.md` body changed without a `metadata.version` bump      |
| `check:no-secrets`      | a credential is committed, or a `.env` has values                |
| `check:theme-tokens`    | a raw colour literal appears outside `styles/tokens.css`         |
| `check:boundaries`      | a package imports another package's undeclared deep path         |
| `check:public-hygiene`  | junk files, committed caches, oversized binaries, leftover TODOs |
| `check:readme-commands` | the README names an `npm run X` that is not a real script        |

Each failure prints the file, the line, and the fix. A gate that only says "failed" wastes the
person running it.

`check:readme-commands` caught a real defect during this build: a PowerShell rewrite had left a
byte-order mark in `package.json`, so the gate's `JSON.parse` threw, its script list came back
empty, and every `npm run` in the README looked fictional. A gate that cannot read its own inputs
is worse than no gate, so this one is worth keeping.

## The Python gates

| Script                        | Tool                         |
| ----------------------------- | ---------------------------- |
| `npm run lint:python`         | `ruff check services/engine` |
| `npm run format:check:python` | `ruff format --check`        |
| `npm run typecheck:python`    | `mypy --strict`              |

The engine is `mypy --strict` clean because it is the credibility of the product. A `TypedDict`
that drifts from the wire format is a provenance bug waiting to happen.

## Supply chain

Every third-party action is pinned to a **commit SHA** with the version in a trailing comment. A
mutable tag means anyone who compromises the tag owns your CI.

## Adding a gate

1. Add `scripts/check-<name>.mjs`.
2. Wire it into `package.json` scripts.
3. Add it to `check` **before** the expensive steps.
4. Add a row to the table above.
5. Make sure it fails on a deliberately broken input — a gate that has never failed is not known
   to work.

## Local parity

```bash
npm run check     # identical to CI
```
