const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "referral-test-secret";

const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const {
  normalizeReferralCode,
  validateReferralCode,
  registerUser,
  getMyReferral,
} = require("../controllers/auth.controller");

const responseFor = async (handler, request) => {
  const result = {};
  const response = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };

  await handler(request, response);
  return result;
};

const queryValue = (value) => {
  const promise = Promise.resolve(value);
  promise.select = () => promise;
  promise.lean = () => promise;
  promise.sort = () => promise;
  return promise;
};

const settingsQueryValue = (enabled = true) =>
  queryValue({
    registration: {
      allowReferralCode: enabled,
    },
  });

test("normalizes referral codes without accepting unsafe values", () => {
  assert.equal(normalizeReferralCode("  sp-abcd-1234 "), "SP-ABCD-1234");
  assert.equal(normalizeReferralCode(""), "");
  assert.equal(normalizeReferralCode("SP ABCD"), "");
  assert.equal(normalizeReferralCode({ toString: () => "SP-ABCD" }), "");
  assert.equal(normalizeReferralCode("x".repeat(65)), "");
});

test("public referral validation exposes only a first name", async () => {
  const originalFindOne = User.findOne;
  const originalSettingsFindOne = AppSettings.findOne;
  AppSettings.findOne = () => settingsQueryValue(true);
  User.findOne = (conditions) => {
    assert.equal(conditions.referralCode, "SP-ADA-1234");
    return queryValue({
      _id: "referrer-id",
      fullName: "Ada Lovelace",
    });
  };

  try {
    const result = await responseFor(validateReferralCode, {
      query: { code: " sp-ada-1234 " },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      success: true,
      valid: true,
      firstName: "Ada",
    });
  } finally {
    User.findOne = originalFindOne;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("missing and ineligible referral codes return valid:false", async () => {
  const originalFindOne = User.findOne;
  const originalSettingsFindOne = AppSettings.findOne;
  AppSettings.findOne = () => settingsQueryValue(true);
  User.findOne = () => queryValue(null);

  try {
    const missing = await responseFor(validateReferralCode, { query: {} });
    assert.equal(missing.status, 200);
    assert.deepEqual(missing.body, { success: true, valid: false });

    const ineligible = await responseFor(validateReferralCode, {
      query: { code: "SP-INACTIVE-1234" },
    });
    assert.equal(ineligible.status, 200);
    assert.deepEqual(ineligible.body, { success: true, valid: false });
  } finally {
    User.findOne = originalFindOne;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("disabled referral setting returns valid:false without a user lookup", async () => {
  const originalFindOne = User.findOne;
  const originalSettingsFindOne = AppSettings.findOne;
  let userLookupCalled = false;
  AppSettings.findOne = () => settingsQueryValue(false);
  User.findOne = () => {
    userLookupCalled = true;
    return queryValue(null);
  };

  try {
    const result = await responseFor(validateReferralCode, {
      query: { code: "SP-ADA-1234" },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { success: true, valid: false });
    assert.equal(userLookupCalled, false);
  } finally {
    User.findOne = originalFindOne;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("registration attributes a valid referrer only at account creation", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalSettingsFindOne = AppSettings.findOne;
  let createdPayload;
  let findOneCalls = 0;

  User.findOne = (conditions) => {
    findOneCalls += 1;
    if (findOneCalls === 1) {
      return queryValue(null);
    }
    assert.equal(conditions.referralCode, "SP-ADA-1234");
    return queryValue({
      _id: "referrer-id",
      fullName: "Ada Lovelace",
    });
  };
  User.create = async (payload) => {
    createdPayload = payload;
    return {
      ...payload,
      _id: "new-customer-id",
      authTokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  AppSettings.findOne = () => settingsQueryValue(true);

  try {
    const result = await responseFor(registerUser, {
      body: {
        fullName: "New Customer",
        phone: "08012345678",
        email: "new@example.com",
        password: "StrongPassword1!",
        acceptTerms: true,
        nin: "12345678901",
        referralCode: " sp-ada-1234 ",
      },
      headers: {},
      ip: "127.0.0.1",
    });

    assert.equal(result.status, 201);
    assert.equal(createdPayload.role, "CUSTOMER");
    assert.equal(createdPayload.referredBy, "referrer-id");
    assert.ok(createdPayload.referralCapturedAt instanceof Date);
    assert.match(createdPayload.referralCode, /^SP-NEWC-[A-F0-9]{10}$/);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("invalid referral does not block normal registration or add attribution", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalSettingsFindOne = AppSettings.findOne;
  let createdPayload;
  let findOneCalls = 0;

  User.findOne = () => {
    findOneCalls += 1;
    return queryValue(null);
  };
  User.create = async (payload) => {
    createdPayload = payload;
    return {
      ...payload,
      _id: "new-customer-id",
      authTokenVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  };
  AppSettings.findOne = () => settingsQueryValue(true);

  try {
    const result = await responseFor(registerUser, {
      body: {
        fullName: "Normal Customer",
        phone: "08012345679",
        password: "StrongPassword1!",
        acceptTerms: true,
        nin: "12345678902",
        referralCode: "does-not-exist",
      },
      headers: {},
      ip: "127.0.0.1",
    });

    assert.equal(result.status, 201);
    assert.equal(findOneCalls, 2);
    assert.equal("referredBy" in createdPayload, false);
    assert.equal("referralCapturedAt" in createdPayload, false);
    assert.match(createdPayload.referralCode, /^SP-NORM-[A-F0-9]{10}$/);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("an existing account cannot attach or change a referrer", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  const originalSettingsFindOne = AppSettings.findOne;
  let createCalled = false;
  let settingsCalled = false;

  User.findOne = () =>
    queryValue({
      _id: "existing-customer",
      referredBy: "original-referrer",
    });
  User.create = async () => {
    createCalled = true;
  };
  AppSettings.findOne = () => {
    settingsCalled = true;
    return settingsQueryValue(true);
  };

  try {
    const result = await responseFor(registerUser, {
      body: {
        fullName: "Existing Customer",
        phone: "08012345670",
        password: "StrongPassword1!",
        acceptTerms: true,
        nin: "12345678903",
        referralCode: "SP-OTHER-1234",
      },
    });
    assert.equal(result.status, 400);
    assert.equal(createCalled, false);
    assert.equal(settingsCalled, false);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
    AppSettings.findOne = originalSettingsFindOne;
  }
});

test("referral dashboard preserves legacy fields and returns private-safe metrics", async () => {
  const originalFindById = User.findById;
  const originalFind = User.find;
  User.findById = () =>
    queryValue({
      _id: "owner-id",
      fullName: "Referral Owner",
      role: "CUSTOMER",
      referralCode: "SP-OWNR-1234",
    });
  User.find = (conditions) => {
    assert.equal(conditions.referredBy, "owner-id");
    return queryValue([
      {
        _id: "child-id",
        fullName: "Grace Hopper",
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  };

  try {
    const result = await responseFor(getMyReferral, {
      user: { _id: "owner-id" },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.referralCode, "SP-OWNR-1234");
    assert.equal(result.body.referredCount, 1);
    assert.equal(
      result.body.referralLink,
      "https://servicepay.ng/register?ref=SP-OWNR-1234"
    );
    assert.equal(result.body.totalReferrals, 1);
    assert.equal(result.body.qualifiedReferrals, 0);
    assert.equal(result.body.pendingReferrals, 1);
    assert.equal(result.body.totalReferralRewards, 0);
    assert.equal(result.body.rewardProgramStatus, "CONFIGURED");
    assert.equal(result.body.rewardPolicy.amount, 2000);
    assert.deepEqual(result.body.referrals[0], {
      id: "child-id",
      firstName: "Grace",
      fullName: "Grace",
      status: "ACTIVE",
      joinedAt: "2026-01-01T00:00:00.000Z",
      category: "DATA",
      categoryProgress: { DATA: 0, DELIVERY: 0, MARKETPLACE: 0 },
      qualificationProgress: 0,
      qualificationStatus: "PENDING",
      rewardStatus: "NOT_ISSUED",
      ledgerReference: null,
      clawbackReference: null,
      pendingClawback: null,
    });
    assert.equal(result.body.referrals[0].fullName, "Grace");
  } finally {
    User.findById = originalFindById;
    User.find = originalFind;
  }
});