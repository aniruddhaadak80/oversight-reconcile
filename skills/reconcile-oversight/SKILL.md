---
name: reconcile-oversight
description: Use when a governance document must be checked against an obligation register, because the verdicts and their exit code are what a reviewer or a pipeline acts on.
metadata:
  version: 1.0.0
---

# Run an oversight reconciliation

## When to use this

You have published AI governance prose and need to know which of its claims are actually
evidenced, which obligations nothing addresses, and where the document contradicts itself.

## Steps

1. `oversight-reconcile doctor` — do this first. A reconciliation over an empty register
   reports every claim as `unbacked`, which is a true statement about nothing.
2. `oversight-reconcile ingest docs/policy/*.md` — parses each document and persists its
   claim tree. Re-ingesting a changed file replaces its claims, because a stale span points
   into bytes that no longer exist.
3. `oversight-reconcile inspect docs/policy/<file>.md` — read the tree before the verdicts.
   Each row shows `line:column` and the UTF-8 byte range, so you can check any claim against
   the source yourself.
4. `oversight-reconcile reconcile --evidence <file> --fail-on blocker` — reconcile every
   stored claim against every active obligation pack. Exit 3 means a finding exists at or
   above the threshold; that is the CI gate, not a crash.

## Reading the verdicts

| Verdict        | Means                                                       | The move                                                       |
| -------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `supported`    | an obligation governs it and enough artifacts are on record | nothing                                                        |
| `unevidenced`  | an obligation governs it and the artifacts are short        | produce the artifact, or lower `evidenceRequired` deliberately |
| `contradicted` | the same document affirms and denies it                     | fix the document; one of the two sentences is wrong            |
| `unbacked`     | no obligation in the register governs it                    | add an obligation, or accept that the claim is unchecked       |
| `unmet`        | nothing in any document addresses an obligation             | the document is silent on a duty your framework requires       |

`unmet` rows are the ones reviewers skip. They are the point: a framework list that reads as
a checklist of things you have done is worse than useless.

## Compare against a previous run

1. `oversight-reconcile runs` — list run ids, newest first.
2. `oversight-reconcile compare <beforeId> <afterId>` — per-verdict deltas, plus whether the
   underlying claim tree changed. If `treeChanged` is true the documents moved, so a verdict
   delta may be a text edit rather than a governance change.

## Verify

`oversight-reconcile reconcile --evidence <file> --fail-on blocker` exits 0 or 3, and
`oversight-reconcile runs --json` lists the run it recorded.
