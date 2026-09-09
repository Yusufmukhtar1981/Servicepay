const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TRUST_LEVELS,
  calculateTrustScore,
} = require("../services/trustScore.service");
const {
  MAX_SEARCH_RESULTS,
  classifySearch,
  isPubliclyAvailable,
  maskPhone,
  phoneSearchVariants,
  toPlainProfile,
  toPublicTrustProfile,
} = require("../services/trustProfile.service");
const {
  protect,
} = require("../middleware/auth.middleware");
const {
  STAFF_PERMISSIONS,
} = require("../config/staffPermissions");
const {
  defaultRoles,
} = require("../scripts/seedStaffRoles");
const {
  bucketFor,
  createTrustSearchRateLimit,
} = require("../middleware/trustRateLimit.middleware");

const verifiedUser = {
  _id: "customer-1",
  fullName: "Ada Example",
  status: "ACTIVE",
  createdAt: "2024-01-01T00:00:00.000Z",
  kycVerified: true,
};

test("scores verified active members from server-side source data", () => {
  const result = calculateTrustScore({
    user: verifiedUser,
    kycProfile: {
      status: "VERIFIED",
      level: "TIER_2",
      ninVerified: true,
    },
    successfulIdentityVerifications: 1,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.restricted, false);
  assert.equal(result.scoreInputs.kycVerified, true);
  assert.equal(result.trustScore, 90);
  assert.equal(result.trustLevel, TRUST_LEVELS.HIGHLY_TRUSTED);
});

test("restricted or inactive accounts always return RESTRICTED", () => {
  const result = calculateTrustScore({
    user: { ...verifiedUser, status: "SUSPENDED" },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.trustScore, 0);
  assert.equal(result.trustLevel, TRUST_LEVELS.RESTRICTED);
  assert.equal(result.restricted, true);
});

test("ignores client-controlled score and verification inputs", () => {
  const result = calculateTrustScore({
    user: {
      ...verifiedUser,
      createdAt: "2025-12-31T00:00:00.000Z",
      kycVerified: false,
      trustScore: 100,
      trustLevel: "HIGHLY_TRUSTED",
      identityVerified: true,
    },
    kycProfile: { status: "PENDING", level: "TIER_1" },
    clientTrustScore: 100,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(result.trustScore, 6);
  assert.equal(result.trustLevel, TRUST_LEVELS.NEW);
  assert.equal(result.scoreInputs.kycVerified, false);
});

test("returns truthful Phase 1 defaults for protected-deal metrics", () => {
  const profile = toPublicTrustProfile(
    {
      servicePayId: "SPT-ABCDEF123456",
      displayName: "Ada Example",
      businessName: "Ada Stores",
      profilePhotoUrl: "",
      identityVerified: true,
      businessVerified: false,
      accountOwnershipVerified: false,
      memberSince: "2024-01-01T00:00:00.000Z",
      trustScore: 70,
      trustLevel: "TRUSTED",
      restricted: false,
      discoverable: true,
      lastCalculatedAt: "2026-01-01T00:00:00.000Z",
      restrictionReason: "Sensitive admin note",
      scoreInputs: { kycVerified: true },
      user: "internal-user-id",
    },
    {
      phone: "08021234645",
      email: "private@example.com",
      virtualAccount: { accountNumber: "0123456789" },
    }
  );

  assert.equal(profile.maskedPhone, "*******4645");
  assert.equal(profile.protectedTransactionsCount, 0);
  assert.equal(profile.protectedTradeVolume, 0);
  assert.equal(profile.completionRate, 0);
  assert.equal(profile.disputesCount, 0);
  assert.equal(profile.resolvedDisputesCount, 0);
  assert.equal("email" in profile, false);
  assert.equal("user" in profile, false);
  assert.equal("restrictionReason" in profile, false);
  assert.equal("scoreInputs" in profile, false);
  assert.equal("virtualAccount" in profile, false);
});

test("requires discoverability and active status for public profiles", () => {
  const profile = { discoverable: false, restricted: false };
  const user = { status: "ACTIVE" };

  assert.equal(isPubliclyAvailable(profile, user), false);
  assert.equal(
    isPubliclyAvailable(
      { discoverable: true, restricted: true },
      user
    ),
    false
  );
  assert.equal(
    isPubliclyAvailable(
      { discoverable: true, restricted: false },
      { status: "ACTIVE" }
    ),
    true
  );
});

test("validates controlled Trust search inputs and result cap", () => {
  assert.deepEqual(
    classifySearch("SPT-ABCDEF123456", "auto"),
    {
      kind: "servicepay_id",
      value: "SPT-ABCDEF123456",
    }
  );
  assert.deepEqual(
    classifySearch("Ada Stores", "business_name"),
    {
      kind: "business_name",
      value: "ada stores",
    }
  );
  assert.throws(
    () => classifySearch("ad", "business_name"),
    /3 to 120/
  );
  assert.throws(
    () => classifySearch("SPT-INVALID", "servicepay_id"),
    /valid ServicePay Trust ID/
  );
  assert.equal(MAX_SEARCH_RESULTS, 10);
});

test("keeps Trust viewing permission in the canonical role seed", () => {
  const complianceManager = defaultRoles.find(
    (role) => role.name === "COMPLIANCE_MANAGER"
  );

  assert.equal(STAFF_PERMISSIONS.TRUST_VIEW, "trust.view");
  assert.ok(complianceManager);
  assert.ok(
    complianceManager.permissions.includes(
      STAFF_PERMISSIONS.TRUST_VIEW
    )
  );
});

test("masks phone values without exposing full identifiers", () => {
  assert.equal(maskPhone("08021234645"), "*******4645");
  assert.equal(maskPhone("12345"), "");
});

test("matches Nigerian local and international phone lookup forms", () => {
  assert.deepEqual(phoneSearchVariants("08021234645").sort(), [
    "+08021234645",
    "+2348021234645",
    "08021234645",
    "2348021234645",
  ]);
  assert.deepEqual(phoneSearchVariants("+2348021234645").sort(), [
    "+2348021234645",
    "08021234645",
    "2348021234645",
  ]);
});

test("serializes a first-created Trust profile before responding", () => {
  const createdDocument = {
    toObject() {
      return {
        servicePayId: "SPT-ABCDEF123456",
        displayName: "Ada Example",
        discoverable: false,
        trustScore: 5,
        trustLevel: "NEW",
      };
    },
  };
  const profile = toPublicTrustProfile(
    toPlainProfile(createdDocument),
    { phone: "08021234645" }
  );

  assert.equal(profile.servicePayId, "SPT-ABCDEF123456");
  assert.equal(profile.discoverable, false);
});

test("denies unauthenticated Trust requests through shared auth middleware", async () => {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  await protect(
    { headers: {} },
    response,
    () => assert.fail("Unauthenticated request should not continue")
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.success, false);
});

test("rate limits authenticated searches through a shared user bucket", async () => {
  let recordedFilter;
  let recordedUpdate;
  let recordedOptions;
  const limiter = createTrustSearchRateLimit({
    now: () => 1_700_000_000_000,
    rateLimitModel: {
      async findOneAndUpdate(filter, update, options) {
        recordedFilter = filter;
        recordedUpdate = update;
        recordedOptions = options;
        return { count: 21 };
      },
    },
  });
  const request = {
    user: { _id: "customer-1" },
    headers: { "x-forwarded-for": "spoofed-client-ip" },
  };
  const next = () => {};
  const response = {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  await limiter(request, response, next);

  assert.equal(response.statusCode, 429);
  assert.equal(response.payload.success, false);
  assert.deepEqual(recordedFilter, {
    user: "customer-1",
    bucket: bucketFor(1_700_000_000_000),
  });
  assert.equal(recordedUpdate.$inc.count, 1);
  assert.equal(recordedOptions.upsert, true);
});