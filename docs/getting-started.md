# Getting started

## Requirements

- Node 22.12 or newer (`.nvmrc` pins the tested version)
- Python 3.11 or newer — only for the deterministic engine

## Install

```bash
git clone https://github.com/aniruddhaadak80/oversight-reconcile.git
cd oversight-reconcile
npm install
npm run build
```

`npm install` runs `prettier --write .` as its `prepare` step, so the tree is already formatted.
If `better-sqlite3` has no prebuilt binary for your platform, `npm rebuild better-sqlite3` fetches
or compiles it.

## Verify the install

```bash
node packages/cli/dist/bin.js doctor
```

It spawns the engine, opens the store, and parses every shipped obligation pack. It is the fastest
way to confirm a working install, and every failing row carries the fix. `npm link` puts
`oversight-reconcile` on your `PATH` if you would rather not write the long path out.

## First run

```bash
node packages/cli/dist/bin.js ingest docs/policy/meridian-system-card.md
node packages/cli/dist/bin.js inspect docs/policy/meridian-system-card.md
node packages/cli/dist/bin.js reconcile --evidence evidence/example.json --fail-on blocker
node packages/cli/dist/bin.js runs
```

Read `inspect` before `reconcile`. The point of the product is that a claim is citable before you
judge it, and the tree is where that is proven.

## Publish a report

```bash
npm run report
```

Writes `apps/web/content/oversight/latest.json`. It is a committed artifact on purpose: the web
report renders the committed bytes rather than running a live query, so the numbers on the page
are the numbers in the repository and a diff is reviewable.

`report` exits `3` when the reconciliation found a blocker. That is the gate working, not a
failure of the command.

## Run the web report

```bash
npm run build --workspace @oversightreconcile/web
cd apps/web && npx next start -p 4317
```

Then read <http://localhost:4317>, <http://localhost:4317/register>,
<http://localhost:4317/surfaces>, <http://localhost:4317/health>, and the machine-readable
<http://localhost:4317/api/health>.

## Run the tests

```bash
npm test                # TypeScript, every package
npm run pytest          # the Python engine: unit, property and golden tests
npm run evals           # scored cases over real governance prose
npm run prove:mcp       # a real MCP client over stdio, against the built server
npm run check           # everything CI runs
```

## Regenerate the golden file

The engine is deterministic, so any change to the lexicon, the sentence splitter or a verdict rule
changes its output. That is deliberate, and the golden file is what makes the change visible:

```bash
GOLDEN_UPDATE=1 python -m pytest services/engine/tests/test_golden.py -q
git diff services/engine/tests/golden
```
