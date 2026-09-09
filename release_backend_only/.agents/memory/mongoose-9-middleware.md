---
name: Mongoose 9 middleware
description: Compatibility rule for model middleware in the current backend dependency range.
---

Use synchronous or async Mongoose middleware that returns normally or throws to reject an operation; do not depend on a `next` callback.

**Why:** Mongoose 9 no longer passes the callback to these hooks. Callback-style middleware fails with `next is not a function`, which can prevent normal persistence and invalidate audit protections.

**How to apply:** When adding or updating schema middleware, use `throw` for a rejected operation and test the protected write path against the installed Mongoose version.