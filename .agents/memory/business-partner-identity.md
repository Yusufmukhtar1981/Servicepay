---
name: Business Partner identity
description: Why distributor Business Partners must remain separate from API-client Partner accounts and wallets.
---

Use the normal User authentication domain for distributor Business Partners,
with a linked distributor profile. Do not use or merge the API-client Partner
credential and wallet entity as the distributor login.

**Why:** API-client Partners authenticate with API credentials and maintain a
mutable purchase wallet, while distributor Business Partners manage scoped
officers, financing applications, and commission evidence. Combining them would
blur authorization boundaries and create unsafe wallet/commission coupling.

**How to apply:** New distributor features should scope through the logged-in
User and Business Partner profile. Preserve API Partner routes, credentials,
transactions, and balances as an independent integration domain.