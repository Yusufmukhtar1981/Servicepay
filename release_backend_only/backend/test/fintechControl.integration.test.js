const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const AppSettings = require("../models/appSettings.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const BankTransfer = require("../models/bankTransfer.model");
const Transaction = require("../models/transaction.model");
const {
  getFintechControlSettings,
  updateFintechControlSettings,
} = require("../controllers/fintechControlSettings.controller");
const {
  adminRequeryTransaction,
} = require("../controllers/adminTransactionRequery.controller");
const {
  listBankReconciliation,
} = require("../controllers/adminBankReconciliation.controller");
const fintechControlMiddleware = require("../middleware/fintechControl.middleware");
const { adminOnly } = require("../middleware/auth.middleware");

let mongo;
let sequence = 0;

const models = [
  AppSettings,
  AdminAuditLog,
  BankTransfer,
  Transaction,
];

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "fintech-control-tests" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  sequence += 1;
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

const headOffice = () => ({
  _id: new mongoose.Types.ObjectId(),
  role: "HEAD_OFFICE",
  fullName: "Fintech Test Head Office",
});

const request = ({
  user = headOffice(),
  body = {},
  query = {},
  params = {},
  originalUrl = "/api/settings/admin/fintech-control",
  method = "GET",
} = {}) => ({
  user,
  body,
  query,
  params,
  originalUrl,
  method,
  ip: "127.0.0.1",
  headers: { "user-agent": "fintech-control-test" },
});

const call = async (handler, options) => {
  const result = { status: 200 };
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
  await handler(request(options), res);
  return result;
};

const runMiddleware = async (options) => {
  const result = { next: false, status: 200 };
  const req = request(options);
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
  await fintechControlMiddleware(req, res, () => {
    result.next = true;
  });
  result.request = req;
  return result;
};

const createBankTransfer = async ({
  reference = `BANK-${sequence}`,
  status = "PENDING",
  requeryInProgress = false,
} = {}) =>
  BankTransfer.create({
    sender: new mongoose.Types.ObjectId(),
    reference,
    bankCode: "000001",
    bankName: "Sterling Bank",
    accountNumber: "0000000000",
    accountName: "Fintech Test Recipient",
    amount: 100,
    totalDebit: 100,
    status,
    requeryInProgress,
  });

test("GET creates and returns the canonical fintech-control contract", async () => {
  const response = await call(getFintechControlSettings);

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.maintenance.enabled, false);
  assert.equal(response.body.data.maintenance.customerAppEnabled, true);
  assert.equal(response.body.data.serviceLimits.tier1Daily, 0);
  assert.equal(response.body.data.featureToggles.airtime, true);
  assert.equal(await AppSettings.countDocuments({ key: "GLOBAL_SETTINGS" }), 1);
});

test("maintenance, limits, and feature toggles persist with an audit trail", async () => {
  const actor = headOffice();
  const response = await call(updateFintechControlSettings, {
    user: actor,
    method: "PUT",
    body: {
      reason: "Focused verification",
      fintechControl: {
        maintenance: {
          enabled: true,
          customerAppEnabled: false,
          apiEnabled: false,
          message: "Focused verification window.",
        },
        serviceLimits: {
          tier1Daily: 1200,
          tier1PerTransaction: 300,
        },
        featureToggles: { airtime: false },
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.maintenance.enabled, true);
  assert.equal(response.body.data.serviceLimits.tier1Daily, 1200);
  assert.equal(response.body.data.featureToggles.airtime, false);

  const saved = await AppSettings.getGlobalSettings();
  assert.equal(saved.fintechControl.maintenance.enabled, true);
  assert.equal(saved.platform.maintenanceMode, true);
  assert.equal(saved.fintechControl.serviceLimits.tier1PerTransaction, 300);
  assert.equal(saved.services.airtime, false);

  const audit = await AdminAuditLog.findOne({
    action: "SYSTEM_SETTING_UPDATED",
  }).lean();
  assert.equal(audit.actorRole, "HEAD_OFFICE");
  assert.equal(audit.reason, "Focused verification");
  assert.equal(audit.metadata.settingsKey, "FINTECH_CONTROL");
  assert.equal(audit.newData.maintenance.enabled, true);
});

test("rejects invalid negative limits without changing saved controls", async () => {
  const initial = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      fintechControl: { serviceLimits: { tier1PerTransaction: 700 } },
    },
  });
  assert.equal(initial.status, 200);

  const rejected = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      fintechControl: { serviceLimits: { tier1PerTransaction: -1 } },
    },
  });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.message, /non-negative number/);

  const saved = await AppSettings.getGlobalSettings();
  assert.equal(saved.fintechControl.serviceLimits.tier1PerTransaction, 700);
});

