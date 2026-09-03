---
name: Admin production repository
description: Identifies the non-obvious source repository and verification rule for the ServicePay Admin custom domain.
---

The `admin.servicepay.ng` custom domain is deployed from the hyphenated `servicepay-admin` repository. A similarly named underscore repository can deploy successfully without changing the custom-domain site.

**Why:** A release was reported successful from the underscore repository while the custom domain continued serving an older placeholder bundle from the hyphenated repository. Failed workflows in the authoritative repository left the prior GitHub Pages artifact live.

**How to apply:** Publish Admin runtime changes to the repository actually attached to the custom domain. Patch that repository's own navigation and permissions rather than copying the main app's Admin files wholesale, then wait for Pages and verify `main.dart.js`.

The Admin Pages workflow analyzes test code before building. When a production interface gains a method, update that repository's test doubles in the same push. Test-only follow-up commits do not trigger Pages because its push paths exclude `test/**`.

**Why:** A valid Admin build was blocked by a stale Delivery API fake, and the corrective test-only push did not start a replacement deployment.

**How to apply:** Run the repository's exact analyze command before pushing. Include interface/test-double compatibility with the triggering `lib/**` change, or make a harmless `lib/**` follow-up if a corrected latest-main deployment must be triggered.

Complete Admin screens can silently disappear from production when they remain on disk but are no longer imported and registered in the authoritative navigation; Flutter then tree-shakes them from the web bundle.

**Why:** Transaction Intelligence retained its screen, models, API client, permissions, and live backend routes, but a navigation rewrite omitted its import and destination.

**How to apply:** Treat normal Transactions and Transaction Intelligence as independent permission-gated destinations. Test full-access roles and explicit staff permissions, then confirm both labels exist in the deployed `main.dart.js`.