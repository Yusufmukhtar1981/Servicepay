---
name: ServicePay executive administration
description: Canonical location and security boundary for Executive Management and SVP capabilities.
---

Executive Management and SVP functionality must be built inside the main ServicePay Admin experience and its main backend. Do not add or mirror this functionality in the separate ServicePay Admin project. The initial Head Office dashboard must show a prominent Executive Management card and direct Create SVP shortcut; navigation-only access is insufficient. Completion requires authenticated visual verification in the real Admin entrypoint at desktop and mobile widths; tests or hidden routes alone are insufficient.

**Why:** The project direction explicitly consolidated Head Office and executive operations into the main ServicePay application to avoid split authority, duplicate behavior, and deployment ambiguity. A prior implementation passed automated checks while the real Head Office navigation still exposed no usable Executive Management entry.

**How to apply:** Extend the main Admin dashboard body, navigation, authentication, APIs, permissions, reporting, and audit systems. Treat Head Office as the highest authority, isolate SVPs behind dedicated scoped endpoints, and leave the separate Admin project untouched. Keep both Executive Management and Create SVP physically visible immediately after login. Before reporting completion, authenticate through the compiled Admin entrypoint and visually traverse both the dashboard shortcut and navigation-based management/create flows at desktop and mobile widths without mutating production data.