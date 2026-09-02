---
name: Admin production repository
description: Identifies the non-obvious source repository and verification rule for the ServicePay Admin custom domain.
---

The `admin.servicepay.ng` custom domain is deployed from the hyphenated `servicepay-admin` repository. A similarly named underscore repository can deploy successfully without changing the custom-domain site.

**Why:** A release was reported successful from the underscore repository while the custom domain continued serving an older placeholder bundle from the hyphenated repository. Failed workflows in the authoritative repository left the prior GitHub Pages artifact live.

**How to apply:** Publish Admin runtime changes to the repository actually attached to the custom domain, wait for its Pages workflow, and confirm the production `main.dart.js` fingerprint contains the intended routes and no longer matches the old bundle.