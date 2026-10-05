---
name: product-overview
description: Use when someone new to Oversight Reconcile needs to understand what it does and where its capabilities live, because the surface area is wider than one README can convey.
metadata:
  version: 1.0.0
---

# Oversight Reconcile overview

## When to use this

You are orienting yourself in Oversight Reconcile and need the map, not the detail.

## The one idea

Untrusted governance prose is parsed into a claim tree where every claim carries a
**byte-exact** span into the source, and that tree is reconciled against a machine-checkable
obligation register. The output is a verdict per claim: supported, unevidenced, contradicted,
unbacked, or unmet.

Provenance and reconciliation are code, not generation. That is the whole credibility claim:
a regulator gets the same verdict from the same bytes with no model version pinned.

## Steps

1. Run `oversight-reconcile doctor` — it probes every subsystem and prints a fix hint per failing row.
2. Run `oversight-reconcile tools --json` — the authoritative list of capabilities.
3. Read `docs/architecture.md` for the narrow waist and the footprint ladder.

## Where capability belongs

In order of preference. Adding to the core registry is the _last_ option, not the first:

1. Extend an existing tool's input schema
2. Add a CLI command plus a skill
3. Add a plugin-gated tool
4. Add an MCP server tool
5. Add a new Python engine operation
6. Add a new core tool

## The surfaces that exist

| Surface              | Entry point                                       |
| -------------------- | ------------------------------------------------- |
| Claim-tree inspector | `oversight-reconcile inspect <document>`          |
| Reconciliation gate  | `oversight-reconcile reconcile --fail-on blocker` |
| Published report     | `oversight-reconcile report`                      |
| Run ledger           | `oversight-reconcile runs`                        |
| MCP server           | `oversight-reconcile mcp serve`                   |
| Web report           | the deployed `/` route                            |

There is no desktop shell, no channel adapter, and no model provider. `/surfaces` states why.

## Verify

`oversight-reconcile doctor` exits 0 and `oversight-reconcile tools --json` lists ten tools.
