# ServicePay pending transfer operations runbook

The pending state is a safety lock, not permission to retry. Never ask a customer
to submit another transfer while the original reference remains `PENDING`.

## Triage

Use only the opaque correlation reference, transfer-attempt ID, and transfer ID
from the alert. The correlation reference is deliberately not the customer's
submitted transfer reference; locate the record by its internal attempt ID.
Do not copy PINs, tokens, idempotency keys, names, phone numbers, or wallet details
into tickets, chat, email, or logs.

### Fresh in-flight request

An attempt younger than the alert threshold, with an unexpired `leaseExpiresAt`,
is owned by a request worker and is normally still in flight. It is intentionally
excluded from aged alerts. Wait for the lease and normal status polling; do not
intervene or tell the customer to retry.

### Expired failed reservation

`EXPIRED_FAILED_RESERVATION` means the attempt is still `PENDING`, its ownership
lease has expired, and no authoritative `Transfer` exists for the reference. No
committed money movement has been found. Have the customer use the status/requery
flow: its guarded reconciliation can mark the attempt `FAILED`. Only after the
API returns `FAILED` may the client offer a new transfer with new request IDs.
Do not edit the database or manually credit/debit a wallet.

### Committed transfer whose response was lost

`COMMITTED_RESPONSE_LOST` means an authoritative `Transfer` exists although the
attempt still says `PENDING`. The money movement is complete; the response or
attempt-state acknowledgement was lost. Have the customer use status/requery,
which treats the committed transfer as `SUCCESS` and returns its receipt. Never
retry, reverse, or recreate the transfer merely to clear the pending attempt.

## Escalation

Escalate repeated or growing alerts to backend/database operations with the
alert timestamp, opaque reference, attempt ID, classification, and transfer ID
when present. Investigate database availability and transaction commit
acknowledgements. Keep the customer in requery-only mode until the authoritative
status endpoint reports `SUCCESS` or `FAILED`.