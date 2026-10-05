"""The run ledger: three pure operations over recorded oversight runs.

A run is one execution of parse + reconcile, fingerprinted by two digests — the claim tree
digest and the report digest. These operations answer the questions a reviewer asks over
time: what does the current posture look like (``summarize``), is the stored form canonical
(``normalize``), and what changed between two runs (``diff``).

They are pure functions over records, with no clock and no filesystem: the caller supplies
the records and the ordering is decided here, so two processes reading the same ledger in
different orders get the same answer.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .protocol import EngineError

MAX_RUNS: Final[int] = 2_000

#: The verdict keys a run record must carry. A run missing one is rejected rather than
#: zero-filled, because a zero-filled verdict count is indistinguishable from a real zero.
VERDICT_KEYS: Final[tuple[str, ...]] = (
    "supported",
    "unevidenced",
    "contradicted",
    "unbacked",
    "unmet",
)


class RunRecord(TypedDict):
    id: str
    createdAt: int
    treeDigest: str
    reportDigest: str
    verdicts: dict[str, int]
    blocking: int


class NormalizeInput(TypedDict):
    runs: list[RunRecord]


class NormalizedRun(TypedDict):
    id: str
    createdAt: int
    treeDigest: str
    reportDigest: str
    blocking: int
    verdicts: dict[str, int]


class NormalizeOutput(TypedDict):
    runs: list[NormalizedRun]
    count: int
    treeDigests: list[str]


class DiffInput(TypedDict):
    before: list[RunRecord]
    after: list[RunRecord]


class RunChange(TypedDict):
    id: str
    change: str
    deltas: dict[str, int]
    treeChanged: bool


class DiffOutput(TypedDict):
    added: list[str]
    removed: list[str]
    changed: list[RunChange]
    unchanged: int
    deltas: dict[str, int]


class SummarizeInput(TypedDict):
    runs: list[RunRecord]


class SummaryOutput(TypedDict):
    runs: int
    byVerdict: dict[str, int]
    blocking: int
    earliest: int
    latest: int
    distinctTrees: int


def _verdicts_of(row: dict[str, Any], where: str) -> dict[str, int]:
    """Validated verdict counts. A missing key is an error, never a silent zero."""
    verdicts = row.get("verdicts")
    if not isinstance(verdicts, dict):
        raise EngineError("BAD_SHAPE", f"{where}.verdicts must be an object")
    counted: dict[str, int] = {}
    for key in VERDICT_KEYS:
        value = verdicts.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise EngineError(
                "BAD_SHAPE",
                f'{where}.verdicts["{key}"] must be a non-negative integer',
            )
        counted[key] = value
    unknown = sorted(set(verdicts) - set(VERDICT_KEYS))
    if unknown:
        raise EngineError("BAD_SHAPE", f"{where}.verdicts has unknown key(s): {unknown}")
    return counted


def _integer(row: dict[str, Any], field: str, where: str) -> int:
    value = row.get(field)
    if isinstance(value, bool) or not isinstance(value, int):
        raise EngineError("BAD_SHAPE", f"{where}.{field} must be an integer")
    return value


def _run_record(row: object, index: int, field: str, seen: set[str]) -> RunRecord:
    if not isinstance(row, dict):
        raise EngineError("BAD_SHAPE", f'"{field}"[{index}] must be an object')
    where = f"{field}[{index}]"
    identifier = row.get("id")
    if not isinstance(identifier, str) or not identifier:
        raise EngineError("BAD_SHAPE", f"{where}.id must be a non-empty string")
    if identifier in seen:
        raise EngineError("BAD_SHAPE", f"{where}.id {identifier!r} is duplicated")
    seen.add(identifier)
    return {
        "id": identifier,
        "createdAt": _integer(row, "createdAt", where),
        "treeDigest": _digest_field(row, where, "treeDigest"),
        "reportDigest": _digest_field(row, where, "reportDigest"),
        "verdicts": _verdicts_of(row, where),
        "blocking": _integer(row, "blocking", where),
    }


def _runs(payload: Any, field: str) -> list[RunRecord]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f'expected an object with "{field}"')
    rows = payload.get(field)
    if not isinstance(rows, list):
        raise EngineError("BAD_SHAPE", f'"{field}" must be a list')
    if len(rows) > MAX_RUNS:
        raise EngineError("BAD_SHAPE", f'"{field}" has {len(rows)} items, limit is {MAX_RUNS}')
    seen: set[str] = set()
    return [_run_record(row, index, field, seen) for index, row in enumerate(rows)]


def _digest_field(row: dict[str, Any], where: str, field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise EngineError("BAD_SHAPE", f"{where}.{field} must be a non-empty digest string")
    return value


def normalize(payload: NormalizeInput) -> NormalizeOutput:
    """Canonical ledger form: runs sorted by (createdAt, id) with sorted verdict keys."""
    runs = sorted(_runs(payload, "runs"), key=lambda item: (item["createdAt"], item["id"]))
    return {
        "runs": [
            {
                "id": run["id"],
                "createdAt": run["createdAt"],
                "treeDigest": run["treeDigest"],
                "reportDigest": run["reportDigest"],
                "blocking": run["blocking"],
                "verdicts": dict(sorted(run["verdicts"].items())),
            }
            for run in runs
        ],
        "count": len(runs),
        "treeDigests": sorted({run["treeDigest"] for run in runs}),
    }


def diff(payload: DiffInput) -> DiffOutput:
    """Compare two ledger snapshots by run id, reporting per-verdict deltas."""
    before = {run["id"]: run for run in _runs(payload, "before")}
    after = {run["id"]: run for run in _runs(payload, "after")}

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed: list[RunChange] = []
    unchanged = 0

    for identifier in sorted(set(before) & set(after)):
        left = before[identifier]
        right = after[identifier]
        deltas = {
            key: right["verdicts"][key] - left["verdicts"][key]
            for key in VERDICT_KEYS
            if right["verdicts"][key] != left["verdicts"][key]
        }
        identical = (
            not deltas
            and left["blocking"] == right["blocking"]
            and left["treeDigest"] == right["treeDigest"]
            and left["reportDigest"] == right["reportDigest"]
        )
        if identical:
            unchanged += 1
            continue
        changed.append(
            {
                "id": identifier,
                "change": "modified",
                "deltas": dict(sorted(deltas.items())),
                "treeChanged": left["treeDigest"] != right["treeDigest"],
            }
        )

    totals: dict[str, int] = {}
    for identifier in sorted(set(after)):
        totals[identifier] = 1
    for identifier in sorted(set(before)):
        totals[identifier] = -1

    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "unchanged": unchanged,
        "deltas": dict(sorted(totals.items())),
    }


def summarize(payload: SummarizeInput) -> SummaryOutput:
    """Aggregate the ledger without discarding anything."""
    runs = _runs(payload, "runs")
    totals = {key: 0 for key in VERDICT_KEYS}
    for run in runs:
        for key in VERDICT_KEYS:
            totals[key] += run["verdicts"][key]
    stamps = [run["createdAt"] for run in runs] or [0]
    return {
        "runs": len(runs),
        "byVerdict": dict(sorted(totals.items())),
        "blocking": sum(run["blocking"] for run in runs),
        "earliest": min(stamps),
        "latest": max(stamps),
        "distinctTrees": len({run["treeDigest"] for run in runs}),
    }


__all__ = [
    "DiffInput",
    "DiffOutput",
    "NormalizeInput",
    "NormalizeOutput",
    "RunRecord",
    "SummarizeInput",
    "SummaryOutput",
    "VERDICT_KEYS",
    "diff",
    "normalize",
    "summarize",
]
