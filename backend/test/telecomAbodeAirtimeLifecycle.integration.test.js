const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const { createTelecomAbodeBillsProvider } = require("../services/telecomAbodeBillsProvider.service");
const { createTelecomAbodeAirtimeLifecycle, priceFor } = require("../services/telecomAbodeAirtimeLifecycle.service");
let repl, sequence = 0;
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k]))
    throw Error("Integration tests must not inherit database credentials.");
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(repl.getUri(), { dbName: "telecom-abode-airtime-integration" });
  await Promise.all([User, Transaction, LedgerEntry, Commission, ProductCommission].map(m => m.init()));
});
test.after(async () => { await mongoose.disconnect(); await repl?.stop(); });
const fixture = async ({ mode = "success", markupBps = 0 } = {}) => {
  const n = ++sequence;
  const customer = await User.create({ fullName: "Mock buyer", phone: `080${String(n).padStart(8,"0")}`,
    email: `ta-air-${n}@test.invalid`, password: "test-only-password", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 1000, commissionBalance: 0 });
  const calls = [];
  const config = { primaryProvider: "TELECOM_ABODE", airtimeMarkupBps: markupBps,
    providerStates: [{ provider: "TELECOM_ABODE", enabled: true }] };
  const bills = createTelecomAbodeBillsProvider({ credentials: () => "fake-no-network-key",
    transport: async options => {
      calls.push(options);
      if (options.url.includes("get-networks")) return { status: 200, data: [
        { id: 7, network: "MTN" }, { id: 9, network: "Airtel" },
        { id: 11, network: "Glo" }, { id: 12, network: "9mobile" }] };
      if (mode === "timeout") throw Error("Mock timeout");
      const key = options.data?.["request-id"] || decodeURIComponent(options.url.split("/").pop());
      if (mode === "validation-rejected") return { status: 422, data: {
        status: "fail", Status: "failed", message: "Insufficient wallet balance" } };
      return { status: 200, data: mode === "failure" ? { status: "fail", Status: "failed", "request-id": key }
        : { status: "success", Status: "successful", "request-id": mode === "wrong-ref" ? "unrelated-order" : key,
          service: "airtime", amount: 50 } };
    } });
  const lifecycle = createTelecomAbodeAirtimeLifecycle({ bills, readConfig: async () => config });
  const input = { customerId: customer._id, network: 7, phone: "08012345678", amount: 50,
    customerSellingPrice: priceFor(50, markupBps), idempotencyKey: `ta-mock-request-${n}` };
  return { customer, lifecycle, calls, input, config };
};
test("international phone formats validate at quote boundary without a wallet debit or purchase dispatch", async () => {
  const f = await fixture();
  for (const phone of ["08012345678", "2348012345678", "+2348012345678"]) {
    const quote = await f.lifecycle.quote({ network: 7, amount: 50, phone });
    assert.equal(quote.normalizedPhone, "08012345678");
    assert.equal(quote.phoneValidation, "SYNTAX_ONLY");
  }
  await assert.rejects(f.lifecycle.quote({ network: 7, amount: 50, phone: "abc08012345678" }));
  await assert.rejects(f.lifecycle.executePurchase({ ...f.input, phone: "abc08012345678" }));
  assert.equal((await User.findById(f.customer._id)).walletBalance, 1000);
  assert.equal(await Transaction.countDocuments({ customerId: f.customer._id }), 0);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});
