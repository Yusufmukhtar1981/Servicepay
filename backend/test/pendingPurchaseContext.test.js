const test = require("node:test");
const assert = require("node:assert/strict");
const { createPendingPurchaseContext } = require("../controllers/pendingPurchaseContext.controller");
const call = async (handler, user, query) => {
  const result = { status: 200 };
  await handler({ user, query }, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  });
  return result;
};
test("pending context only reads the authenticated customer's requested service", async () => {
  const queries = [];
  const handler = createPendingPurchaseContext({ count: async filter => {
    queries.push(filter); return filter.phone ? 2 : 4;
  } });
  const result = await call(handler, { _id: "owner", role: "CUSTOMER" },
    { serviceType: "DATA", phone: "08012345678", network: "mtn", planCode: "plan-1" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, pendingCount: 4, matchingPendingCount: 2 });
  assert.ok(queries.every(q => q.customerId === "owner" && q.serviceType === "DATA"));
  assert.equal(queries[1]["providerResponse.planCode"], "plan-1");
});
test("pending context rejects staff and malformed services without database access", async () => {
  const handler = createPendingPurchaseContext({ count: () => { throw new Error("must not read"); } });
  assert.equal((await call(handler, { _id: "owner", role: "ADMIN" }, { serviceType: "DATA" })).status, 403);
  assert.equal((await call(handler, { _id: "owner", role: "CUSTOMER" }, { serviceType: "WALLET" })).status, 400);
});
test("pending context failures cannot claim that there are no pending purchases", async () => {
  const handler = createPendingPurchaseContext({ count: () => { throw new Error("db offline"); } });
  const result = await call(handler, { _id: "owner", role: "CUSTOMER" }, { serviceType: "AIRTIME" });
  assert.equal(result.status, 503);
  assert.equal(result.body.success, false);
  assert.equal(result.body.pendingCount, undefined);
});
