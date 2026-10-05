"""Reconciliation: a claim tree against an obligation register, as a total function.

The product's position is that a governance claim is only as good as the obligation behind
it, and an obligation is only as good as its evidence. This module turns (claims,
obligations, evidence) into a verdict per claim and per obligation, with a reason code for
every verdict. It is a **total function**:

* the same input always produces the same output, byte for byte;
* permuting ``claims``, ``obligations`` or ``evidence`` does not change the output;
* nothing is scored, ranked or judged — the verdicts come from declared rules only.

No clock, no network, no randomness, no model.
"""

from __future__ import annotations

import hashlib
import json
from typing import Final, TypedDict

from .claims import CUES, Claim
from .protocol import EngineError

#: Bumped when a verdict rule changes, so a stored report states which rules produced it.
RULES_VERSION: Final[str] = "1.0.0"

VERDICTS: Final[tuple[str, ...]] = ("supported", "unevidenced", "contradicted", "unbacked", "unmet")
SEVERITIES: Final[tuple[str, ...]] = ("blocker", "major", "minor")
POLARITIES: Final[tuple[str, ...]] = ("affirmed", "denied")
SEVERITY_RANK: Final[dict[str, int]] = {"minor": 0, "major": 1, "blocker": 2}

#: Verdicts that mean something is wrong. ``supported`` is the only verdict that passes, so
#: a clean run needs nothing further; anything else is a finding with a severity.
FAILING_VERDICTS: Final[tuple[str, ...]] = (
    "contradicted",
    "unmet",
    "unbacked",
    "unevidenced",
)

MAX_ITEMS: Final[int] = 5_000


class Obligation(TypedDict, total=False):
    id: str
    code: str
    source: str
    statement: str
    kind: str
    evidenceRequired: int
    severity: str
    evidenceKind: str
    #: Explicit cue ids this obligation governs. When present they REPLACE the cues implied
    #: by `kind`, so a register can pin one obligation to both "we retain X" and
    #: "we never retain X" — which is exactly the pair that makes a document
    #: self-contradictory.
    cues: list[str]


class Evidence(TypedDict):
    id: str
    obligationId: str
    locator: str
    sha256: str
    kind: str


class Reason(TypedDict):
    code: str
    detail: str


class Verdict(TypedDict):
    claimId: str | None
    obligationId: str | None
    verdict: str
    severity: str
    reasons: list[Reason]


class ReconcileInput(TypedDict, total=False):
    claims: list[Claim]
    obligations: list[Obligation]
    evidence: list[Evidence]


class ReconcileOutput(TypedDict):
    rulesVersion: str
    verdicts: list[Verdict]
    counts: dict[str, object]
    unmatchedObligationIds: list[str]
    digest: str


def _require_list(payload: ReconcileInput, field: str) -> list[object]:
    value = payload.get(field)
    if not isinstance(value, list):
        raise EngineError("BAD_SHAPE", f'"{field}" must be a list')
    if len(value) > MAX_ITEMS:
        raise EngineError("BAD_SHAPE", f'"{field}" has {len(value)} items, limit is {MAX_ITEMS}')
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise EngineError("BAD_SHAPE", f'"{field}"[{index}] must be an object')
    return value


def _string(row: dict[str, object], field: str, where: str, default: str | None = None) -> str:
    value = row.get(field)
    if isinstance(value, str) and value:
        return value
    if default is not None:
        return default
    raise EngineError("BAD_SHAPE", f"{where} is missing a non-empty {field!r}")


def _obligations(rows: list[object]) -> list[Obligation]:
    out: list[Obligation] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        assert isinstance(row, dict)
        where = f"obligations[{index}]"
        identifier = _string(row, "id", where)
        if identifier in seen:
            raise EngineError("BAD_SHAPE", f"{where}.id {identifier!r} is duplicated")
        seen.add(identifier)
        severity = row.get("severity", "major")
        if severity not in SEVERITY_RANK:
            raise EngineError("BAD_SHAPE", f"{where}.severity must be one of {SEVERITIES}")
        evidence_required = row.get("evidenceRequired", 1)
        if isinstance(evidence_required, bool) or not isinstance(evidence_required, int):
            raise EngineError("BAD_SHAPE", f"{where}.evidenceRequired must be an integer")
        if evidence_required < 0:
            raise EngineError("BAD_SHAPE", f"{where}.evidenceRequired must not be negative")
        explicit = _explicit_cues(row, where)
        out.append(
            {
                "id": identifier,
                "code": _string(row, "code", where, identifier),
                "source": _string(row, "source", where, "unspecified"),
                "statement": _string(row, "statement", where, identifier),
                "kind": _string(row, "kind", where, "any"),
                "evidenceRequired": evidence_required,
                "severity": severity,
                "evidenceKind": _string(row, "evidenceKind", where, "document"),
                "cues": explicit,
            }
        )
    return out


