---
name: GitHub workflow publishing
description: Connector proxy restriction affecting workflow-file changes
---

The configured GitHub connector can update normal repository files but returns HTTP 403 for `.github/workflows` content paths.

**Why:** Admin source and backend changes can be published through the connector, but CI workflow updates cannot be safely applied by that route.

**How to apply:** Publish normal files through the connector and dispatch existing workflows for hosted validation. Treat workflow changes as pending until a supported repository write path is available; do not claim they were published after a 403.