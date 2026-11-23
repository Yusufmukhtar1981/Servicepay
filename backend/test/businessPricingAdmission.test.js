"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { requireIntegratedBusinessPricing } = require("../middleware/businessPricingAdmission.middleware");

// A real Express dispatch verifies rejection happens before a charge handler.
// No database, credentials, wallet, provider or live server is used.
let server, origin, dispatched;
test.before(async () => {
  const app = express();
  app.use(express.json());
  for (const service of ["ELECTRICITY", "EXAM_PIN", "NIN", "BVN"]) {
    app.post(`/${service}`, requireIntegratedBusinessPricing(service), (_req, res) => {
      dispatched++;
      res.json({ success: true });
    });
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.beforeEach(() => { dispatched = 0; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
for (const service of ["ELECTRICITY", "EXAM_PIN", "NIN", "BVN"]) {
  test(`${service}: Customer requests remain unchanged; Agent and Merchant cannot inherit prices`, async () => {
    const invoke = async (body = {}, query = "") => {
      const response = await fetch(`${origin}/${service}${query}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await invoke()).status, 200);
    assert.equal(dispatched, 1);
    for (const businessKind of ["AGENT", "MERCHANT"]) {
      const bodyRequest = await invoke({ businessKind });
      assert.equal(bodyRequest.status, 409);
      assert.equal(bodyRequest.body.code, "NETWORK_PRICE_NOT_CONFIGURED");
      assert.equal(bodyRequest.body.service, service);
      assert.equal((await invoke({}, `?businessKind=${businessKind}`)).status, 409);
    }
    assert.equal((await invoke({ businessKind: "MERCHANT" }, "?businessKind=AGENT")).status, 400);
    assert.equal((await invoke({ businessKind: ["MERCHANT"] })).status, 400);
    assert.equal((await invoke({}, "?businessKind=MERCHANT&businessKind=AGENT")).status, 400);
    assert.equal(dispatched, 1, "No rejected request may reach a purchase/charge handler");
  });
}
test("guard is attached to charge admission, not callbacks or history", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const [file, pathName, service] of [
    ["electricity.routes.js", "/pay", "ELECTRICITY"],
    ["examPin.routes.js", "/buy", "EXAM_PIN"],
    ["idVerification.routes.js", "/nin", "NIN"],
    ["idVerification.routes.js", "/bvn", "BVN"],
  ]) {
    const source = fs.readFileSync(path.join(__dirname, "../routes", file), "utf8");
    assert.match(source, new RegExp(`"${pathName}",\\s*protect,\\s*requireIntegratedBusinessPricing\\("${service}"\\)`));
    assert.equal(source.split(`requireIntegratedBusinessPricing("${service}")`).length - 1, 1);
  }
});
