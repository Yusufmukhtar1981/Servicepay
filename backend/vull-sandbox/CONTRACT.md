# VULL Sandbox v1

This separately runnable service only accepts `VULL_ENV=sandbox`. Its base
path is `/v1`; `GET /v1/health` is the sole unauthenticated route. Every other
route requires `X-VULL-API-Key` (`vull_sb_...`) and `X-VULL-API-Secret`.
Credentials carry scopes; defaults cover checkout, refund, subscription and
reconciliation operations. Mutating routes require `Idempotency-Key`; a replay
returns the stored response and a body mismatch returns 409. Amounts are
integer `amountMinor` (NGN).

An idempotency reservation, every business mutation, the canonical response,
and all webhook outbox records commit in one Mongo transaction. Responses are
sent only after commit. Concurrent identical requests produce one mutation and
the loser replays the committed response. A transaction failure rolls back the
wallet, ledger, domain records, idempotency record, and outbox together.

Routes: `POST/GET /v1/checkouts`, `GET /v1/payments/:reference`,
`POST /v1/checkouts/:reference/verify`, `POST/GET /v1/refunds`,
`POST/GET/cancel /v1/subscriptions`, renewal simulation at
`POST /v1/subscriptions/:reference/renew`, and `POST/GET /v1/reconciliations`.
Checkout scenarios are `success` (201), `declined` (201), `pending` (201), and
`provider_error` (deterministic 502); all other values fail closed with 400.
Successful checkout and subscription renewal are simulated credits and write
one atomic wallet/append-only-ledger/transaction set. A refund is unique per
checkout and writes its reversal ledger entry. Reconciliation reports checkout,
renewal and refund counts.

Callbacks are HTTPS public URLs (localhost only in test). Event headers are
`X-VULL-Event-ID`, `X-VULL-Timestamp`, `X-VULL-Signature` and
`X-VULL-Environment: SANDBOX`; signature is HMAC-SHA256 over
`timestamp.eventId.rawBody`. Inbound simulated events use the same headers,
must be within five minutes, and event IDs are replay protected. Delivery state
is persisted: at most five attempts use exponential backoff; `nextAttemptAt`,
sanitized error code/status, and delivery time are retained. `processPending()`
uses expiring leased claims so workers cannot concurrently send one event.
Outbound HTTPS requests time out after 10 seconds, strictly before the
30-second lease expires. The separate worker polls continuously at
`VULL_SANDBOX_WORKER_POLL_INTERVAL_MS` (default 1000ms, allowed 100–60000ms)
and shuts down gracefully on SIGTERM/SIGINT. The API creates no background
timer. Required secrets are
`VULL_SANDBOX_AUTH_PEPPER` and `VULL_SANDBOX_WEBHOOK_SIGNING_SECRET`.
Startup also requires `VULL_SANDBOX_MONGO_ALLOWED_HOSTS`,
`VULL_SANDBOX_MONGO_DATABASE`, and `VULL_PRODUCTION_MONGO_FINGERPRINTS`; it
rejects any inherited common production Mongo variable. A fingerprint is
`sha256(lowercase-host + "/" + lowercase-database)`, calculated by an operator
from host/database only (never an URI or its credentials).

The service creates only its own `VullSandbox*` collections through a dedicated
`mongoose.createConnection`; it never imports production models or uses the
default mongoose connection. Start it with `npm --prefix backend run
start:vull-sandbox`; provision with `npm --prefix backend run
provision:vull-sandbox [callbackUrl]`.