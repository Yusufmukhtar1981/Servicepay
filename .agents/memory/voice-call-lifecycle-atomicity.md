---
name: Voice call lifecycle atomicity
description: Consistency rules for accepted call state, participant busy leases, and client-side negotiation failures.
---

Treat call acceptance and both participants' busy-lease extensions as one atomic operation. Once accepted, every local negotiation or transport failure must terminate server state and notify the peer; a new call must reset all per-call terminal and teardown guards.

**Why:** Separate acceptance and lease writes can allow overlapping calls after partial failure. Local-only WebRTC cleanup can leave the peer waiting and both participants locked, while stale teardown flags can suppress termination for a later call.

**How to apply:** Use a database transaction for acceptance plus both lease updates. Resolve expired accepted leases before granting new locks. On the client, distinguish remote terminal events from local failures, use acknowledged termination with a bounded authenticated fallback, and reinitialize all lifecycle guards for every call.