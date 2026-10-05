---
name: author-obligation-pack
description: Use when a governance framework needs to become machine-checkable in this repository, because an obligation pack is the only thing a claim tree is ever measured against.
metadata:
  version: 1.0.0
---

# Author an obligation pack

## When to use this

You are adding a framework — or a subset of one — so that published claims get measured
against it.

## Shape

A pack is a plugin directory with two files:

```
plugins/<framework>/
  plugin.json      # the manifest: name, version, capabilities, obligations
  obligations.json # the pack: framework, version, description, obligations[]
```

## Steps

1. Create `plugins/<framework>/plugin.json` with a unique `name`, a `version`, a
   `description` of at least ten characters, and `capabilities` including
   `obligation-pack` plus `obligation-pack.<framework>` — the shared capability would
   otherwise be claimed by whichever plugin sorts first and the loser would be dropped.
2. Point `"obligations": "obligations.json"` at the pack file. Without this key the plugin
   loads and contributes nothing.
3. Write `plugins/<framework>/obligations.json`. Every obligation needs `id`, `code`,
   `source`, `statement`, `kind`, `evidenceRequired`, `severity`, and optionally `evidenceKind`
   (default `document`) and `cues`.
4. Set `severity` honestly. `blocker` fails a pipeline at `--fail-on blocker`; if a framework
   is advisory, no obligation in it should be a blocker.
5. `oversight-reconcile doctor` — the `register` row names every pack and its obligation
   count, and fails with a JSON path if a pack does not validate.
6. `oversight-reconcile reconcile --evidence <file>` — check the coverage. A pack whose every
   obligation is `unmet` is usually a cue problem, not a document problem.

## Choosing `kind` and `cues`

`kind` decides which claims the obligation can govern; the cue ids are derived from it. Leave
`cues` out for the common case. Pin `cues` explicitly when one obligation must govern both
sides of a statement:

```json
{ "kind": "any", "cues": ["exclusion.never", "commitment.retain"] }
```

That pair is how a document gets caught affirming and denying the same duty in two sections.
An explicit cue match always outranks an inferred one, so a pinned obligation wins ties.

## Rules

1. A pack is **data**. Do not add code to a plugin: obligations must be diffable and
   reviewable without running anything.
2. `id` must be unique within the pack and stable across versions — verdicts reference it.
3. Every `cues` entry must exist in the engine lexicon. A typo is refused at load with the
   offending id named.
4. `evidenceRequired: 0` means "declared, no artifact needed". Use it sparingly; it turns
   the obligation into an assertion.

## Verify

`oversight-reconcile doctor` exits 0, and `oversight-reconcile mcp call list_obligations '{}'`
lists your pack with its obligation count.
