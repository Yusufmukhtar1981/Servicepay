const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const authRoutes = require("../routes/auth.routes");
const solarRoutes = require("../routes/solar.routes");
const solarOfficerRoutes = require("../routes/solarOfficer.routes");
const solarOfficerController = require("../controllers/solarOfficer.controller");
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

test("customer application reaches Admin assignment and the assigned Solar Officer", async () => {
  const admin = await createUser({ role: "HEAD_OFFICE" });
  const customer = await createUser();
  const createdOfficer = await api({
    method: "POST",
    path: "/api/solar/officer/admin/officers",
    actor: admin,
    body: {
      fullName: "Customer Flow Officer",
      phone: "08069991001",
      email: "customer-flow-officer@example.test",
      password: "officer123",
      state: "Lagos",
      lga: "Ikeja",
      address: "5 Solar Operations Road",
    },
  });
  assert.equal(createdOfficer.status, 201, createdOfficer.body?.message);
  const officerUser = await User.findOne({
    email: "customer-flow-officer@example.test",
  });
  const solarPackage = await SolarPackage.create({
    name: "Customer Flow Solar",
    capacityKw: 2,
    cashPrice: 850000,
    financedPrice: 900000,
    depositPercent: 20,
    installmentMonths: 12,
    interestPercent: 0,
    repaymentFrequency: "MONTHLY",
    stock: 5,
    active: true,
    createdBy: admin._id,
  });

  const submitted = await api({
    method: "POST",
    path: "/api/solar/applications",
    actor: customer,
    body: {
      packageId: String(solarPackage._id),
      fullName: "Amina Solar Customer",
      phone: "08030000000",
      email: "amina-solar@example.test",
      residentialAddress: "12 Solar Installation Street",
      state: "Ogun",
      lga: "Abeokuta South",
      business: {
        occupationBusiness: "Food retail business",
        monthlyIncomeRange: "₦100,001 - ₦250,000",
        preferredRepaymentPeriod: "12",
        upfrontPaymentOption: "Standard package deposit",
      },
      applicationPreferences: {
        occupationBusiness: "Food retail business",
        monthlyIncomeRange: "₦100,001 - ₦250,000",
        preferredRepaymentPeriod: "12",
        upfrontPaymentOption: "Standard package deposit",
      },
      declarations: {
        informationAccurate: true,
        termsAccepted: true,
        recoveryAgreementAccepted: true,
      },
    },
  });
  assert.equal(submitted.status, 201, submitted.body?.message);
  const applicationId = submitted.body.application._id;
  assert.equal(
    submitted.body.application.applicationPreferences.monthlyIncomeRange,
    "₦100,001 - ₦250,000"
  );
  assert.deepEqual(submitted.body.application.profileSnapshot, {
    fullName: "Amina Solar Customer",
    phone: "08030000000",
    email: "amina-solar@example.test",
    state: "Ogun",
    lga: "Abeokuta South",
    address: "12 Solar Installation Street",
  });

  const customerApplications = await api({
    path: "/api/solar/my-applications",
    actor: customer,
  });
  assert.equal(customerApplications.status, 200);
  assert.equal(customerApplications.body.applications.length, 1);
  assert.equal(
    customerApplications.body.applications[0].applicationPreferences
      .preferredRepaymentPeriod,
    "12"
  );

  const adminApplications = await api({
    path: "/api/solar/admin/applications",
    actor: admin,
  });
  assert.equal(adminApplications.status, 200);
  assert.equal(adminApplications.body.applications.length, 1);
  assert.equal(
    adminApplications.body.applications[0].applicationPreferences
      .upfrontPaymentOption,
    "Standard package deposit"
  );

  const assigned = await api({
    method: "POST",
    path: `/api/solar/officer/admin/applications/${applicationId}/assign`,
    actor: admin,
    body: { officerId: createdOfficer.body.officer._id },
  });
  assert.equal(assigned.status, 201, assigned.body?.message);

  const officerApplications = await api({
    path: "/api/solar/officer/applications",
    actor: officerUser,
  });
  assert.equal(officerApplications.status, 200);
  assert.equal(officerApplications.body.applications.length, 1);
  assert.equal(
    officerApplications.body.applications[0].customer.fullName,
    customer.fullName
  );
  assert.equal(
    officerApplications.body.applications[0].applicationPreferences
      .occupationBusiness,
    "Food retail business"
  );
  assert.equal(
    officerApplications.body.applications[0].profileSnapshot.address,
    "12 Solar Installation Street"
  );
});

