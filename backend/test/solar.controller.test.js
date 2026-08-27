const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const solar = require("../controllers/solar.controller");
const solarRoutes = require("../routes/solar.routes");
const User = require("../models/user.model");
const SolarPackage = require("../models/solarPackage.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarPayment = require("../models/solarPayment.model");
const SolarSettings = require("../models/solarSettings.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const models = [User, SolarPackage, SolarApplication, SolarPayment, SolarSettings, Transaction, LedgerEntry, Notification, AdminAuditLog];
let mongo, apiServer, apiBaseUrl, sequence = 0;
const request = ({ user, body = {}, params = {}, query = {}, headers = {} }) => ({
  user, body, params, query, method: "POST", originalUrl: "/api/solar/test", ip: "127.0.0.1",
  get(name) { return headers[Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())]; },
});
const call = async (handler, options) => {
  const result = {}; const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler(request(options), res); result.status ||= 200; return result;
};
const user = async ({ role = "CUSTOMER", balance = 0, pin = "1234" } = {}) => {
  sequence += 1;
  return User.create({ fullName: `Solar ${sequence}`, phone: `080500${String(sequence).padStart(5, "0")}`, email: `solar${sequence}@example.test`, password: "password123", transactionPin: pin, role, status: "ACTIVE", walletBalance: balance, state: "Lagos", lga: "Ikeja" });
};
test.before(async () => {
  process.env.JWT_SECRET = "solar-route-contract-test-secret";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "solar-tests" });
  await Promise.all(models.map((model) => model.init()));
  const app = express();
  app.use(express.json());
  app.use("/api/solar", solarRoutes);
  app.use((req, res) => res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  }));
  await new Promise((resolve) => {
    apiServer = app.listen(0, "127.0.0.1", () => {
      apiBaseUrl = `http://127.0.0.1:${apiServer.address().port}`;
      resolve();
    });
  });
});
test.after(async () => {
  await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongo.stop();
});
test.beforeEach(async () => Promise.all(models.map((model) => model.collection.deleteMany({}))));

