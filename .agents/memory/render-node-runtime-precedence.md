---
name: Render Node runtime precedence
description: How to diagnose Render npm failures when repository runtime pins appear ineffective.
---

Render's service-level `NODE_VERSION` environment variable takes precedence over the repository `.node-version` file. When a build reports a different runtime than the repository pin, correct the service variable before changing dependencies or regenerating lockfiles.

**Why:** A valid, reproducible `npm ci` failed on Render because the service still forced Node 22.22.0/npm 10.9.4. The repository pin alone had no effect. Node 20.18.2/npm 10.8.2 matched the backend engine contract and produced a live deployment.

**How to apply:** Inspect the first Render build lines for the effective Node/npm versions and whether they came from an environment variable. Validate lockfiles locally, prefer `npm ci`, and use a fresh build cache before considering dependency changes.