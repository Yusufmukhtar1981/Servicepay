const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  normalizePhone,
  asMoney,
  isAdmin,
  isProgramEligibleOrganization,
  listOrganizations,
  updateOrganizationStatus,
  createProgram: createProgramHandler,
  applyForProgram,
  bulkAddBeneficiaries,
  fundProgram,
  verifyBeneficiary,
  updateBeneficiaryStatus,
  disburseProgram,
  disburseBeneficiary,
  listDisbursementBatches,
  listPrograms,
  getProgramStatistics,
  getProgramReport,
  getEmpowermentDashboardSummary,
} = require("../controllers/empowerment.controller");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentBeneficiary = require("../models/empowermentBeneficiary.model");
const EmpowermentFunding = require("../models/empowermentFunding.model");
const Transaction = require("../models/transaction.model");
const EmpowermentPayout = require("../models/empowermentPayout.model");
const EmpowermentDisbursement = require(
  "../models/empowermentDisbursement.model"
);
const EmpowermentAuditLog = require("../models/empowermentAuditLog.model");
const LedgerEntry = require("../models/ledgerEntry.model");

let mongo;

const databaseModels = [
  User,
  KycProfile,
  EmpowermentOrganization,
  EmpowermentProgram,
  EmpowermentBeneficiary,
  EmpowermentFunding,
  EmpowermentDisbursement,
  EmpowermentPayout,
  EmpowermentAuditLog,
  Transaction,
  LedgerEntry,
];

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "empowerment-integration-tests",
  });
  await Promise.all(databaseModels.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(
    databaseModels.map((model) => model.collection.deleteMany({}))
  );
});

const request = ({
  user,
  body = {},
  params = {},
  query = {},
  headers = {},
}) => ({
  user,
  body,
  params,
  query,
  get(name) {
    const key = Object.keys(headers).find(
      (header) => header.toLowerCase() === name.toLowerCase()
    );
    return key ? headers[key] : undefined;
  },
});

const call = async (handler, options) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };

  await handler(request(options), res);
  return result;
};

let userSequence = 0;

const createUser = async ({
  role = "CUSTOMER",
  status = "ACTIVE",
  walletBalance = 0,
  transactionPin,
  state = "Lagos",
} = {}) => {
  userSequence += 1;
  return User.create({
    fullName: `Empowerment Test User ${userSequence}`,
    phone: `0803000${String(userSequence).padStart(5, "0")}`,
    email: `empowerment-${userSequence}@example.com`,
    password: "password123",
    transactionPin,
    role,
    status,
    state,
    lga: "Ikeja",
    walletBalance,
  });
};

const createKyc = (user, status = "VERIFIED") =>
  KycProfile.create({
    user: user._id,
    status,
    level: "TIER_2",
    requestedLevel: "TIER_2",
    firstName: user.fullName.split(" ")[0],
    lastName: "User",
    phone: user.phone,
    state: user.state,
  });

const createProgram = async ({
  owner,
  organization,
  targetBeneficiaries = 1,
  amountPerBeneficiary = 100,
  status = "OPEN",
  publicApplicationEnabled = false,
  availableFundingAmount = 0,
  totalFundedAmount = 0,
} = {}) => {
  const org =
    organization ||
    (await EmpowermentOrganization.create({
      name: "Test Empowerment Organization",
      organizationType: "NGO",
      registrationNumber: `NGO-${userSequence + 1}`,
      contactName: owner.fullName,
      phone: owner.phone,
      email: owner.email,
      address: "1 Test Street",
      state: owner.state,
      status: "ACTIVE",
      createdBy: owner._id,
    }));

  return EmpowermentProgram.create({
    organization: org._id,
    name: "Concurrent Empowerment Grant",
    state: owner.state,
    amountPerBeneficiary,
    targetBeneficiaries,
    beneficiaryCount: 0,
    totalFundedAmount,
    availableFundingAmount,
    status,
    publicApplicationEnabled,
    createdBy: owner._id,
  });
};

const createBeneficiary = async ({
  program,
  user,
  applicationStatus = "APPROVED",
  verificationStatus = "VERIFIED",
  kycStatus = "VERIFIED",
} = {}) =>
  EmpowermentBeneficiary.create({
    program: program._id,
    user: user._id,
    fullName: user.fullName,
    phone: user.phone,
    normalizedPhone: user.phone,
    email: user.email,
    state: user.state,
    lga: user.lga,
    kycReference: "test-kyc-reference",
    kycStatus,
    verificationStatus,
    applicationStatus,
    amount: program.amountPerBeneficiary,
  });

const programForPayout = async () => {
  const owner = await createUser({
    role: "HEAD_OFFICE",
    walletBalance: 1_000,
    transactionPin: "1234",
  });
  const recipient = await createUser({ walletBalance: 25 });
  await createKyc(recipient);
  const program = await createProgram({
    owner,
    status: "APPROVED",
    targetBeneficiaries: 1,
    amountPerBeneficiary: 100,
    availableFundingAmount: 100,
    totalFundedAmount: 100,
  });
  const beneficiary = await createBeneficiary({ program, user: recipient });
  await EmpowermentProgram.updateOne(
    { _id: program._id },
    { $set: { beneficiaryCount: 1, totalApproved: 1 } }
  );
  return { owner, recipient, program, beneficiary };
};

test("Empowerment normalizes Nigerian beneficiary phone numbers", () => {
  assert.equal(normalizePhone("+234 803 123 4567"), "08031234567");
  assert.equal(normalizePhone("2348031234567"), "08031234567");
  assert.equal(normalizePhone("0803-123-4567"), "08031234567");
});

test("Empowerment funding rejects zero, negative and malformed amounts", () => {
  assert.equal(asMoney(0), null);
  assert.equal(asMoney(-500), null);
  assert.equal(asMoney("not-money"), null);
  assert.equal(asMoney("1200.456"), 1200.46);
});

