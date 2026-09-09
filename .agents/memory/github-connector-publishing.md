---
name: GitHub connector publishing
description: Safe publication when the local Git remote has no usable authentication and remote main may have advanced.
---

Use the authenticated GitHub connector rather than retrying local HTTPS pushes. Before updating `main`, ensure the remote ref has not advanced from the expected parent. If local and remote history cannot be compared, only layer committed file changes on the remote tree after verifying each changed file's remote blob still matches the local commit's base blob (and new files are absent).

**Why:** The workspace Git remote may reject password/token authentication, while the GitHub connector is authorized. A remote branch can advance independently, and a non-force API update must never overwrite those changes.

**How to apply:** Commit and validate locally first; exclude unrelated untracked attachments. Use the connector's Git database endpoints to create blobs/tree/commit and PATCH the branch with `force: false` only after the relevant file-level conflict check passes.

When transporting local file contents into connector blob requests, read the files directly and encode them in memory. Avoid parsing shell marker streams: line-ending normalization can leave carriage returns in marker-derived path keys, producing an opaque GitHub `422` with missing blob content.

GitHub connector reads may succeed while mutation payloads are rejected by Replit's Cloudflare layer. After any transport or HTML-block-page error, re-read the branch head before retrying; if unchanged, stop rather than repeatedly creating orphan blobs or duplicate commits.

If the workspace already has a protected GitHub push secret, a safe fallback is to clone the current remote branch into temporary storage, repeat the file-level base checks there, and push with an ephemeral credential helper. Never print the secret, embed it in a remote URL, or persist it in Git configuration.

Fine-grained token access to repository contents does not necessarily authorize commits that modify `.github/workflows/*`; GitHub can reject those pushes even when ordinary source pushes succeed.

**Why:** Workflow-file writes require separate workflow authorization, while an existing workflow can still run normally after an application-only commit.

**How to apply:** Probe ordinary ref writes first. If only a workflow-file push is rejected, preserve the existing remote workflow and publish validated application files separately unless changing the workflow is essential.

GitHub push protection scans every unpublished commit being introduced, including historical test fixtures. If it blocks an older commit and history rewriting is prohibited, stop and require an explicit repository-side allowance before retrying.

**Why:** Editing the fixture in a new commit does not remove the flagged value from history, while rebasing or filtering the branch would violate the non-rewrite constraint.

**How to apply:** Confirm the reported location is historical, do not use force-push or secret-scanning bypass APIs, and retry the same non-force push only after the repository owner explicitly allows the detected fixture.