"""Claim extraction: untrusted governance prose in, a typed claim tree out.

This module is the reason the product exists. Every claim it emits carries a
**byte-exact** provenance span: the invariant ``text.encode("utf-8")[byteStart:byteEnd]
.decode("utf-8") == quote`` is asserted in the test suite and is what makes an oversight
artifact citable. A model cannot produce a byte offset; it can produce a sentence that
looks like one, which is worse than nothing.

Three properties are load-bearing and must not be traded away:

1. **Byte-exact spans.** Offsets are UTF-8 byte offsets into the original document, so a
   consumer in any language can slice the source and get the quote back.
2. **Determinism.** Output depends only on the input bytes. Cue resolution is a total
   order (earliest position, then longest phrase), never "the first one the scanner saw".
3. **Bounded work.** Depth and claim count are capped and the overflow is reported as a
   diagnostic. Malformed input yields diagnostics, never an exception — a claim tree that
   is not produced at all is useless to a reviewer.

No clock, no network, no randomness, no filesystem.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Final, TypedDict

from .protocol import EngineError

#: Bumped whenever the cue table or the resolution rule changes. Recorded in the tree
#: digest so a stored report states which lexicon produced it.
LEXICON_VERSION: Final[str] = "1.0.0"

#: A governance card is a few kilobytes. Anything larger is a data dump, not prose.
MAX_DOCUMENT_BYTES: Final[int] = 1024 * 1024

DEFAULT_MAX_CLAIMS: Final[int] = 512
DEFAULT_MAX_DEPTH: Final[int] = 6
ROOT_SECTION: Final[str] = "(document root)"

#: Words that end in a period without ending a sentence.
_ABBREVIATIONS: Final[frozenset[str]] = frozenset(
    {
        "e.g",
        "i.e",
        "etc",
        "cf",
        "vs",
        "al",
        "dr",
        "mr",
        "ms",
        "prof",
        "fig",
        "sec",
        "no",
        "vol",
        "st",
        "approx",
        "incl",
        "resp",
        "art",
        "para",
        "ch",
        "pp",
        "ed",
        "eds",
        "min",
        "max",
        "avg",
        "std",
    }
)

#: Leading words stripped from a subject phrase, repeatedly, before it is used.
_FILLER: Final[re.Pattern[str]] = re.compile(
    r"^(?:that|the|a|an|to|and|we|our|us|all|any|every|with|for|in|on|of|at|by|as|is|are"
    r"|will|has|have|had|can|may|must|should|shall|not|no|,|;|:|\s)+",
    re.IGNORECASE,
)

MAX_SUBJECT_CHARS: Final[int] = 80
_MAX_SUBJECT_WORDS: Final[int] = 12
#: Below this, a "subject" is not a subject. A cue at the start of a sentence falls back to
#: the cue's declared subject instead of producing "We".
MIN_SUBJECT_CHARS: Final[int] = 3


@dataclass(frozen=True)
class Cue:
    """One governance cue phrase and what it asserts when found."""

    id: str
    phrase: str
    kind: str
    polarity: str
    subject: str


# The lexicon, in full. It is deliberately small and reviewable: a governance reviewer has
# to be able to read every rule that can fire, which is the opposite of a classifier.
CUES: Final[tuple[Cue, ...]] = (
    Cue("assurance.ensure", "we ensure", "assurance", "affirmed", "assurance"),
    Cue("assurance.guarantee", "we guarantee", "assurance", "affirmed", "assurance"),
    Cue("assurance.committed", "we are committed", "commitment", "affirmed", "commitment"),
    Cue("attestation.attest", "we attest", "attestation", "affirmed", "attestation"),
    Cue("attestation.certify", "we certify", "attestation", "affirmed", "attestation"),
    Cue("attestation.confirm", "we confirm", "attestation", "affirmed", "attestation"),
    Cue("exclusion.never", "we never", "exclusion", "denied", "exclusion"),
    Cue("exclusion.do-not", "we do not", "exclusion", "denied", "exclusion"),
    Cue("exclusion.dont", "we don't", "exclusion", "denied", "exclusion"),
    Cue("exclusion.will-not", "we will not", "exclusion", "denied", "exclusion"),
    Cue("disclosure.disclose", "we disclose", "disclosure", "affirmed", "disclosure"),
    Cue("disclosure.publish", "we publish", "disclosure", "affirmed", "disclosure"),
    Cue("disclosure.documented", "is documented", "disclosure", "affirmed", "documentation"),
    Cue("commitment.maintain", "we maintain", "commitment", "affirmed", "maintenance"),
    Cue("commitment.monitor", "we monitor", "commitment", "affirmed", "monitoring"),
    Cue("commitment.review", "we review", "commitment", "affirmed", "review"),
    Cue("commitment.audit", "we audit", "commitment", "affirmed", "audit"),
    Cue("commitment.retain", "we retain", "retention", "affirmed", "retention"),
    Cue("commitment.retention-period", "retention period", "retention", "affirmed", "retention"),
    Cue("commitment.retention", "data retention", "retention", "affirmed", "retention"),
    Cue("oversight.human-review", "human review", "oversight", "affirmed", "human review"),
    Cue("oversight.human-oversight", "human oversight", "oversight", "affirmed", "human oversight"),
    Cue("oversight.appeal", "appeal", "redress", "affirmed", "appeal"),
    Cue("oversight.opt-out", "opt out", "redress", "affirmed", "opt-out"),
    Cue("oversight.consent", "consent", "consent", "affirmed", "consent"),
    Cue("accountability.audit-log", "audit log", "accountability", "affirmed", "audit log"),
    Cue("accountability.audit-trail", "audit trail", "accountability", "affirmed", "audit trail"),
    Cue("fairness.bias", "bias", "fairness", "affirmed", "bias"),
    Cue("fairness.fairness", "fairness", "fairness", "affirmed", "fairness"),
    Cue(
        "transparency.explainability",
        "explainability",
        "transparency",
        "affirmed",
        "explainability",
    ),
    Cue(
        "transparency.interpretability",
        "interpretability",
        "transparency",
        "affirmed",
        "interpretability",
    ),
    Cue("performance.accuracy", "accuracy", "performance", "affirmed", "accuracy"),
    Cue("performance.measure", "we measure", "metric", "affirmed", "measurement"),
    Cue("metric.subgroup", "subgroup", "metric", "affirmed", "subgroup metric"),
    Cue("metric.disparate-impact", "disparate impact", "metric", "affirmed", "disparate impact"),
)

_CUE_PATTERNS: Final[dict[str, re.Pattern[str]]] = {
    cue.id: re.compile(rf"(?<![\w-]){re.escape(cue.phrase)}(?![\w-])", re.IGNORECASE)
    for cue in CUES
}


class Span(TypedDict):
    """Byte-exact provenance. Offsets are UTF-8 byte offsets into the source document."""

    byteStart: int
    byteEnd: int
    line: int
    column: int


class Claim(TypedDict):
    id: str
    parentId: str | None
    depth: int
    section: str
    kind: str
    polarity: str
    subject: str
    quote: str
    span: Span
    cues: list[str]


class Diagnostic(TypedDict):
    code: str
    message: str
    line: int


class ParseInput(TypedDict, total=False):
    text: str
    limits: Limits


class Limits(TypedDict, total=False):
    maxClaims: int
    maxDepth: int


class ParseOutput(TypedDict):
    lexiconVersion: str
    claims: list[Claim]
    sections: list[str]
    diagnostics: list[Diagnostic]
    truncated: bool
    maxDepthReached: int
    counts: dict[str, object]
    digest: str


@dataclass(frozen=True)
class _Line:
    """One physical line, with a precomputed char-index -> byte-offset table."""

    number: int
    text: str
    byte_start: int
    prefix: tuple[int, ...]

    def byte_at(self, char_index: int) -> int:
        return self.byte_start + self.prefix[char_index]


def _prefix_bytes(text: str) -> tuple[int, ...]:
    """Prefix byte lengths. ASCII fast path; otherwise count UTF-8 per character."""
    if text.isascii():
        return tuple(range(len(text) + 1))
    out = [0]
    total = 0
    for char in text:
        total += len(char.encode("utf-8"))
        out.append(total)
    out.append(total)
    return tuple(out)


def _split_lines(text: str) -> list[_Line]:
    lines: list[_Line] = []
    byte_start = 0
    number = 1
    for raw in text.split("\n"):
        lines.append(_Line(number, raw, byte_start, _prefix_bytes(raw)))
        # +1 for the newline that split() removed. The final segment adds one byte that no
        # line ever references, which is harmless: no span can reach it.
        byte_start += len(raw.encode("utf-8")) + 1
        number += 1
    return lines


def _is_abbreviation(line: str, dot_index: int, start: int) -> bool:
    match = re.search(r"[A-Za-z][A-Za-z.]*$", line[start:dot_index])
    if match is None:
        return False
    token = match.group(0).rstrip(".").lower()
    if token in _ABBREVIATIONS:
        return True
    # An initial: "J. Smith" must not split after the initial.
    return len(token) == 1 and match.group(0)[0].isupper()


def _sentence_spans(text: str) -> list[tuple[int, int]]:
    """Sentence boundaries as character spans, inclusive of the terminator."""
    spans: list[tuple[int, int]] = []
    start = 0
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char not in ".!?":
            index += 1
            continue
        after = index + 1
        while after < length and text[after] in "\"'”)]":
            after += 1
        boundary = True
        if after < length and not text[after].isspace():
            boundary = False  # a decimal point, a version, a path
        elif char == "." and _is_abbreviation(text, index, start):
            boundary = False
        if not boundary:
            index = after
            continue
        spans.append((start, after))
        index = after
        while index < length and text[index].isspace():
            index += 1
        start = index
    if start < length:
        spans.append((start, length))
    return spans


def _normalise_subject(prefix: str, fallback: str) -> str:
    candidate = prefix
    while True:
        stripped = _FILLER.sub("", candidate, count=1)
        if stripped == candidate:
            break
        candidate = stripped
    candidate = candidate.strip().strip(",;:-—").strip()
    words = candidate.split()
    if len(words) > _MAX_SUBJECT_WORDS:
        candidate = " ".join(words[:_MAX_SUBJECT_WORDS])
    if len(candidate) < MIN_SUBJECT_CHARS:
        return fallback
    if len(candidate) > MAX_SUBJECT_CHARS:
        return candidate[: MAX_SUBJECT_CHARS - 1].rstrip() + "…"
    return candidate


def _match_cues(text: str) -> list[tuple[int, int, Cue]]:
    """Every cue occurrence, ordered by (position, -phrase length). Total and stable."""
    found: list[tuple[int, int, Cue]] = []
    for cue in CUES:
        for match in _CUE_PATTERNS[cue.id].finditer(text):
            found.append((match.start(), -len(cue.phrase), cue))
    found.sort(key=lambda item: (item[0], item[1], item[2].id))
    return found


def _bounded_int(raw: object, fallback: int, minimum: int, maximum: int) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        return fallback
    return max(minimum, min(maximum, raw))


def _limits(payload: ParseInput) -> tuple[int, int]:
    raw = payload.get("limits")
    if not isinstance(raw, dict):
        return DEFAULT_MAX_CLAIMS, DEFAULT_MAX_DEPTH
    return (
        _bounded_int(raw.get("maxClaims"), DEFAULT_MAX_CLAIMS, 1, 10_000),
        _bounded_int(raw.get("maxDepth"), DEFAULT_MAX_DEPTH, 1, 6),
    )


_HEADING: Final[re.Pattern[str]] = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_BULLET: Final[re.Pattern[str]] = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$")
_QUOTE: Final[re.Pattern[str]] = re.compile(r"^\s*>\s?(.*)$")
_TABLE: Final[re.Pattern[str]] = re.compile(r"^\s*\|.*\|\s*$")
_FENCE: Final[re.Pattern[str]] = re.compile(r"^\s*(?:```|~~~)")


def _strip_markers(line: str) -> tuple[str, int]:
    """Return the prose content of a line and the character index where it starts."""
    quote = _QUOTE.match(line)
    if quote is not None:
        return quote.group(1), quote.start(1)
    bullet = _BULLET.match(line)
    if bullet is not None:
        return bullet.group(2), bullet.start(2)
    stripped = line.lstrip()
    return stripped, len(line) - len(stripped)


@dataclass
class _Walk:
    """Mutable accumulator for one document walk. Kept separate so the walk can be tested."""

    claims: list[Claim] = field(default_factory=list)
    sections: list[str] = field(default_factory=list)
    stack: list[tuple[int, str]] = field(default_factory=list)
    last_at_depth: dict[int, str] = field(default_factory=dict)
    max_depth_reached: int = 0
    truncated: bool = False

    def see_section(self, section: str) -> None:
        if section not in self.sections:
            self.sections.append(section)

    def push_heading(self, level: int, title: str) -> None:
        while self.stack and self.stack[-1][0] >= level:
            self.stack.pop()
        self.stack.append((level, title))

    @property
    def depth(self) -> int:
        return max(1, self.stack[-1][0] if self.stack else 1)

    @property
    def section(self) -> str:
        return _section_path(self.stack)

    def add(self, claim: Claim) -> None:
        depth = claim["depth"]
        for deeper in [key for key in self.last_at_depth if key >= depth]:
            del self.last_at_depth[deeper]
        self.last_at_depth[depth] = claim["id"]
        self.max_depth_reached = max(self.max_depth_reached, depth)
        self.claims.append(claim)


def _line_claims(line: _Line, content: str, content_at: int, walk: _Walk) -> list[Claim]:
    """Every claim on one line, with byte-exact spans resolved against the document."""
    out: list[Claim] = []
    depth = walk.depth
    for sent_start, sent_end in _sentence_spans(content):
        sentence = content[sent_start:sent_end]
        matches = _match_cues(sentence)
        if not matches:
            continue
        primary = matches[0][2]
        char_index = content_at + sent_start
        out.append(
            {
                "id": f"c{len(walk.claims) + len(out) + 1}",
                "parentId": walk.last_at_depth.get(depth - 1),
                "depth": depth,
                "section": walk.section,
                "kind": primary.kind,
                "polarity": primary.polarity,
                "subject": _normalise_subject(sentence[: matches[0][0]], primary.subject),
                "quote": sentence,
                "span": {
                    "byteStart": line.byte_at(char_index),
                    "byteEnd": line.byte_at(content_at + sent_end),
                    "line": line.number,
                    "column": char_index + 1,
                },
                "cues": sorted({cue.id for _, _, cue in matches}),
            }
        )
    return out


def _apply_heading(line: _Line, walk: _Walk, max_depth: int, diagnostics: list[Diagnostic]) -> None:
    """Push a heading onto the section stack, clamping its level and reporting the clamp."""
    heading = _HEADING.match(line.text)
    if heading is None:
        return
    level = len(heading.group(1))
    if level > max_depth:
        diagnostics.append(
            {
                "code": "MAX_DEPTH",
                "message": f"heading level {level} clamped to maxDepth {max_depth}",
                "line": line.number,
            }
        )
        level = max_depth
    walk.push_heading(level, heading.group(2).strip())
    walk.see_section(walk.section)


def _walk_document(
    lines: list[_Line], max_claims: int, max_depth: int
) -> tuple[_Walk, list[Diagnostic]]:
    """Walk the document once, returning the claim tree and everything it skipped."""
    walk = _Walk()
    diagnostics: list[Diagnostic] = []
    in_fence = False
    fence_line = 0

    for line in lines:
        if _FENCE.match(line.text):
            in_fence = not in_fence
            fence_line = line.number if in_fence else 0
            continue
        if in_fence:
            continue

        if _HEADING.match(line.text):
            _apply_heading(line, walk, max_depth, diagnostics)
            continue

        if line.text.strip() == "" or _TABLE.match(line.text):
            # A table row is machine-shaped, not prose; its cells belong in a table
            # renderer, not in a claim tree.
            continue

        content, content_at = _strip_markers(line.text)
        if content.strip() == "":
            continue
        walk.see_section(walk.section)
        for claim in _line_claims(line, content, content_at, walk):
            walk.add(claim)
            if len(walk.claims) >= max_claims:
                walk.truncated = True
                break
        if walk.truncated:
            break

    if in_fence:
        diagnostics.append(
            {
                "code": "FENCE_UNTERMINATED",
                "message": f"code fence opened on line {fence_line} was never closed",
                "line": fence_line,
            }
        )
    if walk.truncated:
        diagnostics.append(
            {
                "code": "MAX_CLAIMS",
                "message": f"claim budget of {max_claims} reached; the remainder was not parsed",
                "line": 0,
            }
        )
    if not walk.claims:
        diagnostics.append(
            {
                "code": "NO_CLAIMS",
                "message": (
                    "no governance cue matched, so the document makes no claim this "
                    "lexicon can reconcile"
                ),
                "line": 0,
            }
        )
    return walk, diagnostics


def parse_claims(payload: ParseInput) -> ParseOutput:
    """Turn governance prose into a claim tree with byte-exact provenance."""
    text = payload.get("text")
    if not isinstance(text, str):
        raise EngineError("BAD_SHAPE", 'parse_claims requires a string "text"')
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_DOCUMENT_BYTES:
        raise EngineError(
            "INPUT_TOO_LARGE",
            f"document is {len(encoded)} bytes, limit is {MAX_DOCUMENT_BYTES}",
        )

    max_claims, max_depth = _limits(payload)
    walk, diagnostics = _walk_document(_split_lines(text), max_claims, max_depth)
    if not text.isascii():
        diagnostics.insert(
            0,
            {
                "code": "NON_ASCII",
                "message": (
                    "document contains non-ASCII characters, so byte offsets differ from "
                    "character offsets"
                ),
                "line": 1,
            },
        )

    return {
        "lexiconVersion": LEXICON_VERSION,
        "claims": walk.claims,
        "sections": walk.sections,
        "diagnostics": diagnostics,
        "truncated": walk.truncated,
        "maxDepthReached": walk.max_depth_reached,
        "counts": _counts(walk.claims),
        "digest": digest_claims(walk.claims),
    }


def _section_path(stack: list[tuple[int, str]]) -> str:
    if not stack:
        return ROOT_SECTION
    return " \u203a ".join(title for _, title in stack)


def _counts(claims: list[Claim]) -> dict[str, object]:
    by_kind: dict[str, int] = {}
    by_polarity: dict[str, int] = {}
    for claim in claims:
        by_kind[claim["kind"]] = by_kind.get(claim["kind"], 0) + 1
        key = claim["polarity"]
        by_polarity[key] = by_polarity.get(key, 0) + 1
    return {
        "total": len(claims),
        "byKind": dict(sorted(by_kind.items())),
        "byPolarity": dict(sorted(by_polarity.items())),
    }


def digest_claims(claims: list[Claim]) -> str:
    """A stable fingerprint of a claim tree: same claims in, same digest out.

    Claims are sorted by id first, so the digest is a property of the *set* of claims and
    cannot be moved by the order they were produced in. The digest covers only the fields
    that carry meaning, so a diagnostic change cannot silently invalidate a stored report —
    and a content change always does.
    """
    canonical = [
        {
            "id": claim["id"],
            "parentId": claim["parentId"],
            "depth": claim["depth"],
            "section": claim["section"],
            "kind": claim["kind"],
            "polarity": claim["polarity"],
            "subject": claim["subject"],
            "quote": claim["quote"],
            "span": claim["span"],
            "cues": claim["cues"],
        }
        for claim in sorted(claims, key=lambda item: item["id"])
    ]
    return _sha256(canonical)


def _sha256(value: object) -> str:
    blob = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


__all__ = [
    "CUES",
    "Claim",
    "Cue",
    "DEFAULT_MAX_CLAIMS",
    "DEFAULT_MAX_DEPTH",
    "Diagnostic",
    "LEXICON_VERSION",
    "Limits",
    "MAX_DOCUMENT_BYTES",
    "ParseInput",
    "ParseOutput",
    "Span",
    "digest_claims",
    "parse_claims",
]