def _evidence(rows: list[object]) -> list[Evidence]:
    out: list[Evidence] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        assert isinstance(row, dict)
        where = f"evidence[{index}]"
        identifier = _string(row, "id", where)
        if identifier in seen:
            # Silently dropping a duplicate evidence record would make an audit trail
            # that looks complete and is not. This is refused instead.
            raise EngineError("BAD_SHAPE", f"{where}.id {identifier!r} is duplicated")
        seen.add(identifier)
        out.append(
            {
                "id": identifier,
                "obligationId": _string(row, "obligationId", where),
                "locator": _string(row, "locator", where, identifier),
                "sha256": _string(row, "sha256", where, "unspecified"),
                "kind": _string(row, "kind", where, "document"),
            }
        )
    return out


def _int_or(row: dict[str, object], field: str, default: int) -> int:
    """Read an integer, falling back to a default. mypy cannot narrow a repeated .get()."""
    value = row.get(field)
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _string_or_none(row: dict[str, object], field: str) -> str | None:
    value = row.get(field)
    return value if isinstance(value, str) else None


def _claims(rows: list[object]) -> list[Claim]:
    out: list[Claim] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        assert isinstance(row, dict)
        where = f"claims[{index}]"
        identifier = _string(row, "id", where)
        if identifier in seen:
            raise EngineError("BAD_SHAPE", f"{where}.id {identifier!r} is duplicated")
        seen.add(identifier)
        span = row.get("span")
        if not isinstance(span, dict):
            raise EngineError("BAD_SHAPE", f"{where}.span must be an object")
        cues = row.get("cues", [])
        if not isinstance(cues, list) or any(not isinstance(cue, str) for cue in cues):
            raise EngineError("BAD_SHAPE", f"{where}.cues must be a list of strings")
        polarity = _string(row, "polarity", where, "affirmed")
        if polarity not in POLARITIES:
            raise EngineError("BAD_SHAPE", f"{where}.polarity must be one of {POLARITIES}")
        out.append(
            {
                "id": identifier,
                "parentId": _string_or_none(row, "parentId"),
                "depth": _int_or(row, "depth", 1),
                "section": _string(row, "section", where, "(unknown)"),
                "kind": _string(row, "kind", where),
                "polarity": polarity,
                "subject": _string(row, "subject", where, identifier),
                "quote": _string(row, "quote", where),
                "span": {
                    "byteStart": _int_or(span, "byteStart", 0),
                    "byteEnd": _int_or(span, "byteEnd", 0),
                    "line": _int_or(span, "line", 0),
                    "column": _int_or(span, "column", 0),
                },
                "cues": [str(cue) for cue in cues],
            }
        )
    return out


def _explicit_cues(row: dict[str, object], where: str) -> list[str]:
    """Validated explicit cue ids, or an empty list when the obligation derives its own."""
    raw = row.get("cues")
    if raw is None:
        return []
    if not isinstance(raw, list) or any(not isinstance(cue, str) or not cue for cue in raw):
        raise EngineError("BAD_SHAPE", f"{where}.cues must be a list of non-empty strings")
    if len(set(raw)) != len(raw):
        raise EngineError("BAD_SHAPE", f"{where}.cues has duplicate ids")
    unknown = sorted(set(raw) - set(_KNOWN_CUES))
    if unknown:
        raise EngineError("BAD_SHAPE", f"{where}.cues names unknown cue id(s): {unknown}")
    return sorted(raw)


def _match_score(claim: Claim, obligation: Obligation) -> int:
    """How strongly a claim speaks to an obligation. Higher wins; ties break on id.

    Scoring is declared, not learned:

    * an **explicit** cue match is worth 3 each, and when a register pins cues the implied
      cues are dropped — the register has spoken, so it speaks precisely;
    * a kind match is worth 2;
    * an implied cue match is worth 1.

    Because a pinned cue scores 3 on top of any kind match, an explicit obligation always
    outranks an inferred one. No weight is ever compared against a threshold.
    """
    shared = set(claim["cues"])
    kind_match = 2 if obligation["kind"] != "any" and obligation["kind"] == claim["kind"] else 0
    explicit = obligation.get("cues") or []
    if explicit:
        return 3 * len(set(explicit) & shared) + kind_match
    return kind_match + len(set(obligation_cues(obligation)) & shared)