test("middleware enforces maintenance, feature toggles, and tier transaction limits", async () => {
  await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      fintechControl: {
        maintenance: {
          enabled: false,
          customerAppEnabled: true,
          apiEnabled: true,
        },
        serviceLimits: { tier1PerTransaction: 200 },
        featureToggles: { airtime: false },
      },
    },
  });

  const disabledFeature = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    originalUrl: "/api/airtime/purchase",
    method: "POST",
    body: { amount: 50 },
  });
  assert.equal(disabledFeature.status, 503);
  assert.equal(disabledFeature.body.code, "FEATURE_DISABLED");

  const limited = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    originalUrl: "/api/bills/purchase",
    method: "POST",
    body: { amount: 201 },
  });
  assert.equal(limited.status, 400);
  assert.equal(limited.body.code, "TIER_TRANSACTION_LIMIT_EXCEEDED");

  await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      fintechControl: { maintenance: { enabled: true } },
    },
  });
  const maintenance = await runMiddleware({
    user: { role: "CUSTOMER" },
    originalUrl: "/api/bills/purchase",
    method: "GET",
  });
  assert.equal(maintenance.status, 503);
  assert.equal(maintenance.body.maintenance, true);
});

test("HEAD_OFFICE authorization middleware blocks non-Head Office settings updates", async () => {
  const result = { next: false };
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
  adminOnly("HEAD_OFFICE")(
    { user: { _id: new mongoose.Types.ObjectId(), role: "CUSTOMER" } },
    res,
    () => {
      result.next = true;
    }
  );
  assert.equal(result.status, 403);
  assert.equal(result.next, false);

  const allowed = { next: false };
  adminOnly("HEAD_OFFICE")(
    { user: { _id: new mongoose.Types.ObjectId(), role: "head-office" } },
    res,
    () => {
      allowed.next = true;
    }
  );
  assert.equal(allowed.next, true);
});

test("bank reconciliation exposes an in-progress duplicate requery as processing", async () => {
  await createBankTransfer({ requeryInProgress: true });
  const response = await call(listBankReconciliation, {
    originalUrl: "/api/admin/bank-reconciliation",
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.records.length, 1);
  assert.equal(response.body.records[0].safeAction, "PROCESSING");
});

test("duplicate bank requery returns a safe manual-review response without provider access", async () => {
  const transfer = await createBankTransfer({ requeryInProgress: true });
  const response = await call(adminRequeryTransaction, {
    method: "POST",
    originalUrl: "/api/admin/transaction-requery",
    body: { reference: transfer.reference },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.code, "REQUERY_ALREADY_PROCESSING");
  assert.equal(response.body.manualReviewRequired, true);
  const unchanged = await BankTransfer.findById(transfer._id).lean();
  assert.equal(unchanged.requeryInProgress, true);
});

test("unsupported requery returns MANUAL_REVIEW and leaves financial state untouched", async () => {
  const customerId = new mongoose.Types.ObjectId();
  const transaction = await Transaction.create({
    reference: `UNSUPPORTED-${sequence}`,
    customerId,
    serviceType: "AIRTIME",
    amount: 500,
    status: "PENDING",
  });
  const response = await call(adminRequeryTransaction, {
    method: "POST",
    originalUrl: "/api/admin/transaction-requery",
    body: { reference: transaction.reference },
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.manualReviewRequired, true);
  assert.equal(response.body.liveProviderRequery, false);
  const unchanged = await Transaction.findById(transaction._id).lean();
  assert.equal(unchanged.status, "PENDING");
  assert.equal(unchanged.amount, 500);
});