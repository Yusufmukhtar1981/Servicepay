---
name: Notification lifecycle independence
description: Durable rules for transaction activity delivery and safe notification-schema evolution.
---

Record customer financial activity independently from email or push delivery. A missing email address or provider failure must not suppress the in-app event.

**Why:** In-app history is the authoritative authenticated activity surface, while email and push are optional delivery channels with different availability and retry behavior.

**How to apply:** Create or deduplicate the in-app lifecycle event first, then attempt each external channel independently. When adding stored classification fields, keep query-time legacy matching until production history is explicitly and safely backfilled.