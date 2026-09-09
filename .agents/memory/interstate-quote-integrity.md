---
name: Interstate quote integrity
description: Safety rule for directional route quotes and parcel attributes that affect Interstate pricing.
---

Every price-affecting field must have one canonical representation shared by quote calculation, quote integrity checks, shipment persistence, and later branch recalculation. Route direction must be bound server-side rather than trusted from a client-selected route ID.

**Why:** A field that affects price but is omitted from integrity checks, stored differently, or dropped during verification can accept stale quotes, enable reverse-route underpricing, or create false adjustments.

**How to apply:** When Interstate pricing gains a new input, update canonical validation, integrity hashing, persisted parcel data, and every recalculation path together. Reject conflicting duplicate representations.