#: Obligation kinds carry a cue prefix equal to the claim kind they govern, so a kind
#: match and a cue match can never disagree about which lexicon entry fired.
_KIND_PREFIX: Final[dict[str, str]] = {
    "assurance": "assurance.",
    "attestation": "attestation.",
    "exclusion": "exclusion.",
    "disclosure": "disclosure.",
    "commitment": "commitment.",
    "oversight": "oversight.",
    "redress": "oversight.",
    "consent": "oversight.",
    "accountability": "accountability.",
    "retention": "commitment.",
    "fairness": "fairness.",
    "transparency": "transparency.",
    "performance": "performance.",
    "metric": "metric.",
}


def obligation_cues(obligation: Obligation) -> list[str]:
    """The implied cue ids for an obligation, derived from its kind.

    Derived, never stored twice: a claim's cue ids come from the lexicon, and the lexicon
    is the only place a cue id is written down.
    """
    if obligation.get("cues"):
        return list(obligation["cues"])
    prefix = _KIND_PREFIX.get(obligation["kind"])
    if prefix is None:
        return []
    return sorted(cue.id for cue in CUES if cue.id.startswith(prefix))


#: Every cue id that exists in the lexicon, used to validate a register at load time.
_KNOWN_CUES: Final[frozenset[str]] = frozenset(cue.id for cue in CUES)


def _resolve(claims: list[Claim], obligations: list[Obligation]) -> dict[str, str]:
    """Map each claim to its single governing obligation, deterministically."""
    ordered = sorted(obligations, key=lambda item: (item["code"], item["id"]))
    assignment: dict[str, str] = {}
    for claim in sorted(claims, key=lambda item: item["id"]):
        best_score = 0
        best_id = ""
        for obligation in ordered:
            score = _match_score(claim, obligation)
            if score > best_score or (
                score == best_score and score > 0 and obligation["id"] < best_id
            ):
                best_score = score
                best_id = obligation["id"]
        if best_id:
            assignment[claim["id"]] = best_id
    return assignment


def _worst(severities: list[str]) -> str:
    return max(severities, key=lambda item: SEVERITY_RANK[item]) if severities else "minor"


def _verdict(
    claim_id: str | None,
    obligation_id: str | None,
    verdict: str,
    severity: str,
    reason: tuple[str, str],
) -> Verdict:
    return {
        "claimId": claim_id,
        "obligationId": obligation_id,
        "verdict": verdict,
        "severity": severity,
        "reasons": [{"code": reason[0], "detail": reason[1]}],
    }


def _group_by_obligation(claims: list[Claim], assignment: dict[str, str]) -> dict[str, list[Claim]]:
    """Every claim governed by the same obligation. An affirmed and a denied claim in one
    group is a contradiction the document states against itself."""
    groups: dict[str, list[Claim]] = {}
    for claim in claims:
        obligation_id = assignment.get(claim["id"])
        if obligation_id is not None:
            groups.setdefault(obligation_id, []).append(claim)
    return groups


def _contradictions(groups: dict[str, list[Claim]]) -> dict[str, list[str]]:
    """claim id -> the ids of the claims it directly contradicts."""
    out: dict[str, list[str]] = {}
    for members in groups.values():
        if len({member["polarity"] for member in members}) <= 1:
            continue
        for member in members:
            opposite = "denied" if member["polarity"] == "affirmed" else "affirmed"
            out[member["id"]] = sorted(
                other["id"] for other in members if other["polarity"] == opposite
            )
    return out


def _verdict_for_claim(
    claim: Claim,
    obligation: Obligation | None,
    held: int,
    conflicting: list[str] | None,
) -> Verdict:
    """One claim's verdict, in rule order: unbacked, then contradicted, then evidence."""
    claim_id = claim["id"]
    if obligation is None:
        return _verdict(
            claim_id,
            None,
            "unbacked",
            "major",
            (
                "NO_OBLIGATION_MATCHES",
                f"a {claim['kind']} claim about {claim['subject']!r} is not governed by any "
                "obligation in the register",
            ),
        )

    if conflicting:
        return _verdict(
            claim_id,
            obligation["id"],
            "contradicted",
            obligation["severity"],
            (
                "SELF_CONTRADICTION",
                "the same document both affirms and denies "
                f"{obligation['statement']!r}; conflicting claims: " + ", ".join(conflicting),
            ),
        )

    wanted = obligation["evidenceKind"]
    required = obligation["evidenceRequired"]
    if required == 0:
        return _verdict(
            claim_id,
            obligation["id"],
            "supported",
            obligation["severity"],
            ("DECLARED_NO_ARTIFACT", "the register declares this obligation needs no artifact"),
        )
    if held >= required:
        return _verdict(
            claim_id,
            obligation["id"],
            "supported",
            obligation["severity"],
            (
                "EVIDENCE_SUFFICIENT",
                f"{held} {wanted} artifact(s) on record, {required} required",
            ),
        )
    return _verdict(
        claim_id,
        obligation["id"],
        "unevidenced",
        obligation["severity"],
        (
            "EVIDENCE_SHORTFALL",
            f"{obligation['statement']!r} needs {required} {wanted} artifact(s); {held} on record",
        ),
    )


