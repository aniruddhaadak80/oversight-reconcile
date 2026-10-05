# Configuration

Layered, later wins:

```
defaults  ->  product.config.json  ->  environment
```

The zod schema in `packages/config/src/schema.ts` is the **single source of truth**. Anything that
needs to render settings derives its JSON Schema from `z.toJSONSchema()` — never hand-written, so
the two cannot drift.

## Keys

| Key                | Type    | Default       | Meaning                                  |
| ------------------ | ------- | ------------- | ---------------------------------------- |
| `productEnv`       | enum    | `development` | one of development, test, production     |
| `dataDir`          | string  | `.data`       | where SQLite lives                       |
| `engine.python`    | string  | `python`      | interpreter for the deterministic engine |
| `engine.timeoutMs` | integer | `10000`       | hard ceiling on one engine call          |
| `providers`        | record  | `{}`          | per-provider overrides                   |
| `channels`         | record  | `{}`          | per-channel `enabled` flags              |
| `logLevel`         | enum    | `info`        | one of debug, info, warn, error          |

`dataDir` is the one that matters most. It is gitignored: the store is derived state, and the
artifact that gets committed is the report under `apps/web/content/oversight/`. If you delete
`dataDir` you lose the runs; you do not lose the evidence.

Copy `product.config.json.example` to `product.config.json` to start from a file rather than
defaults. `doctor` warns while it is absent, which is correct — defaults are a valid state.

## Environment overlay

| Variable                  | Maps to                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `PRODUCT_ENV`             | `productEnv`                                                                     |
| `PRODUCT_DATA_DIR`        | `dataDir`                                                                        |
| `PRODUCT_LOG_LEVEL`       | `logLevel`                                                                       |
| `PRODUCT_CONFIG_PATH`     | the config file path                                                             |
| `PRODUCT_MCP_PERMISSIONS` | the MCP server's permission ceiling, comma-separated                             |
| `TELEMETRY_ENABLED`       | nothing sends telemetry either way; `/api/health` reports it as `warn` while off |

## An invalid value is an error, never a coercion

Unknown keys are dropped rather than carried forward, and a value that fails validation raises a
`ValidationError` naming the failing field. Silently coercing `"loud"` to a log level is how a
typo becomes a debugging session.

## Secrets

Only `.env.example` is committed, and every value in it is empty. `npm run check:no-secrets` fails
if a `.env` with values is ever tracked.

There is nothing to configure for credentials, because nothing in this product authenticates to
anything. That is a consequence of the design, not an oversight: a governance verdict that needed
an API key could not be replayed by someone who did not have it.
