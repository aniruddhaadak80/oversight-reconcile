from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from oversight_reconcile.ledger import diff, normalize, summarize
from oversight_reconcile.protocol import EngineError


def run(
    identifier: str,
    *,
    created: int = 1,
    tree: str = "tree-a",
    report: str = "report-a",
    blocking: int = 0,
    **verdicts: int,
) -> dict[str, object]:
    counted = {
        "supported": verdicts.get("supported", 0),
        "unevidenced": verdicts.get("unevidenced", 0),
        "contradicted": verdicts.get("contradicted", 0),
        "unbacked": verdicts.get("unbacked", 0),
        "unmet": verdicts.get("unmet", 0),
    }
    return {
        "id": identifier,
        "createdAt": created,
        "treeDigest": tree,
        "reportDigest": report,
        "verdicts": counted,
        "blocking": blocking,
    }


class TestNormalize:
    def test_runs_come_back_sorted_by_time_then_id(self) -> None:
        result = normalize(
            {"runs": [run("b", created=2), run("a", created=1), run("c", created=1)]}
        )
        assert [item["id"] for item in result["runs"]] == ["a", "c", "b"]

    def test_an_empty_ledger_normalises_to_nothing(self) -> None:
        assert normalize({"runs": []}) == {"runs": [], "count": 0, "treeDigests": []}

    def test_distinct_trees_are_listed_once_each(self) -> None:
        result = normalize(
            {"runs": [run("a", tree="t1"), run("b", tree="t1"), run("c", tree="t2")]}
        )
        assert result["treeDigests"] == ["t1", "t2"]

    def test_a_missing_verdict_key_is_rejected_not_zero_filled(self) -> None:
        broken = run("a", supported=1)
        del broken["verdicts"]["unmet"]  # type: ignore[index]
        with pytest.raises(EngineError) as caught:
            normalize({"runs": [broken]})
        assert caught.value.code == "BAD_SHAPE"
        assert "unmet" in caught.value.message

    def test_an_unknown_verdict_key_is_rejected(self) -> None:
        broken = run("a")
        broken["verdicts"]["vibes"] = 1  # type: ignore[index]
        with pytest.raises(EngineError) as caught:
            normalize({"runs": [broken]})
        assert "unknown key" in caught.value.message

    def test_a_duplicate_run_id_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            normalize({"runs": [run("a"), run("a")]})
        assert "duplicated" in caught.value.message

    def test_a_missing_digest_is_rejected(self) -> None:
        broken = run("a")
        del broken["treeDigest"]
        with pytest.raises(EngineError):
            normalize({"runs": [broken]})

    def test_a_non_list_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            normalize({"runs": "nope"})  # type: ignore[typeddict-item]
        assert caught.value.code == "BAD_SHAPE"


class TestDiff:
    def test_detects_a_changed_verdict_count(self) -> None:
        result = diff(
            {"before": [run("a", unevidenced=1)], "after": [run("a", unevidenced=3, supported=2)]}
        )
        assert result["changed"] == [
            {
                "id": "a",
                "change": "modified",
                "deltas": {"supported": 2, "unevidenced": 2},
                "treeChanged": False,
            }
        ]

    def test_detects_a_changed_claim_tree(self) -> None:
        result = diff({"before": [run("a")], "after": [run("a", tree="tree-b")]})
        assert result["changed"][0]["treeChanged"] is True  # type: ignore[index]

    def test_an_identical_run_is_unchanged(self) -> None:
        result = diff({"before": [run("a")], "after": [run("a")]})
        assert result["unchanged"] == 1
        assert result["changed"] == []

    def test_added_and_removed_runs_are_reported(self) -> None:
        result = diff({"before": [run("gone")], "after": [run("new")]})
        assert result["added"] == ["new"]
        assert result["removed"] == ["gone"]

    def test_both_sides_empty(self) -> None:
        assert diff({"before": [], "after": []}) == {
            "added": [],
            "removed": [],
            "changed": [],
            "unchanged": 0,
            "deltas": {},
        }

    def test_the_result_is_json_serialisable(self) -> None:
        assert json.loads(json.dumps(diff({"before": [run("a")], "after": [run("a")]})))


class TestSummarize:
    def test_totals_every_verdict_kind(self) -> None:
        result = summarize(
            {"runs": [run("a", supported=2, unbacked=1), run("b", supported=3, unbacked=1)]}
        )
        assert result["byVerdict"]["supported"] == 5
        assert result["byVerdict"]["unbacked"] == 2
        assert result["runs"] == 2

    def test_an_empty_ledger_reports_zero_rather_than_raising(self) -> None:
        assert summarize({"runs": []}) == {
            "runs": 0,
            "byVerdict": {
                "contradicted": 0,
                "supported": 0,
                "unbacked": 0,
                "unevidenced": 0,
                "unmet": 0,
            },
            "blocking": 0,
            "earliest": 0,
            "latest": 0,
            "distinctTrees": 0,
        }

    def test_time_bounds_span_the_ledger(self) -> None:
        result = summarize(
            {"runs": [run("a", created=10), run("b", created=90), run("c", created=50)]}
        )
        assert (result["earliest"], result["latest"]) == (10, 90)

    def test_distinct_trees_counted(self) -> None:
        result = summarize({"runs": [run("a", tree="t1"), run("b", tree="t2")]})
        assert result["distinctTrees"] == 2


@pytest.mark.property
@settings(max_examples=100, deadline=None)
@given(st.lists(st.integers(min_value=0, max_value=9), min_size=0, max_size=8))
def test_normalize_is_order_independent(supported: list[int]) -> None:
    runs = [
        run(f"r{index}", created=index, supported=value) for index, value in enumerate(supported)
    ]
    forward = normalize({"runs": runs})
    backward = normalize({"runs": list(reversed(runs))})
    assert forward == backward


@pytest.mark.property
@settings(max_examples=100, deadline=None)
@given(
    st.lists(st.integers(min_value=0, max_value=9), min_size=1, max_size=6),
    st.lists(st.integers(min_value=0, max_value=9), min_size=1, max_size=6),
)
def test_summarize_totals_never_lose_a_verdict(
    supported: list[int], unevidenced: list[int]
) -> None:
    runs = [
        run(f"r{index}", created=index, supported=a, unevidenced=b)
        for index, (a, b) in enumerate(zip(supported, unevidenced, strict=False))
    ]
    result = summarize({"runs": runs})
    assert result["byVerdict"]["supported"] == sum(supported[: len(runs)])
    assert result["byVerdict"]["unevidenced"] == sum(unevidenced[: len(runs)])
