---
name: Partner reconciliation states
description: Safety rules for uncertain Partner API purchases and their delayed financial resolution.
---

Treat a provider-dispatched purchase as in-flight until a timeout, transport failure, malformed response, or otherwise indeterminate result explicitly moves it into a reconciliation-only state. Manual success/failure decisions and wallet refunds must be unavailable while the provider request is still in flight.

**Why:** A provider may complete a request after an operator sees it but before a manual refund. Resolving the in-flight record could leave a delivered service refunded. The current provider integration has no supported transaction-status endpoint, so no safe automated requery can be invented.

**How to apply:** Make every transition conditional on its allowed source state, preserve final states as one-way, and only refund an eligible unresolved request once. Reverse daily spending only when the original debit belongs to the current accounting day.