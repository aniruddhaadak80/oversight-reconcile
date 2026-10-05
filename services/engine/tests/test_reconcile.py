from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from oversight_reconcile.claims import parse_claims
from oversight_reconcile.protocol import EngineError
from oversight_reconcile.reconcile import (
    RULES_VERSION,
    obligation_cues,
    reconcile,
    worst_severity,
)


def claim(
    identifier: str,
    kind: str,
    polarity: str = "affirmed",
    cues: list[str] | None = None,
    **extra: str,
) -> dict[str, object]:
    return {
        "id": identifier,
        "parentId": None,
        "depth": 1,
        "section": "Test",
        "kind": kind,
        "polarity": polarity,
        "subject": identifier,
        "quote": f"{identifier} quote",
        "span": {"byteStart": 0, "byteEnd": 3, "line": 1, "column": 1},
        "cues": list(cues) if cues is not None else (list(extra) or [f"{kind}.default"]),
    }


# A test factory with five knobs is clearer than a builder object, so the arity rule is
# waived here rather than worked around in every call site.
def obligation(  # noqa: PLR0913
    identifier: str,
    kind: str,
    *,
    required: int = 1,
    severity: str = "major",
    cues: list[str] | None = None,
    evidence_kind: str = "document",
) -> dict[str, object]:
    row: dict[str, object] = {
        "id": identifier,
        "code": identifier.upper(),
        "source": "test",
        "statement": f"{identifier} must hold",
        "kind": kind,
        "evidenceRequired": required,
        "severity": severity,
        "evidenceKind": evidence_kind,
    }
    if cues is not None:
        row["cues"] = cues
    return row


def evidence(identifier: str, obligation_id: str, kind: str = "document") -> dict[str, object]:
    return {
        "id": identifier,
        "obligationId": obligation_id,
        "locator": f"artifacts/{obligation_id}.pdf",
        "sha256": "0" * 64,
        "kind": kind,
    }


def verdicts_by_claim(result: dict[str, object]) -> dict[str, str]:
    entries = result["verdicts"]
    assert isinstance(entries, list)
    return {
        str(item["claimId"]): str(item["verdict"])
        for item in entries
        if item["claimId"] is not None
    }


def count(result: dict[str, object], verdict: str) -> int:
    counts = result["counts"]
    assert isinstance(counts, dict)
    by_verdict = counts["byVerdict"]
    assert isinstance(by_verdict, dict)
    return int(by_verdict[verdict])  # type: ignore[call-overload]


