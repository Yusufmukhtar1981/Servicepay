---
name: Transfer alert references
description: Privacy rule for identifiers emitted by transfer monitoring and operations tooling.
---

Treat client-supplied transfer references as potentially containing personal
information, even when their syntax looks identifier-like. Operations alerts
must emit a secret-keyed, non-reversible correlation reference plus internal
record IDs rather than the stored client reference.

**Why:** Client reference validation permits phone-shaped and other
caller-chosen values. Plain hashes, including hashes salted only with a visible
record ID, still allow recipients to confirm guesses.

**How to apply:** Any transfer monitor, export, email, ticket, or operational
log that crosses into a broader audience must use a server-secret HMAC or a
persisted random correlation ID. Never include the HMAC key or its source data.