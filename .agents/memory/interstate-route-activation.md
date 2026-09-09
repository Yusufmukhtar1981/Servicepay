---
name: Interstate route activation
description: Defines the operational safety rule for activating Interstate Logistics pricing.
---

Interstate Logistics must remain unavailable until Head Office explicitly creates an active route between two real active branches. Never seed routes, prices, drivers, vehicles, trips, or shipments automatically.

**Why:** Production pricing and wallet debits must be based on approved operational capacity, not invented setup data.

**How to apply:** Keep empty states actionable, derive route states from selected branches, and verify record counts remain unchanged unless an authorized operator intentionally submits a setup form.