test("Empowerment transaction and payout schemas enforce auditable records", () => {
  const serviceTypes = Transaction.schema.path("serviceType").enumValues;
  assert.ok(serviceTypes.includes("EMPOWERMENT_FUNDING"));
  assert.ok(serviceTypes.includes("EMPOWERMENT_DISBURSEMENT"));

  const payoutIndex = EmpowermentPayout.schema.indexes().find(
    ([keys, options]) =>
      keys.program === 1 &&
      keys.beneficiary === 1 &&
      options.unique === true
  );
  assert.ok(payoutIndex, "program/beneficiary payout must be unique");

  assert.equal(
    EmpowermentDisbursement.schema.path("idempotencyKey").isRequired,
    true
  );
});

test("organization verification is admin-only and controls program eligibility", async () => {
  const owner = await createUser();
  const otherCustomer = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE" });
  const organization = await EmpowermentOrganization.create({
    name: "Pending Organization",
    organizationType: "NGO",
    registrationNumber: "PENDING-NGO-001",
    contactName: owner.fullName,
    phone: owner.phone,
    email: owner.email,
    address: "1 Pending Street",
    state: owner.state,
    status: "PENDING",
    createdBy: owner._id,
  });

  const unauthorized = await call(updateOrganizationStatus, {
    user: owner,
    params: { id: String(organization._id) },
    body: { status: "ACTIVE" },
  });
  assert.equal(unauthorized.status, 403);
  assert.equal(
    (await EmpowermentOrganization.findById(organization._id)).status,
    "PENDING"
  );

  const pendingEligible = await call(listOrganizations, {
    user: owner,
    query: { eligible: "true" },
  });
  assert.equal(pendingEligible.status, 200);
  assert.equal(pendingEligible.body.organizations.length, 0);

  const approved = await call(updateOrganizationStatus, {
    user: admin,
    params: { id: String(organization._id) },
    body: { status: "ACTIVE" },
  });
  assert.equal(approved.status, 200);
  const activeOrganization = await EmpowermentOrganization.findById(
    organization._id
  );
  assert.equal(activeOrganization.status, "ACTIVE");
  assert.equal(String(activeOrganization.verification.verifiedBy), String(admin._id));
  assert.equal(isProgramEligibleOrganization(activeOrganization), true);
  assert.equal(isAdmin(admin), true);
  assert.equal(
    await EmpowermentAuditLog.countDocuments({
      entityId: organization._id,
      action: "ORGANIZATION_STATUS_UPDATED",
    }),
    1
  );

  const activeEligible = await call(listOrganizations, {
    user: owner,
    query: { eligible: "true" },
  });
  assert.equal(activeEligible.status, 200);
  assert.equal(activeEligible.body.organizations.length, 1);
  assert.equal(
    String(activeEligible.body.organizations[0]._id),
    String(organization._id)
  );

  const ownerProgram = await call(createProgramHandler, {
    user: owner,
    body: {
      organizationId: String(organization._id),
      name: "Owner Eligible Program",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 2,
      state: owner.state,
    },
  });
  assert.equal(ownerProgram.status, 201);

  const foreignOwnerProgram = await call(createProgramHandler, {
    user: otherCustomer,
    body: {
      organizationId: String(organization._id),
      name: "Unauthorized Program",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 2,
      state: otherCustomer.state,
    },
  });
  assert.equal(foreignOwnerProgram.status, 403);
});

test("rejected and suspended organizations cannot create programs", async () => {
  const owner = await createUser();
  const admin = await createUser({ role: "HEAD_OFFICE" });
  const organization = await EmpowermentOrganization.create({
    name: "Organization Lifecycle Test",
    organizationType: "NGO",
    registrationNumber: "LIFECYCLE-NGO-001",
    contactName: owner.fullName,
    phone: owner.phone,
    email: owner.email,
    address: "2 Lifecycle Street",
    state: owner.state,
    status: "PENDING",
    createdBy: owner._id,
  });

  const reject = await call(updateOrganizationStatus, {
    user: admin,
    params: { id: String(organization._id) },
    body: { status: "REJECTED" },
  });
  assert.equal(reject.status, 200);
  const rejectedProgram = await call(createProgramHandler, {
    user: owner,
    body: {
      organizationId: String(organization._id),
      name: "Rejected Organization Program",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 1,
      state: owner.state,
    },
  });
  assert.equal(rejectedProgram.status, 409);

  await call(updateOrganizationStatus, {
    user: admin,
    params: { id: String(organization._id) },
    body: { status: "ACTIVE" },
  });
  const suspend = await call(updateOrganizationStatus, {
    user: admin,
    params: { id: String(organization._id) },
    body: { status: "SUSPENDED" },
  });
  assert.equal(suspend.status, 200);
  const suspendedProgram = await call(createProgramHandler, {
    user: owner,
    body: {
      organizationId: String(organization._id),
      name: "Suspended Organization Program",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 1,
      state: owner.state,
    },
  });
  assert.equal(suspendedProgram.status, 409);
});

test(
  "concurrent self-applications reserve one beneficiary slot",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser();
    const applicant = await createUser();
    await createKyc(applicant);
    const program = await createProgram({
      owner,
      targetBeneficiaries: 1,
      publicApplicationEnabled: true,
    });

    const options = {
      user: applicant,
      params: { programId: String(program._id) },
      body: { state: "Lagos", eligibilityDeclaration: "I qualify." },
    };
    const responses = await Promise.all([
      call(applyForProgram, options),
      call(applyForProgram, options),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    assert.equal(
      await EmpowermentBeneficiary.countDocuments({ program: program._id }),
      1
    );
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedProgram.beneficiaryCount, 1);
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        program: program._id,
        action: "BENEFICIARY_APPLIED",
      }),
      1
    );
  }
);

test(
  "concurrent bulk intake cannot overfill program capacity",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser();
    const program = await createProgram({
      owner,
      targetBeneficiaries: 2,
    });
    const makeRows = (prefix) =>
      [1, 2].map((index) => ({
        fullName: `${prefix} Beneficiary ${index}`,
        phone: `0803999${prefix === "A" ? "1" : "2"}${index}000`,
        state: "Lagos",
      }));

    const responses = await Promise.all(
      ["A", "B"].map((prefix) =>
        call(bulkAddBeneficiaries, {
          user: owner,
          params: { programId: String(program._id) },
          body: { beneficiaries: makeRows(prefix) },
        })
      )
    );

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    assert.equal(
      await EmpowermentBeneficiary.countDocuments({ program: program._id }),
      2
    );
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedProgram.beneficiaryCount, 2);
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        program: program._id,
        action: "BENEFICIARIES_BULK_ADDED",
      }),
      1
    );
  }
);

