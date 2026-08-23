const TRUST_LEVELS = Object.freeze({
  NEW: "NEW",
  BASIC: "BASIC",
  VERIFIED: "VERIFIED",
  TRUSTED: "TRUSTED",
  HIGHLY_TRUSTED: "HIGHLY_TRUSTED",
  RESTRICTED: "RESTRICTED",
});

const normalizeStatus = (value) =>
  String(value || "").trim().toUpperCase();

const monthsSince = (value, now = new Date()) => {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime()) || date > now) {
    return 0;
  }

  return Math.max(
    0,
    (now.getUTCFullYear() - date.getUTCFullYear()) * 12 +
      (now.getUTCMonth() - date.getUTCMonth())
  );
};

const hasVerifiedKyc = (user, kycProfile) => {
  if (user?.kycVerified === true) {
    return true;
  }

  const status = normalizeStatus(kycProfile?.status);

  return (
    status === "VERIFIED" &&
    (kycProfile?.ninVerified === true ||
      kycProfile?.bvnVerified === true ||
      ["TIER_2", "TIER_3"].includes(
        normalizeStatus(kycProfile?.level)
      ))
  );
};

const levelForScore = (score) => {
  if (score >= 85) return TRUST_LEVELS.HIGHLY_TRUSTED;
  if (score >= 70) return TRUST_LEVELS.TRUSTED;
  if (score >= 45) return TRUST_LEVELS.VERIFIED;
  if (score >= 15) return TRUST_LEVELS.BASIC;
  return TRUST_LEVELS.NEW;
};

const calculateTrustScore = ({
  user,
  kycProfile,
  successfulIdentityVerifications = 0,
  restricted = false,
  now = new Date(),
} = {}) => {
  const accountActive =
    normalizeStatus(user?.status) === "ACTIVE";
  const accountAgeMonths = monthsSince(
    user?.createdAt,
    now
  );
  const kycVerified = hasVerifiedKyc(user, kycProfile);
  const verifiedIdentityCount = Math.max(
    0,
    Number(successfulIdentityVerifications) || 0
  );

  /*
   * Phase 1 intentionally does not infer business or payment-account
   * ownership verification. ServicePay has no dedicated KYB or ownership
   * source of truth yet, and Trust must never overstate verification.
   */
  const businessVerified = false;
  const accountOwnershipVerified = false;

  const scoreInputs = {
    accountActive,
    accountAgeMonths,
    kycVerified,
    kycTier: normalizeStatus(kycProfile?.level),
    successfulIdentityVerifications: verifiedIdentityCount,
    businessVerified,
    accountOwnershipVerified,
  };

  if (restricted || !accountActive) {
    return {
      trustScore: 0,
      trustLevel: TRUST_LEVELS.RESTRICTED,
      restricted: true,
      scoreInputs,
    };
  }

  let trustScore = 5;
  trustScore += Math.min(accountAgeMonths, 20);

  if (kycVerified) {
    trustScore += 60;
  }

  trustScore += Math.min(verifiedIdentityCount, 2) * 5;
  trustScore = Math.min(100, trustScore);

  return {
    trustScore,
    trustLevel: levelForScore(trustScore),
    restricted: false,
    scoreInputs,
  };
};

module.exports = {
  TRUST_LEVELS,
  calculateTrustScore,
  hasVerifiedKyc,
  monthsSince,
};