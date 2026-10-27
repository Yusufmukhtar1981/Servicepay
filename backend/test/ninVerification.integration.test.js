const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const Verification = require("../models/idVerification.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const { createNinHandler } = require("../services/ninVerification.service");
const { extractNinData, getNinVerificationHistory, getSingleNinVerification } =
  require("../controllers/idVerification.controller");
const nin = "12345678901";
let replica;
before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replica.getUri();
  assert.match(uri, /^mongodb:\/\/127\.0\.0\.1:/);
  await mongoose.connect(uri, { dbName: "nin_disposable" });
  await Promise.all([Verification.init(), Transaction.init(), Ledger.init()]);
});
after(async () => { await mongoose.disconnect(); if (replica) await replica.stop(); });
const response = () => ({ status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; } });
async function fixture(post) {
  const id = new mongoose.Types.ObjectId();
  await User.collection.insertOne({ _id: id, fullName: "Test Customer",
    phone: `fixture-${id}`, role: "CUSTOMER", status: "ACTIVE", walletBalance: 1000 });
  const handler = createNinHandler({ extract: extractNinData,
    getConfig: () => ({ baseUrl: "https://api.prembly.com", key: "mock-only" }), post });
  return { id, async run(body = {}) {
    const res = response();
    await handler({ user: { id }, body: { ninNumber: nin, slipType: "REGULAR",
      consentAccepted: true, ...body } }, res);
    return res;
  }};
}
const success = () => ({ status: 200, data: { status: true, response_code: "00",
  data: { nin, firstname: "Test", middlename: "Middle", surname: "Customer", photo: "mock-photo" } } });
const balance = async id => (await User.findById(id).lean()).walletBalance;

