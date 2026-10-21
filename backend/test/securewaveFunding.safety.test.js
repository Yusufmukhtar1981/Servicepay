const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Event = require("../models/securewaveWebhook.model");
const { handleVirtualAccountWebhook } = require("../controllers/securewaveWebhook.controller");

let mongo, customer;
const secret = "local-mock-webhook-signature-only";
const payload = (extra = {}) => ({
  transaction_id: "sandbox-funding-event",
  account_number: "0123456789",
  amount: 500,
  transaction_status: "successful",
  currency: "NGN",
  ...extra,
});
async function invoke(body, { valid = true, signedBody = body } = {}) {
  const rawBody = Buffer.from(JSON.stringify(signedBody));
  const res = {
    code: null, body: null,
    status(code) { this.code = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const signature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  await handleVirtualAccountWebhook({
    body, rawBody,
    headers: { "x-signature": valid ? signature : "invalid-fixture-signature" },
  }, res);
  return res;
}
test.before(async () => {
  assert.ok(!["MONGODB_URI", "MONGO_URI", "DATABASE_URL", "MONGO_URL"]
    .some((key) => process.env[key]), "Never inherit production database credentials");
  process.env.SECUREWAVE_WEBHOOK_SECRET = secret;
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  await mongoose.connect(mongo.getUri());
  await Promise.all([User.init(), Transaction.init(), Event.init()]);
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Transaction.deleteMany({}), Event.deleteMany({})]);
  customer = await User.create({
    fullName: "Sandbox Funding Customer", email: "funding@example.invalid",
    phone: "08060009998", password: "SandboxOnly123!", role: "CUSTOMER",
    status: "ACTIVE", walletBalance: 1000,
    virtualAccount: { provider: "SECUREWAVENG", status: "ACTIVE",
      accountNumber: "0123456789", bankName: "Sandbox Bank", accountName: "Sandbox" },
  });
});
test("authenticated successful funding credits once; duplicate replay creates no extra credit", async () => {
  const first = await invoke(payload());
  assert.equal(first.code, 200);
  assert.equal((await User.findById(customer._id)).walletBalance, 1500);
  const replay = await invoke(payload());
  assert.equal(replay.code, 200);
  assert.equal((await User.findById(customer._id)).walletBalance, 1500);
  assert.equal(await Transaction.countDocuments({ reference: "sandbox-funding-event" }), 1);
  assert.equal(await Event.countDocuments({ status: "PROCESSED" }), 1);
});
test("invalid signature never persists an event or changes funds", async () => {
  assert.equal((await invoke(payload(), { valid: false })).code, 401);
  assert.equal((await User.findById(customer._id)).walletBalance, 1000);
  assert.equal(await Event.countDocuments({}), 0);
  assert.equal(await Transaction.countDocuments({}), 0);
});
test("pending and failed signed notifications do not credit funds", async () => {
  for (const status of ["pending", "failed"]) {
    await invoke(payload({ transaction_id: `sandbox-${status}`, transaction_status: status }));
  }
  assert.equal((await User.findById(customer._id)).walletBalance, 1000);
  assert.equal(await Transaction.countDocuments({}), 0);
});
test("signed funding for an unknown account never credits another customer", async () => {
  assert.equal((await invoke(payload({ account_number: "9876543210" }))).code, 404);
  assert.equal((await User.findById(customer._id)).walletBalance, 1000);
  assert.equal(await Transaction.countDocuments({}), 0);
});
test("non-NGN signed funding does not change a naira wallet", async () => {
  await invoke(payload({ currency: "USD" }));
  assert.equal((await User.findById(customer._id)).walletBalance, 1000);
  assert.equal(await Transaction.countDocuments({}), 0);
});