test(
  "funding retry is idempotent and preserves wallet, ledger and program totals",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 1_000,
      transactionPin: "1234",
    });
    const program = await createProgram({
      owner,
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      status: "APPROVED",
    });
    const options = {
      user: owner,
      params: { programId: String(program._id) },
      body: { amount: 100, transactionPin: "1234" },
      headers: { "Idempotency-Key": "funding-retry-1234" },
    };

    const first = await call(fundProgram, options);
    const retry = await call(fundProgram, options);

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    assert.equal(String(retry.body.funding._id), String(first.body.funding._id));

    const savedOwner = await User.findById(owner._id);
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedOwner.walletBalance, 900);
    assert.equal(await EmpowermentFunding.countDocuments(), 1);
    assert.equal(
      await Transaction.countDocuments({ serviceType: "EMPOWERMENT_FUNDING" }),
      1
    );
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_FUNDING",
        direction: "DEBIT",
      }),
      1
    );
    assert.equal(savedProgram.totalFundedAmount, 100);
    assert.equal(savedProgram.availableFundingAmount, 100);
    const transaction = await Transaction.findOne({
      serviceType: "EMPOWERMENT_FUNDING",
    });
    const ledger = await LedgerEntry.findOne({
      service: "EMPOWERMENT_FUNDING",
    });
    assert.equal(String(first.body.funding.transaction), String(transaction._id));
    assert.equal(first.body.funding.reference, transaction.reference);
    assert.equal(ledger.reference, transaction.reference);
    assert.equal(String(ledger.transactionId), String(transaction._id));
  }
);

test(
  "simultaneous funding retries share one debit, funding record and ledger row",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 1_000,
      transactionPin: "1234",
    });
    const program = await createProgram({
      owner,
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      status: "APPROVED",
    });
    const options = {
      user: owner,
      params: { programId: String(program._id) },
      body: { amount: 100, transactionPin: "1234" },
      headers: { "Idempotency-Key": "concurrent-funding-1234" },
    };

    const responses = await Promise.all([
      call(fundProgram, options),
      call(fundProgram, options),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 201]
    );
    assert.equal(
      String(responses[0].body.funding._id),
      String(responses[1].body.funding._id)
    );
    assert.equal((await User.findById(owner._id)).walletBalance, 900);
    assert.equal(await EmpowermentFunding.countDocuments(), 1);
    assert.equal(
      await Transaction.countDocuments({ serviceType: "EMPOWERMENT_FUNDING" }),
      1
    );
    assert.equal(
      await LedgerEntry.countDocuments({ service: "EMPOWERMENT_FUNDING" }),
      1
    );
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedProgram.totalFundedAmount, 100);
    assert.equal(savedProgram.availableFundingAmount, 100);
  }
);

test(
  "Head Office can top up an approved ₦1,000 program and report an exactly-once payout",
  { timeout: 120_000 },
  async () => {
    const headOffice = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 5_000,
      transactionPin: "1234",
    });
    const recipient = await createUser({ walletBalance: 25 });
    await createKyc(recipient);
    const program = await createProgram({
      owner: headOffice,
      status: "APPROVED",
      targetBeneficiaries: 2,
      amountPerBeneficiary: 1_000,
    });
    const beneficiary = await createBeneficiary({ program, user: recipient });
    await EmpowermentProgram.updateOne(
      { _id: program._id },
      { $set: { beneficiaryCount: 1, totalApproved: 1 } }
    );

    const fundingRequests = [
      { amount: 1_000, key: "approved-program-funding-1000" },
      { amount: 1_000, key: "approved-program-topup-1000" },
    ];
    for (let index = 0; index < fundingRequests.length; index += 1) {
      const fundingRequest = fundingRequests[index];
      const response = await call(fundProgram, {
        user: headOffice,
        params: { programId: String(program._id) },
        body: {
          amount: fundingRequest.amount,
          transactionPin: "1234",
        },
        headers: { "Idempotency-Key": fundingRequest.key },
      });
      assert.equal(response.status, 201);
      assert.equal(response.body.financials.fundedAmount, (index + 1) * 1_000);
    }

    const fundedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(fundedProgram.totalBudget, 2_000);
    assert.equal(fundedProgram.totalFundedAmount, 2_000);
    assert.equal(fundedProgram.availableFundingAmount, 2_000);
    assert.equal((await User.findById(headOffice._id)).walletBalance, 3_000);
    assert.equal(await EmpowermentFunding.countDocuments({ program: program._id }), 2);
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_FUNDING",
        direction: "DEBIT",
      }),
      2
    );
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        program: program._id,
        action: "PROGRAM_FUNDED",
      }),
      2
    );

    const [statistics, report, summary] = await Promise.all([
      call(getProgramStatistics, {
        user: headOffice,
        params: { programId: String(program._id) },
      }),
      call(getProgramReport, {
        user: headOffice,
        params: { programId: String(program._id) },
      }),
      call(getEmpowermentDashboardSummary, { user: headOffice }),
    ]);
    assert.equal(statistics.status, 200);
    assert.equal(statistics.body.statistics.total, 1);
    assert.equal(statistics.body.statistics.approved, 1);
    assert.equal(statistics.body.statistics.fundedAmount, 2_000);
    assert.equal(statistics.body.statistics.availableBalance, 2_000);
    assert.equal(report.status, 200);
    assert.equal(report.body.report.financials.totalBudget, 2_000);
    assert.equal(report.body.report.financials.fundedAmount, 2_000);
    assert.equal(report.body.report.financials.availableBalance, 2_000);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.summary.programs, 1);
    assert.equal(summary.body.summary.beneficiaryCount, 1);
    assert.equal(summary.body.summary.paidBeneficiaries, 0);
    assert.equal(summary.body.summary.financials.availableBalance, 2_000);

    const payoutOptions = {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(beneficiary._id),
      },
      body: {},
      headers: { "Idempotency-Key": "approved-program-payout-1000" },
    };
    const firstPayout = await call(disburseBeneficiary, payoutOptions);
    const payoutRetry = await call(disburseBeneficiary, payoutOptions);
    assert.equal(firstPayout.status, 201);
    assert.equal(payoutRetry.status, 200);
    assert.equal(payoutRetry.body.idempotent, true);
    assert.equal(
      String(firstPayout.body.batch._id),
      String(payoutRetry.body.batch._id)
    );

    const [
      paidProgram,
      paidRecipient,
      paidStatistics,
      paidReport,
      paidSummary,
      refreshedPrograms,
    ] =
      await Promise.all([
        EmpowermentProgram.findById(program._id),
        User.findById(recipient._id),
        call(getProgramStatistics, {
          user: headOffice,
          params: { programId: String(program._id) },
        }),
        call(getProgramReport, {
          user: headOffice,
          params: { programId: String(program._id) },
        }),
        call(getEmpowermentDashboardSummary, { user: headOffice }),
        call(listPrograms, { user: headOffice }),
      ]);
    assert.equal(paidRecipient.walletBalance, 1_025);
    assert.equal(paidProgram.availableFundingAmount, 1_000);
    assert.equal(paidProgram.totalDisbursedAmount, 1_000);
    assert.equal(paidProgram.totalPaid, 1);
    assert.equal(await EmpowermentPayout.countDocuments({ program: program._id }), 1);
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_DISBURSEMENT",
        direction: "CREDIT",
      }),
      1
    );
    assert.equal(paidStatistics.body.statistics.paid, 1);
    assert.equal(paidStatistics.body.statistics.availableBalance, 1_000);
    assert.equal(paidReport.body.report.financials.totalDisbursedAmount, 1_000);
    assert.equal(paidReport.body.report.financials.availableBalance, 1_000);
    assert.equal(paidSummary.body.summary.paidBeneficiaries, 1);
    assert.equal(paidSummary.body.summary.financials.availableBalance, 1_000);
    assert.equal(paidSummary.body.summary.totalDisbursed, 1_000);
    assert.equal(refreshedPrograms.status, 200);
    assert.equal(refreshedPrograms.body.programs[0].beneficiaryCounts.total, 1);
    assert.equal(refreshedPrograms.body.programs[0].beneficiaryCounts.approved, 0);
    assert.equal(refreshedPrograms.body.programs[0].beneficiaryCounts.paid, 1);
  }
);