const api = async ({ method = "GET", path, actor, body }) => {
  const headers = { Accept: "application/json" };
  if (actor) {
    headers.Authorization = `Bearer ${jwt.sign({ id: String(actor._id) }, process.env.JWT_SECRET)}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test("Solar package HTTP contract keeps customer listing active-only and supports admin lifecycle", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const customer = await user();
  await SolarPackage.create({
    name: "Inactive Existing",
    capacityKw: 1,
    cashPrice: 100000,
    depositPercent: 20,
    installmentMonths: 6,
    stock: 1,
    active: false,
    createdBy: admin._id,
  });

  assert.equal((await api({ path: "/api/solar/admin/packages?includeInactive=true" })).status, 401);
  assert.equal((await api({
    path: "/api/solar/admin/packages?includeInactive=true",
    actor: customer,
  })).status, 403);

  const created = await api({
    method: "POST",
    path: "/api/solar/admin/packages",
    actor: admin,
    body: {
      name: "Production Solar",
      capacityKw: 2.5,
      cashPrice: 450000,
      financedPrice: 500000,
      depositPercent: 20,
      installmentMonths: 12,
      interestPercent: 5,
      repaymentFrequency: "MONTHLY",
      stockQuantity: 3,
      active: true,
    },
  });
  assert.equal(created.status, 201, created.body?.message);
  assert.equal(created.body.package.stock, 3);
  assert.equal(created.body.package.stockQuantity, 3);
  const packageId = String(created.body.package._id);
  const second = await api({
    method: "POST",
    path: "/api/solar/admin/packages",
    actor: admin,
    body: {
      packageName: "ServicePay HomePlus 2KW",
      description: "Reliable 2KW solar solution for family homes.",
      systemCapacityKw: "2",
      cashPrice: "2,200,000",
      financedPrice: "2,600,000",
      depositPercentage: "20",
      repaymentDurationMonths: "12",
      stockQuantity: "10",
      batteryCapacity: "5kWh Lithium Battery",
      inverterCapacity: "2KW Hybrid Inverter",
      includedItems: "2KW Hybrid Inverter, 5kWh Lithium Battery, Solar Panels, Mounting Structure, Cables, Protection Devices, Installation & Basic Setup",
      gracePeriodDays: "3",
      repaymentFrequency: "monthly",
      active: "true",
    },
  });
  assert.equal(second.status, 201, second.body?.message);
  assert.notEqual(String(second.body.package._id), packageId);
  assert.equal(second.body.package.capacityKw, 2);
  assert.equal(second.body.package.cashPrice, 2200000);
  assert.equal(second.body.package.financedPrice, 2600000);
  assert.equal(second.body.package.stockQuantity, 10);
  assert.equal(second.body.package.repaymentFrequency, "MONTHLY");
  assert.equal(second.body.package.specifications.batteryCapacity, "5kWh Lithium Battery");
  assert.equal(second.body.package.terms.gracePeriodDays, 3);
  const secondPackageId = String(second.body.package._id);

  const invalidPrice = await api({
    method: "POST",
    path: "/api/solar/admin/packages",
    actor: admin,
    body: {
      name: "Invalid price",
      capacityKw: 2,
      cashPrice: 2200000,
      financedPrice: "not-a-number",
      depositPercent: 20,
      installmentMonths: 12,
      repaymentFrequency: "MONTHLY",
      stockQuantity: 10,
    },
  });
  assert.equal(invalidPrice.status, 400);
  assert.equal(
    invalidPrice.body.message,
    "financedPrice must be a valid number greater than or equal to 0.",
  );

  const updated = await api({
    method: "PATCH",
    path: `/api/solar/admin/packages/${packageId}`,
    actor: admin,
    body: { name: "Production Solar Plus", stockQuantity: 7 },
  });
  assert.equal(updated.status, 200, updated.body?.message);
  assert.equal(updated.body.package.name, "Production Solar Plus");
  assert.equal(updated.body.package.stockQuantity, 7);

  const deactivated = await api({
    method: "PATCH",
    path: `/api/solar/admin/packages/${packageId}/deactivate`,
    actor: admin,
  });
  assert.equal(deactivated.status, 200, deactivated.body?.message);
  assert.equal(deactivated.body.package.active, false);

  const adminPackages = await api({
    path: "/api/solar/admin/packages?includeInactive=true",
    actor: admin,
  });
  assert.equal(adminPackages.status, 200, adminPackages.body?.message);
  assert.deepEqual(
    adminPackages.body.packages.map((item) => item.name),
    ["Inactive Existing", "Production Solar Plus", "ServicePay HomePlus 2KW"],
  );
  assert.equal(
    adminPackages.body.packages.find((item) => String(item._id) === secondPackageId).active,
    true,
  );

  const inactiveCustomerView = await api({
    path: "/api/solar/packages?includeInactive=true",
    actor: customer,
  });
  assert.equal(inactiveCustomerView.status, 200, inactiveCustomerView.body?.message);
  assert.deepEqual(
    inactiveCustomerView.body.packages.map((item) => item.name),
    ["ServicePay HomePlus 2KW"],
  );

  const activated = await api({
    method: "PATCH",
    path: `/api/solar/admin/packages/${packageId}/activate`,
    actor: admin,
  });
  assert.equal(activated.status, 200, activated.body?.message);
  assert.equal(activated.body.package.active, true);

  const activeCustomerView = await api({
    path: "/api/solar/packages",
    actor: customer,
  });
  assert.equal(activeCustomerView.status, 200, activeCustomerView.body?.message);
  assert.deepEqual(
    activeCustomerView.body.packages.map((item) => item.name),
    ["Production Solar Plus", "ServicePay HomePlus 2KW"],
  );
  assert.equal(await AdminAuditLog.countDocuments({
    action: {
      $in: [
        "SOLAR_PACKAGE_CREATED",
        "SOLAR_PACKAGE_UPDATED",
        "SOLAR_PACKAGE_DELETED",
      ],
    },
  }), 5);
});

test("Solar package updates preserve concurrent stock reservations and roll back when audit storage fails", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const pack = await SolarPackage.create({
    name: "Concurrency Safe",
    capacityKw: 1,
    cashPrice: 200000,
    depositPercent: 20,
    installmentMonths: 6,
    stock: 2,
    active: true,
    createdBy: admin._id,
  });

  const [updated] = await Promise.all([
    api({
      method: "PATCH",
      path: `/api/solar/admin/packages/${pack._id}`,
      actor: admin,
      body: { description: "Updated without replacing inventory" },
    }),
    SolarPackage.updateOne(
      { _id:pack._id, stock:{ $gt:0 } },
      { $inc:{ stock:-1 } },
    ),
  ]);
  assert.equal(updated.status, 200, updated.body?.message);
  const reserved = await SolarPackage.findById(pack._id);
  assert.equal(reserved.stock, 1);
  assert.equal(reserved.description, "Updated without replacing inventory");

  const createAudit = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("Forced Solar audit failure");
  };
  try {
    const failed = await api({
      method: "PATCH",
      path: `/api/solar/admin/packages/${pack._id}/deactivate`,
      actor: admin,
    });
    assert.equal(failed.status, 500);
  } finally {
    AdminAuditLog.create = createAudit;
  }
  assert.equal((await SolarPackage.findById(pack._id)).active, true);
});

test("Solar admin HTTP routes approve once and preserve the canonical status actions", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const customer = await user({ balance: 250000 });
  const pack = await SolarPackage.create({
    name: "ServicePay HomeLite 1KW",
    capacityKw: 1,
    cashPrice: 1000,
    financedPrice: 1000,
    depositPercent: 20,
    installmentMonths: 4,
    interestPercent: 10,
    repaymentFrequency: "MONTHLY",
    stock: 2,
    active: true,
    createdBy: admin._id,
  });
  const application = await SolarApplication.create({
    customer: customer._id,
    package: pack._id,
    packageSnapshot: {
      name: pack.name,
      capacityKw: pack.capacityKw,
      cashPrice: pack.cashPrice,
      financedPrice: pack.financedPrice,
      depositPercent: pack.depositPercent,
      installmentMonths: pack.installmentMonths,
      interestPercent: pack.interestPercent,
      repaymentFrequency: pack.repaymentFrequency,
      terms: pack.terms,
    },
    profileSnapshot: { fullName: customer.fullName },
    status: "UNDER_REVIEW",
    statusHistory: [{ status: "UNDER_REVIEW", changedBy: admin._id }],
  });
  const approvalPath = `/api/solar/admin/applications/${application._id}/approve`;
  const approvalBody = { approvedPrice: 1000, note: "Approved for HomeLite" };

  assert.equal((await api({
    method: "PATCH",
    path: approvalPath,
    body: approvalBody,
  })).status, 401);
  assert.equal((await api({
    method: "PATCH",
    path: approvalPath,
    actor: customer,
    body: approvalBody,
  })).status, 403);
  assert.equal((await api({
    method: "POST",
    path: approvalPath,
    actor: admin,
    body: approvalBody,
  })).status, 404);

  const approved = await api({
    method: "PATCH",
    path: approvalPath,
    actor: admin,
    body: approvalBody,
  });
  assert.equal(approved.status, 200, approved.body?.message);
  assert.equal(approved.body.application.status, "AWAITING_DEPOSIT");

  const saved = await SolarApplication.findById(application._id);
  assert.equal(String(saved.customer), String(customer._id));
  assert.equal(String(saved.package), String(pack._id));
  assert.equal(String(saved.approvedBy), String(admin._id));
  assert.ok(saved.approvedAt);
  assert.equal(saved.approvalSnapshot.approvedPrice, 1000);
  assert.equal(saved.depositRequired, 200);
  assert.equal(saved.totalPayable, 1100);
  assert.equal(saved.outstandingBalance, 1100);
  assert.equal(saved.paymentSchedule.length, 4);
  assert.equal(
    saved.paymentSchedule.reduce((sum, row) => sum + row.amount, 0),
    900,
  );
  assert.equal((await SolarPackage.findById(pack._id)).stock, 1);
  assert.equal(await Notification.countDocuments({
    userId: customer._id,
    type: "SOLAR",
  }), 1);
  assert.equal(await Transaction.countDocuments(), 0);
  assert.equal(await LedgerEntry.countDocuments(), 0);

  const duplicate = await api({
    method: "PATCH",
    path: approvalPath,
    actor: admin,
    body: approvalBody,
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await SolarPackage.findById(pack._id)).stock, 1);
  assert.equal(await Notification.countDocuments({
    userId: customer._id,
    type: "SOLAR",
  }), 1);

  const missing = await api({
    method: "PATCH",
    path: `/api/solar/admin/applications/${new mongoose.Types.ObjectId()}/approve`,
    actor: admin,
    body: approvalBody,
  });
  assert.equal(missing.status, 404);
  const invalid = await api({
    method: "PATCH",
    path: "/api/solar/admin/applications/not-an-object-id/approve",
    actor: admin,
    body: approvalBody,
  });
  assert.equal(invalid.status, 400);

  const persisted = await api({
    path: "/api/solar/admin/applications",
    actor: admin,
  });
  assert.equal(persisted.status, 200, persisted.body?.message);
  assert.equal(
    persisted.body.applications.find(
      (item) => String(item._id) === String(application._id),
    ).status,
    "AWAITING_DEPOSIT",
  );

  const requestInfoApplication = await SolarApplication.create({
    customer: customer._id,
    package: pack._id,
    packageSnapshot: saved.packageSnapshot,
    profileSnapshot: saved.profileSnapshot,
    status: "SUBMITTED",
    statusHistory: [{ status: "SUBMITTED", changedBy: customer._id }],
  });
  const requestInfo = await api({
    method: "PATCH",
    path: `/api/solar/admin/applications/${requestInfoApplication._id}/status`,
    actor: admin,
    body: { status: "MORE_INFORMATION_REQUIRED", note: "Upload invoice" },
  });
  assert.equal(requestInfo.status, 200, requestInfo.body?.message);
  assert.equal(requestInfo.body.application.status, "MORE_INFORMATION_REQUIRED");

  const rejectedApplication = await SolarApplication.create({
    customer: customer._id,
    package: pack._id,
    packageSnapshot: saved.packageSnapshot,
    profileSnapshot: saved.profileSnapshot,
    status: "SUBMITTED",
    statusHistory: [{ status: "SUBMITTED", changedBy: customer._id }],
  });
  const rejected = await api({
    method: "PATCH",
    path: `/api/solar/admin/applications/${rejectedApplication._id}/status`,
    actor: admin,
    body: { status: "REJECTED", note: "Eligibility requirements not met" },
  });
  assert.equal(rejected.status, 200, rejected.body?.message);
  assert.equal(rejected.body.application.status, "REJECTED");
});

test("Solar approval snapshots price and allocates rounded installment balances exactly", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const customer = await user();
  const pack = await SolarPackage.create({ name: "1kW", capacityKw: 1, cashPrice: 1000, depositPercent: 10, installmentMonths: 3, interestPercent: 0, stock: 1, createdBy: admin._id });
  const submitted = await call(solar.submitApplication, { user: customer, body: { packageId: String(pack._id), residentialAddress: "1 Solar Approval Street", business: { name: "Shop" }, guarantor: { phone: "0801" }, applicationPreferences: { occupationBusiness: "Shop", monthlyIncomeRange: "₦50,000 - ₦100,000", preferredRepaymentPeriod: "3", upfrontPaymentOption: "Standard package deposit" }, declarations: { accepted: true } } });
  assert.equal(submitted.status, 201);
  const reviewing = await call(solar.transitionApplication, { user: admin, params: { applicationId: String(submitted.body.application._id) }, body: { status: "UNDER_REVIEW" } });
  assert.equal(reviewing.status, 200);
  const approved = await call(solar.approveApplication, { user: admin, params: { applicationId: String(pack._id === pack._id ? submitted.body.application._id : "") }, body: { approvedPrice: 1000 } });
  assert.equal(approved.status, 200);
  const app = await SolarApplication.findById(submitted.body.application._id);
  assert.equal(app.depositRequired, 100);
  assert.equal(app.totalPayable, 1000);
  assert.equal(app.paymentSchedule.reduce((sum, row) => sum + row.amount, 0), 900);
  assert.deepEqual(app.paymentSchedule.map((row) => row.amount), [300, 300, 300]);
  assert.equal(app.approvalSnapshot.approvedPrice, 1000);
  assert.equal(await Notification.countDocuments({ userId: customer._id, type: "SOLAR" }), 1);
});

test("Solar wallet payment is idempotent, debits once, and completes only at zero balance", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const customer = await user({ balance: 1000 });
  const pack = await SolarPackage.create({ name: "Exact", capacityKw: 1, cashPrice: 1000, depositPercent: 10, installmentMonths: 3, createdBy: admin._id });
  const app = await SolarApplication.create({ customer: customer._id, package: pack._id, packageSnapshot: pack.toObject(), profileSnapshot: { fullName: customer.fullName }, status: "APPROVED", statusHistory: [{ status: "APPROVED", changedBy: admin._id }], approvalSnapshot: { approvedPrice: 1000 }, depositRequired: 100, totalPayable: 1000, outstandingBalance: 1000, paymentSchedule: [{ installmentNumber: 1, dueDate: new Date(), amount: 300 }, { installmentNumber: 2, dueDate: new Date(), amount: 300 }, { installmentNumber: 3, dueDate: new Date(), amount: 300 }] });
  const opts = { user: customer, params: { applicationId: String(app._id) }, body: { type: "DEPOSIT", amount: 100, transactionPin: "1234" }, headers: { "Idempotency-Key": "solar-deposit-once" } };
  const firstPayment = await call(solar.pay, opts);
  assert.equal(firstPayment.status, 201, firstPayment.body?.message);
  assert.equal((await call(solar.pay, opts)).status, 200);
  assert.equal((await User.findById(customer._id)).walletBalance, 900);
  assert.equal(await SolarPayment.countDocuments(), 1);
  // Legacy compatible alias remains restricted to active contracts.
  await SolarApplication.updateOne({ _id: app._id }, { $set: { status: "ACTIVE" } });
  const installment = { user: customer, params: opts.params, body: { type: "INSTALLMENT", amount: 900, transactionPin: "1234" }, headers: { "Idempotency-Key": "solar-final-once" } };
  assert.equal((await call(solar.pay, installment)).status, 201);
  const saved = await SolarApplication.findById(app._id);
  assert.equal(saved.outstandingBalance, 0);
  assert.equal(saved.status, "COMPLETED");
  assert.equal(await LedgerEntry.countDocuments({ service: { $in: ["SOLAR_DEPOSIT", "SOLAR_INSTALLMENT"] } }), 2);
});

test("Solar guards ownership and recovery requires an admin reason without changing remote state", async () => {
  const owner = await user(), stranger = await user(), admin = await user({ role: "HEAD_OFFICE" });
  const pack = await SolarPackage.create({ name: "Guard", capacityKw: 1, cashPrice: 100, depositPercent: 0, installmentMonths: 1, createdBy: admin._id });
  const app = await SolarApplication.create({ customer: owner._id, package: pack._id, packageSnapshot: pack.toObject(), profileSnapshot: { fullName: owner.fullName }, status: "ACTIVE", statusHistory: [], totalPayable: 100, outstandingBalance: 100 });
  assert.equal((await call(solar.getMyApplication, { user: stranger, params: { applicationId: String(app._id) } })).status, 404);
  assert.equal((await call(solar.recovery, { user: admin, params: { applicationId: String(app._id) }, body: {} })).status, 400);
  const recovery = await call(solar.recovery, { user: admin, params: { applicationId: String(app._id) }, body: { reason: "Missed payments", notes: "Contact customer" } });
  assert.equal(recovery.status, 200);
  assert.equal(recovery.body.application.status, "RECOVERY");
  assert.equal(recovery.body.application.recovery.reason, "Missed payments");
});

test("parallel approval reserves one stock unit and parallel cancellation releases it once", async () => {
  const admin = await user({ role: "HEAD_OFFICE" });
  const customer = await user();
  const pack = await SolarPackage.create({ name: "Concurrent", capacityKw: 1, cashPrice: 500, depositPercent: 20, installmentMonths: 2, stock: 1, createdBy: admin._id });
  const app = await SolarApplication.create({
    customer: customer._id, package: pack._id,
    packageSnapshot: { name: pack.name, cashPrice: 500, depositPercent: 20, interestPercent: 0, installmentMonths: 2, repaymentFrequency: "MONTHLY" },
    profileSnapshot: { fullName: customer.fullName }, declarations: { accepted: true },
    status: "UNDER_REVIEW", statusHistory: [{ status: "UNDER_REVIEW", changedBy: admin._id }],
  });
  const approval = { user: admin, params: { applicationId: String(app._id) }, body: {} };
  const approvals = await Promise.all([call(solar.approveApplication, approval), call(solar.approveApplication, approval)]);
  assert.deepEqual(approvals.map((item) => item.status).sort(), [200, 409]);
  assert.equal((await SolarPackage.findById(pack._id)).stock, 0);
  const cancellation = { user: admin, params: { applicationId: String(app._id) }, body: { status: "CANCELLED", note: "Customer withdrew" } };
  const cancellations = await Promise.all([call(solar.transitionApplication, cancellation), call(solar.transitionApplication, cancellation)]);
  assert.deepEqual(cancellations.map((item) => item.status).sort(), [200, 409]);
  assert.equal((await SolarPackage.findById(pack._id)).stock, 1);
  const saved = await SolarApplication.findById(app._id);
  assert.equal(saved.stockReservation.reserved, false);
  assert.ok(saved.stockReservation.releasedAt);
});