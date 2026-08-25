const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Partner = require("../models/partner.model");
const PartnerTransaction = require("../models/partnerTransaction.model");
const PartnerAuditLog = require("../models/partnerAuditLog.model");
const partnerController = require("../controllers/partner.controller");
const partnerApiController = require("../controllers/partnerApi.controller");
const partnerTransactionsController = require("../controllers/partnerTransactions.controller");
const axios = require("axios");
const {
  partnerAuth,
  requirePartnerPermission,
} = require("../middleware/partnerAuth.middleware");

let mongo;
let sequence = 0;
const models = [Partner, PartnerTransaction, PartnerAuditLog];

const hash = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const call = async (handler, {
  user = null,
  body = {},
  params = {},
  headers = {},
  partner = null,
} = {}) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.status ??= 200;
      result.body = payload;
      return this;
    },
  };
  await handler({ user, body, params, headers, partner }, res);
  return result;
};

const runMiddleware = async (middleware, req) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  let advanced = false;
  await middleware(req, res, () => {
    advanced = true;
  });
  return { advanced, ...result };
};

const createPartner = async ({
  status = "ACTIVE",
  permissions = ["AIRTIME"],
  secret = "sp_secret_test_value",
  owner,
} = {}) => {
  sequence += 1;
  return Partner.create({
    businessName: `Partner ${sequence}`,
    contactName: "Security Test",
    email: `partner-${sequence}@example.test`,
    phone: `080900${String(sequence).padStart(5, "0")}`,
    apiKey: `sp_live_test_${sequence}`,
    apiSecretHash: hash(secret),
    status,
    permissions,
    walletBalance: 5000,
    dailyLimit: 10000,
    perTransactionLimit: 2000,
    createdBy: owner || new mongoose.Types.ObjectId(),
  });
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})));
});

test("partner authentication accepts valid credentials and blocks suspended access without status leakage", async () => {
  const partner = await createPartner();
  const validRequest = {
    headers: {
      "x-api-key": partner.apiKey,
      "x-api-secret": "sp_secret_test_value",
    },
  };
  const valid = await runMiddleware(partnerAuth, validRequest);
  assert.equal(valid.advanced, true);
  assert.equal(validRequest.partner._id.toString(), partner._id.toString());

  partner.status = "SUSPENDED";
  await partner.save();
  const blocked = await runMiddleware(partnerAuth, validRequest);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.message, "Partner API access is not active.");
});

test("permissions are server-side enforced and unsupported services are not granted", async () => {
  const partner = await createPartner({ permissions: ["AIRTIME"] });
  const airtime = await runMiddleware(
    requirePartnerPermission("AIRTIME"),
    { partner }
  );
  const data = await runMiddleware(
    requirePartnerPermission("DATA"),
    { partner }
  );
  assert.equal(airtime.advanced, true);
  assert.equal(data.status, 403);

  const changed = await call(partnerController.updatePartnerPermissions, {
    user: { _id: new mongoose.Types.ObjectId() },
    params: { id: partner._id.toString() },
    body: { permissions: ["AIRTIME", "DATA", "CABLE"] },
  });
  assert.equal(changed.status, 400);

  const legacy = await createPartner({ permissions: ["*"] });
  const legacyProfile = await call(partnerController.getCustomerPartnerProfile, {
    user: { _id: legacy.createdBy },
  });
  assert.deepEqual(legacyProfile.body.partner.permissions, ["AIRTIME", "DATA"]);
  const legacyData = await runMiddleware(
    requirePartnerPermission("DATA"),
    { partner: legacy }
  );
  assert.equal(legacyData.advanced, true);
});

