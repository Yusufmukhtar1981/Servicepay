const test = require("node:test");
const assert = require("node:assert/strict");
const { createDataPurchaseStatus } = require("../controllers/dataPurchaseStatus.controller");
function response() {
  return { http: 200, status(n) { this.http = n; return this; },
    json(body) { this.body = body; return this; } };
}
const request = { user: { _id: "customer-a", role: "CUSTOMER" }, params: { key: "data-safe-key" } };
test("DATA status reads only the exact owned request and never returns raw provider data", async () => {
  let query;
  const controller = createDataPurchaseStatus({ lookup: async q => {
    query = q;
    return { status: "SUCCESSFUL", reference: "DATA-1", amount: 100, phone: "08000000000",
      providerResponse: { raw: "private", planName: "1GB", network: "MTN" } };
  } });
  const res = response(); await controller(request, res);
  assert.deepEqual(query, { customerId: "customer-a", serviceType: "DATA", idempotencyKey: "data-safe-key" });
  assert.equal(res.body.success, true);
  assert.equal(res.body.reference, "DATA-1");
  assert.equal(res.body.planName, "1GB");
  assert.equal(res.body.providerResponse, undefined);
});
test("not recorded and database failure remain pending, without dispatch", async () => {
  for (const lookup of [async () => null, async () => { throw Error("database failure"); }]) {
    const res = response(); await createDataPurchaseStatus({ lookup })(request, res);
    assert.equal(res.body.pending, true); assert.equal(res.body.success, false);
  }
});
test("pending or refunded requests are not reported as successful", async () => {
  for (const status of ["PENDING", "FAILED"]) {
    const res = response();
    await createDataPurchaseStatus({ lookup: async () => ({ status, dispatchStatus: status === "FAILED" ? "REFUNDED" : "UNKNOWN" }) })(request, res);
    assert.equal(res.body.success, false);
    assert.equal(res.body.status, status);
  }
});
test("staff and malformed request keys cannot query DATA custody", async () => {
  const controller = createDataPurchaseStatus({ lookup: () => { throw Error("must not query"); } });
  for (const req of [{ ...request, user: { _id: "staff", role: "ADMIN" } },
    { ...request, params: { key: { $ne: null } } }]) {
    const res = response(); await controller(req, res);
    assert.ok([400, 403].includes(res.http));
  }
});