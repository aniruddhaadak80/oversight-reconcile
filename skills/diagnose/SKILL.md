---
name: diagnose
description: Use when Oversight Reconcile is misbehaving and the cause is not obvious, because the diagnostic order below finds the failing subsystem without guesswork.
metadata:
  version: 1.0.0
---

# Diagnose Oversight Reconcile

## When to use this

Something is broken and you do not yet know which subsystem is at fault.

## Steps

1. `oversight-reconcile doctor` — read the failing row and its **fix** line. Do not skip to step 2.
2. If `engine` is failing: run
   `python -m pytest services/engine -q`. The probe itself already reports whether the engine
   is missing (`warn`, this tree does not ship it) or broken (`fail`, it answered wrongly).
3. If `schema` is failing: the store is on an older migration than the code expects. Any
   command that opens the store migrates it; `doctor` prints `store.pending` when it cannot.
4. If `register` is failing: `oversight-reconcile tools --json` is not the place to look. Run
   `oversight-reconcile list_obligations` via `mcp call`:
   `oversight-reconcile mcp call list_obligations '{}'` — it returns each pack and any issue
   with its file and JSON path.
5. If `skills` is failing: `oversight-reconcile mcp call list_skills '{"includeBodies":false}'`
   lists every validation issue.
6. If `plugins` is warning: `oversight-reconcile mcp call list_plugins '{}'` shows each
   rejection with its reason. A version mismatch names the required and running versions.
7. If a single tool misbehaves: `oversight-reconcile mcp call <tool> '<json>'` prints the
   error envelope with its stable code.
8. If the web report is stale: the report is a committed artifact. Re-run
   `oversight-reconcile report` and redeploy; the page will not invent numbers.

## Error codes

| Code                | Meaning                               | First move                            |
| ------------------- | ------------------------------------- | ------------------------------------- |
| `VALIDATION_FAILED` | input did not match the tool's schema | print the schema, fix the caller      |
| `PERMISSION_DENIED` | tool needs a permission not granted   | check the declared permissions        |
| `CONFLICT`          | duplicate name at registration        | find the other registrant             |
| `UPSTREAM_FAILED`   | the Python engine returned an error   | run the op directly, see `durationMs` |
| `TIMEOUT`           | exceeded `engine.timeoutMs`           | raise it or make the op cheaper       |

Engine error codes come back in the `error.code` field of the response envelope: `BAD_SHAPE`,
`MISSING_FIELD`, `UNKNOWN_OP`, `INPUT_TOO_LARGE`.

## Exit codes

`0` ok · `1` runtime failure · `2` usage error · `3` findings at or above `--fail-on`.

Exit 3 is **not** a crash. It is the reconciliation gate reporting that a finding exists.

## Verify

`oversight-reconcile doctor` exits 0.
