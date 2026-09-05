# VULL Sandbox v1

This separately runnable service only accepts `VULL_ENV=sandbox`. Its base
path is `/v1`; `GET /v1/live` and database-backed `GET /v1/health` are the only
unauthenticated routes. Every other
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

## Separate Replit deployment

Never apply the sandbox run command or environment to the existing ServicePay
production project deployment. Create a separate Replit project/artifact from
the approved sandbox source and use a **Reserved VM** because the webhook worker
must poll continuously. Use:

- Build: `npm --prefix backend ci --omit=dev`
- Run: `npm --prefix backend run run:vull-sandbox`
- Replit startup health check: `GET /` must return 200 and
  `{"status":"ok","environment":"SANDBOX","database":"ready","webhookWorker":"ready"}`
- Operational readiness check: `GET /v1/health` returns the same response
- Liveness check: `GET /v1/live` returns 200 without querying MongoDB
- Public custom domain: `sandbox-api.servicepay.ng`
- Visibility: public, because VULL webhook/API calls cannot traverse Replit
  collaborator or password protection

The runtime supervises the API and worker as separate child processes and stops
the deployment if either exits. The worker writes a database-backed heartbeat
after every successful poll; readiness fails if it is missing or stale. Three
consecutive polling failures terminate the worker so Replit can restart the
Reserved VM. Replit's assigned `PORT` is used when present.
The default initial simulated wallet balance is 10,000,000 minor units
(NGN 100,000); configuration is bounded from zero through NGN 1,000,000.

MongoDB must be a separate sandbox cluster or independently permissioned
sandbox deployment supporting replica-set transactions. Create a database named
`vull_servicepay_sandbox` and a dedicated least-privilege user restricted to
that database. Allow network access only from the connectivity range required
by the selected MongoDB/Replit setup; never reuse the production URI, database,
or principal.

In Replit Publishing, enter the sandbox values in the **Production** environment
of the separate sandbox project. Secrets are
`VULL_SANDBOX_MONGODB_URI`, `VULL_SANDBOX_AUTH_PEPPER`, and
`VULL_SANDBOX_WEBHOOK_SIGNING_SECRET`. Plain settings are `VULL_ENV=sandbox`,
`NODE_ENV=production`, `VULL_SANDBOX_MONGO_ALLOWED_HOSTS`,
`VULL_SANDBOX_MONGO_DATABASE=vull_servicepay_sandbox`,
`VULL_PRODUCTION_MONGO_FINGERPRINTS`,
`VULL_SANDBOX_WORKER_POLL_INTERVAL_MS=1000`,
and `VULL_SANDBOX_INITIAL_BALANCE_MINOR=10000000`.
The common production database variables listed in `config.js` must be absent.
`VULL_SANDBOX_CREDENTIAL_OUTPUT_FILE` is not an API/worker deployment setting;
set it only for the later approved one-time credential provisioning command.

After the new deployment has a successful generated `*.replit.app` URL, add
`sandbox-api.servicepay.ng` in that sandbox project's Publishing custom-domain
settings. At DNS, create the exact A and `replit-verify=...` TXT records Replit
provides. Keep the TXT record permanently so Replit can renew its managed TLS
certificate. Do not create records from guessed addresses. Wait for Replit to
show the domain and certificate as verified before provisioning credentials.

Post-deployment verification, before VULL receives credentials:

1. Confirm the existing ServicePay production URL and workflows were not
   republished or reconfigured.
2. Confirm `https://sandbox-api.servicepay.ng/v1/live` returns SANDBOX/200.
3. Confirm `/v1/health` returns SANDBOX, database ready, and 200.
4. Confirm an unauthenticated protected route returns 401.
5. Confirm a fake `sp_live_` API key is rejected.
6. Confirm the deployment logs show both API startup and worker polling with no
   production-variable or database-boundary errors.
7. Run the sandbox test suite against the deployed source.
8. Provision one credential only after the approved VULL HTTPS callback URL is
   available; retrieve the mode-0600 output once, place the values in VULL's
   secure secret store, then securely delete the output file.
9. Execute one idempotent success, declined, pending, provider-error, refund,
   subscription, reconciliation, and signed webhook test.
10. Reconfirm production database sentinels and production provider activity
    are unchanged.