const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canEditKyc,
  documentFlags,
  safeKycProfile,
  validateDocumentsForTier,
} = require("../services/kycRequirements.service");
const {
  maskIdentifier,
  nameMatchStatus,
} = require("../services/kycIdentityVerification.service");
const {
  hasSupportedImageSignature,
} = require("../services/kycImageValidation.service");

test("requires private KYC assets for enhanced tiers", () => {
  const incomplete = {
    documentType: "DRIVERS_LICENSE",
    idDocumentAssetId: "private/front",
    selfieAssetId: "private/selfie",
  };
  assert.equal(validateDocumentsForTier(incomplete, "TIER_2").valid, false);

  incomplete.idDocumentBackAssetId = "private/back";
  assert.equal(validateDocumentsForTier(incomplete, "TIER_2").valid, true);
  assert.equal(validateDocumentsForTier(incomplete, "TIER_3").valid, false);

  incomplete.proofOfAddressAssetId = "private/address";
  assert.equal(validateDocumentsForTier(incomplete, "TIER_3").valid, true);
});

test("never serializes private assets, legacy URLs, or provider references", () => {
  const profile = {
    _id: "kyc-1",
    status: "PENDING",
    ninVerified: true,
    ninLast4: "1234",
    ninVerificationId: "private-provider-reference",
    selfieAssetId: "private/selfie",
    selfieUrl: "https://legacy.example/selfie",
    idDocumentAssetId: "private/id",
    idDocumentUrl: "https://legacy.example/id",
  };
  const serialized = safeKycProfile(profile);
  assert.equal(serialized.identity.ninLast4, "1234");
  assert.equal(serialized.documents.selfieUploaded, true);
  assert.equal(serialized.documents.idDocumentUploaded, true);
  assert.equal(JSON.stringify(serialized).includes("private/"), false);
  assert.equal(JSON.stringify(serialized).includes("legacy.example"), false);
  assert.equal(JSON.stringify(serialized).includes("provider-reference"), false);
});

test("allows corrections only when KYC is not under review", () => {
  assert.equal(canEditKyc({ status: "NOT_STARTED" }), true);
  assert.equal(canEditKyc({ status: "REJECTED" }), true);
  assert.equal(canEditKyc({ status: "NEEDS_MORE_INFORMATION" }), true);
  assert.equal(canEditKyc({ status: "PENDING" }), false);
  assert.equal(canEditKyc({ status: "UNDER_REVIEW" }), false);
});

test("masks identifiers, compares names safely, and validates image signatures", () => {
  assert.equal(maskIdentifier("12345678901"), "*******8901");
  assert.equal(
    nameMatchStatus({
      firstName: "Ada",
      middleName: "N.",
      lastName: "Okafor",
      providerName: "Okafor Ada N",
    }),
    "MATCHED",
  );
  assert.equal(
    nameMatchStatus({
      firstName: "Ada",
      lastName: "Okafor",
      providerName: "Grace Hopper",
    }),
    "REVIEW_REQUIRED",
  );
  assert.equal(
    hasSupportedImageSignature(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/png",
    ),
    true,
  );
  assert.equal(
    hasSupportedImageSignature(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      "image/jpeg",
    ),
    false,
  );
});