test(
  "only Head Office can fund an approved Empowerment program",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser({
      walletBalance: 2_000,
      transactionPin: "1234",
    });
    const program = await createProgram({
      owner,
      status: "APPROVED",
      targetBeneficiaries: 1,
      amountPerBeneficiary: 1_000,
    });

    const response = await call(fundProgram, {
      user: owner,
      params: { programId: String(program._id) },
      body: { amount: 1_000, transactionPin: "1234" },
      headers: { "Idempotency-Key": "customer-program-funding-1000" },
    });

    assert.equal(response.status, 403);
    assert.equal((await User.findById(owner._id)).walletBalance, 2_000);
    assert.equal(await EmpowermentFunding.countDocuments(), 0);
    assert.equal(
      (await EmpowermentProgram.findById(program._id)).availableFundingAmount,
      0
    );
  }
);

test(
  "monetary idempotency keys cannot be reused for another program or beneficiary",
  { timeout: 120_000 },
  async () => {
    const headOffice = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 5_000,
      transactionPin: "1234",
    });
    const firstRecipient = await createUser();
    const secondRecipient = await createUser();
    await Promise.all([createKyc(firstRecipient), createKyc(secondRecipient)]);
    const program = await createProgram({
      owner: headOffice,
      status: "APPROVED",
      targetBeneficiaries: 2,
      amountPerBeneficiary: 1_000,
    });
    const otherProgram = await createProgram({
      owner: headOffice,
      status: "APPROVED",
      targetBeneficiaries: 1,
      amountPerBeneficiary: 1_000,
    });
    const [firstBeneficiary, secondBeneficiary] = await Promise.all([
      createBeneficiary({ program, user: firstRecipient }),
      createBeneficiary({ program, user: secondRecipient }),
    ]);

    const funding = await call(fundProgram, {
      user: headOffice,
      params: { programId: String(program._id) },
      body: { amount: 1_000, transactionPin: "1234" },
      headers: { "Idempotency-Key": "bound-funding-key-1000" },
    });
    assert.equal(funding.status, 201);
    const crossProgramFunding = await call(fundProgram, {
      user: headOffice,
      params: { programId: String(otherProgram._id) },
      body: { amount: 1_000, transactionPin: "1234" },
      headers: { "Idempotency-Key": "bound-funding-key-1000" },
    });
    assert.equal(crossProgramFunding.status, 409);
    assert.equal(
      (await EmpowermentProgram.findById(otherProgram._id)).availableFundingAmount,
      0
    );

    const firstPayout = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(firstBeneficiary._id),
      },
      body: {},
      headers: { "Idempotency-Key": "bound-payout-key-1000" },
    });
    assert.equal(firstPayout.status, 201);
    const secondPayout = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(secondBeneficiary._id),
      },
      body: {},
      headers: { "Idempotency-Key": "bound-payout-key-1000" },
    });
    assert.equal(secondPayout.status, 409);
    assert.equal((await User.findById(secondRecipient._id)).walletBalance, 0);
    assert.equal(await EmpowermentPayout.countDocuments({ program: program._id }), 1);
  }
);

