---
name: Control Center reporting integrity
description: Rules for truthful operational metrics, security-event workflows, and exports in the Admin Control Center.
---

Operational status metrics must use an explicit, exhaustive taxonomy for each source model, including an `other` bucket. Product lifecycle values such as applications, financing schedules, payments, funding, and disbursements must be labeled non-additive unless one canonical monetary source is selected.

**Why:** Generic status buckets omitted valid states and additive lifecycle rows could overstate financial activity.

**How to apply:** When adding a model or status, update its dedicated taxonomy and exhaustiveness test. Keep investigation transitions server-enforced, mask identifiers by default, and reject unsupported export filters instead of silently ignoring them.