def reconcile(payload: ReconcileInput) -> ReconcileOutput:
    """Reconcile a claim tree against an obligation register. Total and order-independent."""
    claims = _claims(_require_list(payload, "claims"))
    obligations = _obligations(_require_list(payload, "obligations"))
    evidence = _evidence(_require_list(payload, "evidence"))

    assignment = _resolve(claims, obligations)
    by_id = {obligation["id"]: obligation for obligation in obligations}
    held_by_obligation: dict[str, int] = {}
    for item in evidence:
        obligation = by_id.get(item["obligationId"])
        if obligation is not None and item["kind"] == obligation["evidenceKind"]:
            held_by_obligation[item["obligationId"]] = (
                held_by_obligation.get(item["obligationId"], 0) + 1
            )

    groups = _group_by_obligation(claims, assignment)
    contradictions = _contradictions(groups)

    verdicts: list[Verdict] = []
    for claim in sorted(claims, key=lambda item: item["id"]):
        obligation_id = assignment.get(claim["id"])
        verdicts.append(
            _verdict_for_claim(
                claim,
                by_id[obligation_id] if obligation_id is not None else None,
                held_by_obligation.get(obligation_id, 0) if obligation_id else 0,
                contradictions.get(claim["id"]),
            )
        )

    unmatched: list[str] = []
    for obligation in sorted(obligations, key=lambda item: item["id"]):
        if obligation["id"] in groups:
            continue
        unmatched.append(obligation["id"])
        verdicts.append(
            _verdict(
                None,
                obligation["id"],
                "unmet",
                obligation["severity"],
                (
                    "NO_CLAIM_ADDRESSES_OBLIGATION",
                    f"nothing in the documents addresses {obligation['statement']!r}",
                ),
            )
        )

    verdicts.sort(
        key=lambda item: (
            item["claimId"] is None,
            item["claimId"] or "",
            item["obligationId"] or "",
        )
    )

    by_verdict: dict[str, int] = {name: 0 for name in VERDICTS}
    by_severity: dict[str, int] = {name: 0 for name in SEVERITIES}
    for verdict in verdicts:
        by_verdict[verdict["verdict"]] += 1
        by_severity[verdict["severity"]] += 1

    # ``blocking`` counts blocking FINDINGS, not obligations declared at blocker severity.
    # A satisfied blocker obligation is not a finding, and counting it would make a clean
    # report look alarming.
    blocking = sum(
        1
        for verdict in verdicts
        if verdict["verdict"] in FAILING_VERDICTS and verdict["severity"] == "blocker"
    )

    counts: dict[str, object] = {
        "verdicts": len(verdicts),
        "claims": len(claims),
        "obligations": len(obligations),
        "evidence": len(evidence),
        "byVerdict": dict(sorted(by_verdict.items())),
        "bySeverity": dict(sorted(by_severity.items())),
        "blocking": blocking,
    }

    return {
        "rulesVersion": RULES_VERSION,
        "verdicts": verdicts,
        "counts": counts,
        "unmatchedObligationIds": unmatched,
        "digest": _digest(verdicts, by_verdict),
    }


def _digest(verdicts: list[Verdict], by_verdict: dict[str, int]) -> str:
    canonical = {
        "rulesVersion": RULES_VERSION,
        "verdicts": verdicts,
        "byVerdict": dict(sorted(by_verdict.items())),
    }
    blob = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


#: Verdicts that mean something is wrong. ``supported`` is the only verdict that passes, so
#: a clean run needs nothing further; anything else is a finding with a severity.
def worst_severity(verdicts: list[Verdict]) -> str | None:
    """The severity that should decide an exit code, or None when nothing is wrong.

    This is the function that turns a reconciliation into a CI gate: a ``blocker`` finding
    here is what makes ``oversight-reconcile reconcile`` exit non-zero in a pipeline.
    """
    failing = [item for item in verdicts if item["verdict"] in FAILING_VERDICTS]
    if not failing:
        return None
    return _worst([item["severity"] for item in failing])


__all__ = [
    "Evidence",
    "Obligation",
    "ReconcileInput",
    "ReconcileOutput",
    "Reason",
    "RULES_VERSION",
    "SEVERITIES",
    "VERDICTS",
    "Verdict",
    "obligation_cues",
    "reconcile",
    "worst_severity",
]
