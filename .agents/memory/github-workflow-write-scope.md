---
name: GitHub workflow write scope
description: Distinguishes ordinary repository writes from authorization to modify GitHub Actions workflow files.
---

GitHub authorization that can create blobs, trees, commits, and refs for ordinary repository files may still reject a tree containing `.github/workflows/**`.

**Why:** GitHub protects workflow-file changes with a distinct workflow permission/scope. A connection can report broad repository access and successfully publish application code while returning a misleading 404 for a tree that includes a workflow file.

**How to apply:** When a mixed Git tree fails but a non-workflow tree succeeds, isolate the workflow path before retrying. Do not misdiagnose the repository or Git Data API; repair the GitHub authorization’s workflow permission before publishing the workflow change.