test("customer profile excludes secret hash, initial activation is one-time, regeneration invalidates old credentials, and revocation blocks use", async () => {
  const owner = new mongoose.Types.ObjectId();
  const partner = await createPartner({ owner });
  partner.initialCredentialDeliveryPending = true;
  await partner.save();
  const user = { _id: owner };

  const profile = await call(partnerController.getCustomerPartnerProfile, { user });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.partner.apiKey, partner.apiKey);
  assert.equal(Object.hasOwn(profile.body.partner, "apiSecretHash"), false);

  const activated = await call(partnerController.activateCustomerCredentials, {
    user,
  });
  assert.equal(activated.status, 200);
  assert.match(activated.body.credentials.apiSecret, /^sp_secret_/);
  const secondActivation = await call(partnerController.activateCustomerCredentials, {
    user,
  });
  assert.equal(secondActivation.status, 409);

  const regenerated = await call(partnerController.regenerateCustomerCredentials, { user });
  assert.equal(regenerated.status, 200);
  assert.match(regenerated.body.credentials.apiKey, /^sp_live_/);
  assert.match(regenerated.body.credentials.apiSecret, /^sp_secret_/);

  const oldCredentials = await runMiddleware(partnerAuth, {
    headers: {
      "x-api-key": partner.apiKey,
      "x-api-secret": "sp_secret_test_value",
    },
  });
  assert.equal(oldCredentials.status, 401);

  const revoked = await call(partnerController.revokeCustomerAccess, { user });
  assert.equal(revoked.status, 200);
  const latest = await Partner.findById(partner._id);
  assert.equal(latest.status, "REVOKED");
  const revokedCredentials = await runMiddleware(partnerAuth, {
    headers: {
      "x-api-key": regenerated.body.credentials.apiKey,
      "x-api-secret": regenerated.body.credentials.apiSecret,
    },
  });
  assert.equal(revokedCredentials.status, 403);
});

test("customer credential endpoints cannot resolve another partner by matching contact details", async () => {
  const owner = new mongoose.Types.ObjectId();
  const partner = await createPartner({ owner });
  const attacker = {
    _id: new mongoose.Types.ObjectId(),
    email: partner.email,
    phone: partner.phone,
  };
  const profile = await call(partnerController.getCustomerPartnerProfile, {
    user: attacker,
  });
  assert.equal(profile.status, 404);
  const regenerate = await call(partnerController.regenerateCustomerCredentials, {
    user: attacker,
  });
  assert.equal(regenerate.status, 404);
});

test("provider transport uncertainty remains processing and does not refund the partner wallet", async () => {
  const oldUserId = process.env.CLUBKONNECT_USER_ID;
  const oldApiKey = process.env.CLUBKONNECT_API_KEY;
  const originalGet = axios.get;
  process.env.CLUBKONNECT_USER_ID = "test-user";
  process.env.CLUBKONNECT_API_KEY = "test-key";
  axios.get = async () => {
    throw new Error("provider timeout after request accepted");
  };
  try {
    const partner = await createPartner({ permissions: ["AIRTIME"] });
    const result = await call(partnerApiController.buyAirtime, {
      partner,
      headers: { "idempotency-key": "timeout-reconciliation-request" },
      body: { network: "MTN", phone: "08030000000", amount: 100 },
    });
    assert.equal(result.status, 202);
    assert.equal(result.body.status, "PROCESSING");
    const latestPartner = await Partner.findById(partner._id);
    assert.equal(latestPartner.walletBalance, 4900);
    const transaction = await PartnerTransaction.findOne({
      partner: partner._id,
      idempotencyKey: "timeout-reconciliation-request",
    });
    assert.equal(transaction.status, "REQUERY_REQUIRED");
  } finally {
    axios.get = originalGet;
    if (oldUserId === undefined) {
      delete process.env.CLUBKONNECT_USER_ID;
    } else {
      process.env.CLUBKONNECT_USER_ID = oldUserId;
    }
    if (oldApiKey === undefined) {
      delete process.env.CLUBKONNECT_API_KEY;
    } else {
      process.env.CLUBKONNECT_API_KEY = oldApiKey;
    }
  }
});

