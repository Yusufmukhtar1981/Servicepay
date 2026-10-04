const test = require("node:test");
const assert = require("node:assert/strict");
const { createDataPurchaseStatus } = require("../controllers/dataPurchaseStatus.controller");
function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; },
    json(body) { this.body = body; return this; } };
}
const req = { user: { _id: "customer-a", role: "CUSTOMER" },
  params: { key: "data-request-12345678" } };
const tx = { status: "PENDING", provider: "TELECOM_ABODE",
  dispatchStatus: "UNKNOWN", dispatchClaimedAt: new Date(), reference: "bound-ref",
  amount: 100, phone: "08012345678", providerResponse: {} };

test("customer-bound UNKNOWN queries provider once, retains held funds and offers explicit independent purchase", async () => {
  let calls = 0;
  const controller = createDataPurchaseStatus({
    lookup: async filter => {
      assert.deepEqual(filter, { customerId: "customer-a", serviceType: "DATA",
        idempotencyKey: req.params.key });
      return tx;
    },
    reconcile: async reference => {
      assert.equal(reference, tx.reference); calls++;
      return { body: { outcome: "UNKNOWN", providerLookup: "NOT_FOUND" } };
    },
  });
  const res = response(); await controller(req, res);
  assert.equal(calls, 1);
  assert.equal(res.body.status, "UNKNOWN");
  assert.equal(res.body.allowSeparatePurchase, true);
  assert.equal(tx.status, "PENDING", "unknown never refunds or rewrites custody");
});

test("genuine provider PENDING and active dispatch remain locked against a new purchase", async () => {
  for (const dispatchStatus of ["READY", "CLAIMED", "SENDING", "UNKNOWN"]) {
    let calls = 0;
    const controller = createDataPurchaseStatus({
      lookup: async () => ({ ...tx, dispatchStatus }),
      reconcile: async () => { calls++; return { body: { providerStatus: "PENDING" } }; },
    });
    const res = response(); await controller(req, res);
    assert.equal(res.body.status, "PENDING");
    assert.equal(res.body.allowSeparatePurchase, false);
    assert.equal(calls, dispatchStatus === "UNKNOWN" ? 1 : 0);
  }
});

test("correlated reconciliation rereads final success/refund, never trusts an uncommitted result", async () => {
  for (const final of [{status: "SUCCESSFUL", dispatchStatus: "SUCCEEDED"},
      {status: "FAILED", dispatchStatus: "REFUNDED"}]) {
    let current = tx;
    const controller = createDataPurchaseStatus({
      lookup: async () => current,
      reconcile: async () => { current = {...tx, ...final}; return {body: {outcome: "SUCCESS"}}; },
    });
    const res = response(); await controller(req, res);
    assert.equal(res.body.status, final.status);
    assert.equal(res.body.dispatchStatus, final.dispatchStatus);
    assert.equal(res.body.allowSeparatePurchase, false);
  }
});

test("missing record, unavailable query and unauthorized account fail closed without a new dispatch", async () => {
  const missing = response();
  await createDataPurchaseStatus({lookup: async () => null,
    isRetired: async () => false})(req, missing);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.allowSeparatePurchase, false);
  const unavailable = response();
  await createDataPurchaseStatus({lookup: async () => tx,
    reconcile: async () => { throw Error("unavailable"); }})(req, unavailable);
  assert.equal(unavailable.statusCode, 503);
  const denied = response();
  await createDataPurchaseStatus({lookup: async () => { throw Error("must not query"); }})(
    {...req, user: {_id: "staff", role: "ADMIN"}}, denied);
  assert.equal(denied.statusCode, 403);
});