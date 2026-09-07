# ServicePay production reconciliation

Audit date: 2026-09-07

This document is the release source of truth until the legacy deployment paths
are retired. It records observed production evidence; it does not authorize a
deployment, migration, data change, or deletion.

## Current projects and deployment paths

| Project/component | Purpose | Repository/source | Branch and observed revision | Provider and live domain | Build/output | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Main ServicePay workspace | Canonical customer, Head Office/Admin source, backend, and shared Flutter code | `Yusufmukhtar1981/Servicepay`; local branch `staff-dashboard-release-final` | Workspace `d00f2b63e8fd`; GitHub `main` `4bd63911d322` | Replit also has a public static deployment at `servicepay.replit.app` | `flutter build web --release`; `build/web` | Canonical source, but workspace and GitHub `main` do not match |
| Customer frontend | Production customer Flutter web | `Yusufmukhtar1981/Servicepay` | GitHub `main` `4bd63911d322` | GitHub Pages, `servicepay.ng` | `.github/workflows/deploy-customer-web.yml`; `build/web` | Active production |
| Canonical Head Office/Admin source | Current approved Admin and Executive/SVP implementation | Main repository, `lib/admin/main.dart` | Workspace `d00f2b63e8fd` | Development preview only; port 8080 | `tool/build_admin_web.sh`; default `build/admin-web` | Canonical source, not live production |
| Legacy Admin deployment | Admin currently served to users | `Yusufmukhtar1981/servicepay-admin` | GitHub `main` `b00e08521ed0` | GitHub Pages, `admin.servicepay.ng` | `.github/workflows/deploy_admin_web.yml`; `build/web` | Active legacy production |
| Backend/API | Canonical Express API in the main repository | Main repository, `backend/` | Live commit unknown because production exposes no version and Render management authentication failed | Render behind Cloudflare, `api.servicepay.ng` | `node backend/index.js`; Docker image/runtime output | Active production; deployed source revision not identifiable |
| Replit static deployment | Alternate customer build path | Current Repl | Last successful Replit build revision not exposed in the app | Replit Static, `servicepay.replit.app` | `.replit` deployment; `build/web` | Active conflicting/alternate path; not a custom production domain |
| Admin preview | Exact canonical Admin entrypoint for development verification | Current workspace | Current workspace revision | Replit development workflow, port 8080 | `/tmp/servicepay-admin-preview-web` | Development only |
| VULL | Separate product | Separate/unknown | Not audited | Not audited | Not audited | Out of scope; untouched |

## Live domain ownership

- `servicepay.ng`: GitHub Pages for `Yusufmukhtar1981/Servicepay`, deployed by
  `Deploy ServicePay Customer Web` from `main`.
- `admin.servicepay.ng`: GitHub Pages for
  `Yusufmukhtar1981/servicepay-admin`, deployed by
  `Deploy ServicePay Admin Web` from `main`.
- `api.servicepay.ng`: Render origin behind Cloudflare. The exact Render
  repository, branch, and deploy commit remain unverified because the stored
  Render API credential returned HTTP 401 and the live API had no version
  endpoint at audit time.

## Reconciliation findings

1. The current workspace is not the same revision as the customer production
   repository head.
2. The live Admin is built from a separate repository, not from the canonical
   `lib/admin/main.dart` now containing Executive Management/SVP work.
3. The live API root has no version/commit field. Several current route families
   return 404 in production, including SVP and rider-withdrawal feature control.
4. The Repl has a successful public static deployment in addition to the two
   GitHub Pages custom-domain deployments.
5. A code/test/preview PASS therefore cannot prove that the custom production
   domain contains the change.

## Recent-fix live evidence

| Capability | Canonical code | Preview | Live build/UI | Live API | Reconciliation result |
| --- | --- | --- | --- | --- | --- |
| Rider withdrawal | Present | Previously verified | Legacy Admin bundle contains a Rider Withdrawal surface | Withdrawal reads return 200; rider-withdrawal control returns 404 | Partial/stale; not accepted as live |
| Rider credit/debit and Admin wallet controls | Present in canonical rider wallet administration code | Previously verified | Current approved controls cannot be tied to the legacy Admin revision | Related authenticated reads return 200; mutation routes were not called | Not live-verified |
| Executive Management | Present | Verified | Absent from live Admin UI and bundle | SVP probe returns 404 | Not deployed |
| SVP Management/Create SVP | Present | Verified | Absent from live Admin UI and bundle | SVP probe returns 404 | Not deployed |
| SVP login/routing | Present | Verified | No live SVP module was found | SVP probe returns 404 | Not deployed |
| Main Head Office Dashboard | Present | Verified | Present and is the first page after normal `HEAD_OFFICE` login | Established Admin reads return 200 | Live |

Production verification used the normal visible login form at
`admin.servicepay.ng`. No injected token, mock API, financial write, SVP create,
wallet adjustment, or business-data mutation endpoint was used.

## Canonical controlled release pipelines

No step below should run until a human explicitly approves the reconciliation.

### Backend/API

1. Start from an approved main-repository commit and record its full SHA.
2. Run backend tests, including authentication, wallets, withdrawals, rider
   wallet controls, and SVP authorization/scope suites.
3. Build the production image from the root Dockerfile.
4. Set `SERVICEPAY_BUILD_VERSION` and `SERVICEPAY_BUILD_COMMIT` to the approved
   release identifier and commit, or verify the host supplies
   `RENDER_GIT_COMMIT`.