class TestVerdicts:
    def test_a_claim_with_enough_evidence_is_supported(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [obligation("O1", "oversight")],
                "evidence": [evidence("e1", "O1")],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "supported"}
        assert count(result, "supported") == 1

    def test_a_claim_short_of_evidence_is_unevidenced(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [obligation("O1", "oversight", required=2)],
                "evidence": [evidence("e1", "O1")],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "unevidenced"}
        detail = result["verdicts"][0]["reasons"][0]["detail"]  # type: ignore[index]
        assert "needs 2" in detail and "1 on record" in detail

    def test_a_claim_no_obligation_governs_is_unbacked(self) -> None:
        result = reconcile(
            {"claims": [claim("c1", "oversight")], "obligations": [], "evidence": []}
        )
        assert verdicts_by_claim(result) == {"c1": "unbacked"}
        assert result["verdicts"][0]["obligationId"] is None  # type: ignore[index]

    def test_an_obligation_nothing_addresses_is_unmet(self) -> None:
        result = reconcile(
            {"claims": [], "obligations": [obligation("O1", "oversight")], "evidence": []}
        )
        assert verdicts_by_claim(result) == {}
        assert count(result, "unmet") == 1
        assert result["unmatchedObligationIds"] == ["O1"]

    def test_a_declared_obligation_needing_no_artifact_is_supported_without_evidence(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "assurance")],
                "obligations": [obligation("O1", "assurance", required=0)],
                "evidence": [],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "supported"}

    def test_evidence_of_the_wrong_kind_does_not_count(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [obligation("O1", "oversight", evidence_kind="run")],
                "evidence": [evidence("e1", "O1", kind="document")],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "unevidenced"}

    def test_an_affirmed_and_a_denied_claim_in_one_obligation_are_contradicted(self) -> None:
        result = reconcile(
            {
                "claims": [
                    claim("c1", "retention", "affirmed", **{"commitment.retain": "affirmed"}),
                    claim("c2", "exclusion", "denied", **{"exclusion.never": "denied"}),
                ],
                "obligations": [
                    obligation(
                        "O1",
                        "any",
                        required=0,
                        cues=["commitment.retain", "exclusion.never"],
                        severity="blocker",
                    )
                ],
                "evidence": [],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "contradicted", "c2": "contradicted"}
        assert count(result, "contradicted") == 2
        entries = result["verdicts"]
        assert isinstance(entries, list)
        for entry in entries:
            reason = entry["reasons"][0]
            assert reason["code"] == "SELF_CONTRADICTION"
            # Each verdict names the claim it conflicts with, never itself.
            other = "c2" if entry["claimId"] == "c1" else "c1"
            assert reason["detail"].endswith(f"conflicting claims: {other}")
            assert entry["claimId"] not in reason["detail"].split("conflicting claims: ")[1]

    def test_two_claims_of_one_polarity_are_not_a_contradiction(self) -> None:
        result = reconcile(
            {
                "claims": [
                    claim("c1", "retention", cues=["commitment.retain"]),
                    claim("c2", "retention", cues=["commitment.retain"]),
                ],
                "obligations": [obligation("O1", "retention", required=0)],
                "evidence": [],
            }
        )
        assert verdicts_by_claim(result) == {"c1": "supported", "c2": "supported"}

    def test_the_best_scoring_obligation_governs_the_claim(self) -> None:
        # Two obligations both reach the claim by kind; the one whose pinned cue matches
        # wins, because an explicit cue match outweighs a kind match.
        result = reconcile(
            {
                "claims": [claim("c1", "oversight", cues=["oversight.human-review"])],
                "obligations": [
                    obligation("O-generic", "oversight", required=0),
                    obligation(
                        "O-specific", "oversight", required=0, cues=["oversight.human-review"]
                    ),
                ],
                "evidence": [],
            }
        )
        entry = result["verdicts"][0]  # type: ignore[index]
        assert entry["obligationId"] == "O-specific"

    def test_a_tie_resolves_to_the_smallest_obligation_id(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [
                    obligation("O-beta", "oversight", required=0),
                    obligation("O-alpha", "oversight", required=0),
                ],
                "evidence": [],
            }
        )
        assert result["verdicts"][0]["obligationId"] == "O-alpha"  # type: ignore[index]


class TestDeterminism:
    def test_the_same_input_gives_the_same_digest(self) -> None:
        payload = {
            "claims": [claim("c1", "oversight"), claim("c2", "assurance")],
            "obligations": [obligation("O1", "oversight"), obligation("O2", "assurance")],
            "evidence": [evidence("e1", "O1"), evidence("e2", "O2")],
        }
        assert reconcile(payload)["digest"] == reconcile(payload)["digest"]

    def test_permuting_claims_does_not_change_the_result(self) -> None:
        claims = [claim("c1", "oversight"), claim("c2", "assurance"), claim("c3", "metric")]
        obligations = [obligation("O1", "oversight"), obligation("O2", "assurance")]
        forward = reconcile(
            {"claims": claims, "obligations": obligations, "evidence": [evidence("e1", "O1")]}
        )
        backward = reconcile(
            {
                "claims": list(reversed(claims)),
                "obligations": obligations,
                "evidence": [evidence("e1", "O1")],
            }
        )
        assert forward == backward

    def test_permuting_evidence_does_not_change_the_result(self) -> None:
        obligations = [obligation("O1", "oversight", required=2), obligation("O2", "assurance")]
        claims = [claim("c1", "oversight"), claim("c2", "assurance")]
        items = [evidence("e1", "O1"), evidence("e2", "O1"), evidence("e3", "O2")]
        forward = reconcile({"claims": claims, "obligations": obligations, "evidence": items})
        backward = reconcile(
            {"claims": claims, "obligations": obligations, "evidence": list(reversed(items))}
        )
        assert forward == backward

    def test_reconciling_twice_is_idempotent(self) -> None:
        payload = {
            "claims": [claim("c1", "oversight")],
            "obligations": [obligation("O1", "oversight")],
            "evidence": [],
        }
        once = reconcile(payload)
        assert reconcile(payload) == once

    def test_the_result_is_json_serialisable(self) -> None:
        assert json.loads(
            json.dumps(
                reconcile(
                    {
                        "claims": [claim("c1", "oversight")],
                        "obligations": [obligation("O1", "oversight")],
                        "evidence": [],
                    }
                )
            )
        )

    def test_the_rules_version_is_recorded(self) -> None:
        assert reconcile({"claims": [], "obligations": [], "evidence": []})["rulesVersion"] == (
            RULES_VERSION
        )


