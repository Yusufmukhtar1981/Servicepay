---
name: Twilio TURN account entitlement
description: Provider-side limitation affecting ephemeral WebRTC ICE credential generation.
---

Twilio Network Traversal token generation can return HTTP 401 error 20003 with a message that the feature is unavailable on a Trial account. This is an account entitlement failure, not evidence that the SID/auth token variables are missing or that the application route is mis-mounted.

**Why:** The ServicePay call path correctly uses Twilio's ephemeral Tokens endpoint and fails closed when no credentialed TURN server is returned; a trial-account response cannot produce usable ICE credentials.

**How to apply:** Verify the live provider response and production secret presence before changing WebRTC code. The unblock is upgrading the Twilio account or using credentials from an eligible non-Trial Twilio account, without logging or hard-coding credentials.