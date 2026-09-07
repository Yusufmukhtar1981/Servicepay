---
name: ServicePay executive administration
description: Canonical location and security boundary for Executive Management and SVP capabilities.
---

Executive Management and SVP functionality must be built inside the main ServicePay Admin experience and its main backend. Do not add or mirror this functionality in the separate ServicePay Admin project.

**Why:** The project direction explicitly consolidated Head Office and executive operations into the main ServicePay application to avoid split authority, duplicate behavior, and deployment ambiguity.

**How to apply:** Extend the main Admin navigation, authentication, APIs, permissions, reporting, and audit systems. Treat Head Office as the highest authority, isolate SVPs behind dedicated scoped endpoints, and leave the separate Admin project untouched.