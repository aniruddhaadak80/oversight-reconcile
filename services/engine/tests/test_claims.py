from __future__ import annotations

import json

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from oversight_reconcile.claims import (
    LEXICON_VERSION,
    MAX_DOCUMENT_BYTES,
    ROOT_SECTION,
    digest_claims,
    parse_claims,
)
from oversight_reconcile.protocol import EngineError

SYSTEM_CARD = """# Atlas Triage — System Card

This card describes how Atlas Triage reaches a decision. We publish the decision policy in full.

## Purpose

We ensure that every triage decision is reproducible from the recorded context.

## Data provenance

- We never train on customer support transcripts.
- Data sources are listed in the appendix and reviewed quarterly.
- We retain event logs for 400 days.

## Human oversight

Human review is available for any decision flagged as adverse.

## Known limitations

We do not provide an appeal route for automated rejections.
"""


def parse(text: str, **limits: object) -> dict[str, object]:
    payload: dict[str, object] = {"text": text}
    if limits:
        payload["limits"] = limits
    return parse_claims(payload)  # type: ignore[arg-type]


def codes(result: dict[str, object]) -> set[str]:
    diagnostics = result["diagnostics"]
    assert isinstance(diagnostics, list)
    return {str(item["code"]) for item in diagnostics}


class TestProvenance:
    """The invariant the product exists to guarantee."""

    def test_every_span_slices_back_to_its_quote(self) -> None:
        data = SYSTEM_CARD.encode("utf-8")
        result = parse(SYSTEM_CARD)
        claims = result["claims"]
        assert isinstance(claims, list) and claims
        for claim in claims:
            span = claim["span"]
            sliced = data[span["byteStart"] : span["byteEnd"]].decode("utf-8")
            assert sliced == claim["quote"], claim["id"]
            assert data[span["byteStart"] : span["byteEnd"]].startswith(
                claim["quote"].encode("utf-8")
            )

    def test_the_quote_occurs_in_the_source(self) -> None:
        result = parse(SYSTEM_CARD)
        for claim in result["claims"]:  # type: ignore[union-attr]
            assert claim["quote"] in SYSTEM_CARD

    def test_line_and_column_locate_the_quote(self) -> None:
        result = parse(SYSTEM_CARD)
        for claim in result["claims"]:  # type: ignore[union-attr]
            lines = SYSTEM_CARD.split("\n")
            line = lines[claim["span"]["line"] - 1]
            column = claim["span"]["column"] - 1
            assert line[column:].startswith(claim["quote"])

    def test_spans_are_ordered_and_non_overlapping_within_a_line(self) -> None:
        result = parse(SYSTEM_CARD)
        seen: dict[int, int] = {}
        for claim in result["claims"]:  # type: ignore[union-attr]
            line = claim["span"]["line"]
            previous = seen.get(line)
            if previous is not None:
                assert claim["span"]["byteStart"] >= previous
            seen[line] = claim["span"]["byteEnd"]


class TestClassification:
    def test_finds_an_affirmed_assurance(self) -> None:
        result = parse(SYSTEM_CARD)
        kinds = {claim["kind"] for claim in result["claims"]}  # type: ignore[union-attr]
        assert "assurance" in kinds

    def test_negation_yields_a_denied_exclusion(self) -> None:
        result = parse(SYSTEM_CARD)
        exclusions = [
            claim
            for claim in result["claims"]  # type: ignore[union-attr]
            if claim["kind"] == "exclusion"
        ]
        assert [claim["polarity"] for claim in exclusions] == ["denied", "denied"]
        assert exclusions[0]["cues"] == ["exclusion.never"]

    def test_a_sentence_with_two_cues_records_both(self) -> None:
        # "We do not provide an appeal route" trips the exclusion cue first and the redress
        # cue second. Both are recorded; the earliest cue classifies the claim.
        result = parse(SYSTEM_CARD)
        appeals = [
            claim
            for claim in result["claims"]  # type: ignore[union-attr]
            if "oversight.appeal" in claim["cues"]
        ]
        assert len(appeals) == 1
        assert appeals[0]["kind"] == "exclusion"
        assert appeals[0]["polarity"] == "denied"

    def test_the_appeal_claim_is_captured(self) -> None:
        result = parse(SYSTEM_CARD)
        quotes = [claim["quote"] for claim in result["claims"]]  # type: ignore[union-attr]
        assert any("appeal route" in quote for quote in quotes)

    def test_a_noun_phrase_cue_falls_back_to_its_declared_subject(self) -> None:
        result = parse("Human review is available for every adverse decision.")
        claims = result["claims"]
        assert len(claims) == 1
        assert claims[0]["subject"] == "human review"

    def test_an_empty_prefix_falls_back_to_the_cue_subject(self) -> None:
        result = parse("We ensure that all training data is documented.")
        claims = result["claims"]
        assert claims[0]["subject"] == "assurance"

    def test_subject_keeps_the_prefix_when_there_is_one(self) -> None:
        result = parse("Explicit user consent is required before any secondary use.")
        claims = result["claims"]
        assert claims[0]["kind"] == "consent"
        assert claims[0]["subject"] == "Explicit user"

    def test_earliest_cue_wins_over_a_later_longer_one(self) -> None:
        # "we ensure" starts before "data retention" and is longer; earliest position is
        # the primary rule, so the assurance cue classifies the sentence.
        result = parse("We ensure that data retention is bounded.")
        claims = result["claims"]
        assert claims[0]["kind"] == "assurance"
        assert claims[0]["cues"] == ["assurance.ensure", "commitment.retention"]


