const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const authRoutes = require("../routes/auth.routes");
const solarRoutes = require("../routes/solar.routes");
const solarOfficerRoutes = require("../routes/solarOfficer.routes");
const User = require("../models/user.model");
const SolarPackage = require("../models/solarPackage.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarFinance = require("../models/solarFinance.model");
const SolarPayment = require("../models/solarPayment.model");
const SolarOfficer = require("../models/solarOfficer.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarVerification = require("../models/solarVerification.model");
const SolarFollowUp = require("../models/solarFollowUp.model");
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const SolarOfficerWithdrawal = require("../models/solarOfficerWithdrawal.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const models = [
  User,
  SolarPackage,
  SolarApplication,
  SolarFinance,
  SolarPayment,
  SolarOfficer,
  SolarAssignment,
  SolarVerification,
  SolarFollowUp,
  SolarOfficerWallet,
  SolarOfficerCommission,
  SolarOfficerWithdrawal,
  Transaction,
  LedgerEntry,
  Notification,
  AdminAuditLog,
];

let mongo;
let server;
let baseUrl;
let sequence = 0;

const createUser = async ({ role = "CUSTOMER", walletBalance = 0 } = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Solar Officer Test ${sequence}`,
    phone: `080611${String(sequence).padStart(5, "0")}`,
    email: `solar-officer-${sequence}@example.test`,
    password: "password123",
    transactionPin: "1234",
    transactionPinSet: true,
    role,
    status: "ACTIVE",
    walletBalance,
    state: "Lagos",
    lga: "Ikeja",
    address: "1 Solar Test Street",
  });
};

const tokenFor = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

const api = async ({ method = "GET", path, actor, body, headers = {} }) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(actor ? { Authorization: `Bearer ${tokenFor(actor)}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

test.before(async () => {
  process.env.JWT_SECRET = "solar-officer-integration-secret";
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "solar-officer-tests" });
  await Promise.all(models.map((model) => model.init()));
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  app.use("/api/solar", solarRoutes);
  app.use("/api/solar/officer", solarOfficerRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("Solar Officer flow enforces assignment, commissions, withdrawal locks, and Admin approval", async () => {
  const admin = await createUser({ role: "HEAD_OFFICE" });
  const customer = await createUser({ walletBalance: 500 });
  const otherCustomer = await createUser({ walletBalance: 500 });

  const createOfficer = await api({
    method: "POST",
    path: "/api/solar/officer/admin/officers",
    actor: admin,
    body: {
      fullName: "Field Solar Officer",
      phone: "08069990001",
      email: "field-officer@example.test",
      password: "officer123",
      state: "Lagos",
      lga: "Ikeja",
      address: "2 Officer Street",
    },
  });
  assert.equal(createOfficer.status, 201);
  assert.match(createOfficer.body.officer.officerId, /^SSO-\d{6}$/);
  const officerUser = await User.findOne({ email: "field-officer@example.test" });
  assert.equal(officerUser.role, "SOLAR_OFFICER");

  const login = await api({
    method: "POST",
    path: "/api/auth/login",
    body: { email: "field-officer@example.test", password: "officer123" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, "SOLAR_OFFICER");

  const solarPackage = await SolarPackage.create({
    name: "Officer Test Solar",
    capacityKw: 2,
    cashPrice: 100,
    financedPrice: 100,
    depositPercent: 20,
    installmentMonths: 2,
    interestPercent: 0,
    repaymentFrequency: "MONTHLY",
    stock: 3,
    active: true,
    createdBy: admin._id,
  });
  const snapshot = {
    name: solarPackage.name,
    cashPrice: 100,
    financedPrice: 100,
    depositPercent: 20,
    installmentMonths: 2,
    interestPercent: 0,
    repaymentFrequency: "MONTHLY",
  };
  const application = await SolarApplication.create({
    customer: customer._id,
    package: solarPackage._id,
    packageSnapshot: snapshot,
    profileSnapshot: {
      fullName: customer.fullName,
      phone: customer.phone,
      email: customer.email,
      state: customer.state,
      lga: customer.lga,
      address: customer.address,
    },
    status: "SUBMITTED",
    statusHistory: [{ status: "SUBMITTED", changedBy: customer._id }],
  });
  const hiddenApplication = await SolarApplication.create({
    customer: otherCustomer._id,
    package: solarPackage._id,
    packageSnapshot: snapshot,
    profileSnapshot: { fullName: otherCustomer.fullName, phone: otherCustomer.phone },
    status: "SUBMITTED",
    statusHistory: [{ status: "SUBMITTED", changedBy: otherCustomer._id }],
  });

  const assigned = await api({
    method: "POST",
    path: `/api/solar/officer/admin/applications/${application._id}/assign`,
    actor: admin,
    body: { officerId: createOfficer.body.officer._id },
  });
  assert.equal(assigned.status, 201);

  const assignedApplications = await api({
    path: "/api/solar/officer/applications",
    actor: officerUser,
  });
  assert.equal(assignedApplications.status, 200);
  assert.equal(assignedApplications.body.applications.length, 1);
  assert.equal(assignedApplications.body.applications[0]._id, String(application._id));

  const hidden = await api({
    path: `/api/solar/officer/applications/${hiddenApplication._id}`,
    actor: officerUser,
  });
  assert.equal(hidden.status, 404);

  const verification = await api({
    method: "POST",
    path: `/api/solar/officer/applications/${application._id}/verification`,
    actor: officerUser,
    body: {
      checklist: {
        identityConfirmed: true,
        phoneConfirmed: true,
        addressConfirmed: true,
        locationConfirmed: true,
        customerContacted: true,
        requirementConfirmed: true,
        repaymentAssessed: true,
        kycReviewed: true,
      },
      recommendation: "VERIFIED_RECOMMENDED",
      notes: "Customer verified in the field.",
    },
  });
  assert.equal(verification.status, 201);
  assert.equal(verification.body.verification.recommendation, "VERIFIED_RECOMMENDED");

  const officerCannotApprove = await api({
    method: "PATCH",
    path: `/api/solar/admin/applications/${application._id}/approve`,
    actor: officerUser,
    body: { approvedPrice: 100 },
  });
  assert.equal(officerCannotApprove.status, 403);

  const approval = await api({
    method: "PATCH",
    path: `/api/solar/admin/applications/${application._id}/approve`,
    actor: admin,
    body: { approvedPrice: 100 },
  });
  assert.equal(approval.status, 200);
  assert.equal(approval.body.application.status, "AWAITING_DEPOSIT");

  const firstDeposit = await api({
    method: "POST",
    path: `/api/solar/applications/${application._id}/pay-deposit`,
    actor: customer,
    headers: { "Idempotency-Key": "solar-officer-deposit-1" },
    body: { amount: 10, transactionPin: "1234" },
  });
  assert.equal(firstDeposit.status, 201);
  assert.equal(
    await SolarOfficerCommission.countDocuments({
      application: application._id,
      commissionType: "SOLAR_DEPOSIT_5_PERCENT",
    }),
    0
  );
  const secondDeposit = await api({
    method: "POST",
    path: `/api/solar/applications/${application._id}/pay-deposit`,
    actor: customer,
    headers: { "Idempotency-Key": "solar-officer-deposit-2" },
    body: { amount: 10, transactionPin: "1234" },
  });
  assert.equal(secondDeposit.status, 201);
  const depositCommissions = await SolarOfficerCommission.find({
    application: application._id,
    commissionType: "SOLAR_DEPOSIT_5_PERCENT",
  });
  assert.equal(depositCommissions.length, 1);
  assert.equal(
    depositCommissions.reduce((sum, item) => sum + item.baseAmount, 0),
    20
  );
  assert.equal(
    depositCommissions.reduce((sum, item) => sum + item.commissionAmount, 0),
    1
  );
  const replayedDeposit = await api({
    method: "POST",
    path: `/api/solar/applications/${application._id}/pay-deposit`,
    actor: customer,
    headers: { "Idempotency-Key": "solar-officer-deposit-1" },
    body: { amount: 10, transactionPin: "1234" },
  });
  assert.equal(replayedDeposit.status, 200);
  assert.equal(
    await SolarOfficerCommission.countDocuments({
      application: application._id,
      commissionType: "SOLAR_DEPOSIT_5_PERCENT",
    }),
    1
  );

  const install = await api({
    method: "POST",
    path: `/api/solar/admin/applications/${application._id}/install`,
    actor: admin,
    body: {
      installedAt: new Date().toISOString(),
      installerName: "Approved Installer",
      installationAddress: customer.address,
      installationNotes: "Handover complete.",
      handover: {
        recipientName: customer.fullName,
        acceptedAt: new Date().toISOString(),
      },
    },
  });
  assert.equal(install.status, 201);
  const saleCommission = await SolarOfficerCommission.findOne({
    application: application._id,
    commissionType: "SOLAR_SALE_2_PERCENT",
  });
  assert.equal(saleCommission.baseAmount, 100);
  assert.equal(saleCommission.commissionAmount, 2);
  assert.equal(await SolarOfficerCommission.countDocuments({ application: application._id }), 2);

  const duplicateInstall = await api({
    method: "POST",
    path: `/api/solar/admin/applications/${application._id}/install`,
    actor: admin,
    body: {
      installedAt: new Date().toISOString(),
      handover: { recipientName: customer.fullName, acceptedAt: new Date().toISOString() },
    },
  });
  assert.equal(duplicateInstall.status, 409);
  assert.equal(await SolarOfficerCommission.countDocuments({ application: application._id }), 2);

  const repaymentView = await api({
    path: "/api/solar/officer/repayments",
    actor: officerUser,
  });
  assert.equal(repaymentView.status, 200);
  assert.equal(repaymentView.body.repayments.length, 1);

  const followUp = await api({
    method: "POST",
    path: `/api/solar/officer/applications/${application._id}/follow-ups`,
    actor: officerUser,
    body: {
      contactMethod: "PHONE",
      notes: "Customer confirmed the next repayment date.",
      outcome: "PROMISE_TO_PAY",
      promiseToPayDate: new Date(Date.now() + 86400000).toISOString(),
    },
  });
  assert.equal(followUp.status, 201);

  const withdrawal = await api({
    method: "POST",
    path: "/api/solar/officer/withdrawals",
    actor: officerUser,
    body: {
      amount: 2.5,
      bankCode: "000",
      bankName: "Test Bank",
      accountNumber: "0123456789",
      accountName: "Field Solar Officer",
    },
  });
  assert.equal(withdrawal.status, 201);
  let wallet = await SolarOfficerWallet.findOne({ officer: createOfficer.body.officer._id });
  assert.equal(wallet.availableBalance, 0.5);
  assert.equal(wallet.lockedBalance, 2.5);

  const approveWithdrawal = await api({
    method: "PATCH",
    path: `/api/solar/officer/admin/withdrawals/${withdrawal.body.withdrawal._id}/approve`,
    actor: admin,
    body: { note: "Approved for settlement." },
  });
  assert.equal(approveWithdrawal.status, 200);

  const doubleApprove = await api({
    method: "PATCH",
    path: `/api/solar/officer/admin/withdrawals/${withdrawal.body.withdrawal._id}/approve`,
    actor: admin,
  });
  assert.equal(doubleApprove.status, 409);

  const paidWithdrawal = await api({
    method: "PATCH",
    path: `/api/solar/officer/admin/withdrawals/${withdrawal.body.withdrawal._id}/paid`,
    actor: admin,
  });
  assert.equal(paidWithdrawal.status, 200);
  wallet = await SolarOfficerWallet.findOne({ officer: createOfficer.body.officer._id });
  assert.equal(wallet.lockedBalance, 0);
  assert.equal(wallet.totalWithdrawn, 2.5);
  const adminPerformance = await api({
    path: `/api/solar/officer/admin/officers/${createOfficer.body.officer._id}/performance`,
    actor: admin,
  });
  assert.equal(adminPerformance.status, 200);
  assert.equal(adminPerformance.body.performance.solarUnitsSold, 1);
  assert.equal(adminPerformance.body.performance.totalSalesValue, 100);

  const secondOfficerResponse = await api({
    method: "POST",
    path: "/api/solar/officer/admin/officers",
    actor: admin,
    body: {
      fullName: "Replacement Solar Officer",
      phone: "08069990002",
      email: "replacement-officer@example.test",
      password: "officer123",
      state: "Lagos",
      lga: "Surulere",
      address: "3 Officer Street",
    },
  });
  assert.equal(secondOfficerResponse.status, 201);
  const reassigned = await api({
    method: "POST",
    path: `/api/solar/officer/admin/applications/${application._id}/assign`,
    actor: admin,
    body: { officerId: secondOfficerResponse.body.officer._id },
  });
  assert.equal(reassigned.status, 201);
  const staleVerification = await api({
    method: "POST",
    path: `/api/solar/officer/applications/${application._id}/verification`,
    actor: officerUser,
    body: {
      checklist: {},
      recommendation: "NEEDS_REVIEW",
      notes: "This stale officer write must not be accepted.",
    },
  });
  assert.equal(staleVerification.status, 404);
  const staleHandover = await api({
    method: "POST",
    path: `/api/solar/officer/applications/${application._id}/handover`,
    actor: officerUser,
    body: { handoverNotes: "Stale handover" },
  });
  assert.equal(staleHandover.status, 404);
  const staleFollowUp = await api({
    method: "POST",
    path: `/api/solar/officer/applications/${application._id}/follow-ups`,
    actor: officerUser,
    body: {
      contactMethod: "PHONE",
      notes: "Stale follow-up",
      outcome: "CONTACTED",
    },
  });
  assert.equal(staleFollowUp.status, 404);

  const customerForbidden = await api({
    path: "/api/solar/officer/dashboard",
    actor: customer,
  });
  assert.equal(customerForbidden.status, 403);
  const adminSurfaceForbidden = await api({
    path: "/api/solar/officer/admin/officers",
    actor: officerUser,
  });
  assert.equal(adminSurfaceForbidden.status, 403);
});