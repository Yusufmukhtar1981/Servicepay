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
  patch: patchFeatureControl,
  bulk: bulkFeatureControl,
} = require("../controllers/featureControl.controller");
const {
  adminRequeryTransaction,
} = require("../controllers/adminTransactionRequery.controller");
const {
  listBankReconciliation,
} = require("../controllers/adminBankReconciliation.controller");
const fintechControlMiddleware = require("../middleware/fintechControl.middleware");
const {
  requireFeatureEnabled,
} = require("../middleware/fintechControl.middleware");
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

const runFeatureGuard = async (key, {
  user,
  originalUrl,
  method = "POST",
} = {}) => {
  const result = { next: false, status: 200 };
  const req = { user, originalUrl, method };
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
  await requireFeatureEnabled(key)(req, res, () => {
    result.next = true;
  });
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
        featureToggles: { airtime: false, delivery: false },
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

test("legacy fintech settings saves preserve the feature registry", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        data: { enabled: false, visible: false },
      },
    },
  });

  const response = await call(updateFintechControlSettings, {
    user: headOffice(),
    method: "PUT",
    body: {
      reason: "Update legacy controls safely",
      fintechControl: { featureToggles: { airtime: false } },
    },
  });

  assert.equal(response.status, 200);
  const settings = await AppSettings.getGlobalSettings();
  assert.equal(settings.fintechControl.featureRegistry.get("data").enabled, false);
  assert.equal(settings.fintechControl.featureRegistry.get("data").visible, false);
});

test("legacy fintech mutation requires a durable actor", async () => {
  const response = await call(updateFintechControlSettings, {
    user: null,
    method: "PUT",
    body: {
      reason: "Reject anonymous settings",
      fintechControl: { serviceLimits: { tier1Daily: 99 } },
    },
  });
  assert.equal(response.status, 401);
  assert.equal(await AppSettings.countDocuments({}), 0);
  assert.equal(await AdminAuditLog.countDocuments({}), 0);
});

test("legacy fintech mutation rolls back GLOBAL_SETTINGS when audit creation fails", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: { serviceLimits: { tier1Daily: 100 } },
  });
  const originalCreate = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("audit unavailable");
  };
  try {
    const response = await call(updateFintechControlSettings, {
      user: headOffice(),
      method: "PUT",
      body: {
        reason: "Rollback legacy audit failure",
        fintechControl: { serviceLimits: { tier1Daily: 200 } },
      },
    });
    assert.equal(response.status, 500);
  } finally {
    AdminAuditLog.create = originalCreate;
  }
  const settings = await AppSettings.getGlobalSettings();
  assert.equal(settings.fintechControl.serviceLimits.tier1Daily, 100);
  assert.equal(await AdminAuditLog.countDocuments({ action: "SYSTEM_SETTING_UPDATED" }), 0);
});

test("only SERVICEPAY_SUPER_ADMIN bypasses protected feature permission", async () => {
  const body = {
    enabled: false,
    reason: "Disable wallet for protected maintenance",
    confirmationText: "wallet",
  };
  const regularSuperAdmin = await call(patchFeatureControl, {
    user: { _id: new mongoose.Types.ObjectId(), role: "SUPER_ADMIN" },
    method: "PATCH",
    params: { key: "wallet" },
    body,
  });
  assert.equal(regularSuperAdmin.status, 403);

  const servicePaySuperAdmin = await call(patchFeatureControl, {
    user: { _id: new mongoose.Types.ObjectId(), role: "SERVICEPAY_SUPER_ADMIN" },
    method: "PATCH",
    params: { key: "wallet" },
    body,
  });
  assert.equal(servicePaySuperAdmin.status, 200);
});

test("feature PATCH requires a durable actor and atomically commits its audit", async () => {
  const actor = headOffice();
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: { featureRegistry: { data: { enabled: true } } },
  });

  const saved = await call(patchFeatureControl, {
    user: actor,
    method: "PATCH",
    params: { key: "data" },
    body: { enabled: false, reason: "Disable data for provider work" },
  });
  assert.equal(saved.status, 200);
  assert.equal((await AppSettings.getGlobalSettings()).fintechControl.featureRegistry.get("data").enabled, false);
  assert.equal(await AdminAuditLog.countDocuments({ action: "FEATURE_CONTROL_UPDATED" }), 1);

  const rejected = await call(patchFeatureControl, {
    user: null,
    method: "PATCH",
    params: { key: "data" },
    body: { enabled: true, reason: "Attempt without actor" },
  });
  assert.equal(rejected.status, 401);
});

