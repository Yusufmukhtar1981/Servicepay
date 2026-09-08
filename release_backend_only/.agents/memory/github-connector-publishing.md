---
name: GitHub connector publishing
description: Safe publication when the local Git remote has no usable authentication and remote main may have advanced.
---

Use the authenticated GitHub connector rather than retrying local HTTPS pushes. Before updating `main`, ensure the remote ref has not advanced from the expected parent. If local and remote history cannot be compared, only layer committed file changes on the remote tree after verifying each changed file's remote blob still matches the local commit's base blob (and new files are absent).

**Why:** The workspace Git remote may reject password/token authentication, while the GitHub connector is authorized. A remote branch can advance independently, and a non-force API update must never overwrite those changes.

**How to apply:** Commit and validate locally first; exclude unrelated untracked attachments. Use the connector's Git database endpoints to create blobs/tree/commit and PATCH the branch with `force: false` only after the relevant file-level conflict check passes.