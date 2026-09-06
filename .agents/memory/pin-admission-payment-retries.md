---
name: PIN admission and payment retries
description: Safety rules for idempotent wallet payments when requests or responses may be delayed or lost.
---

Create and bind a durable client reference before submitting a wallet payment. Any timeout, network error, 404 status lookup, pending response, or uncertain commit must retain that reference and allow status queries only; it must not enable a fresh payment.

**Why:** A delayed original POST can arrive after a client-only timeout. If the client clears its reference or lets the customer change the payment intent, a new reference can authorize a second debit.

**How to apply:** Persist unresolved intent without PINs or tokens, scope it to the signed-in account, block edits and new submissions until the backend returns authoritative success or failure, and render recovered receipts from server-verified beneficiary data. Server attempt expiry must use a compare-and-set that cannot race a financial commit.

Complete transaction-PIN admission before entering the wallet transaction, but keep transient PIN-admission conflicts retryable under the same request identity.

**Why:** PIN lockout counters and wallet mutations have different concurrency requirements; combining them can create false lockouts or duplicate payment retries.

**How to apply:** Preserve the payment reference and idempotency key across retryable admission outcomes, then atomically commit debit, credit, transfer, histories, ledger entries, and successful attempt state.