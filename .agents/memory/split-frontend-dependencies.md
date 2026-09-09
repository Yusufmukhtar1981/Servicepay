---
name: Split frontend dependencies
description: Production dependency boundary between the customer and Admin Flutter repositories.
---

Customer-facing Flutter code must remain self-contained and must not import files that exist only in the Admin application tree.

**Why:** Local development can contain both trees and pass builds, while the customer production repository intentionally excludes Admin files. A cross-tree import therefore fails only in the production CI checkout.

**How to apply:** Before publishing customer UI changes, build from the exact remote customer commit or verify every imported source exists in that repository. Use a customer-owned API client or a shared package that is deliberately present in both repositories.