test(
  "payout retry is idempotent and records one immutable wallet credit",
  { timeout: 120_000 },
  async () => {
    const { owner, recipient, program, beneficiary } =
      await programForPayout();
    const options = {
      user: owner,
      params: { programId: String(program._id) },
      body: {},
      headers: { "Idempotency-Key": "payout-retry-1234" },
    };

    const first = await call(disburseProgram, options);
    const retry = await call(disburseProgram, options);

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    assert.equal(String(retry.body.batch._id), String(first.body.batch._id));

    const savedRecipient = await User.findById(recipient._id);
    const savedProgram = await EmpowermentProgram.findById(program._id);
    const savedBeneficiary = await EmpowermentBeneficiary.findById(
      beneficiary._id
    );
    const payout = await EmpowermentPayout.findOne({
      beneficiary: beneficiary._id,
    });
    const transaction = await Transaction.findOne({
      serviceType: "EMPOWERMENT_DISBURSEMENT",
    });
    const ledger = await LedgerEntry.findOne({
      service: "EMPOWERMENT_DISBURSEMENT",
    });

    assert.equal(savedRecipient.walletBalance, 125);
    assert.equal(await EmpowermentPayout.countDocuments(), 1);
    assert.equal(await EmpowermentDisbursement.countDocuments(), 1);
    assert.equal(await Transaction.countDocuments(), 1);
    assert.equal(await LedgerEntry.countDocuments(), 1);
    assert.equal(savedProgram.availableFundingAmount, 0);
    assert.equal(savedProgram.totalDisbursedAmount, 100);
    assert.equal(savedProgram.totalPaid, 1);
    assert.equal(savedBeneficiary.applicationStatus, "PAID");
    assert.equal(String(payout.transaction), String(transaction._id));
    assert.equal(String(ledger.transactionId), String(transaction._id));
    assert.equal(payout.reference, transaction.reference);
    assert.equal(ledger.reference, transaction.reference);
    assert.equal(first.body.batch.results[0].transactionReference, payout.reference);
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        action: "PROGRAM_DISBURSED",
      }),
      1
    );

    await assert.rejects(
      LedgerEntry.updateOne(
        { _id: ledger._id },
        { $set: { narration: "tampered" } }
      ),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.updateMany(
        { _id: ledger._id },
        { $set: { narration: "tampered" } }
      ),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.findOneAndUpdate(
        { _id: ledger._id },
        { $set: { narration: "tampered" } }
      ),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.replaceOne(
        { _id: ledger._id },
        { ...ledger.toObject(), narration: "tampered" }
      ),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.findOneAndReplace(
        { _id: ledger._id },
        { ...ledger.toObject(), narration: "tampered" }
      ),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.deleteMany({ _id: ledger._id }),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.findOneAndDelete({ _id: ledger._id }),
      /immutable/
    );
    await assert.rejects(
      LedgerEntry.bulkWrite([
        {
          updateOne: {
            filter: { _id: ledger._id },
            update: { $set: { narration: "tampered" } },
          },
        },
      ]),
      /immutable/
    );
    ledger.narration = "tampered";
    await assert.rejects(ledger.save(), /immutable/);
    await assert.rejects(ledger.deleteOne(), /immutable/);
  }
);

test(
  "Head Office can disburse one approved verified beneficiary with auditable history",
  { timeout: 120_000 },
  async () => {
    const headOffice = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 1_000,
    });
    const recipient = await createUser({ walletBalance: 25 });
    const untouchedRecipient = await createUser({ walletBalance: 40 });
    await Promise.all([createKyc(recipient), createKyc(untouchedRecipient)]);
    const program = await createProgram({
      owner: headOffice,
      status: "APPROVED",
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      totalFundedAmount: 200,
      availableFundingAmount: 200,
    });
    const [beneficiary, untouchedBeneficiary] = await Promise.all([
      createBeneficiary({ program, user: recipient }),
      createBeneficiary({ program, user: untouchedRecipient }),
    ]);

    const first = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(beneficiary._id),
      },
      body: {},
      headers: { "Idempotency-Key": "single-payout-success-1234" },
    });
    assert.equal(first.status, 201);
    assert.equal(first.body.batch.results.length, 1);
    assert.equal(
      String(first.body.batch.organization),
      String(program.organization)
    );

    const [savedRecipient, savedUntouchedRecipient, savedBeneficiary, payout, transaction] =
      await Promise.all([
        User.findById(recipient._id),
        User.findById(untouchedRecipient._id),
        EmpowermentBeneficiary.findById(beneficiary._id),
        EmpowermentPayout.findOne({ beneficiary: beneficiary._id }),
        Transaction.findOne({ serviceType: "EMPOWERMENT_DISBURSEMENT" }),
      ]);
    assert.equal(savedRecipient.walletBalance, 125);
    assert.equal(savedUntouchedRecipient.walletBalance, 40);
    assert.equal(savedBeneficiary.applicationStatus, "PAID");
    assert.equal(
      (await EmpowermentBeneficiary.findById(untouchedBeneficiary._id))
        .applicationStatus,
      "APPROVED"
    );
    assert.equal(String(payout.program), String(program._id));
    assert.equal(String(payout.beneficiary), String(beneficiary._id));
    assert.equal(String(payout.recipient), String(recipient._id));
    assert.equal(payout.walletBalanceBefore, 25);
    assert.equal(payout.walletBalanceAfter, 125);
    assert.equal(
      transaction.providerResponse.organizationId,
      String(program.organization)
    );
    assert.equal(transaction.providerResponse.walletBalanceBefore, 25);
    assert.equal(transaction.providerResponse.walletBalanceAfter, 125);

    const history = await call(listDisbursementBatches, {
      user: headOffice,
      params: { programId: String(program._id) },
    });
    assert.equal(history.status, 200);
    assert.equal(history.body.batches.length, 1);
    assert.equal(history.body.summary.totalDisbursed, 100);
    assert.equal(history.body.summary.successfulCount, 1);
    assert.equal(history.body.summary.failedCount, 0);
    assert.equal(history.body.summary.pendingCount, 0);
    assert.equal(history.body.summary.remainingProgramFunding, 100);

    const duplicate = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(beneficiary._id),
      },
      body: {},
      headers: { "Idempotency-Key": "single-payout-success-1234" },
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.idempotent, true);
    assert.equal(await EmpowermentPayout.countDocuments(), 1);
    assert.equal((await User.findById(recipient._id)).walletBalance, 125);
  }
);