test("real wallet lifecycle settles delivery once with unknown cost and no invented commission", async () => {
  const f = await fixture({ markupBps: 500 });
  const first = await f.lifecycle.executePurchase(f.input);
  assert.equal(first.transaction.status, "SUCCESSFUL");
  assert.equal(first.transaction.amount, 52.5);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 947.5);
  assert.equal(first.transaction.providerResponse.financialAccounting.providerCost, null);
  assert.equal(first.transaction.providerResponse.financialAccounting.servicePayGrossProfit, null);
  assert.equal(first.transaction.providerResponse.financialAccounting.status, "AWAITING_PROVIDER_COST");
  assert.equal(await LedgerEntry.countDocuments({ transactionId: first.transaction._id, direction: "DEBIT" }), 1);
  assert.equal(await Commission.countDocuments({ reference: first.transaction.reference }), 0);
  await f.lifecycle.executePurchase(f.input);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 947.5);
  assert.equal(f.calls.find(c => c.method === "POST").data.amount, 50);
});
test("parallel duplicate requests have one debit and one provider send", async () => {
  const f = await fixture();
  await Promise.all([f.lifecycle.executePurchase(f.input), f.lifecycle.executePurchase(f.input)]);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 950);
});
for (const mode of ["timeout", "wrong-ref", "failure"]) test(`${mode} stays pending, no resend/refund/commission`, async () => {
  const f = await fixture({ mode });
  const result = await f.lifecycle.executePurchase(f.input);
  assert.equal(result.transaction.status, "PENDING");
  await f.lifecycle.executePurchase(f.input);
  await f.lifecycle.reconcilePendingPurchase({ transactionId: result.transaction._id });
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 950);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: result.transaction._id, direction: "CREDIT" }), 0);
});
test("paused admission and changed quote cannot debit", async () => {
  const f = await fixture();
  f.config.providerStates[0].enabled = false;
  await assert.rejects(f.lifecycle.executePurchase(f.input), { code: "AIRTIME_PROVIDER_UNAVAILABLE" });
  f.config.providerStates[0].enabled = true;
  f.config.airtimeMarkupBps = 100;
  await assert.rejects(f.lifecycle.executePurchase(f.input), { code: "AIRTIME_QUOTE_CHANGED" });
  assert.equal((await User.findById(f.customer._id)).walletBalance, 1000);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 0);
});
test("changed intent under same request key cannot spend again", async () => {
  const f = await fixture();
  await f.lifecycle.executePurchase(f.input);
  await assert.rejects(f.lifecycle.executePurchase({ ...f.input, amount: 100 }), { code: "AIRTIME_IDEMPOTENCY_CONFLICT" });
});
test("markup cannot be negative or create zero-priced airtime", () => {
  assert.throws(() => priceFor(50, -1));
  assert.throws(() => priceFor(0, 0));
  assert.equal(priceFor("93.07", 0), 93.07);
});

test("documented initial validation rejection refunds once without commission", async () => {
  const f = await fixture({ mode: "validation-rejected" });
  const first = await f.lifecycle.executePurchase(f.input);
  assert.equal(first.transaction.status, "FAILED");
  assert.equal(first.transaction.dispatchStatus, "REFUNDED");
  await f.lifecycle.executePurchase(f.input);
  await assert.rejects(f.lifecycle.reconcilePendingPurchase({ transactionId: first.transaction._id }),
    { code: "AIRTIME_TRANSACTION_NOT_PENDING" });
  assert.equal(f.calls.filter(c => c.method === "POST").length, 1);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 1000);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: first.transaction._id, direction: "DEBIT" }), 1);
  assert.equal(await LedgerEntry.countDocuments({ transactionId: first.transaction._id, direction: "CREDIT" }), 1);
  assert.equal(await Commission.countDocuments({ transactionId: first.transaction._id }), 0);
});

test("an old UNKNOWN request never blocks a distinct new request or gets resent", async () => {
  const f = await fixture({ mode: "timeout" });
  const first = await f.lifecycle.executePurchase(f.input);
  const second = await f.lifecycle.executePurchase({ ...f.input, idempotencyKey: f.input.idempotencyKey + "-separate" });
  assert.notEqual(String(first.transaction._id), String(second.transaction._id));
  assert.notEqual(first.transaction.providerRequestId, second.transaction.providerRequestId);
  await f.lifecycle.executePurchase(f.input);
  assert.equal(f.calls.filter(c => c.method === "POST").length, 2);
  assert.equal((await User.findById(f.customer._id)).walletBalance, 900);
  assert.equal((await Transaction.findById(first.transaction._id)).status, "PENDING");
});