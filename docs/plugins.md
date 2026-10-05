# Plugins and obligation packs

A plugin in this product is **data with a manifest**. The only thing one can contribute today is
an obligation pack: the machine-checkable half of a governance framework.

That is a deliberate constraint. A reviewer must be able to read every obligation, its severity
and how many artifacts it demands without running anything, and must be able to diff a framework's
duties in a pull request like any other artifact.

## Manifest contract

`plugins/<name>/plugin.json`:

| Field          | Type     | Rule                                                      |
| -------------- | -------- | --------------------------------------------------------- |
| `name`         | string   | `^[a-z0-9][a-z0-9-]*$`                                    |
| `version`      | string   | `\d+\.\d+\.\d+$`                                          |
| `description`  | string   | at least 10 characters                                    |
| `enabled`      | boolean  | default `true`                                            |
| `priority`     | 0–100    | default `50`; decides capability conflicts                |
| `capabilities` | string[] | the names this plugin claims                              |
| `engines`      | record   | exact version matches; a mismatch rejects the plugin      |
| `obligations`  | string   | optional; path to the pack file, relative to the manifest |

Without the `obligations` key the plugin loads and contributes nothing. `doctor`'s `register` row
tells you which packs actually loaded and how many obligations each contributed.

## Pack contract

`plugins/<name>/obligations.json`:

```json
{
  "framework": "EU AI Act",
  "version": "1.0.0",
  "description": "Machine-checkable reading of the duties a deployer must evidence.",
  "obligations": [
    {
      "id": "EU-ART-14-HUMAN-OVERSIGHT",
      "code": "Art. 14(1)",
      "source": "EU AI Act",
      "statement": "high-risk systems must be effectively overseen by natural persons",
      "kind": "oversight",
      "cues": ["oversight.human-review"],
      "evidenceRequired": 1,
      "evidenceKind": "document",
      "severity": "blocker"
    }
  ]
}
```

| Field              | Rule                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `id`               | unique within the pack, stable across versions — verdicts reference it |
| `code`             | the human-facing reference, e.g. `Art. 14(1)`                          |
| `statement`        | at least 8 characters; this is what a `unmet` finding prints           |
| `kind`             | decides which claims the obligation can govern                         |
| `cues`             | optional explicit cue ids; when present they replace the implied set   |
| `evidenceRequired` | 0–10; `0` means "declared, no artifact needed"                         |
| `evidenceKind`     | `document` (default), `run` or `manual`                                |
| `severity`         | `blocker`, `major` or `minor`                                          |

A pack with an invalid field is **rejected with its JSON path**, e.g.
`eu-ai-act: plugins/eu-ai-act/obligations.json: obligations.0.id — ...`. A duplicate obligation id
rejects the whole pack rather than silently dropping one row.

## How an obligation matches a claim

Scoring is declared, not learned:

| Signal                                                     | Weight |
| ---------------------------------------------------------- | ------ |
| an **explicit** cue id matches a claim's cue ids           | 3 each |
| the obligation's `kind` equals the claim's `kind`          | 2      |
| an **implied** cue id matches (only when `cues` is absent) | 1 each |

The highest score wins. A tie breaks on the smallest obligation `id`, so resolution is
deterministic. Because a pinned cue scores 3 on top of any kind match, an explicit obligation
always outranks an inferred one.

Pinning `cues` is how you catch a document that contradicts itself:

```json
{ "kind": "any", "cues": ["exclusion.never", "commitment.retain"] }
```

That single obligation governs both "we retain X" and "we never retain X", so a document that
says both is reported as `contradicted` rather than as two unrelated claims.

## Capabilities and conflicts

Plugins are sorted by priority descending, then by name. A plugin claiming a capability an
already-accepted plugin holds is **shadowed** and reported — not dropped. That is why the two
shipped packs claim `obligation-pack.eu-ai-act` and `obligation-pack.nist-ai-rmf` separately, and
only `eu-ai-act` claims the shared `obligation-pack`: otherwise the higher-priority plugin would
shadow the other and one framework would silently vanish.

## Inspect

```bash
oversight-reconcile mcp call list_plugins '{}'
oversight-reconcile mcp call list_obligations '{}'
```

The first separates `active`, `disabled` and `rejected`, and every rejection carries its reason.
The second returns the assembled register plus the packs that produced it.

## A plugin gets no privileged path

A pack is data. There is no plugin code path that bypasses permission checks or validation,
because there is no plugin code.
