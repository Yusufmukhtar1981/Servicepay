const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelecomAbodeService } = require("../services/telecomAbode.service");
const { createTelecomAbodeBillsProvider } = require("../services/telecomAbodeBillsProvider.service");
const { createTelecomAbodeReconciliationWorker } = require("../services/telecomAbodeReconciliationWorker.service");

test("DATA status lookup is bounded and timeout cannot imply failure or resend", async () => {
  const calls = [];
  const provider = createTelecomAbodeService({
    apiKey: "fixture-key", audit() {},
    transport: async request => {
      calls.push(request);
      throw new Error("fixture timeout");
    },
  });
  await assert.rejects(provider.getTransactionByRequestId("original-reference"),
    { code: "PROVIDER_REQUEST_UNCERTAIN" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].timeout, 10000);
});

test("Airtime lookup timeout stays unknown; Electricity timeout is unchanged", async () => {
  const calls = [];
  const provider = createTelecomAbodeBillsProvider({
    credentials: () => "fixture-key",
    transport: async request => { calls.push(request); throw new Error("timeout"); },
  });
  for (const service of ["AIRTIME", "ELECTRICITY"]) {
    const result = await provider.query({ service, requestId: "original-reference" });
    assert.equal(result.outcome, "UNKNOWN");
    assert.equal(result.authoritative, false);
  }
  assert.deepEqual(calls.map(c => [c.method, c.timeout]),
    [["GET", 10000], ["GET", 30000]]);
});

test("recent uncertain bills recover promptly without racing active sends or historical records", async () => {
  const now = new Date("2026-11-05T12:00:00Z");
  let filter;
  await createTelecomAbodeReconciliationWorker({
    now: () => now,
    model: { findOneAndUpdate(value) {
      filter = value; return { lean: async () => null };
    } },
  }).run();
  assert.equal(filter.createdAt.$lte.toISOString(), "2026-11-05T11:59:45.000Z");
  assert.equal(filter.$and[0].$or[1].dispatchClaimedAt.$lte.toISOString(),
    "2026-11-05T11:58:00.000Z");
  assert.equal(filter.$and.at(-1).$or[1].createdAt.$gte instanceof Date, true);
  const budget = filter.$and.find(v => v.$or?.some(x =>
    x["providerResponse.statusReconciliation.attemptCount"]?.$lt));
  assert.equal(budget.$or[2]["providerResponse.statusReconciliation.attemptCount"].$lt, 12);
  assert.equal(budget.$or[0].serviceType, "ELECTRICITY");
  // Electricity preserves its existing two-minute grace.
  assert.equal(filter.$and[0].$or[0].$or[1].createdAt.$lte.toISOString(),
    "2026-11-05T11:58:00.000Z");
});

test("late recovery metadata cannot overwrite a settled transaction or another worker lease", async () => {
  const now = new Date("2026-11-05T12:00:00Z");
  let claimed = false, write;
  await createTelecomAbodeReconciliationWorker({
    now: () => now, limit: 1,
    model: {
      findOneAndUpdate() { return { lean: async () => {
        if (claimed) return null;
        claimed = true;
        return { _id: "local-only", serviceType: "DATA", dispatchStatus: "UNKNOWN",
          providerRequestId: "original-reference", reference: "original-reference",
          createdAt: new Date(now - 20000) };
      } }; },
      async updateOne(filter, change) { write = { filter, change }; },
    },
    data: { async reconcileByReference() { return { body: { outcome: "UNKNOWN" } }; } },
  }).run();
  assert.equal(write.filter.status, "PENDING");
  assert.equal(write.filter.providerRequestId, "original-reference");
  assert.equal(write.filter["providerResponse.statusReconciliation.leaseUntil"].getTime(),
    now.getTime() + 300000);
  assert.equal(write.change.$inc, undefined);
  assert.equal(write.change.$set.status, undefined);
});
