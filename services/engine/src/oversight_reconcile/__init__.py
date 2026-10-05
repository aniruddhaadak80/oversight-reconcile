"""Oversight Reconcile — the deterministic engine.

Every operation here is a pure function: same input, same output, no clock, no network, no
randomness, no filesystem, no model. Time and entropy are arguments when an operation needs
them, and none do.

The engine is the credibility of the product. The parts that must be exactly right — the
byte-exact provenance spans and the reconciliation verdicts — are code. A claim tree that a
model summarised is not an audit artifact; it is a paragraph.
"""

from .analysis import OPERATIONS, analyse
from .claims import (
    CUES,
    LEXICON_VERSION,
    MAX_DOCUMENT_BYTES,
    Claim,
    Diagnostic,
    ParseInput,
    ParseOutput,
    Span,
    digest_claims,
    parse_claims,
)
from .ledger import (
    VERDICT_KEYS,
    RunRecord,
    diff,
    normalize,
    summarize,
)
from .protocol import EngineError, dispatch, read_request, write_response
from .reconcile import (
    RULES_VERSION,
    Evidence,
    Obligation,
    ReconcileInput,
    ReconcileOutput,
    Verdict,
    reconcile,
    worst_severity,
)

__all__ = [
    "CUES",
    "Claim",
    "Diagnostic",
    "EngineError",
    "Evidence",
    "LEXICON_VERSION",
    "MAX_DOCUMENT_BYTES",
    "OPERATIONS",
    "Obligation",
    "ParseInput",
    "ParseOutput",
    "RULES_VERSION",
    "ReconcileInput",
    "ReconcileOutput",
    "RunRecord",
    "Span",
    "VERDICT_KEYS",
    "Verdict",
    "analyse",
    "digest_claims",
    "diff",
    "dispatch",
    "normalize",
    "parse_claims",
    "read_request",
    "reconcile",
    "summarize",
    "worst_severity",
    "write_response",
]
__version__ = "0.1.0"