test("admin limit controls reject unsafe combinations and partner transaction idempotency is unique", async () => {
  const partner = await createPartner();
  const invalid = await call(partnerController.updatePartnerLimits, {
    user: { _id: new mongoose.Types.ObjectId() },
    params: { id: partner._id.toString() },
    body: { dailyLimit: 1000, perTransactionLimit: 1500 },
  });
  assert.equal(invalid.status, 400);

  const updated = await call(partnerController.updatePartnerLimits, {
    user: { _id: new mongoose.Types.ObjectId() },
    params: { id: partner._id.toString() },
    body: { dailyLimit: 6000, perTransactionLimit: 1200 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.partner.perTransactionLimit, 1200);

  const base = {
    partner: partner._id,
    service: "AIRTIME",
    amount: 250,
    status: "PROCESSING",
    idempotencyKey: "only-once-request",
  };
  await PartnerTransaction.create({ ...base, reference: "SPP-TEST-ONE" });
  await assert.rejects(
    PartnerTransaction.create({ ...base, reference: "SPP-TEST-TWO" }),
    /duplicate key/
  );
});

test("provider success and explicit provider failure have final, financially correct outcomes", async () => {
  const oldUserId = process.env.CLUBKONNECT_USER_ID;
  const oldApiKey = process.env.CLUBKONNECT_API_KEY;
  const originalGet = axios.get;
  process.env.CLUBKONNECT_USER_ID = "test-user";
  process.env.CLUBKONNECT_API_KEY = "test-key";
  try {
    const successfulPartner = await createPartner({ permissions: ["AIRTIME"] });
    axios.get = async () => ({
      status: 200,
      data: { status: "SUCCESSFUL", reference: "PROVIDER-SUCCESS-1" },
    });
    const successful = await call(partnerApiController.buyAirtime, {
      partner: successfulPartner,
      headers: { "idempotency-key": "provider-success-request" },
      body: { network: "MTN", phone: "08030000000", amount: 100 },
    });
    assert.equal(successful.status, 201);
    assert.equal(successful.body.data.status, "SUCCESSFUL");
    assert.equal(successful.body.data.providerReference, "PROVIDER-SUCCESS-1");
    assert.equal((await Partner.findById(successfulPartner._id)).walletBalance, 4900);

    const failedPartner = await createPartner({ permissions: ["AIRTIME"] });
    axios.get = async () => ({
      status: 200,
      data: { status: "FAILED", message: "Beneficiary rejected" },
    });
    const failed = await call(partnerApiController.buyAirtime, {
      partner: failedPartner,
      headers: { "idempotency-key": "provider-failure-request" },
      body: { network: "MTN", phone: "08030000000", amount: 100 },
    });
    assert.equal(failed.status, 422);
    assert.equal(failed.body.status, "REVERSED");
    const storedFailure = await PartnerTransaction.findOne({ partner: failedPartner._id });
    assert.equal(storedFailure.status, "REVERSED");
    assert.equal(storedFailure.walletDebitStatus, "REFUNDED");
    assert.equal((await Partner.findById(failedPartner._id)).walletBalance, 5000);
  } finally {
    axios.get = originalGet;
    if (oldUserId === undefined) delete process.env.CLUBKONNECT_USER_ID;
    else process.env.CLUBKONNECT_USER_ID = oldUserId;
    if (oldApiKey === undefined) delete process.env.CLUBKONNECT_API_KEY;
    else process.env.CLUBKONNECT_API_KEY = oldApiKey;
  }
});

test("unknown provider responses remain unresolved and repeat requests cannot purchase or debit twice", async () => {
  const oldUserId = process.env.CLUBKONNECT_USER_ID;
  const oldApiKey = process.env.CLUBKONNECT_API_KEY;
  const originalGet = axios.get;
  process.env.CLUBKONNECT_USER_ID = "test-user";
  process.env.CLUBKONNECT_API_KEY = "test-key";
  let providerCalls = 0;
  axios.get = async () => {
    providerCalls += 1;
    return { status: 200, data: "<html>temporary upstream response</html>" };
  };
  try {
    const partner = await createPartner({ permissions: ["AIRTIME"] });
    const request = {
      partner,
      headers: { "idempotency-key": "unknown-provider-response" },
      body: { network: "MTN", phone: "08030000000", amount: 100 },
    };
    const first = await call(partnerApiController.buyAirtime, request);
    assert.equal(first.status, 202);
    assert.equal(first.body.status, "PROCESSING");
    const duplicate = await call(partnerApiController.buyAirtime, request);
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(providerCalls, 1);
    assert.equal((await Partner.findById(partner._id)).walletBalance, 4900);
    const transaction = await PartnerTransaction.findOne({ partner: partner._id });
    assert.equal(transaction.status, "REQUERY_REQUIRED");
    assert.equal(transaction.walletDebitStatus, "DEBITED");
    assert.match(transaction.uncertaintyReason, /malformed/i);
  } finally {
    axios.get = originalGet;
    if (oldUserId === undefined) delete process.env.CLUBKONNECT_USER_ID;
    else process.env.CLUBKONNECT_USER_ID = oldUserId;
    if (oldApiKey === undefined) delete process.env.CLUBKONNECT_API_KEY;
    else process.env.CLUBKONNECT_API_KEY = oldApiKey;
  }
});

test("requery is ownership-scoped and does not replay an unresolved purchase", async () => {
  const partner = await createPartner();
  const otherPartner = await createPartner();
  const transaction = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-REQUERY-OWNED",
    idempotencyKey: "requery-owned",
    service: "AIRTIME",
    amount: 100,
    status: "REQUERY_REQUIRED",
    walletDebitStatus: "DEBITED",
  });
  const first = await call(partnerApiController.requeryPartnerTransaction, {
    partner,
    params: { reference: transaction.reference },
  });
  assert.equal(first.status, 202);
  assert.equal(first.body.status, "PENDING");
  const second = await call(partnerApiController.requeryPartnerTransaction, {
    partner,
    params: { reference: transaction.reference },
  });
  assert.equal(second.status, 202);
  const requeryed = await PartnerTransaction.findById(transaction._id);
  assert.equal(requeryed.status, "REQUERY_REQUIRED");
  assert.equal(requeryed.requeryCount, 2);
  assert.equal(requeryed.walletDebitStatus, "DEBITED");
  const crossPartner = await call(partnerApiController.requeryPartnerTransaction, {
    partner: otherPartner,
    params: { reference: transaction.reference },
  });
  assert.equal(crossPartner.status, 404);
  const crossPartnerStatus = await call(partnerTransactionsController.getTransaction, {
    partner: otherPartner,
    params: { reference: transaction.reference },
  });
  assert.equal(crossPartnerStatus.status, 404);

  partner.status = "SUSPENDED";
  await partner.save();
  const suspended = await call(partnerApiController.requeryPartnerTransaction, {
    partner,
    params: { reference: transaction.reference },
  });
  assert.equal(suspended.status, 403);
});

