const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelecomAbodeReconciliationWorker } =
  require("../services/telecomAbodeReconciliationWorker.service");
const fs = require("node:fs");
const path = require("node:path");

const date = new Date("2026-10-23T12:00:00Z");
function fixture({ dispatchStatus = "SENDING", concurrentSettlement = false } = {}) {
  let claimed = false;
  let lookups = 0;
  const mutations = [];
  const tx = {
    _id: "isolated-recovery", reference: "DATA-ORIGINAL",
    providerRequestId: "DATA-ORIGINAL", provider: "TELECOM_ABODE",
    serviceType: "DATA", status: "PENDING", dispatchStatus,
  };
  const worker = createTelecomAbodeReconciliationWorker({
    now: () => date,
    model: {
      findOneAndUpdate(filter, update) {
        mutations.push({ filter, update });
        if (filter._id) {
          assert.equal(filter.status, "PENDING");
          assert.equal(filter.dispatchStatus, "SENDING");
          assert.equal(filter.reference, tx.providerRequestId);
          assert.equal(filter.dispatchClaimedAt.$lte.toISOString(),
            "2026-10-23T11:58:00.000Z");
          return { lean: async () => concurrentSettlement ? null :
            { ...tx, dispatchStatus: "UNKNOWN" } };
        }
        assert.deepEqual(filter.$and[0].$or[1], {
          dispatchStatus: "SENDING",
          dispatchClaimedAt: { $lte: new Date("2026-10-23T11:58:00Z") },
        });
        return { lean: async () => {
          if (claimed) return null;
          claimed = true;
          return tx;
        } };
      },
      async updateOne(filter, update) { mutations.push({ filter, update }); },
    },
    data: { async reconcileByReference(reference) {
      lookups++;
      assert.equal(reference, tx.providerRequestId);
      return { body: { outcome: "UNKNOWN", providerLookup: "NOT_FOUND" } };
    } },
  });
  return { worker, mutations, lookups: () => lookups };
}
test("restart recovers a stale DATA send using only its original status lookup", async () => {
  const f = fixture();
  await f.worker.run();
  assert.equal(f.lookups(), 1);
  const recovery = f.mutations.find(x => x.update.$set?.dispatchStatus);
  assert.deepEqual(recovery.update, { $set: { dispatchStatus: "UNKNOWN" } });
  const metadata = f.mutations.find(x =>
    x.update.$set?.["providerResponse.statusReconciliation.outcome"]);
  assert.equal(metadata.update.$set["providerResponse.statusReconciliation.outcome"], "UNKNOWN");
  assert.equal(metadata.update.$set["providerResponse.statusReconciliation.reason"], "NOT_FOUND");
  assert.ok(f.mutations.every(x => !x.update.$inc && !x.update.$set?.status));
});
test("a webhook settling during restart recovery cannot be downgraded or re-queried", async () => {
  const f = fixture({ concurrentSettlement: true });
  await f.worker.run();
  assert.equal(f.lookups(), 0);
  assert.ok(!f.mutations.some(x => x.update.$set?.[
    "providerResponse.statusReconciliation.outcome"]));
});
test("an already UNKNOWN request is looked up without a second dispatch transition", async () => {
  const f = fixture({ dispatchStatus: "UNKNOWN" });
  await f.worker.run();
  assert.equal(f.lookups(), 1);
  assert.ok(!f.mutations.some(x => x.update.$set?.dispatchStatus));
});
test("SecureWave webhook routing does not log raw headers, signatures or bank payloads", () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/securewave.routes.js"), "utf8");
  assert.ok(!source.includes("console.log"));
  assert.ok(source.includes("handleVirtualAccountWebhook"));
  const controller = fs.readFileSync(path.join(
    __dirname, "../controllers/securewaveWebhook.controller.js"), "utf8");
  assert.ok(!controller.includes('"SecureWave normalized webhook:"'));
  assert.ok(!controller.includes('"SecureWave wallet credited:"'));
});
test("SecureWave webhook still rejects invalid signatures before database or wallet access", async () => {
  const previous = process.env.SECUREWAVE_WEBHOOK_SECRET;
  process.env.SECUREWAVE_WEBHOOK_SECRET = "isolated-signature-test-only";
  try {
    const controller = require("../controllers/securewaveWebhook.controller");
    const response = { code: null, body: null,
      status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; } };
    await controller.handleVirtualAccountWebhook({
      headers: { "x-signature": "invalid-test-signature" },
      body: {}, rawBody: Buffer.from("{}"),
    }, response);
    assert.equal(response.code, 401);
    assert.equal(response.body.success, false);
  } finally {
    if (previous === undefined) delete process.env.SECUREWAVE_WEBHOOK_SECRET;
    else process.env.SECUREWAVE_WEBHOOK_SECRET = previous;
  }
});