test("feature PATCH rolls back settings when immutable audit creation fails", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: { featureRegistry: { data: { enabled: true } } },
  });
  const originalCreate = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("audit unavailable");
  };
  try {
    const response = await call(patchFeatureControl, {
      user: headOffice(),
      method: "PATCH",
      params: { key: "data" },
      body: { enabled: false, reason: "Rollback when audit fails" },
    });
    assert.equal(response.status, 500);
  } finally {
    AdminAuditLog.create = originalCreate;
  }
  assert.equal((await AppSettings.getGlobalSettings()).fintechControl.featureRegistry.get("data").enabled, true);
  assert.equal(await AdminAuditLog.countDocuments({ action: "FEATURE_CONTROL_UPDATED" }), 0);
});

test("feature bulk rolls back all settings when one audit write fails", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        data: { enabled: true },
        airtime: { enabled: true },
      },
    },
  });
  const originalCreate = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("audit unavailable");
  };
  try {
    const response = await call(bulkFeatureControl, {
      user: headOffice(),
      method: "POST",
      body: {
        keys: ["data", "airtime"],
        action: "DISABLE",
        reason: "Rollback bulk control audit",
      },
    });
    assert.equal(response.status, 500);
  } finally {
    AdminAuditLog.create = originalCreate;
  }
  const settings = await AppSettings.getGlobalSettings();
  assert.equal(settings.fintechControl.featureRegistry.get("data").enabled, true);
  assert.equal(settings.fintechControl.featureRegistry.get("airtime").enabled, true);
});

test("rejects invalid negative limits without changing saved controls", async () => {
  const initial = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      reason: "Set initial transaction limit",
      fintechControl: { serviceLimits: { tier1PerTransaction: 700 } },
    },
  });
  assert.equal(initial.status, 200);

  const rejected = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      reason: "Reject invalid transaction limit",
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
      reason: "Exercise middleware controls",
      fintechControl: {
        maintenance: {
          enabled: false,
          customerAppEnabled: true,
          apiEnabled: true,
        },
        serviceLimits: { tier1PerTransaction: 200 },
        featureToggles: { airtime: false, delivery: false },
      },
    },
  });

  const disabledFeature = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    originalUrl: "/api/clubkonnect/airtime",
    method: "POST",
    body: { amount: 50 },
  });
  assert.equal(disabledFeature.status, 503);
  assert.equal(disabledFeature.body.code, "FEATURE_DISABLED");

  const disabledInterstate = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    originalUrl: "/api/logistics/interstate/routes",
    method: "GET",
  });
  assert.equal(disabledInterstate.next, true);
  assert.equal(disabledInterstate.status, 200);

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
      reason: "Enable scheduled maintenance",
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

test("feature enforcement bypasses reads, callbacks, webhooks, and transfer requeries", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    services: { airtime: false, bankTransfer: false },
    fintechControl: {
      featureRegistry: {
        airtime: { enabled: false },
        bankTransfer: { enabled: false },
      },
    },
  });
  for (const options of [
    { method: "GET", originalUrl: "/api/clubkonnect/airtime" },
    { method: "POST", originalUrl: "/api/transfer/squad/webhook" },
    { method: "POST", originalUrl: "/api/electricity/callback" },
    { method: "POST", originalUrl: "/api/transfer/bank/requery" },
  ]) {
    const result = await runMiddleware({ user: { role: "CUSTOMER" }, ...options });
    assert.equal(result.next, true, options.originalUrl);
  }
});

test("bypass matching ignores adversarial query tokens and unrelated path segments", async () => {
  const settings = await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      maintenance: {
        enabled: false,
        customerAppEnabled: true,
        apiEnabled: true,
      },
      serviceLimits: { tier1PerTransaction: 100 },
      featureRegistry: {
        servicepayTransfer: { enabled: false },
      },
    },
  });

  let result = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    method: "POST",
    originalUrl: "/api/transfer/servicepay?next=/admin",
    body: { amount: 10 },
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FEATURE_DISABLED");

  settings.set("fintechControl.featureRegistry", {
    servicepayTransfer: { enabled: true },
  });
  settings.set("fintechControl.maintenance.enabled", true);
  await settings.save();
  result = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    method: "POST",
    originalUrl: "/api/transfer/servicepay?callback=webhook",
    body: { amount: 10 },
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.maintenance, true);

  settings.set("fintechControl.maintenance.enabled", false);
  settings.set("fintechControl.maintenance.apiEnabled", false);
  await settings.save();
  for (const originalUrl of [
    "/api/transfer/servicepay?next=/admin",
    "/api/transfer/servicepay?token=callback",
    "/api/not-administer/servicepay?webhook=true",
  ]) {
    result = await runMiddleware({
      user: { role: "CUSTOMER", kycTier: "TIER_1" },
      method: "POST",
      originalUrl,
      body: { amount: 10 },
    });
    assert.equal(result.status, 503, originalUrl);
    assert.equal(result.body.code, "API_DISABLED", originalUrl);
  }

  settings.set("fintechControl.maintenance.apiEnabled", true);
  await settings.save();
  result = await runMiddleware({
    user: { role: "CUSTOMER", kycTier: "TIER_1" },
    method: "POST",
    originalUrl: "/api/transfer/servicepay?next=/admin",
    body: { amount: 101 },
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, "TIER_TRANSACTION_LIMIT_EXCEEDED");
});

