"""The engine's operation table — the single place an operation name becomes callable.

Five operations, all pure:

| op             | purpose                                                   |
| -------------- | --------------------------------------------------------- |
| `parse_claims` | governance prose -> claim tree with byte-exact spans       |
| `reconcile`    | claims + obligations + evidence -> a verdict per claim    |
| `normalize`    | canonical ledger form, sorted and stable                  |
| `diff`         | two ledger snapshots -> per-verdict deltas                |
| `summarize`    | ledger totals and time bounds                             |

Adding an operation means adding it here and in ``docs/architecture.md``. There is no
dynamic discovery, because a registry that can grow at runtime is a registry nobody can
reason about.
"""

from __future__ import annotations

from typing import Any, Final

from .claims import parse_claims
from .ledger import diff, normalize, summarize
from .protocol import EngineError
from .reconcile import reconcile

OPERATIONS: Final[dict[str, Any]] = {
    "parse_claims": parse_claims,
    "reconcile": reconcile,
    "normalize": normalize,
    "diff": diff,
    "summarize": summarize,
}


def analyse(op: str, payload: Any) -> Any:
    handler = OPERATIONS.get(op)
    if handler is None:
        known = ", ".join(sorted(OPERATIONS))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)
