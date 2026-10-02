const test = require("node:test");
const assert = require("node:assert/strict");
const { customerResponse, customerResponsePrivacy } = require("../middleware/customerResponsePrivacy.middleware");

for (const serviceType of ["DATA", "AIRTIME", "ELECTRICITY", "CABLE_TV", "BANK_TRANSFER", "OTHER"]) {
  for (const status of ["SUCCESSFUL", "FAILED", "PENDING"]) {
    test(`${serviceType} ${status}: private responses hidden, customer facts unchanged`, () => {
      const raw = { reference: "SP-unit-reference", serviceType, status, amount: 2000,
        provider: "TELECOM_ABODE", providerReference: "private-upstream-id",
        apiInformation: "private-api", dispatchStatus: "UNKNOWN", data: { fingerprint: "private-input-fingerprint" },
        providerResponse: { network: "MTN", providerCost: 1900, rawResponse: { secretExtra: "private", customerName: "private-raw-name" },
          electricity: { meterNumber: "62130123456", customerName: "Unit customer",
            electricityCompany: "Kano Electric", meterType: "prepaid", meterToken: "1234-5678-9012-3456-7890",
            units: "", providerReference: "private-upstream-id" },
          voucherCode: "unit-claim-code", serialNumber: "unit-serial" },
        metadata: { routing: { vendor: "private-vendor" }, providerResponse: { apiKey: "private-secret" } } };
      const before = JSON.stringify(raw);
      const projected = customerResponse(raw);
      const encoded = JSON.stringify(projected);
      assert.equal(JSON.stringify(raw), before);
      assert.equal(projected.reference, raw.reference);
      assert.equal(projected.amount, 2000);
      assert.equal(projected.status, status);
      assert.equal(projected.fulfillment.meterToken, raw.providerResponse.electricity.meterToken);
      assert.equal(projected.fulfillment.customerName, "Unit customer");
      assert.equal(projected.fulfillment.networkName, "MTN");
      assert.equal(projected.fulfillment.voucherCode, "unit-claim-code");
      assert.equal(projected.fulfillment.units, undefined);
      assert.equal(projected.deliveryStatus, "UNKNOWN");
      assert.doesNotMatch(encoded, /private|provider|apiInformation|dispatchStatus/i);
    });
  }
}
test("staff serialization is unchanged; final authenticated role controls projection", () => {
  for (const role of ["ADMIN", "SUPER_ADMIN", "OWNER", "HEAD_OFFICE"]) {
    const body = { provider: "TELECOM_ABODE", providerReference: "private-id",
      providerResponse: { cost: 123, reconciliation: "pending" } };
    const req = {};
    let actual;
    const res = { json(value) { actual = value; return this; } };
    customerResponsePrivacy(req, res, () => {});
    req.user = { role };
    res.json(body);
    assert.equal(actual, body);
  }
});
test("middleware filters post-auth customer response including duplicate data aliases", () => {
  const req = { body: { role: "ADMIN" } };
  let actual;
  const res = { json(value) { actual = value; } };
  customerResponsePrivacy(req, res, () => {});
  req.user = { role: "CUSTOMER" };
  res.json({ transaction: { provider: "private" }, data: { providerReference: "private" } });
  assert.deepEqual(actual, { transaction: {}, data: {} });
});
test("public catalog identities and prices stay usable without provider fields", () => {
  const result = customerResponse({ data: [{ displayName: "MTN", networkCode: "MTN",
    providerId: 1, provider: "TELECOM_ABODE", planProvider: "TELECOM_ABODE",
    primaryProvider: "TELECOM_ABODE", order_id: "private-order",
    id: "DATA-MTN-opaque-hash", price: 97, invoiceId: "public-invoice" }] });
  assert.equal(result.data[0].networkId, 1);
  assert.equal(result.data[0].networkCode, "MTN");
  assert.equal(result.data[0].id, "DATA-MTN-opaque-hash");
  assert.equal(result.data[0].price, 97);
  assert.equal(result.data[0].providerId, undefined);
  assert.equal(result.data[0].planProvider, undefined);
  assert.equal(result.data[0].primaryProvider, undefined);
  assert.equal(result.data[0].order_id, undefined);
  assert.equal(result.data[0].invoiceId, "public-invoice");
});
test("legacy completed purchases retain terminal delivery without private accounting fields", () => {
  assert.deepEqual(customerResponse({ reference: "SP-unit", status: "SUCCESSFUL",
    accountingStatus: "COMPLETE" }), { reference: "SP-unit", status: "SUCCESSFUL", deliveryStatus: "SUCCEEDED" });
});
test("names and internal accounting messages cannot leak via human-readable strings", () => {
  assert.equal(customerResponse({ description: "Telecom Abode delivery" }).description, "ServicePay delivery");
  assert.doesNotMatch(customerResponse({ message: "Provider cost, profit and commission are awaiting accounting reconciliation." }).message,
    /provider|profit|commission|reconciliation/i);
  assert.doesNotMatch(customerResponse({ message: "Failed at https://telecomabode.com.ng/api/bill/bill-purchase" }).message,
    /https|telecomabode|\/api\//i);
  assert.doesNotMatch(JSON.stringify(customerResponse({ code: "TELECOM_ABODE_UNAVAILABLE",
    error: "SecureWaveNG lookup unavailable" })), /TELECOM|SECUREWAVE/i);
});
test("real HTTP serialization filters customer success/failure/pending and preserves staff detail", async () => {
  const express = require("express");
  const app = express();
  app.use(customerResponsePrivacy);
  const original = { reference: "SP-existing-unit", provider: "TELECOM_ABODE",
    providerReference: "upstream-private", providerResponse: {
      actualCost: 1900, reconciliation: "pending", rawResponse: { apiKey: "private" },
      electricity: { meterToken: "1234-5678-9012-3456-7890", meterNumber: "62130123456" },
    } };
  app.get("/:role/:status", (req, res) => {
    req.user = { role: req.params.role === "staff" ? "HEAD_OFFICE" : "CUSTOMER" };
    res.status(req.params.status === "FAILED" ? 400 : req.params.status === "PENDING" ? 202 : 200)
      .json({ ...original, status: req.params.status });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    for (const status of ["SUCCESSFUL", "FAILED", "PENDING"]) {
      const customer = await (await fetch(`http://127.0.0.1:${server.address().port}/customer/${status}`)).json();
      assert.equal(customer.reference, original.reference);
      assert.equal(customer.status, status);
      assert.equal(customer.fulfillment.meterToken, original.providerResponse.electricity.meterToken);
      assert.equal(customer.provider, undefined);
      const staff = await (await fetch(`http://127.0.0.1:${server.address().port}/staff/${status}`)).json();
      assert.deepEqual(staff, { ...original, status });
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});