test("NIN and BVN controls never cross-block one another", async () => {
  const settings = await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        ninVerification: { enabled: false },
        bvnVerification: { enabled: true },
      },
    },
  });
  let nin = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/id-verification/nin",
  });
  let bvn = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/id-verification/bvn",
  });
  assert.equal(nin.body.service, "ninVerification");
  assert.equal(nin.status, 503);
  assert.equal(bvn.next, true);

  settings.set("fintechControl.featureRegistry", {
    ninVerification: { enabled: true },
    bvnVerification: { enabled: false },
  });
  await settings.save();
  nin = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/id-verification/nin",
  });
  bvn = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/id-verification/bvn",
  });
  assert.equal(nin.next, true);
  assert.equal(bvn.body.service, "bvnVerification");
  assert.equal(bvn.status, 503);
});

test("empowerment applications are rejected by the canonical empowerment control", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        empowerment: { enabled: false },
      },
    },
  });
  const result = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/empowerment/programs/program-1/apply",
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FEATURE_DISABLED");
  assert.equal(result.body.service, "empowerment");
});

test("staff disbursement guards enforce programSponsor independently of management bypass", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        programSponsor: { enabled: false },
      },
    },
  });
  const disabled = await runFeatureGuard("programSponsor", {
    user: headOffice(),
    originalUrl: "/api/empowerment/programs/program-1/disbursements",
  });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.code, "FEATURE_DISABLED");

  const enabledSettings = await AppSettings.getGlobalSettings();
  enabledSettings.set("fintechControl.featureRegistry", {
    programSponsor: { enabled: true },
  });
  await enabledSettings.save();
  for (const user of [
    headOffice(),
    { _id: new mongoose.Types.ObjectId(), role: "STAFF" },
  ]) {
    const allowed = await runFeatureGuard("programSponsor", {
      user,
      originalUrl: "/api/empowerment/programs/program-1/bulk-disbursement",
    });
    assert.equal(allowed.next, true, user.role);
  }
});

test("organization payment initiation routes are blocked without blocking recovery paths", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: {
      featureRegistry: {
        organizations: { enabled: false },
      },
    },
  });
  for (const originalUrl of [
    "/api/organizations/org-1/payments",
    "/api/organizations/org-1/annual-payment",
    "/api/organizations/org-1/fee-assignments/assignment-1/pay",
  ]) {
    const result = await runMiddleware({
      user: { role: "CUSTOMER" },
      method: "POST",
      originalUrl,
    });
    assert.equal(result.status, 503, originalUrl);
    assert.equal(result.body.code, "FEATURE_DISABLED", originalUrl);
    assert.equal(result.body.service, "organizations", originalUrl);
  }
  for (const originalUrl of [
    "/api/organizations/org-1/payments/requery",
    "/api/organizations/org-1/payments/reject",
  ]) {
    const result = await runMiddleware({
      user: { role: "CUSTOMER" },
      method: "POST",
      originalUrl,
    });
    assert.equal(result.next, true, originalUrl);
  }
});

test("middleware and controllers read exactly GLOBAL_SETTINGS", async () => {
  await AppSettings.create({
    key: "GLOBAL_SETTINGS",
    fintechControl: { featureRegistry: { data: { enabled: false } } },
  });
  await AppSettings.create({
    key: "OTHER_SETTINGS",
    fintechControl: { featureRegistry: { data: { enabled: true } } },
  });
  const result = await runMiddleware({
    user: { role: "CUSTOMER" },
    method: "POST",
    originalUrl: "/api/clubkonnect/data",
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "FEATURE_DISABLED");
});

test("PUT requires an explicit audit reason before changing settings", async () => {
  const rejected = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      fintechControl: { featureToggles: { airtime: false } },
    },
  });

  assert.equal(rejected.status, 400);
  assert.match(rejected.body.message, /audit reason/i);
  assert.equal(await AppSettings.countDocuments({}), 0);
  assert.equal(await AdminAuditLog.countDocuments({}), 0);
});

test("unknown toggle keys round-trip without overriding canonical services", async () => {
  const saved = await call(updateFintechControlSettings, {
    method: "PUT",
    body: {
      reason: "Preserve future service toggle",
      fintechControl: {
        featureToggles: {
          airtime: false,
          futureService: false,
        },
      },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.featureToggles.airtime, false);
  assert.equal(saved.body.data.featureToggles.futureService, false);

  const reloaded = await call(getFintechControlSettings);
  assert.equal(reloaded.body.data.featureToggles.airtime, false);
  assert.equal(reloaded.body.data.featureToggles.futureService, false);

  const settings = await AppSettings.getGlobalSettings();
  assert.equal(settings.services.airtime, false);
  assert.equal(settings.fintechControl.featureToggles.get("futureService"), false);
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