class TestStructure:
    def test_headings_become_the_section_path(self) -> None:
        result = parse(SYSTEM_CARD)
        sections = result["sections"]
        assert isinstance(sections, list)
        assert "Atlas Triage \u2014 System Card" in sections
        assert "Atlas Triage \u2014 System Card \u203a Purpose" in sections
        assert "Atlas Triage \u2014 System Card \u203a Data provenance" in sections

    def test_a_claim_nests_under_the_previous_claim_one_level_up(self) -> None:
        result = parse(SYSTEM_CARD)
        claims = result["claims"]
        by_id = {claim["id"]: claim for claim in claims}
        nested = [claim for claim in claims if claim["parentId"] is not None]
        assert nested, "a two-level document must produce a real tree"
        for claim in nested:
            parent = by_id[claim["parentId"]]
            assert parent["depth"] == claim["depth"] - 1
            assert claim["section"].startswith(f"{parent['section']} \u203a ")

    def test_a_document_with_no_heading_roots_at_the_document_root(self) -> None:
        result = parse("We ensure that logs are retained.")
        claim = result["claims"][0]  # type: ignore[index]
        assert claim["section"] == ROOT_SECTION
        assert claim["parentId"] is None
        assert claim["depth"] == 1


class TestBoundaries:
    def test_a_table_row_is_not_prose(self) -> None:
        result = parse("| claim | status |\n|---|---|\n| We ensure X | yes |")
        assert result["claims"] == []

    def test_a_code_fence_is_skipped(self) -> None:
        text = "Before.\n\n```python\n# we ensure nothing\n```\n\nAfter we ensure this.\n"
        result = parse(text)
        quotes = [claim["quote"] for claim in result["claims"]]  # type: ignore[union-attr]
        assert all("python" not in quote for quote in quotes)
        assert len(quotes) == 1

    def test_an_unterminated_fence_is_reported(self) -> None:
        result = parse("We ensure this.\n\n```\nwe ensure that too\n")
        assert "FENCE_UNTERMINATED" in codes(result)

    def test_the_claim_budget_truncates_and_says_so(self) -> None:
        text = "\n".join(f"- We ensure thing number {index}." for index in range(12))
        result = parse(text, maxClaims=5)
        assert result["truncated"] is True
        assert len(result["claims"]) == 5  # type: ignore[arg-type]
        assert "MAX_CLAIMS" in codes(result)

    def test_a_budget_of_one_keeps_the_first_claim(self) -> None:
        result = parse("- We ensure first.\n- We ensure second.\n", maxClaims=1)
        assert result["claims"][0]["quote"] == "We ensure first."  # type: ignore[index]

    def test_depth_beyond_the_limit_is_clamped_and_reported(self) -> None:
        text = "####### not a heading\n\n# H1\n\n### H3\n\nWe ensure this.\n"
        result = parse(text, maxDepth=2)
        assert "MAX_DEPTH" in codes(result)
        assert result["maxDepthReached"] <= 2

    def test_an_empty_document_reports_no_claims_rather_than_raising(self) -> None:
        result = parse("")
        assert result["claims"] == []
        assert "NO_CLAIMS" in codes(result)
        assert result["truncated"] is False

    def test_whitespace_only_reports_no_claims(self) -> None:
        assert parse("   \n\n\t\n")["claims"] == []

    def test_non_ascii_is_flagged_because_byte_and_char_offsets_differ(self) -> None:
        result = parse("We ensure that caf\u00e9 logs are retained.")
        assert "NON_ASCII" in codes(result)
        claim = result["claims"][0]  # type: ignore[index]
        data = "We ensure that caf\u00e9 logs are retained.".encode("utf-8")
        assert (
            data[claim["span"]["byteStart"] : claim["span"]["byteEnd"]].decode("utf-8")
            == claim["quote"]
        )

    def test_a_unicode_heading_is_readable_in_the_section_path(self) -> None:
        result = parse("## \u00dcbersicht\n\nWe ensure this.")
        assert "\u00dcbersicht" in result["sections"]  # type: ignore[operator]