test("customer application rejects malformed or incomplete preferences", async () => {
  const admin = await createUser({ role: "HEAD_OFFICE" });
  const customer = await createUser();
  const solarPackage = await SolarPackage.create({
    name: "Validation Solar",
    capacityKw: 1,
    cashPrice: 400000,
    depositPercent: 20,
    installmentMonths: 12,
    interestPercent: 0,
    repaymentFrequency: "MONTHLY",
    stock: 5,
    active: true,
    createdBy: admin._id,
  });
  const baseBody = {
    packageId: String(solarPackage._id),
    declarations: {
      informationAccurate: true,
      termsAccepted: true,
      recoveryAgreementAccepted: true,
    },
  };
  const invalidPreferences = [
    {},
    {
      occupationBusiness: "Retail",
      monthlyIncomeRange: "Any amount",
      preferredRepaymentPeriod: "12",
      upfrontPaymentOption: "Standard package deposit",
    },
    {
      occupationBusiness: "Retail",
      monthlyIncomeRange: "₦50,000 - ₦100,000",
      preferredRepaymentPeriod: "121",
      upfrontPaymentOption: "Standard package deposit",
    },
    {
      occupationBusiness: "Retail",
      monthlyIncomeRange: "₦50,000 - ₦100,000",
      preferredRepaymentPeriod: "12",
      upfrontPaymentOption: "No deposit",
    },
  ];

  for (const applicationPreferences of invalidPreferences) {
    const response = await api({
      method: "POST",
      path: "/api/solar/applications",
      actor: customer,
      body: { ...baseBody, applicationPreferences },
    });
    assert.equal(response.status, 400);
  }
  assert.equal(await SolarApplication.countDocuments(), 0);
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

test("Branch staff cannot list or transition another branch's Solar withdrawal", async () => {
  const branchA = new mongoose.Types.ObjectId();
  const branchB = new mongoose.Types.ObjectId();
  const creator = await createUser({ role: "HEAD_OFFICE" });
  const officerUser = await createUser({ role: "SOLAR_OFFICER" });
  const officer = await SolarOfficer.create({
    user: officerUser._id, officerId: "SSO-BRANCH-TEST", state: "Lagos",
    lga: "Ikeja", address: "1 Branch Road", createdBy: creator._id, branchId: branchB,
  });
  const makeWithdrawal = () => SolarOfficerWithdrawal.create({
    officer: officer._id, branchId: branchB, reference: `SSW-${new mongoose.Types.ObjectId()}`,
    amount: 10, bankCode: "000", bankName: "Bank", accountNumber: "0123456789", accountName: "Officer",
  });
  const call = async (handler, withdrawalId = null) => {
    const result = {};
    const req = {
      user: { _id: creator._id, role: "STAFF", branchId: branchA },
      staffAccess: { isHeadOffice: false, scope: { type: "BRANCH", branchId: branchA } },
      params: withdrawalId ? { withdrawalId: String(withdrawalId) } : {},
      query: {}, body: {},
    };
    const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
    await handler(req, res);
    return { status: result.status || 200, body: result.body };
  };

  const listed = await call(solarOfficerController.adminListWithdrawals);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.withdrawals.length, 0);
  for (const handler of [
    solarOfficerController.adminApproveWithdrawal,
    solarOfficerController.adminRejectWithdrawal,
    solarOfficerController.adminPayWithdrawal,
  ]) {
    const withdrawal = await makeWithdrawal();
    const response = await call(handler, withdrawal._id);
    assert.equal(response.status, 404);
    assert.equal((await SolarOfficerWithdrawal.findById(withdrawal._id)).status, "PENDING");
  }
});