test("concurrent duplicate submissions dispatch once and debit/record/ledger once", async () => {
  let calls = 0;
  const f = await fixture(async (url, body, config) => {
    calls++;
    assert.equal(url, "https://api.prembly.com/verification/vnin-basic");
    assert.deepEqual(body, { number: nin });
    assert.equal(config.maxRedirects, 0);
    await new Promise(resolve => setTimeout(resolve, 50));
    return success();
  });
  await Promise.all(Array.from({ length: 6 }, () => f.run()));
  const retry = await f.run();
  assert.equal(calls, 1);
  assert.equal(retry.code, 200);
  assert.equal(retry.body.data.slipType, "PREMIUM");
  assert.equal(retry.body.data.verificationData.photo, "mock-photo");
  assert.equal(retry.body.data.amountCharged, 250);
  assert.equal(await balance(f.id), 750);
  assert.equal(await Verification.countDocuments({ userId: f.id }), 1);
  assert.equal(await Transaction.countDocuments({ customerId: f.id }), 1);
  assert.equal(await Ledger.countDocuments({ user: f.id }), 1);
});
test("timeout stays pending, uncharged, and cannot redispatch", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; throw Error("mock-private-detail"); });
  const result = await f.run();
  assert.equal(result.code, 202);
  assert.equal(result.body.retrySafe, false);
  assert.equal((await f.run()).code, 202);
  assert.equal(calls, 1);
  assert.equal(await balance(f.id), 1000);
  assert.equal(await Transaction.countDocuments({ customerId: f.id }), 0);
});
test("an explicit failed result is saved without charging", async () => {
  const f = await fixture(async () => ({ status: 200,
    data: { status: false, response_code: "01", message: "mock-sensitive" } }));
  const result = await f.run();
  assert.equal(result.code, 400);
  const record = await Verification.findOne({ userId: f.id });
  assert.equal(record.status, "FAILED");
  assert.equal(record.amountCharged, 0);
  assert.equal(await balance(f.id), 1000);
  assert.ok(!JSON.stringify(result.body).includes("mock-sensitive"));
  assert.ok(!JSON.stringify(record.rawResponse).includes("mock-sensitive"));
});
test("pending and contradictory identity responses never masquerade as success", async () => {
  for (const output of [
    { status: 202, data: { status: true, response_code: "00", data: success().data.data } },
    { status: 200, data: { ...success().data, status: false } },
    { status: 200, data: { ...success().data,
      data: { ...success().data.data, nin: "99999999999" } } },
  ]) {
    let calls = 0;
    const f = await fixture(async () => { calls++; return output; });
    assert.equal((await f.run()).code, 202);
    assert.equal((await f.run()).code, 202);
    assert.equal(calls, 1);
    assert.equal(await balance(f.id), 1000);
  }
});
test("provider-confirmed suspended NIN is failed and never charged", async () => {
  const f = await fixture(async () => ({ status: 200, data: { ...success().data,
    data: { ...success().data.data, nin_suspension_status: true } } }));
  assert.equal((await f.run()).code, 400);
  assert.equal(await balance(f.id), 1000);
});
test("uniqueness-index failure prevents admission and provider dispatch", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return success(); });
  const original = Verification.collection.createIndex;
  try {
    Verification.collection.createIndex = async () => { throw Error("index unavailable"); };
    assert.equal((await f.run()).code, 503);
  } finally { Verification.collection.createIndex = original; }
  assert.equal(calls, 0);
  assert.equal(await Verification.countDocuments({ userId: f.id }), 0);
  assert.equal(await balance(f.id), 1000);
});
test("ledger failure rolls back every financial write; retry settles saved result only", async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return success(); });
  const original = Ledger.create;
  try {
    Ledger.create = async () => { throw Error("injected ledger outage"); };
    assert.equal((await f.run()).code, 503);
  } finally { Ledger.create = original; }
  assert.equal(await balance(f.id), 1000);
  assert.equal(await Transaction.countDocuments({ customerId: f.id }), 0);
  const retries = await Promise.all(Array.from({ length: 6 }, () => f.run()));
  assert.ok(retries.every(result => result.code === 200));
  assert.equal(calls, 1);
  assert.equal(await balance(f.id), 750);
  assert.equal(await Ledger.countDocuments({ user: f.id }), 1);
});
test("different NIN requests cannot overspend or overwrite concurrent wallet debits", async () => {
  let calls = 0;
  const f = await fixture(async (_, body) => {
    calls++;
    return { ...success(), data: { ...success().data,
      data: { ...success().data.data, nin: body.number } } };
  });
  await User.updateOne({ _id: f.id }, { $set: { walletBalance: 500 } });
  await Promise.all(["12345678901", "12345678902", "12345678903"]
    .map(ninNumber => f.run({ ninNumber })));
  assert.equal(calls, 3);
  assert.equal(await balance(f.id), 0);
  assert.equal(await Transaction.countDocuments({ customerId: f.id }), 2);
  assert.equal(await Ledger.countDocuments({ user: f.id }), 2);
  assert.equal(await Verification.countDocuments({ userId: f.id, status: "SUCCESSFUL" }), 2);
  assert.equal(await Verification.countDocuments({ userId: f.id, status: "PENDING",
    providerOutcome: "SUCCESSFUL" }), 1);
});
test("concurrent external spending cannot make the wallet negative or reverify", async () => {
  let calls = 0;
  const f = await fixture(async () => {
    calls++;
    await User.updateOne({ _id: f.id }, { $set: { walletBalance: 100 } });
    return success();
  });
  const pending = await f.run();
  assert.equal(pending.code, 202);
  assert.equal(pending.body.awaitingPayment, true);
  assert.equal(pending.body.retrySafe, true);
  assert.match(pending.body.message, /provider check will not be repeated/);
  assert.equal(await balance(f.id), 100);
  await User.updateOne({ _id: f.id }, { $set: { walletBalance: 500 } });
  assert.equal((await f.run()).code, 200);
  assert.equal(calls, 1);
  assert.equal(await balance(f.id), 250);
});
test("legacy successful slips are reused and unresolved legacy attempts are protected", async () => {
  const f = await fixture(async () => { throw Error("must not dispatch"); });
  await Verification.collection.insertOne({ userId: f.id, idType: "NIN", status: "SUCCESS",
    reference: `legacy-${f.id}`, amountCharged: 250, verificationData: { nin, fullName: "Legacy Customer" } });
  assert.equal((await f.run()).code, 200);
  assert.equal(await balance(f.id), 1000);
  const pending = await fixture(async () => { throw Error("must not dispatch"); });
  await Verification.create({ userId: pending.id, idType: "NIN", status: "PENDING",
    reference: `legacy-${pending.id}`, ninNumberMasked: "*******8901" });
  assert.equal((await pending.run()).code, 202);
  assert.equal(await balance(pending.id), 1000);
});
test("history is owner-scoped, preserves legacy records and excludes provider payloads", async () => {
  const f = await fixture(async () => success());
  await f.run();
  const record = await Verification.findOne({ userId: f.id }).lean();
  const history = response();
  await getNinVerificationHistory({ user: { id: f.id } }, history);
  assert.equal(history.body.data.length, 1);
  assert.equal(history.body.data[0].verificationData.nin, nin); // Owned slip remains accessible.
  assert.ok(!("rawResponse" in history.body.data[0]));
  assert.ok(!("activeNinKey" in history.body.data[0]));
  const other = response();
  await getSingleNinVerification({ user: { id: new mongoose.Types.ObjectId() },
    params: { id: record._id } }, other);
  assert.equal(other.code, 404);
});