class TestObligationCues:
    def test_cues_are_implied_by_the_kind(self) -> None:
        assert obligation_cues(obligation("O1", "oversight")) == [
            "oversight.appeal",
            "oversight.consent",
            "oversight.human-oversight",
            "oversight.human-review",
            "oversight.opt-out",
        ]

    def test_an_explicit_cue_list_replaces_the_implied_one(self) -> None:
        assert obligation_cues(obligation("O1", "oversight", cues=["oversight.appeal"])) == [
            "oversight.appeal"
        ]

    def test_an_unknown_kind_implies_nothing(self) -> None:
        assert obligation_cues(obligation("O1", "quantum")) == []


class TestRejection:
    def test_a_missing_claims_list_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile({"obligations": [], "evidence": []})
        assert caught.value.code == "BAD_SHAPE"

    def test_a_duplicate_obligation_id_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile(
                {
                    "claims": [],
                    "obligations": [obligation("O1", "oversight"), obligation("O1", "assurance")],
                    "evidence": [],
                }
            )
        assert caught.value.code == "BAD_SHAPE"
        assert "duplicated" in caught.value.message

    def test_a_duplicate_evidence_id_is_rejected_rather_than_deduped(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile(
                {
                    "claims": [],
                    "obligations": [obligation("O1", "oversight")],
                    "evidence": [evidence("e1", "O1"), evidence("e1", "O1")],
                }
            )
        assert caught.value.code == "BAD_SHAPE"

    def test_an_unknown_cue_id_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile(
                {
                    "claims": [],
                    "obligations": [obligation("O1", "oversight", cues=["nonsense.cue"])],
                    "evidence": [],
                }
            )
        assert "unknown cue id" in caught.value.message

    def test_an_unknown_severity_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile(
                {
                    "claims": [],
                    "obligations": [obligation("O1", "oversight", severity="catastrophic")],
                    "evidence": [],
                }
            )
        assert caught.value.code == "BAD_SHAPE"

    def test_a_negative_evidence_requirement_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile(
                {
                    "claims": [],
                    "obligations": [obligation("O1", "oversight", required=-1)],
                    "evidence": [],
                }
            )
        assert caught.value.code == "BAD_SHAPE"

    def test_a_missing_obligation_id_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile({"claims": [], "obligations": [{"kind": "oversight"}], "evidence": []})
        assert caught.value.code == "BAD_SHAPE"

    def test_a_claim_without_a_span_is_rejected(self) -> None:
        broken = claim("c1", "oversight")
        del broken["span"]
        with pytest.raises(EngineError) as caught:
            reconcile({"claims": [broken], "obligations": [], "evidence": []})
        assert caught.value.code == "BAD_SHAPE"

    def test_a_non_object_entry_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            reconcile({"claims": ["not-a-claim"], "obligations": [], "evidence": []})
        assert caught.value.code == "BAD_SHAPE"


class TestSeverity:
    def test_no_failure_means_no_severity_to_act_on(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [obligation("O1", "oversight")],
                "evidence": [evidence("e1", "O1")],
            }
        )
        assert worst_severity(result["verdicts"]) is None  # type: ignore[arg-type]

    def test_a_blocker_dominates(self) -> None:
        result = reconcile(
            {
                "claims": [claim("c1", "oversight")],
                "obligations": [
                    obligation("O1", "oversight", severity="blocker"),
                    obligation("O2", "assurance", severity="minor"),
                ],
                "evidence": [],
            }
        )
        assert worst_severity(result["verdicts"]) == "blocker"  # type: ignore[arg-type]

    def test_an_unmet_obligation_counts_as_a_failure(self) -> None:
        result = reconcile(
            {"claims": [], "obligations": [obligation("O1", "oversight")], "evidence": []}
        )
        assert worst_severity(result["verdicts"]) == "major"  # type: ignore[arg-type]