test("Head Office reconciliation confirms once or refunds a verified failure exactly once", async () => {
  const partner = await createPartner();
  const actor = new mongoose.Types.ObjectId();
  const success = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-MANUAL-SUCCESS",
    idempotencyKey: "manual-success",
    service: "DATA",
    amount: 200,
    status: "REQUERY_REQUIRED",
    walletDebitStatus: "DEBITED",
  });
  const confirmed = await call(partnerApiController.resolvePartnerTransaction, {
    user: { _id: actor },
    params: { reference: success.reference },
    body: {
      outcome: "SUCCESSFUL",
      providerReference: "PROVIDER-CONFIRMED-1",
      verificationNote: "Confirmed with provider reconciliation evidence.",
    },
  });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.data.status, "SUCCESSFUL");
  assert.equal(confirmed.body.data.walletDebitStatus, "DEBITED");

  const failed = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-MANUAL-FAILURE",
    idempotencyKey: "manual-failure",
    service: "AIRTIME",
    amount: 300,
    status: "REQUERY_REQUIRED",
    walletDebitStatus: "DEBITED",
  });
  const beforeFailureResolution = await Partner.findById(partner._id);
  const reversed = await call(partnerApiController.resolvePartnerTransaction, {
    user: { _id: actor },
    params: { reference: failed.reference },
    body: {
      outcome: "FAILED",
      providerReference: "PROVIDER-FAILED-1",
      verificationNote: "Provider confirmed that the request was rejected.",
    },
  });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.data.status, "REVERSED");
  assert.equal(reversed.body.data.walletDebitStatus, "REFUNDED");
  assert.equal((await Partner.findById(partner._id)).walletBalance, beforeFailureResolution.walletBalance + 300);
  const repeat = await call(partnerApiController.resolvePartnerTransaction, {
    user: { _id: actor },
    params: { reference: failed.reference },
    body: {
      outcome: "FAILED",
      verificationNote: "Provider confirmed that the request was rejected.",
    },
  });
  assert.equal(repeat.status, 409);
  assert.equal((await Partner.findById(partner._id)).walletBalance, beforeFailureResolution.walletBalance + 300);
  assert.equal(await PartnerAuditLog.countDocuments({
    partner: partner._id,
    action: "API_TRANSACTION_MANUALLY_RESOLVED",
  }), 1);
});

