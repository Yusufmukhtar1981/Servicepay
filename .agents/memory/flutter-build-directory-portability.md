---
name: Flutter build directory portability
description: Prevent clean Flutter publish builders from failing on development-only build-directory links.
---

Do not track Flutter's `build` path as an absolute symbolic link into `/tmp`. Keep generated build output ignored and let each environment create its own normal `build/` directory.

**Why:** A local disk-saving link can work while its `/tmp` target exists, but a clean static publish builder receives the link without its target. Flutter then fails before compilation with a path-not-found error while creating `build`.

**How to apply:** If a publish build reports that creating the workspace `build` path failed, inspect the Git mode for that path. Remove any tracked symlink, confirm `build/` is ignored, and run the exact static publish command from a normal directory.