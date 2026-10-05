# ADR 0004: provenance is the currency, not the summary

- **Status:** accepted
- **Date:** 2026-10-05
- **Supersedes:** nothing

## Context

The obvious way to build this product is to hand a governance document to a model and ask it which
of its claims are backed by evidence. That returns a summary, in prose, within seconds.

An oversight artifact has to survive a different test. A regulator, or an engineer debugging a
regression eighteen months later, must be able to take the artifact and check it against the
source: _which bytes say this?_ A summary cannot answer that. A paraphrase cannot be compared to
the original. A claim attributed to line 37 that is actually on line 41 is worse than no claim,
because it looks checkable.

There is a second requirement that follows from the first. A finding handed to someone outside the
organisation has to be **reproducible**. Re-running it must produce the same answer, on the same
bytes, without a model version, an account, a network connection, or the original author's
prompt.

## Decision

Provenance is expressed in bytes, not lines or characters, and it is computed by a parser.

- Every claim carries `(byteStart, byteEnd, line, column)`, with the byte offsets into the
  document's UTF-8 encoding.
- The invariant `text.encode("utf-8")[start:end].decode("utf-8") == claim.quote` is asserted in
  the unit tests, in the eval suite, and by the golden file. It is the one property the product
  cannot lose.
- Byte offsets rather than character offsets, because a document card contains em dashes and curly
  quotes. Character offsets would make every span wrong for every non-ASCII document while still
  looking right in a test written in ASCII.
- The parser is a bounded structural walk with a small, reviewable cue lexicon — not a classifier
  and not a model. A governance reviewer must be able to read every rule that can fire.
- Overflow is a diagnostic, not an exception. `NO_CLAIMS` on an empty document is a **result**, and
  the product says so rather than raising.

The report artifact is committed to the repository, and the web app renders those bytes rather than
running a live query. A governance page whose numbers change between two page loads is not
evidence.

## Consequences

**Worth it:** a claim is citable before it is judged; the whole parse-and-reconcile path replays
from the same bytes with no external dependency; the verdict is diffable in a pull request; and
"nothing changed since last quarter" becomes a provable statement about a digest rather than a
feeling.

**Cost:** the lexicon is small and needs curating. A phrase the parser does not know is a phrase it
cannot reconcile, and the fix is an explicit cue in `claims.py` plus a golden-file regeneration —
which is a deliberate, reviewed diff rather than a silent behaviour change. The parser also cannot
follow a sentence across a line break, so a claim that wraps mid-sentence is quoted to the end of
the line. That is a real limitation, and it is honest: the span still points at exactly the bytes
it quotes.

**Rejected alternatives:**

- _Character offsets._ Simpler, and wrong for every document that is not pure ASCII.
- _A model-produced span._ A model cannot emit a byte offset, and cannot be held to the invariant
  above.
- _Hash-based citation_ (`claim` → `sha256(claim text)`). Verifiable but not locatable: it proves a
  sentence appeared somewhere, not where.
- _Line numbers only._ Breaks on any edit above the claim, which makes the artifact unusable as a
  diff.