test(
  "single disbursement rejects non-admin, unverified, and unapproved beneficiaries",
  { timeout: 120_000 },
  async () => {
    const headOffice = await createUser({ role: "HEAD_OFFICE" });
    const customer = await createUser();
    const zonalManager = await createUser({ role: "ZONAL_MANAGER" });
    const stateManager = await createUser({ role: "STATE_MANAGER" });
    const program = await createProgram({
      owner: headOffice,
      status: "APPROVED",
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      totalFundedAmount: 200,
      availableFundingAmount: 200,
    });
    const unverified = await createBeneficiary({
      program,
      user: customer,
      verificationStatus: "PENDING",
    });
    const unapprovedUser = await createUser();
    const unapproved = await createBeneficiary({
      program,
      user: unapprovedUser,
      applicationStatus: "UNDER_REVIEW",
    });

    const unauthorized = await call(disburseBeneficiary, {
      user: customer,
      params: {
        programId: String(program._id),
        beneficiaryId: String(unverified._id),
      },
      body: {},
      headers: { "Idempotency-Key": "unauthorized-single-1234" },
    });
    assert.equal(unauthorized.status, 403);

    for (const manager of [zonalManager, stateManager]) {
      const managerResponse = await call(disburseBeneficiary, {
        user: manager,
        params: {
          programId: String(program._id),
          beneficiaryId: String(unverified._id),
        },
        body: {},
        headers: {
          "Idempotency-Key": `manager-denied-${String(manager._id).slice(-8)}`,
        },
      });
      assert.equal(managerResponse.status, 403);
    }

    const unverifiedResponse = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(unverified._id),
      },
      body: {},
      headers: { "Idempotency-Key": "unverified-single-1234" },
    });
    assert.equal(unverifiedResponse.status, 409);

    const unapprovedResponse = await call(disburseBeneficiary, {
      user: headOffice,
      params: {
        programId: String(program._id),
        beneficiaryId: String(unapproved._id),
      },
      body: {},
      headers: { "Idempotency-Key": "unapproved-single-1234" },
    });
    assert.equal(unapprovedResponse.status, 409);
    assert.equal(await EmpowermentPayout.countDocuments(), 0);
    assert.equal((await User.findById(customer._id)).walletBalance, 0);
    assert.equal((await User.findById(unapprovedUser._id)).walletBalance, 0);
  }
);

test(
  "simultaneous payout retries create one credit, one payout and one batch",
  { timeout: 120_000 },
  async () => {
    const { owner, recipient, program, beneficiary } =
      await programForPayout();
    const options = {
      user: owner,
      params: { programId: String(program._id) },
      body: {},
      headers: { "Idempotency-Key": "concurrent-payout-1234" },
    };

    const responses = await Promise.all([
      call(disburseProgram, options),
      call(disburseProgram, options),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 201]
    );
    assert.equal(
      String(responses[0].body.batch._id),
      String(responses[1].body.batch._id)
    );
    assert.equal((await User.findById(recipient._id)).walletBalance, 125);
    assert.equal(await EmpowermentDisbursement.countDocuments(), 1);
    assert.equal(await EmpowermentPayout.countDocuments(), 1);
    assert.equal(
      await Transaction.countDocuments({
        serviceType: "EMPOWERMENT_DISBURSEMENT",
      }),
      1
    );
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_DISBURSEMENT",
      }),
      1
    );
    assert.equal(
      (await EmpowermentBeneficiary.findById(beneficiary._id))
        .applicationStatus,
      "PAID"
    );
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedProgram.availableFundingAmount, 0);
    assert.equal(savedProgram.totalDisbursedAmount, 100);
    assert.equal(savedProgram.totalPaid, 1);
  }
);

test(
  "competing payout keys cannot double-credit the same beneficiary",
  { timeout: 120_000 },
  async () => {
    const { owner, recipient, program } = await programForPayout();
    const responses = await Promise.all(
      ["payout-race-left-1234", "payout-race-right-1234"].map(
        (idempotencyKey) =>
          call(disburseProgram, {
            user: owner,
            params: { programId: String(program._id) },
            body: {},
            headers: { "Idempotency-Key": idempotencyKey },
          })
      )
    );

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    assert.equal((await User.findById(recipient._id)).walletBalance, 125);
    assert.equal(await EmpowermentDisbursement.countDocuments(), 1);
    assert.equal(await EmpowermentPayout.countDocuments(), 1);
    assert.equal(
      await Transaction.countDocuments({
        serviceType: "EMPOWERMENT_DISBURSEMENT",
      }),
      1
    );
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_DISBURSEMENT",
      }),
      1
    );
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedProgram.availableFundingAmount, 0);
    assert.equal(savedProgram.totalDisbursedAmount, 100);
  }
);

test(
  "inactive organizations and recipients cannot receive a payout",
  { timeout: 120_000 },
  async () => {
    const { owner, recipient, program, beneficiary } =
      await programForPayout();
    await EmpowermentOrganization.updateOne(
      { _id: program.organization },
      { $set: { status: "SUSPENDED" } }
    );

    const inactiveOrganization = await call(disburseProgram, {
      user: owner,
      params: { programId: String(program._id) },
      body: {},
      headers: { "Idempotency-Key": "inactive-org-payout" },
    });
    assert.equal(inactiveOrganization.status, 409);
    assert.match(
      inactiveOrganization.body.message,
      /organization is not active/
    );
    assert.equal(await EmpowermentPayout.countDocuments(), 0);
    assert.equal((await User.findById(recipient._id)).walletBalance, 25);

    await EmpowermentOrganization.updateOne(
      { _id: program.organization },
      { $set: { status: "ACTIVE" } }
    );
    await User.updateOne(
      { _id: recipient._id },
      { $set: { status: "SUSPENDED" } }
    );
    const inactiveRecipient = await call(disburseProgram, {
      user: owner,
      params: { programId: String(program._id) },
      body: {},
      headers: { "Idempotency-Key": "inactive-recipient-payout" },
    });
    assert.equal(inactiveRecipient.status, 409);
    assert.match(inactiveRecipient.body.message, /active ServicePay wallet/);
    assert.equal(await EmpowermentPayout.countDocuments(), 0);
    assert.equal(
      (await EmpowermentProgram.findById(program._id)).availableFundingAmount,
      100
    );
    assert.equal(
      (await EmpowermentBeneficiary.findById(beneficiary._id))
        .applicationStatus,
      "APPROVED"
    );
  }
);

