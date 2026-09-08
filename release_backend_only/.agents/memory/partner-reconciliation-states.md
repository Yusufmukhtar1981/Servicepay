---
name: Partner reconciliation states
description: Safety rules for uncertain Partner API purchases and their delayed financial resolution.
---

Treat a provider-dispatched purchase as in-flight until a timeout, transport failure, malformed response, or otherwise indeterminate result explicitly moves it into a reconciliation-only state. Manual success/failure decisions and wallet refunds must be unavailable while the provider request is still in flight.

**Why:** A provider may complete a request after an operator sees it but before a manual refund. Resolving the in-flight record could leave a delivered service refunded. ClubKonnect now documents `APIQueryV1.asp` queries by OrderID or RequestID, but a response is safe to apply only when it echoes the exact queried identifier.

**How to apply:** Query, never replay, an unresolved purchase. Accept only correlated `200 / ORDER_COMPLETED` as success and correlated 500-series `ORDER_CANCELLED` as failure. Keep all other outcomes unresolved. Make final transitions and audit writes atomic, preserve final states as one-way, and refund only once. Reverse daily spending only when the original debit belongs to the current accounting day.