class TestSentenceSplitting:
    def test_a_decimal_does_not_split_a_sentence(self) -> None:
        result = parse("We measure accuracy at 99.5 percent across every subgroup.")
        assert len(result["claims"]) == 1  # type: ignore[arg-type]

    def test_an_abbreviation_does_not_split_a_sentence(self) -> None:
        result = parse("We ensure this, per Dr. Chen's memo, e.g. for triage.")
        quotes = [claim["quote"] for claim in result["claims"]]  # type: ignore[union-attr]
        assert len(quotes) == 1
        assert "Dr. Chen" in quotes[0]

    def test_two_claims_on_one_line_are_separate_claims(self) -> None:
        result = parse("We ensure safety. We disclose metrics.")
        assert [claim["kind"] for claim in result["claims"]] == [  # type: ignore[index]
            "assurance",
            "disclosure",
        ]

    def test_a_sentence_without_a_cue_is_not_a_claim(self) -> None:
        result = parse("We ensure safety. The model runs on GPU nodes.")
        assert len(result["claims"]) == 1  # type: ignore[arg-type]


class TestRejection:
    def test_a_non_string_document_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            parse_claims({"text": 42})  # type: ignore[typeddict-item]
        assert caught.value.code == "BAD_SHAPE"

    def test_a_missing_document_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            parse_claims({})  # type: ignore[typeddict-item]
        assert caught.value.code == "BAD_SHAPE"

    def test_a_document_over_the_byte_ceiling_is_rejected(self) -> None:
        unit = "We ensure this. "
        oversized = unit * (MAX_DOCUMENT_BYTES // len(unit) + 1)
        assert len(oversized.encode("utf-8")) > MAX_DOCUMENT_BYTES
        with pytest.raises(EngineError) as caught:
            parse_claims({"text": oversized})
        assert caught.value.code == "INPUT_TOO_LARGE"

    def test_limits_out_of_range_are_clamped_not_rejected(self) -> None:
        # A negative budget clamps to 1 and a negative depth clamps to 1: neither is an
        # error, because a caller with a bad config still gets a report back.
        result = parse(SYSTEM_CARD, maxClaims=99_999, maxDepth=-5)
        assert result["truncated"] is False
        assert result["maxDepthReached"] == 1


class TestDigest:
    def test_the_digest_is_a_sha256_hex_string(self) -> None:
        digest = parse(SYSTEM_CARD)["digest"]
        assert isinstance(digest, str)
        assert len(digest) == 64
        assert all(char in "0123456789abcdef" for char in digest)

    def test_the_digest_does_not_depend_on_claim_order(self) -> None:
        claims = parse(SYSTEM_CARD)["claims"]
        assert isinstance(claims, list)
        assert digest_claims(claims) == digest_claims(list(reversed(claims)))

    def test_a_changed_quote_changes_the_digest(self) -> None:
        first = parse("We ensure this.")
        second = parse("We ensure that.")
        assert first["digest"] != second["digest"]


class TestSerialisation:
    def test_the_result_is_json_serialisable(self) -> None:
        assert json.loads(json.dumps(parse(SYSTEM_CARD)))

    def test_the_lexicon_version_is_recorded(self) -> None:
        assert parse(SYSTEM_CARD)["lexiconVersion"] == LEXICON_VERSION

    def test_ids_are_dense_and_in_document_order(self) -> None:
        claims = parse(SYSTEM_CARD)["claims"]
        assert isinstance(claims, list)
        assert [claim["id"] for claim in claims] == [
            f"c{index}" for index in range(1, len(claims) + 1)
        ]


@pytest.mark.property
@settings(max_examples=200, deadline=None)
@given(st.text(max_size=600))
def test_any_text_yields_byte_exact_spans(text: str) -> None:
    data = text.encode("utf-8")
    result = parse(text)
    claims = result["claims"]
    assert isinstance(claims, list)
    for claim in claims:
        span = claim["span"]
        assert 0 <= span["byteStart"] <= span["byteEnd"] <= len(data)
        assert data[span["byteStart"] : span["byteEnd"]].decode("utf-8") == claim["quote"]


@pytest.mark.property
@settings(max_examples=100, deadline=None)
@given(st.text(max_size=400))
def test_parsing_is_deterministic(text: str) -> None:
    first = parse(text)
    second = parse(text)
    assert first["digest"] == second["digest"]
    assert first["claims"] == second["claims"]


@pytest.mark.property
@settings(max_examples=100, deadline=None)
@given(st.text(max_size=400), st.text(max_size=400))
def test_an_equal_digest_means_an_equal_claim_tree(left: str, right: str) -> None:
    first = parse(left)
    second = parse(right)
    if first["digest"] == second["digest"]:
        assert first["claims"] == second["claims"]
    if first["claims"] != second["claims"]:
        assert first["digest"] != second["digest"]