test(
  "unverified KYC and unauthorized verifiers cannot approve beneficiaries",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser();
    const applicant = await createUser();
    await createKyc(applicant, "PENDING");
    const program = await createProgram({ owner });
    const beneficiary = await createBeneficiary({
      program,
      user: applicant,
      applicationStatus: "SUBMITTED",
      verificationStatus: "PENDING",
      kycStatus: "PENDING",
    });

    const unauthorized = await call(updateBeneficiaryStatus, {
      user: owner,
      params: { id: String(beneficiary._id) },
      body: { status: "SUBMITTED", verificationStatus: "VERIFIED" },
    });
    assert.equal(unauthorized.status, 403);
    assert.match(unauthorized.body.message, /authorized administrator/);

    const unverifiedKyc = await call(updateBeneficiaryStatus, {
      user: { ...owner.toObject(), role: "HEAD_OFFICE" },
      params: { id: String(beneficiary._id) },
      body: { status: "APPROVED", verificationStatus: "VERIFIED" },
    });
    assert.equal(unverifiedKyc.status, 409);
    assert.match(unverifiedKyc.body.message, /KYC is verified/);

    const unchanged = await EmpowermentBeneficiary.findById(beneficiary._id);
    assert.equal(unchanged.applicationStatus, "SUBMITTED");
    assert.equal(unchanged.verificationStatus, "PENDING");
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        entityId: beneficiary._id,
      }),
      0
    );
  }
);

