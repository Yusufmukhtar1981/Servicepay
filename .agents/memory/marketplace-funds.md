---
name: Marketplace funds
description: Safety rule for Marketplace payment, fulfillment, and settlement changes.
---

Marketplace wallet payments are recorded as paid orders with funds held by ServicePay. Seller balances must not be credited as part of checkout or seller delivery-status updates.

**Why:** Product pricing, stock reservation, and buyer debits are transaction-safe, but no approved seller settlement, delivery-proof, dispute, or refund-release mechanism exists yet.

**How to apply:** Keep seller fulfillment limited to the controlled order lifecycle. Any future payout work must introduce an explicit, auditable settlement/reversal design before changing `fundsStatus` to settled or crediting a seller wallet.