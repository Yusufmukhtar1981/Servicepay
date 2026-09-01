---
name: Linked worktree recovery
description: How to handle an intact release worktree whose parent Git worktree metadata was removed.
---

Treat an existing directory as untrusted when its `.git` link is missing or broken, even if `git worktree list` still names it. Do not commit until `git -C <path> rev-parse --show-toplevel` resolves to that worktree.

**Why:** Replit checkpoint cleanup can remove `.git/worktrees/*` metadata while leaving validated release files in place, causing Git commands to silently resolve to the parent repository.

**How to apply:** Record hashes of validated files, prune stale worktree metadata, create a fresh worktree from the exact remote parent, reapply the patch, compare hashes, rerun focused tests, and commit only from the repaired worktree.