class TestAgainstRealProse:
    """End to end: real text in, verdicts out, with nothing in between."""

    CARD = """# Support Automation — System Card

## Controls

- Human review is available for every adverse decision.
- We retain event logs for 400 days.

## Limitations

- We do not provide an appeal route for automated rejections.
"""

    def test_a_real_card_reconciles_against_a_real_register(self) -> None:
        tree = parse_claims({"text": self.CARD})
        result = reconcile(
            {
                "claims": tree["claims"],  # type: ignore[typeddict-item]
                "obligations": [
                    obligation("O-HUMAN", "oversight", required=1, severity="blocker"),
                    obligation("O-RETENTION", "retention", required=1),
                    obligation("O-APPEAL", "redress", required=1, severity="major"),
                ],
                "evidence": [evidence("e-hr", "O-HUMAN")],
            }
        )
        by_claim = verdicts_by_claim(result)
        # Every claim is governed by the register, so nothing is unbacked; the retention and
        # redress claims simply have no artifact on record yet.
        assert sorted(by_claim.values()) == ["supported", "unevidenced", "unevidenced"]
        assert by_claim["c1"] == "supported"  # the human-review claim
        assert count(result, "unmet") == 0
        assert count(result, "unbacked") == 0
        assert result["counts"]["blocking"] == 0  # type: ignore[index]

    def test_the_same_prose_twice_produces_the_same_report_digest(self) -> None:
        tree = parse_claims({"text": self.CARD})
        payload = {
            "claims": tree["claims"],
            "obligations": [obligation("O-HUMAN", "oversight", required=1)],
            "evidence": [],
        }
        assert reconcile(payload)["digest"] == reconcile(payload)["digest"]  # type: ignore[arg-type]


@pytest.mark.property
@settings(max_examples=120, deadline=None)
@given(st.permutations([claim("c1", "oversight"), claim("c2", "assurance"), claim("c3", "metric")]))
def test_reconciliation_is_order_independent(claims: list[dict[str, object]]) -> None:
    obligations = [obligation("O1", "oversight"), obligation("O2", "assurance")]
    items = [evidence("e1", "O1"), evidence("e2", "O2")]
    forward = reconcile({"claims": list(claims), "obligations": obligations, "evidence": items})
    backward = reconcile(
        {"claims": list(reversed(claims)), "obligations": obligations, "evidence": items}
    )
    assert forward == backward


@pytest.mark.property
@settings(max_examples=120, deadline=None)
@given(
    st.lists(
        st.tuples(
            st.sampled_from(["oversight", "assurance", "metric", "retention"]),
            st.sampled_from(["affirmed", "denied"]),
        ),
        min_size=0,
        max_size=8,
    )
)
def test_every_claim_gets_exactly_one_verdict(rows: list[tuple[str, str]]) -> None:
    claims = [claim(f"c{index}", kind, polarity) for index, (kind, polarity) in enumerate(rows)]
    result = reconcile(
        {
            "claims": claims,
            "obligations": [obligation("O1", "oversight"), obligation("O2", "assurance")],
            "evidence": [],
        }
    )
    entries = result["verdicts"]
    assert isinstance(entries, list)
    claim_entries = [item for item in entries if item["claimId"] is not None]
    assert len(claim_entries) == len(claims)
    for entry in claim_entries:
        assert entry["verdict"] in {"supported", "unevidenced", "contradicted", "unbacked"}