test("concurrent requery and failure resolution cannot resurrect a final transaction", async () => {
  const partner = await createPartner();
  const actor = new mongoose.Types.ObjectId();
  await Partner.findByIdAndUpdate(partner._id, {
    $set: { walletBalance: 4900, dailySpent: 100 },
  });
  const transaction = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-CONCURRENT-RECONCILIATION",
    idempotencyKey: "concurrent-reconciliation",
    service: "AIRTIME",
    amount: 100,
    status: "REQUERY_REQUIRED",
    walletDebitStatus: "DEBITED",
  });
  const [requery, resolution] = await Promise.all([
    call(partnerApiController.requeryPartnerTransaction, {
      partner,
      params: { reference: transaction.reference },
    }),
    call(partnerApiController.resolvePartnerTransaction, {
      user: { _id: actor },
      params: { reference: transaction.reference },
      body: {
        outcome: "FAILED",
        providerReference: "PROVIDER-CONCURRENT-FAILURE",
        verificationNote: "Provider confirmed the concurrent request failed.",
      },
    }),
  ]);
  assert.ok([200, 202].includes(requery.status));
  assert.equal(resolution.status, 200);
  const finalTransaction = await PartnerTransaction.findById(transaction._id);
  assert.equal(finalTransaction.status, "REVERSED");
  assert.equal(finalTransaction.walletDebitStatus, "REFUNDED");
  assert.equal((await Partner.findById(partner._id)).walletBalance, 5000);
  assert.equal(await PartnerAuditLog.countDocuments({
    partner: partner._id,
    action: "API_TRANSACTION_MANUALLY_RESOLVED",
  }), 1);
});

test("Head Office cannot resolve or refund a provider request still in flight", async () => {
  const partner = await createPartner();
  const actor = new mongoose.Types.ObjectId();
  await Partner.findByIdAndUpdate(partner._id, {
    $set: { walletBalance: 4900, dailySpent: 100 },
  });
  const transaction = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-IN-FLIGHT-GUARD",
    idempotencyKey: "in-flight-guard",
    service: "AIRTIME",
    amount: 100,
    status: "PROCESSING",
    walletDebitStatus: "DEBITED",
  });
  const attemptedResolution = await call(partnerApiController.resolvePartnerTransaction, {
    user: { _id: actor },
    params: { reference: transaction.reference },
    body: {
      outcome: "FAILED",
      providerReference: "UNVERIFIED-REFERENCE",
      verificationNote: "Attempted before the provider request completed.",
    },
  });
  assert.equal(attemptedResolution.status, 409);
  const current = await PartnerTransaction.findById(transaction._id);
  assert.equal(current.status, "PROCESSING");
  assert.equal(current.walletDebitStatus, "DEBITED");
  assert.equal((await Partner.findById(partner._id)).walletBalance, 4900);
});

test("a delayed reversal does not reduce a later day's Partner API spending", async () => {
  const partner = await createPartner();
  const actor = new mongoose.Types.ObjectId();
  const currentDay = new Date().toISOString().slice(0, 10);
  await Partner.findByIdAndUpdate(partner._id, {
    $set: {
      walletBalance: 4900,
      dailySpent: 900,
      dailySpentDate: currentDay,
    },
  });
  const transaction = await PartnerTransaction.create({
    partner: partner._id,
    reference: "SPP-CROSS-DAY-REVERSAL",
    idempotencyKey: "cross-day-reversal",
    service: "AIRTIME",
    amount: 100,
    status: "REQUERY_REQUIRED",
    walletDebitStatus: "DEBITED",
    dailySpentDateAtRequest: "2026-01-01",
  });
  const reversal = await call(partnerApiController.resolvePartnerTransaction, {
    user: { _id: actor },
    params: { reference: transaction.reference },
    body: {
      outcome: "FAILED",
      providerReference: "PROVIDER-CROSS-DAY-FAILURE",
      verificationNote: "Provider confirmed the prior-day request failed.",
    },
  });
  assert.equal(reversal.status, 200);
  const latestPartner = await Partner.findById(partner._id);
  assert.equal(latestPartner.walletBalance, 5000);
  assert.equal(latestPartner.dailySpent, 900);
  assert.equal(latestPartner.dailySpentDate, currentDay);
});