5. Deploy that exact commit to the one canonical Render service.
6. Verify `/` and `/version` expose the expected non-sensitive identifiers.
7. Use normal credentials and status-only GET probes for every critical route
   family. Never test with balance-changing requests.
8. Compare the live commit to the approved commit before declaring
   `LIVE VERIFIED: PASS`.

### Head Office/Admin

1. Treat the main repository's `lib/admin/main.dart` as the only Admin source.
2. Run focused Flutter tests and analysis.
3. Build the exact artifact with:
   `ADMIN_OUTPUT_DIR=build/admin-web bash tool/build_admin_web.sh`.
4. Inspect the artifact for the expected build/commit label and required Admin
   feature strings.
5. During reconciliation, configure one static production target for
   `admin.servicepay.ng` that consumes this artifact. Do not hand-edit or
   independently develop the legacy `servicepay-admin` UI.
6. After DNS/target approval, deploy the exact artifact and verify normal
   Head Office login, default Dashboard, Executive Management, Create SVP, SVP
   Management, and return-to-Dashboard behavior.
7. Keep the legacy repository undeleted until rollback criteria and retention
   are approved.

### Customer frontend

1. Reconcile the workspace onto an approved `Servicepay/main` commit.
2. Run Flutter tests, analysis, and release build for `lib/main.dart`.
3. Use only `.github/workflows/deploy-customer-web.yml` for `servicepay.ng`.
4. Confirm the generated `window.SERVICEPAY_BUILD_VERSION` equals the approved
   Git commit and that old service-worker caches are removed.
5. Verify the real customer login and critical read-only journeys on
   `servicepay.ng`.
6. Retire or clearly mark `servicepay.replit.app` as non-canonical only after
   ownership and rollback approval; do not delete it during reconciliation.

## Production acceptance rule

Every production-facing completion report must state these independently:

- `IMPLEMENTATION: PASS/FAIL`
- `PREVIEW: PASS/FAIL/NOT RUN`
- `DEPLOYED: YES/NO`
- `LIVE VERIFIED: PASS/FAIL/NOT DEPLOYED/LIVE VERIFICATION PENDING`

Tests, builds, source inspection, and previews never imply deployment. If the
custom live domain was not exercised through its real user flow and matched to
the expected build identifier, the task is not production-complete.

## Required reconciliation sequence

1. Repair/replace the Render management credential and identify the live API
   service's repository, branch, and deployed commit.
2. Choose and approve the single Admin deployment target that will consume the
   main repository Admin artifact.
3. Reconcile the workspace branch with `Servicepay/main` without force-pushing
   or discarding either side.
4. Produce immutable customer, Admin, and backend release candidates with
   visible identifiers.
5. Review diffs and migration impact; prohibit destructive database changes.
6. Release backend first, then Admin, then customer, with a rollback checkpoint
   after each component.
7. Verify every custom domain against its expected commit and real user flow.
8. Only then mark the recent fixes live and decide whether to retire legacy
   deployment paths.

## Audit decision block

SERVICEPAY CANONICAL FRONTEND PROJECT: Main ServicePay repository, `lib/main.dart`

SERVICEPAY CANONICAL ADMIN PROJECT: Main ServicePay repository, `lib/admin/main.dart`

SERVICEPAY CANONICAL BACKEND PROJECT: Main ServicePay repository, `backend/`

servicepay.ng SERVED BY: GitHub Pages from `Yusufmukhtar1981/Servicepay`, branch `main`, commit `4bd63911d322`

admin.servicepay.ng SERVED BY: GitHub Pages from legacy `Yusufmukhtar1981/servicepay-admin`, branch `main`, commit `b00e08521ed0`

api.servicepay.ng SERVED BY: Render behind Cloudflare; exact repository, branch, and deployed commit are unverified

WORKSPACE/LIVE VERSION MATCH: NO

STALE PRODUCTION BUILD FOUND: YES

MULTIPLE CONFLICTING DEPLOYMENT PATHS FOUND: YES

RIDER WITHDRAWAL LIVE: FAIL

RIDER CREDIT/DEBIT LIVE: FAIL

FEATURE CONTROLS LIVE: FAIL

EXECUTIVE MANAGEMENT LIVE: NOT DEPLOYED

CREATE SVP LIVE: NOT DEPLOYED

SVP BACKEND LIVE: NOT DEPLOYED

MAIN HEAD OFFICE DASHBOARD PRESERVED: YES

VERSION IDENTIFICATION AVAILABLE: NO

CANONICAL RELEASE PIPELINE DEFINED: YES

PRODUCTION DATA MODIFIED: NO

VULL MODIFIED: NO

ROOT CAUSE OF RECENT “PASS BUT NOT WORKING” ISSUES: Changes were implemented and verified in the main workspace, while `admin.servicepay.ng` continued deploying a separate legacy repository and the live Render API revision could not be identified. Preview, custom-domain production, GitHub Pages, Render, and the additional Replit static deployment were treated as if they were one release path even though they were not.

RECOMMENDED RECONCILIATION ACTIONS: Repair Render management access and pin the live API commit; reconcile the workspace branch with `Servicepay/main`; approve one Admin static target that builds `lib/admin/main.dart`; produce versioned immutable backend/Admin/customer artifacts; release and verify one component at a time; retain legacy paths only for approved rollback until retirement is authorized.

SAFE TO BEGIN CONTROLLED RECONCILIATION/RELEASE: NO