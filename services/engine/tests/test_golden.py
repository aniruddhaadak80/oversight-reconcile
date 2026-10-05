"""The anti-drift test.

A golden file is the only test in this suite that fails when the product is *correct*: the
engine is deterministic, so any change to the lexicon, the sentence splitter, the subject
extractor or a verdict rule changes the output, and this test makes that change visible and
deliberate instead of silent.

Regenerate with:

    GOLDEN_UPDATE=1 python -m pytest services/engine/tests/test_golden.py

and then read the diff. A diff you did not expect means the parser changed, and the README
should say so.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest

from oversight_reconcile.claims import parse_claims
from oversight_reconcile.reconcile import reconcile

GOLDEN = Path(__file__).parent / "golden" / "system_card.json"

SYSTEM_CARD = """# Meridian Lending — System Card

Meridian decides credit-limit changes for existing customers. We publish the decision
policy at /policies/credit-limit-v4.

## Data and training

- Data sources are listed in appendix A. We never train on applicant-uploaded documents.
- We retain application events for 2555 days.

## Human oversight

Human review is available for every adverse decision within two business days.
We monitor override rates monthly.

## Redress

An appeal is available for 30 days after a decision. Opt out is available in settings.

## Transparency

Explainability is available as a per-decision reason code. We measure subgroup disparity
across four cohorts.

## Known limitations

We do not offer an appeal route for automated identity checks.
"""

OBLIGATIONS: list[dict[str, Any]] = [
    {
        "id": "O-PUBLISH",
        "code": "EU-AI-ART-11",
        "source": "EU AI Act",
        "statement": "the decision policy must be published",
        "kind": "disclosure",
        "evidenceRequired": 1,
        "severity": "blocker",
    },
    {
        "id": "O-NO-TRAIN",
        "code": "EU-AI-ART-10",
        "source": "EU AI Act",
        "statement": "special-category data must not be used for training",
        "kind": "any",
        "cues": ["exclusion.never", "commitment.retain"],
        "evidenceRequired": 1,
        "severity": "blocker",
    },
    {
        "id": "O-RETENTION",
        "code": "EU-AI-ART-12",
        "source": "EU AI Act",
        "statement": "log retention must be declared and bounded",
        "kind": "retention",
        "evidenceRequired": 1,
        "severity": "major",
    },
    {
        "id": "O-HUMAN-REVIEW",
        "code": "EU-AI-ART-14",
        "source": "EU AI Act",
        "statement": "human review must be available for adverse decisions",
        "kind": "oversight",
        "cues": ["oversight.human-review"],
        "evidenceRequired": 1,
        "severity": "blocker",
    },
    {
        "id": "O-OVERRIDE",
        "code": "EU-AI-ART-14",
        "source": "EU AI Act",
        "statement": "override rates must be monitored",
        "kind": "commitment",
        "cues": ["commitment.monitor"],
        "evidenceRequired": 1,
        "severity": "major",
    },
    {
        "id": "O-APPEAL",
        "code": "EU-AI-ART-15",
        "source": "EU AI Act",
        "statement": "an appeal route must exist",
        "kind": "redress",
        "cues": ["oversight.appeal"],
        "evidenceRequired": 1,
        "severity": "blocker",
    },
    {
        "id": "O-EXPLAIN",
        "code": "EU-AI-ART-13",
        "source": "EU AI Act",
        "statement": "reason codes must be explainable per decision",
        "kind": "transparency",
        "evidenceRequired": 1,
        "severity": "major",
    },
    {
        "id": "O-SUBGROUP",
        "code": "EU-AI-ART-9",
        "source": "EU AI Act",
        "statement": "subgroup performance must be measured",
        "kind": "metric",
        "cues": ["metric.subgroup", "metric.disparate-impact"],
        "evidenceRequired": 2,
        "severity": "blocker",
    },
]

EVIDENCE: list[dict[str, Any]] = [
    {
        "id": "E-POLICY",
        "obligationId": "O-PUBLISH",
        "locator": "/policies/credit-limit-v4",
        "sha256": "a" * 64,
        "kind": "document",
    },
    {
        "id": "E-DPO",
        "obligationId": "O-NO-TRAIN",
        "locator": "artifacts/dpo-2026-03.pdf",
        "sha256": "b" * 64,
        "kind": "document",
    },
    {
        "id": "E-HR-POLICY",
        "obligationId": "O-HUMAN-REVIEW",
        "locator": "/policies/credit-limit-v4#human-oversight",
        "sha256": "c" * 64,
        "kind": "document",
    },
    {
        "id": "E-APPEAL-POLICY",
        "obligationId": "O-APPEAL",
        "locator": "/policies/credit-limit-v4#redress",
        "sha256": "d" * 64,
        "kind": "document",
    },
    {
        "id": "E-SUBGROUP-Q1",
        "obligationId": "O-SUBGROUP",
        "locator": "artifacts/subgroup-2026-q1.csv",
        "sha256": "e" * 64,
        "kind": "document",
    },
]


def build() -> dict[str, Any]:
    tree = parse_claims({"text": SYSTEM_CARD})
    report = reconcile({"claims": tree["claims"], "obligations": OBLIGATIONS, "evidence": EVIDENCE})
    return {"parse": tree, "reconcile": report}


@pytest.mark.property
def test_output_matches_the_committed_golden_file() -> None:
    actual = build()
    if os.environ.get("GOLDEN_UPDATE") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(actual, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        pytest.skip(f"golden file rewritten at {GOLDEN}")

    assert GOLDEN.exists(), (
        f"missing golden file at {GOLDEN}; regenerate with "
        "GOLDEN_UPDATE=1 python -m pytest services/engine/tests/test_golden.py"
    )
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert actual == expected, (
        "the engine output changed. Read the diff: a changed digest means the parser or a "
        "verdict rule moved. Regenerate deliberately with GOLDEN_UPDATE=1."
    )


@pytest.mark.property
def test_the_golden_tree_is_byte_exact_against_its_source() -> None:
    data = SYSTEM_CARD.encode("utf-8")
    for claim in parse_claims({"text": SYSTEM_CARD})["claims"]:
        span = claim["span"]
        assert data[span["byteStart"] : span["byteEnd"]].decode("utf-8") == claim["quote"]