test(
  "dedicated beneficiary verification endpoint enforces review, KYC and idempotency",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser();
    const applicant = await createUser();
    const admin = await createUser({ role: "HEAD_OFFICE" });
    await createKyc(applicant);
    const program = await createProgram({ owner });
    const beneficiary = await createBeneficiary({
      program,
      user: applicant,
      applicationStatus: "UNDER_REVIEW",
      verificationStatus: "PENDING",
      kycStatus: "VERIFIED",
    });

    const approvalBeforeVerification = await call(updateBeneficiaryStatus, {
      user: admin,
      params: { id: String(beneficiary._id) },
      body: { status: "APPROVED" },
    });
    assert.equal(approvalBeforeVerification.status, 409);
    assert.match(
      approvalBeforeVerification.body.message,
      /Verify the beneficiary/
    );

    const unauthorized = await call(verifyBeneficiary, {
      user: owner,
      params: { id: String(beneficiary._id) },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(unauthorized.status, 403);

    const nonexistent = await call(verifyBeneficiary, {
      user: admin,
      params: { id: new mongoose.Types.ObjectId().toString() },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(nonexistent.status, 404);

    const pendingKycApplicant = await createUser();
    await createKyc(pendingKycApplicant, "PENDING");
    const pendingKycBeneficiary = await createBeneficiary({
      program,
      user: pendingKycApplicant,
      applicationStatus: "UNDER_REVIEW",
      verificationStatus: "PENDING",
      kycStatus: "PENDING",
    });
    const pendingKycVerification = await call(verifyBeneficiary, {
      user: admin,
      params: { id: String(pendingKycBeneficiary._id) },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(pendingKycVerification.status, 409);
    assert.equal(
      (await EmpowermentBeneficiary.findById(pendingKycBeneficiary._id))
        .verificationStatus,
      "PENDING"
    );

    const verified = await call(verifyBeneficiary, {
      user: admin,
      params: { id: String(beneficiary._id) },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.beneficiary.verificationStatus, "VERIFIED");
    assert.equal(
      String(verified.body.beneficiary.verifiedBy),
      String(admin._id)
    );
    assert.ok(verified.body.beneficiary.verifiedAt);
    assert.equal(
      (await EmpowermentBeneficiary.findById(beneficiary._id))
        .applicationStatus,
      "UNDER_REVIEW"
    );
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        entityId: beneficiary._id,
        action: "BENEFICIARY_VERIFICATION_UPDATED",
      }),
      1
    );

    const duplicate = await call(verifyBeneficiary, {
      user: admin,
      params: { id: String(beneficiary._id) },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(duplicate.status, 200);
    assert.equal(
      await EmpowermentAuditLog.countDocuments({
        entityId: beneficiary._id,
        action: "BENEFICIARY_VERIFICATION_UPDATED",
      }),
      1
    );

    const approved = await call(updateBeneficiaryStatus, {
      user: admin,
      params: { id: String(beneficiary._id) },
      body: { status: "APPROVED" },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.beneficiary.applicationStatus, "APPROVED");
    assert.equal(approved.body.beneficiary.verificationStatus, "VERIFIED");

    const rejectedApplicant = await createUser();
    await createKyc(rejectedApplicant);
    const rejectedBeneficiary = await createBeneficiary({
      program,
      user: rejectedApplicant,
      applicationStatus: "UNDER_REVIEW",
      verificationStatus: "PENDING",
      kycStatus: "VERIFIED",
    });
    const rejected = await call(verifyBeneficiary, {
      user: admin,
      params: { id: String(rejectedBeneficiary._id) },
      body: {
        verificationStatus: "REJECTED",
        rejectionReason: "Identity documents could not be validated.",
      },
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.beneficiary.verificationStatus, "REJECTED");
    assert.equal(rejected.body.beneficiary.applicationStatus, "UNDER_REVIEW");
  }
);

test(
  "insufficient payout funding rolls back every transaction-side mutation",
  { timeout: 120_000 },
  async () => {
    const { owner, recipient, program, beneficiary } =
      await programForPayout();
    await EmpowermentProgram.updateOne(
      { _id: program._id },
      {
        $set: {
          availableFundingAmount: 0,
          totalFundedAmount: 0,
        },
      }
    );

    const response = await call(disburseProgram, {
      user: owner,
      params: { programId: String(program._id) },
      body: {},
      headers: { "Idempotency-Key": "rollback-payout-1234" },
    });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /funding is insufficient/);
    assert.equal(await EmpowermentDisbursement.countDocuments(), 0);
    assert.equal(await EmpowermentPayout.countDocuments(), 0);
    assert.equal(await Transaction.countDocuments(), 0);
    assert.equal(await LedgerEntry.countDocuments(), 0);
    assert.equal(await EmpowermentAuditLog.countDocuments(), 0);
    assert.equal((await User.findById(recipient._id)).walletBalance, 25);

    const savedProgram = await EmpowermentProgram.findById(program._id);
    const savedBeneficiary = await EmpowermentBeneficiary.findById(
      beneficiary._id
    );
    assert.equal(savedProgram.availableFundingAmount, 0);
    assert.equal(savedProgram.totalDisbursedAmount, 0);
    assert.equal(savedProgram.totalPaid, 0);
    assert.equal(savedProgram.status, "APPROVED");
    assert.equal(savedBeneficiary.applicationStatus, "APPROVED");
  }
);

test(
  "funding rollback restores the funder wallet and all accounting records",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 1_000,
      transactionPin: "1234",
    });
    const program = await createProgram({
      owner,
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      status: "APPROVED",
    });
    const originalCreate = EmpowermentFunding.create;
    EmpowermentFunding.create = async () => {
      throw new Error("Forced funding persistence failure.");
    };

    let response;
    try {
      response = await call(fundProgram, {
        user: owner,
        params: { programId: String(program._id) },
        body: { amount: 100, transactionPin: "1234" },
        headers: { "Idempotency-Key": "funding-rollback-1234" },
      });
    } finally {
      EmpowermentFunding.create = originalCreate;
    }

    assert.equal(response.status, 500);
    assert.match(response.body.message, /Forced funding persistence failure/);
    const savedOwner = await User.findById(owner._id);
    const savedProgram = await EmpowermentProgram.findById(program._id);
    assert.equal(savedOwner.walletBalance, 1_000);
    assert.equal(savedOwner.totalTransactions, 0);
    assert.equal(savedProgram.totalFundedAmount, 0);
    assert.equal(savedProgram.availableFundingAmount, 0);
    assert.equal(await EmpowermentFunding.countDocuments(), 0);
    assert.equal(
      await Transaction.countDocuments({ serviceType: "EMPOWERMENT_FUNDING" }),
      0
    );
    assert.equal(
      await LedgerEntry.countDocuments({ service: "EMPOWERMENT_FUNDING" }),
      0
    );
    assert.equal(
      await EmpowermentAuditLog.countDocuments({ action: "PROGRAM_FUNDED" }),
      0
    );
  }
);

test(
  "a late payout failure rolls back every previously credited beneficiary",
  { timeout: 120_000 },
  async () => {
    const owner = await createUser({
      role: "HEAD_OFFICE",
      walletBalance: 1_000,
      transactionPin: "1234",
    });
    const firstRecipient = await createUser({ walletBalance: 25 });
    const secondRecipient = await createUser({ walletBalance: 40 });
    await Promise.all([createKyc(firstRecipient), createKyc(secondRecipient)]);
    const program = await createProgram({
      owner,
      status: "APPROVED",
      targetBeneficiaries: 2,
      amountPerBeneficiary: 100,
      totalFundedAmount: 200,
      availableFundingAmount: 200,
    });
    const beneficiaries = await Promise.all([
      createBeneficiary({ program, user: firstRecipient }),
      createBeneficiary({ program, user: secondRecipient }),
    ]);
    await EmpowermentProgram.updateOne(
      { _id: program._id },
      { $set: { beneficiaryCount: 2, totalApproved: 2 } }
    );

    const originalCreate = EmpowermentPayout.create;
    let payoutWrites = 0;
    EmpowermentPayout.create = async function (...args) {
      payoutWrites += 1;
      if (payoutWrites === 2) {
        throw new Error("Forced second payout persistence failure.");
      }
      return originalCreate.apply(this, args);
    };

    let response;
    try {
      response = await call(disburseProgram, {
        user: owner,
        params: { programId: String(program._id) },
        body: {},
        headers: { "Idempotency-Key": "late-payout-rollback-1234" },
      });
    } finally {
      EmpowermentPayout.create = originalCreate;
    }

    assert.equal(response.status, 500);
    assert.match(response.body.message, /Forced second payout persistence failure/);
    const [savedFirstRecipient, savedSecondRecipient, savedProgram] =
      await Promise.all([
        User.findById(firstRecipient._id),
        User.findById(secondRecipient._id),
        EmpowermentProgram.findById(program._id),
      ]);
    assert.equal(savedFirstRecipient.walletBalance, 25);
    assert.equal(savedFirstRecipient.totalTransactions, 0);
    assert.equal(savedSecondRecipient.walletBalance, 40);
    assert.equal(savedSecondRecipient.totalTransactions, 0);
    assert.equal(savedProgram.availableFundingAmount, 200);
    assert.equal(savedProgram.totalDisbursedAmount, 0);
    assert.equal(savedProgram.totalPaid, 0);
    assert.equal(savedProgram.status, "APPROVED");
    assert.equal(await EmpowermentDisbursement.countDocuments(), 0);
    assert.equal(await EmpowermentPayout.countDocuments(), 0);
    assert.equal(
      await Transaction.countDocuments({
        serviceType: "EMPOWERMENT_DISBURSEMENT",
      }),
      0
    );
    assert.equal(
      await LedgerEntry.countDocuments({
        service: "EMPOWERMENT_DISBURSEMENT",
      }),
      0
    );
    assert.equal(
      await EmpowermentAuditLog.countDocuments({ action: "PROGRAM_DISBURSED" }),
      0
    );
    const savedBeneficiaries = await EmpowermentBeneficiary.find({
      _id: { $in: beneficiaries.map((beneficiary) => beneficiary._id) },
    });
    assert.deepEqual(
      savedBeneficiaries.map((beneficiary) => beneficiary.applicationStatus),
      ["APPROVED", "APPROVED"]
    );
  }
);