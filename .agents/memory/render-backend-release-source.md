---
name: Render backend release source
description: Prevents assuming that advancing the customer main branch also updates the production Render API.
---

Treat the customer web branch and the production Render backend source as separate release targets. A successful customer deployment and a healthy API root do not prove that new backend handlers are live.

**Why:** The customer main branch advanced successfully while the production API continued serving the prior backend release. A route-specific authenticated signature check exposed the stale backend even though health and protected-route probes looked normal.

**How to apply:** Identify and preserve the reviewed backend release lineage, deploy backend-only changes there, and verify a feature-specific live response after deployment. Use read-only or deliberately invalid requests that cannot mutate production data.