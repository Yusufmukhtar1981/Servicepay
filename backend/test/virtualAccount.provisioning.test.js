const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const provider = require("../services/securewave.service");
let dispatch, calls, mongo, customer;
provider.generateVirtualAccount = async (body) => { calls++; return dispatch(body); };
provider.getBanks = async () => { throw blocked(); };
provider.validateAccountName = async () => { throw blocked(); };
const controller = require("../controllers/securewave.controller");
const GENERIC = "Virtual account service is temporarily unavailable. Please try again later.";
const bank = { provider: "SECUREWAVENG", accountNumber: "0123456789",
  accountName: "Sandbox Customer", bankName: "Sandbox Bank", bankCode: "001", status: "ACTIVE" };
function blocked() {
  const error = new Error("This IP address 74.220.48.164 is not whitelisted.");
  error.statusCode = 404;
  error.providerResponse = { message: error.message, credential: "fake-sensitive-do-not-expose" };
  return error;
}
function success() {
  return { success: true, message: "provider-private-message", data: {
    account_number: bank.accountNumber, account_name: bank.accountName,
    bank_name: bank.bankName, bank_code: bank.bankCode,
  } };
}
async function invoke(method = "generateVirtualAccount", id = customer._id, body = {}) {
  const response = { code: null, body: null,
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } };
  await controller[method]({ user: id ? { _id: id } : {}, body }, response);
  return response;
}
async function saveAccount(account) {
  await User.updateOne({ _id: customer._id }, { $set: { virtualAccount: account } });
}
async function stored() { return User.findById(customer._id).select("+virtualAccount.creationAttemptId"); }
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k])) {
    throw new Error("Never use ambient database credentials for this test.");
  }
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [
    { args: ["--nounixsocket"] },
  ] });
  await mongoose.connect(mongo.getUri());
  await User.init();
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await User.deleteMany({});
  calls = 0; dispatch = async () => success();
  customer = await User.create({ fullName: "Sandbox Customer", email: "va-test@example.invalid",
    phone: "08060009999", password: "OnlySandbox123!", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 12345.67 });
});
test.afterEach(async () => {
  assert.equal((await stored()).walletBalance, 12345.67, "Virtual-account flow must not change funds.");
});
test("existing account retrieval exposes only owned bank details, not failure diagnostics", async () => {
  await saveAccount({ ...bank, failureReason: blocked().message });
  const response = await invoke("getMyVirtualAccount");
  assert.equal(response.code, 200);
  assert.equal(response.body.data.virtualAccount.accountNumber, bank.accountNumber);
  assert.equal(response.body.data.virtualAccount.bankName, bank.bankName);
  assert.equal(response.body.data.virtualAccount.failureReason, GENERIC);
  assert.ok(!JSON.stringify(response.body).includes("74.220"));
  assert.equal(calls, 0);
});
test("existing ACTIVE account POST never reaches provider or rewrites it", async () => {
  await saveAccount(bank);
  const before = (await stored()).virtualAccount.toObject();
  const response = await invoke();
  assert.equal(response.code, 200); assert.equal(calls, 0);
  assert.deepEqual((await stored()).virtualAccount.toObject(), before);
});
test("existing DISABLED/FAILED bank numbers are preserved and never reprovisioned", async () => {
  for (const status of ["DISABLED", "FAILED"]) {
    await saveAccount({ ...bank, status });
    const response = await invoke(); assert.equal(response.code, 200);
    assert.equal((await stored()).virtualAccount.accountNumber, bank.accountNumber);
  }
  assert.equal(calls, 0);
});
test("valid provider confirmation persists and returns canonical complete bank details", async () => {
  const response = await invoke();
  assert.equal(response.code, 201); assert.equal(calls, 1);
  assert.equal(response.body.data.accountNumber, bank.accountNumber);
  assert.equal(response.body.data.accountName, bank.accountName);
  assert.equal(response.body.data.bankName, bank.bankName);
  assert.equal(response.body.providerData, undefined);
  assert.ok(!JSON.stringify(response.body).includes("provider-private"));
  assert.equal((await stored()).virtualAccount.status, "ACTIVE");
  assert.equal(response.body.data.creationAttemptId, undefined);
});
test("twenty simultaneous POSTs make exactly one external creation request", async () => {
  dispatch = async () => { await new Promise(r => setTimeout(r, 80)); return success(); };
  const replies = await Promise.all(Array.from({ length: 20 }, () => invoke()));
  assert.equal(calls, 1);
  assert.equal(replies.filter(r => r.code === 201).length, 1);
  assert.ok(replies.every(r => [200, 201, 409].includes(r.code)));
  assert.equal((await stored()).virtualAccount.status, "ACTIVE");
});
test("provider whitelist refusal returns generic message, retains safe retry evidence", async () => {
  dispatch = async () => { throw blocked(); };
  const response = await invoke(); assert.equal(response.code, 503);
  assert.deepEqual(response.body, { success: false, message: GENERIC });
  assert.equal((await stored()).virtualAccount.status, "FAILED");
  assert.equal((await stored()).virtualAccount.failureReason, "PROVIDER_ACCESS_REJECTED");
  dispatch = async () => success();
  assert.equal((await invoke()).code, 201);
  assert.equal(calls, 2);
});
test("legacy whitelist failures can retry once but legacy unknown failures cannot", async () => {
  await saveAccount({ status: "FAILED", failureReason: "SecureWaveNG request timed out." });
  assert.equal((await invoke()).code, 409); assert.equal(calls, 0);
  await saveAccount({ status: "FAILED", failureReason: blocked().message });
  assert.equal((await invoke()).code, 201); assert.equal(calls, 1);
});
test("timeout preserves durable PENDING claim and prevents repeated dispatch", async () => {
  dispatch = async () => { const e = new Error("SecureWaveNG request timed out."); e.statusCode = 504; throw e; };
  assert.equal((await invoke()).code, 503);
  assert.equal((await stored()).virtualAccount.status, "PENDING");
  assert.equal((await invoke()).code, 409); assert.equal(calls, 1);
});
test("a provider 500 is uncertain, not permission to create again", async () => {
  dispatch = async () => { const e = new Error("internal SQL trace password fake"); e.statusCode = 500; e.providerResponse = {}; throw e; };
  assert.equal((await invoke()).body.message, GENERIC);
  assert.equal((await invoke()).code, 409); assert.equal(calls, 1);
});
test("incomplete, malformed and logical-failure confirmations do not create ACTIVE records", async () => {
  for (const response of [{ data: { account_number: "123" } },
    { data: { account_number: bank.accountNumber } }, { ...success(), success: false }]) {
    await saveAccount({ status: "NOT_CREATED" }); dispatch = async () => response;
    assert.equal((await invoke()).code, 503);
    assert.equal((await stored()).virtualAccount.status, "PENDING");
    assert.equal((await invoke()).code, 409);
  }
  assert.equal(calls, 3);
});
test("missing configuration is safely retryable without an external outcome", async () => {
  dispatch = async () => { const e = new Error("SecureWaveNG live API keys are not configured."); e.statusCode = 503; throw e; };
  assert.equal((await invoke()).code, 503);
  assert.equal((await stored()).virtualAccount.failureReason, "CONFIGURATION_UNAVAILABLE");
});
test("missing authentication, inactive customers and staff do not reach provider", async () => {
  assert.equal((await invoke("generateVirtualAccount", null)).code, 401);
  await User.updateOne({ _id: customer._id }, { $set: { status: "SUSPENDED" } });
  assert.equal((await invoke()).code, 403);
  await User.updateOne({ _id: customer._id }, { $set: { status: "ACTIVE", role: "HEAD_OFFICE" } });
  assert.equal((await invoke()).code, 403); assert.equal(calls, 0);
});
test("invalid profile data cannot claim or call provider", async () => {
  await User.updateOne({ _id: customer._id }, { $set: { email: "invalid" } });
  assert.equal((await invoke()).code, 400); assert.equal(calls, 0);
  assert.notEqual((await stored()).virtualAccount.status, "PENDING");
});
test("provider success cannot overwrite a separately recovered existing bank account", async () => {
  const recovered = { ...bank, accountNumber: "9999999999" };
  dispatch = async () => { await saveAccount(recovered); return success(); };
  const response = await invoke();
  assert.equal(response.code, 200);
  assert.equal(response.body.data.accountNumber, recovered.accountNumber);
  assert.equal((await stored()).virtualAccount.accountNumber, recovered.accountNumber);
});
test("failure handler cannot downgrade a concurrently recovered account", async () => {
  dispatch = async () => { await saveAccount(bank); throw blocked(); };
  assert.equal((await invoke()).code, 503);
  assert.equal((await stored()).virtualAccount.status, "ACTIVE");
});
test("provider confirmation followed by a database failure stays non-retryable", async () => {
  const original = User.findOneAndUpdate;
  let writes = 0;
  User.findOneAndUpdate = function (...args) {
    writes++;
    if (writes === 2) throw new Error("Simulated persistence failure.");
    return original.apply(this, args);
  };
  try {
    assert.equal((await invoke()).code, 503);
  } finally { User.findOneAndUpdate = original; }
  assert.equal((await stored()).virtualAccount.status, "PENDING");
  assert.equal((await invoke()).code, 409); assert.equal(calls, 1);
});
test("banks and name-validation failures never expose provider response or credentials", async () => {
  for (const [method, body] of [["getBanks", {}], ["validateAccountName", { bankCode: "001", accountNumber: bank.accountNumber }]]) {
    const response = await invoke(method, customer._id, body);
    assert.equal(response.code, 503);
    assert.ok(!JSON.stringify(response.body).includes("74.220"));
    assert.ok(!JSON.stringify(response.body).includes("fake-sensitive"));
    assert.equal(response.body.providerResponse, undefined);
  }
});
