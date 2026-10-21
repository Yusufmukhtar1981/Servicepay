const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelecomAbodeReconciliationWorker } =
  require("../services/telecomAbodeReconciliationWorker.service");

test("old persistently pending Airtime cannot starve an unchecked DATA purchase", async () => {
  let date = new Date("2026-10-21T00:00:00Z");
  const checked = [];
  const rows = ["AIRTIME", "AIRTIME", "DATA"].map((serviceType, i) => ({
    _id: `local-${i}`, reference: `ORIGINAL-${i}`, providerRequestId: `ORIGINAL-${i}`,
    provider: "TELECOM_ABODE", serviceType, status: "PENDING", dispatchStatus: "UNKNOWN",
    createdAt: new Date(`2026-10-0${i + 1}T00:00:00Z`),
    providerResponse: { statusReconciliation: i < 2
      ? { checkedAt: new Date("2026-10-20T00:00:00Z") } : {} },
  }));
  const read = (row, path) => path.split(".").reduce((value, key) => value?.[key], row);
  const update = (row, change) => {
    for (const [path, value] of Object.entries(change.$set || {})) {
      const parts = path.split("."); const key = parts.pop();
      const target = parts.reduce((value, part) => value[part] ||= {}, row);
      target[key] = value;
    }
    for (const path of Object.keys(change.$unset || {})) {
      const parts = path.split("."); const key = parts.pop();
      delete parts.reduce((value, part) => value[part], row)[key];
    }
  };
  const worker = createTelecomAbodeReconciliationWorker({
    now: () => date, limit: 2,
    model: {
      findOneAndUpdate(_filter, change, options) {
        const eligible = rows.filter((row) => {
          const state = row.providerResponse.statusReconciliation;
          return (!state.nextCheckAt || state.nextCheckAt <= date) &&
            (!state.leaseUntil || state.leaseUntil <= date);
        });
        eligible.sort((a, b) => {
          for (const [path, direction] of Object.entries(options.sort)) {
            const left = read(a, path), right = read(b, path);
            if (left === undefined && right !== undefined) return -direction;
            if (right === undefined && left !== undefined) return direction;
            if (left < right) return -direction;
            if (left > right) return direction;
          }
          return 0;
        });
        const row = eligible[0];
        if (row) update(row, change);
        return { lean: async () => row || null };
      },
      async updateOne(filter, change) { update(rows.find((row) => row._id === filter._id), change); },
    },
    data: { async reconcileByReference(reference) {
      checked.push(reference);
      return { body: { outcome: "UNKNOWN", providerLookup: "NOT_FOUND" } };
    } },
    airtime: { async reconcilePendingPurchase({ transactionId }) {
      checked.push(transactionId);
      return { transaction: { status: "PENDING" } };
    } },
    electricity: { async requery() { assert.fail("No Electricity fixture is eligible"); } },
  });
  await worker.run();
  date = new Date(date.getTime() + 61000);
  await worker.run();
  assert.equal(checked.filter((id) => id === "ORIGINAL-2").length, 1,
    "Unchecked DATA must be queried once without bypassing UNKNOWN backoff");
  assert.ok(checked.includes("local-0") && checked.includes("local-1"));
  assert.ok(rows.every((row) => row.status === "PENDING"));
  assert.ok(rows.every((row) => row.dispatchStatus === "UNKNOWN"));
  assert.deepEqual(rows.map((row) => row.providerRequestId),
    ["ORIGINAL-0", "ORIGINAL-1", "ORIGINAL-2"]);
});
