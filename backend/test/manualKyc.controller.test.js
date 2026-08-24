const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const EmpowermentBeneficiary = require("../models/empowermentBeneficiary.model");
const EmpowermentAuditLog = require("../models/empowermentAuditLog.model");
const { submitMyKyc } = require("../controllers/kyc.controller");
const {
  getKycApplications,
  updateKycStatus,
} = require("../controllers/adminKyc.controller");
const {
  verifyBeneficiary,
} = require("../controllers/empowerment.controller");

let mongo;
let sequence = 0;

const models = [
  KycProfile,
  User,
  EmpowermentOrganization,
  EmpowermentProgram,
  EmpowermentBeneficiary,
  EmpowermentAuditLog,
];

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri(), { dbName: "manual-kyc-tests" });
  await Promise.all(models.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

const call = async (handler, {
  user,
  body = {},
  params = {},
  query = {},
} = {}) => {
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
  await handler({ user, body, params, query }, res);
  return result;
};

const createUser = async ({ role = "CUSTOMER" } = {}) => {
  sequence += 1;
  return User.create({
    fullName: `Manual Kyc User ${sequence}`,
    phone: `080401${String(sequence).padStart(5, "0")}`,
    email: `manual-kyc-${sequence}@example.com`,
    password: "password123",
    role,
    status: "ACTIVE",
    state: "Lagos",
    lga: "Ikeja",
  });
};

const kycBody = ({
  nin = "12345678901",
  bvn = "10987654321",
} = {}) => ({
  firstName: "Manual",
  middleName: "Review",
  lastName: "Customer",
  dateOfBirth: "1990-01-01T00:00:00.000Z",
  gender: "FEMALE",
  phone: "08040100000",
  email: "manual.review@example.com",
  address: "1 ServicePay Way",
  state: "Lagos",
  lga: "Ikeja",
  requestedLevel: "TIER_1",
  nin,
  bvn,
  consentAccepted: true,
});

test(
  "manual KYC submission, search, override, and Empowerment compatibility",
  { timeout: 120_000 },
  async () => {
    const customer = await createUser();
    const headOffice = await createUser({ role: "HEAD_OFFICE" });
    const organizationOwner = await createUser();

    const submitted = await call(submitMyKyc, {
      user: customer,
      body: {
        ...kycBody(),
        phone: customer.phone,
        email: customer.email,
      },
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.kyc.status, "PENDING");
    assert.equal(submitted.body.kyc.identity.ninSubmitted, true);
    assert.equal(submitted.body.kyc.identity.bvnSubmitted, true);
    assert.equal(JSON.stringify(submitted.body).includes("12345678901"), false);

    const profile = await KycProfile.findOne({ user: customer._id })
      .select("+submittedNin +submittedBvn");
    assert.equal(profile.submittedNin, "12345678901");
    assert.equal(profile.submittedBvn, "10987654321");
    assert.equal(profile.status, "PENDING");
    assert.equal(await KycProfile.countDocuments({ user: customer._id }), 1);

    for (const search of [
      customer.fullName,
      customer.phone,
      customer.email,
      "12345678901",
      "10987654321",
    ]) {
      const response = await call(getKycApplications, {
        user: headOffice,
        query: { search },
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.kycApplications.length, 1);
      assert.equal(response.body.kycApplications[0].nin, "12345678901");
      assert.equal(response.body.kycApplications[0].bvn, "10987654321");
    }

    const unauthorized = await call(updateKycStatus, {
      user: customer,
      params: { kycId: String(profile._id) },
      body: { status: "VERIFIED", manualOverride: true },
    });
    assert.equal(unauthorized.status, 403);

    const approved = await call(updateKycStatus, {
      user: headOffice,
      params: { kycId: String(profile._id) },
      body: { status: "VERIFIED", manualOverride: true },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.kyc.status, "VERIFIED");
    assert.equal(
      approved.body.kyc.verification.method,
      "MANUAL_ADMIN_OVERRIDE"
    );
    assert.equal(
      String(approved.body.kyc.verification.verifiedBy.id),
      String(headOffice._id)
    );
    assert.ok(approved.body.kyc.verification.verifiedAt);

    const verifiedProfile = await KycProfile.findById(profile._id)
      .select("+submittedNin +submittedBvn");
    assert.equal(verifiedProfile.status, "VERIFIED");
    assert.equal(verifiedProfile.verificationMethod, "MANUAL_ADMIN_OVERRIDE");
    assert.equal(String(verifiedProfile.verifiedBy), String(headOffice._id));
    assert.ok(verifiedProfile.verifiedAt);
    assert.equal(
      verifiedProfile.reviewHistory.some(
        (event) => event.action === "MANUAL_ADMIN_OVERRIDE"
      ),
      true
    );
    assert.equal((await User.findById(customer._id)).kycVerified, true);

    const verifiedResubmission = await call(submitMyKyc, {
      user: customer,
      body: {
        ...kycBody({ nin: "99999999999", bvn: "88888888888" }),
        phone: customer.phone,
        email: customer.email,
      },
    });
    assert.equal(verifiedResubmission.status, 409);
    const unchanged = await KycProfile.findById(profile._id)
      .select("+submittedNin +submittedBvn");
    assert.equal(unchanged.status, "VERIFIED");
    assert.equal(unchanged.submittedNin, "12345678901");
    assert.equal(unchanged.submittedBvn, "10987654321");

    const organization = await EmpowermentOrganization.create({
      name: "Manual KYC Empowerment Organization",
      organizationType: "NGO",
      registrationNumber: "MANUAL-KYC-001",
      contactName: organizationOwner.fullName,
      phone: organizationOwner.phone,
      email: organizationOwner.email,
      address: "2 ServicePay Way",
      state: organizationOwner.state,
      status: "ACTIVE",
      createdBy: organizationOwner._id,
    });
    const program = await EmpowermentProgram.create({
      organization: organization._id,
      name: "Manual KYC Program",
      state: "Lagos",
      amountPerBeneficiary: 100,
      targetBeneficiaries: 1,
      status: "OPEN",
      createdBy: organizationOwner._id,
    });
    const beneficiary = await EmpowermentBeneficiary.create({
      program: program._id,
      user: customer._id,
      fullName: customer.fullName,
      phone: customer.phone,
      normalizedPhone: customer.phone,
      email: customer.email,
      state: "Lagos",
      applicationStatus: "UNDER_REVIEW",
      verificationStatus: "PENDING",
      kycStatus: "PENDING",
      amount: 100,
    });

    const beneficiaryVerification = await call(verifyBeneficiary, {
      user: headOffice,
      params: { id: String(beneficiary._id) },
      body: { verificationStatus: "VERIFIED" },
    });
    assert.equal(beneficiaryVerification.status, 200);
    assert.equal(
      beneficiaryVerification.body.beneficiary.verificationStatus,
      "VERIFIED"
    );
  }
);

test("manual KYC submission rejects invalid NIN and BVN formats", async () => {
  const customer = await createUser();
  const invalidNin = await call(submitMyKyc, {
    user: customer,
    body: {
      ...kycBody({ nin: "1234", bvn: "10987654321" }),
      phone: customer.phone,
      email: customer.email,
    },
  });
  assert.equal(invalidNin.status, 400);

  const invalidBvn = await call(submitMyKyc, {
    user: customer,
    body: {
      ...kycBody({ nin: "12345678901", bvn: "invalid" }),
      phone: customer.phone,
      email: customer.email,
    },
  });
  assert.equal(invalidBvn.status, 400);
  assert.equal(await KycProfile.countDocuments({ user: customer._id }), 1);
});