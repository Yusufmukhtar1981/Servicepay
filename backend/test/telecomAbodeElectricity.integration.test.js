const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Tx = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const { createTelecomAbodeBillsProvider } = require("../services/telecomAbodeBillsProvider.service");
const { createTelecomAbodeElectricity } = require("../services/telecomAbodeElectricity.service");
let repl, sequence = 0;
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k]))
    throw Error("Tests must not inherit database credentials.");
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(repl.getUri(), { dbName: "electricity-safe-integration" });
  await Promise.all([User, Tx, Ledger].map(m => m.init()));
});
test.after(async () => { await mongoose.disconnect(); await repl?.stop(); });
async function fixture(mode = "success", type = "01") {
  const n = ++sequence, calls = [];
  const user = await User.create({ fullName: "Unit buyer", phone: `080${String(n).padStart(8,"0")}`,
    email: `electricity-${n}@test.invalid`, password: "unit-password", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 5000 });
  const transport = async options => {
    calls.push(options);
    if (options.url.endsWith("/get-bill")) return { status: 200,
      data: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: "DISCO " + (i + 1) })) };
    if (options.url.endsWith("/bill/bill-validation")) {
      const invalid = /^(\d)\1+$/.test(options.data.meter_number) || mode === "generic";
      return { status: 200, data: { status: "success", name: invalid ? "Fallback" : "Unit account",
        customer_address: invalid ? "Fallback address" : "Unit address",
        message: invalid ? "Generic verified" : "Unit account" } };
    }
    if (mode === "timeout") throw Error("Unit timeout");
    if (mode === "failed" && options.method === "POST") return { status: 422,
      data: { status: "fail", Status: "failed", message: "Validation rejected" } };
    if (mode === "lookup-failed" && options.method === "GET") return { status: 200,
      data: { status: "fail", Status: "failed", "request-id": options.url.split("/").pop() } };
    if (mode === "lookup-failed" && options.method === "POST") throw Error("Unit timeout");
    return { status: 200, data: { status: "success", Status: "successful", service: "electricity",
      "request-id": options.data?.["request-id"] || options.url.split("/").pop(),
      ...(type === "01" && mode !== "missing-token"
        ? mode === "combined" ? { token: "1234-5678-9012-3456-7890 (Unit 12.34)" }
          : { token: "1234 5678 9012 3456 7890", units: "12.34" } : {}) } };
  };
  const bills = createTelecomAbodeBillsProvider({ transport, credentials: () => "unit-only-key" });
  const config = { primaryProvider: "TELECOM_ABODE", providerStates: [{ provider: "TELECOM_ABODE", enabled: true }] };
  const service = createTelecomAbodeElectricity({ bills, transport, secret: () => "unit-ticket-signing-only",
    allowCustomer: () => true, readConfig: async () => config });
  const input = { electricCompany: 3, meterType: type, meterNumber: "62130123456", phoneNumber: "+2348012345678",
    amount: 1000, idempotencyKey: `electricity-unit-${n}`, customerConfirmed: true };
  return { user, service, calls, config, input, setMode: value => { mode = value; } };
}
async function confirmed(f) {
  const v = await f.service.verify(f.user._id, f.input);
  return { ...f.input, validationToken: v.validationToken };
}
test("all twelve stable DISCO IDs validate without any purchase or debit", async () => {
  const f = await fixture();
  for (let id = 1; id <= 12; id++) {
    const v = await f.service.verify(f.user._id, { ...f.input, electricCompany: id });
    assert.equal(v.customer.disco, id);
    assert.equal(v.customer.meterTypeAuthority, "CUSTOMER_SELECTED_NOT_PROVIDER_VERIFIED");
  }
  assert.equal(await Tx.countDocuments({ customerId: f.user._id }), 0);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 0);
});
test("generic fallback identity cannot authorize a payment", async () => {
  const f = await fixture("generic");
  await assert.rejects(f.service.verify(f.user._id, f.input), { code: "METER_IDENTITY_UNTRUSTED" });
  assert.equal((await User.findById(f.user._id)).walletBalance, 5000);
});
for (const type of ["01", "02"]) test(`type ${type} settles exactly once with unknown invoice cost`, async () => {
  const f = await fixture("success", type), input = await confirmed(f);
  const r = await f.service.purchase(f.user._id, input);
  assert.equal(r.data.status, "SUCCESSFUL");
  assert.equal(r.data.financialAccounting.providerCost, null);
  assert.equal(r.data.financialAccounting.servicePayGrossProfit, null);
  assert.equal(r.data.financialAccounting.status, "AWAITING_PROVIDER_COST");
  if (type === "01") { assert.equal(r.data.meterToken.replaceAll(" ", "").length, 20); assert.equal(r.data.units, "12.34"); }
  await f.service.purchase(f.user._id, input);
  assert.equal((await User.findById(f.user._id)).walletBalance, 4000);
  assert.equal(await Tx.countDocuments({ customerId: f.user._id }), 1);
  assert.equal(await Ledger.countDocuments({ transactionId: r.data.transactionId, direction: "DEBIT" }), 1);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 1);
});
test("parallel duplicate submissions have one transaction, debit and send", async () => {
  const f = await fixture(), input = await confirmed(f);
  await Promise.all([f.service.purchase(f.user._id, input), f.service.purchase(f.user._id, input)]);
  assert.equal((await User.findById(f.user._id)).walletBalance, 4000);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 1);
  assert.equal(await Tx.countDocuments({ customerId: f.user._id }), 1);
});
test("documented initial rejection refunds exactly once", async () => {
  const f = await fixture("failed"), input = await confirmed(f);
  const r = await f.service.purchase(f.user._id, input);
  assert.equal(r.data.status, "FAILED");
  assert.equal(r.data.dispatchStatus, "REFUNDED");
  await f.service.purchase(f.user._id, input);
  await f.service.requery(f.user._id, r.data.transactionId);
  assert.equal((await User.findById(f.user._id)).walletBalance, 5000);
  assert.equal(await Ledger.countDocuments({ transactionId: r.data.transactionId, direction: "CREDIT" }), 1);
});
for (const mode of ["timeout", "lookup-failed", "missing-token"]) test(`${mode} preserves unknown custody without resend/refund`, async () => {
  const f = await fixture(mode), input = await confirmed(f);
  const r = await f.service.purchase(f.user._id, input);
  await f.service.purchase(f.user._id, input);
  await f.service.requery(f.user._id, r.data.transactionId);
  assert.equal((await User.findById(f.user._id)).walletBalance, 4000);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 1);
  assert.equal(await Ledger.countDocuments({ transactionId: r.data.transactionId, direction: "CREDIT" }), 0);
});
test("changed details, forged proof and disabled provider cannot debit", async () => {
  const f = await fixture(), input = await confirmed(f);
  await assert.rejects(f.service.purchase(f.user._id, { ...input, meterNumber: "62130987654" }));
  await assert.rejects(f.service.purchase(f.user._id, { ...input, validationToken: "forged" }));
  await assert.rejects(f.service.purchase(f.user._id, { ...input, customerConfirmed: false }));
  f.config.providerStates[0].enabled = false;
  await assert.rejects(f.service.purchase(f.user._id, input));
  assert.equal((await User.findById(f.user._id)).walletBalance, 5000);
});
test("Admin markup changes the canonical debit, not provider face value or invented profit", async () => {
  const f = await fixture(), input = await confirmed(f);
  f.config.electricityMarkupBps = 250;
  const quote = await f.service.quote(1000);
  assert.equal(quote.customerSellingPrice, 1025);
  await assert.rejects(f.service.purchase(f.user._id, input), { code: "ELECTRICITY_PRICE_CHANGED" });
  const r = await f.service.purchase(f.user._id, { ...input, customerSellingPrice: 1025 });
  assert.equal(r.data.amount, 1025);
  assert.equal(r.data.financialAccounting.serviceFee, 25);
  assert.equal(r.data.financialAccounting.netServicePayRevenue, null);
  assert.equal((await User.findById(f.user._id)).walletBalance, 3975);
  assert.equal(f.calls.find(c => c.url.endsWith("/bill")).data.amount, 1000);
});
test("clearing client storage cannot debit an unresolved Electricity request under a fresh key", async () => {
  const f = await fixture("timeout"), input = await confirmed(f);
  await f.service.purchase(f.user._id, input);
  await assert.rejects(f.service.purchase(f.user._id, { ...input, idempotencyKey: input.idempotencyKey + "-fresh" }),
    { code: "ELECTRICITY_PENDING_RECOVERY" });
  assert.equal((await User.findById(f.user._id)).walletBalance, 4000);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 1);
});
test("timeout then provider success recovers combined token exactly once across concurrent queries", async () => {
  const f = await fixture("timeout"), input = await confirmed(f);
  const pending = await f.service.purchase(f.user._id, input);
  assert.equal(pending.data.status, "PENDING");
  f.setMode("combined");
  const results = await Promise.all(Array.from({ length: 3 }, () =>
    f.service.requery(f.user._id, pending.data.transactionId)));
  for (const result of results) {
    assert.equal(result.data.status, "SUCCESSFUL");
    assert.equal(result.data.meterToken, "1234-5678-9012-3456-7890");
    assert.equal(result.data.units, "12.34");
    assert.equal(result.data.financialAccounting.providerCost, null);
  }
  assert.equal((await User.findById(f.user._id)).walletBalance, 4000);
  assert.equal(await Tx.countDocuments({ customerId: f.user._id }), 1);
  assert.equal(await Ledger.countDocuments({ transactionId: pending.data.transactionId, direction: "DEBIT" }), 1);
  assert.equal(await Ledger.countDocuments({ transactionId: pending.data.transactionId, direction: "CREDIT" }), 0);
  assert.equal(f.calls.filter(c => c.url.endsWith("/bill")).length, 1);
});