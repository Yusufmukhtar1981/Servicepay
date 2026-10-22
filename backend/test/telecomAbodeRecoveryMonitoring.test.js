const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelecomAbodeReconciliationWorker, recoverySchedule } =
  require("../services/telecomAbodeReconciliationWorker.service");

const date = new Date("2026-10-22T12:00:00Z");
const timings = { initialBackoffMs: 60000, maxBackoffMs: 900000, escalationAfterMs: 1800000 };
function row(serviceType = "AIRTIME", previous = {}, ageMs = 120000) {
  return { _id: "local-recovery", provider: "TELECOM_ABODE", serviceType,
    reference: "ORIGINAL-REFERENCE", providerRequestId: "ORIGINAL-REFERENCE",
    status: "PENDING", dispatchStatus: "UNKNOWN",
    createdAt: new Date(date - ageMs),
    providerResponse: { statusReconciliation: previous } };
}
async function run({ tx = row(), result, dataResult, throws = false, onAlert } = {}) {
  const writes = [], alerts = [];
  let claimed = false, lookups = 0;
  const worker = createTelecomAbodeReconciliationWorker({
    now: () => date, limit: 1,
    model: {
      findOneAndUpdate(filter) {
        assert.equal(filter.provider, "TELECOM_ABODE");
        return { lean: async () => claimed ? null : (claimed = true, tx) };
      },
      async updateOne(filter, update) { writes.push(update); },
    },
    airtime: { async reconcilePendingPurchase({ transactionId }) {
      assert.equal(transactionId, tx._id); lookups++;
      if (throws) throw new Error("private-provider-error-not-for-logs");
      return result;
    } },
    data: { async reconcileByReference(reference) {
      assert.equal(reference, tx.providerRequestId); lookups++;
      return dataResult || { body: { outcome: "UNKNOWN", providerLookup: "NOT_FOUND" } };
    } },
    electricity: { async requery() { assert.fail("Electricity is out of scope"); } },
    onAlert: onAlert || (event => alerts.push(event)),
  });
  await worker.run();
  assert.equal(lookups, 1);
  // This worker may update audit metadata only; no wallet/status mutation,
  // request-reference replacement or purchase endpoint exists in this fixture.
  for (const write of writes) {
    assert.ok(!write.$inc);
    assert.ok(Object.keys(write.$set).every(k => k.startsWith("providerResponse.statusReconciliation.")));
  }
  return { state: writes[0].$set, alerts };
}
const key = name => `providerResponse.statusReconciliation.${name}`;
test("Airtime financial PENDING does not mask provider UNKNOWN", async () => {
  const { state } = await run({ result: { status: "PENDING", providerResponse: {
    airtimeLifecycle: { outcome: "UNKNOWN", reasonCode: "TA_QUERY_UNCONFIRMED" },
  } } });
  assert.equal(state[key("outcome")], "UNKNOWN");
  assert.equal(state[key("reason")], "TA_QUERY_UNCONFIRMED");
});
test("documented provider PENDING stays distinct from UNKNOWN", async () => {
  const { state } = await run({ result: { status: "PENDING", providerResponse: {
    airtimeLifecycle: { outcome: "PENDING", reasonCode: "TA_QUERY_PENDING" },
  } } });
  assert.equal(state[key("outcome")], "PENDING");
});
for (const status of ["SUCCESSFUL", "FAILED"]) test(`settled Airtime ${status} is not downgraded`, async () => {
  const { state, alerts } = await run({ tx: row("AIRTIME", {}, 7200000), result: { status } });
  assert.equal(state[key("outcome")], status === "SUCCESSFUL" ? "SUCCESS" : "FAILED");
  assert.deepEqual(alerts, []);
});
test("unknown lookup errors persist a safe reason without leaking their message", async () => {
  const { state } = await run({ throws: true });
  assert.equal(state[key("outcome")], "UNKNOWN");
  assert.equal(state[key("reason")], "LOOKUP_UNAVAILABLE");
  assert.ok(!JSON.stringify(state).includes("private-provider-error"));
});
test("recent repeated uncertainty backs off exponentially with a hard cap", () => {
  let previous = {};
  const delays = [];
  for (let i = 0; i < 7; i++) {
    const schedule = recoverySchedule(row("DATA", previous), "UNKNOWN", date, timings);
    delays.push(schedule.delayMs);
    previous = { ...schedule.metadata, outcome: "UNKNOWN" };
  }
  assert.deepEqual(delays, [60000, 120000, 240000, 480000, 900000, 900000, 900000]);
});
test("a changed provider outcome resets the retry streak", () => {
  const schedule = recoverySchedule(row("DATA", {
    outcome: "UNKNOWN", unchangedOutcomeChecks: 10, attemptCount: 12,
  }), "PENDING", date, timings);
  assert.equal(schedule.delayMs, 60000);
  assert.equal(schedule.metadata.attemptCount, 13);
  assert.equal(schedule.metadata.unchangedOutcomeChecks, 1);
});
test("old backlog starts at the cap and huge or malformed counters stay bounded", () => {
  const old = recoverySchedule(row("DATA", {}, 86400000), "UNKNOWN", date, timings);
  assert.equal(old.delayMs, timings.maxBackoffMs);
  for (const value of [-1, "bad", Infinity, Number.MAX_SAFE_INTEGER]) {
    const schedule = recoverySchedule(row("DATA", {
      outcome: "UNKNOWN", unchangedOutcomeChecks: value,
    }), "UNKNOWN", date, timings);
    assert.ok(Number.isFinite(schedule.delayMs) && schedule.delayMs <= timings.maxBackoffMs);
  }
});
test("overdue unknown DATA is audit-marked and alerts contain aggregate counts only", async () => {
  const { state, alerts } = await run({ tx: row("DATA", {}, 7200000) });
  assert.equal(state[key("outcome")], "UNKNOWN");
  assert.equal(state[key("escalationReason")], "PROVIDER_CONFIRMATION_OVERDUE");
  assert.equal(state[key("escalatedAt")], date);
  assert.deepEqual(alerts, [{
    event: "BILL_RECONCILIATION_OVERDUE", provider: "TELECOM_ABODE",
    escalationAfterMs: timings.escalationAfterMs, counts: { DATA: 1, AIRTIME: 0 },
  }]);
});
test("overdue alert cooldown persists across worker restart", async () => {
  const { alerts } = await run({ tx: row("DATA", {
    lastOverdueAlertAt: new Date(date - 120000), escalatedAt: new Date(date - 7200000),
  }, 7200000) });
  assert.deepEqual(alerts, []);
});
test("monitoring failure cannot turn uncertainty into financial failure", async () => {
  const { state } = await run({ tx: row("DATA", {}, 7200000),
    onAlert: () => { throw new Error("monitor unavailable"); } });
  assert.equal(state[key("outcome")], "UNKNOWN");
});
test("invalid scheduling configuration fails explicitly", () => {
  assert.throws(() => createTelecomAbodeReconciliationWorker({
    initialBackoffMs: 0,
  }), /Invalid reconciliation timing/);
});
