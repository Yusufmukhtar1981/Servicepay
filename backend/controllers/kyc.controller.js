const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");
const {
  canEditKyc,
  normalizeDocumentType,
  safeKycProfile,
  validateDocumentsForTier,
} = require("../services/kycRequirements.service");
const {
  normalizeIdentityType,
  verifyIdentity,
} = require("../services/kycIdentityVerification.service");

const normalizeRequestedKycLevel = (value) => {
  const level = String(value || "TIER_1").trim().toUpperCase();
  return ["TIER_1", "TIER_2", "TIER_3"].includes(level) ? level : "TIER_1";
};

const SERVICEPAY_KYC_LIMITS = {
  TIER_1: {
    perTransaction: Number(process.env.KYC_TIER1_PER_TRANSACTION || 50000),
    daily: Number(process.env.KYC_TIER1_DAILY_LIMIT || 200000),
  },
  TIER_2: {
    perTransaction: Number(process.env.KYC_TIER2_PER_TRANSACTION || 200000),
    daily: Number(process.env.KYC_TIER2_DAILY_LIMIT || 1000000),
  },
  TIER_3: {
    perTransaction: Number(process.env.KYC_TIER3_PER_TRANSACTION || 1000000),
    daily: Number(process.env.KYC_TIER3_DAILY_LIMIT || 5000000),
  },
};

const getOrCreateProfile = async (userId) => {
  let profile = await KycProfile.findOne({ user: userId });
  if (profile) return profile;

  const user = await User.findById(userId);
  if (!user) return null;

  const fullName = String(user.fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  profile = await KycProfile.create({
    user: user._id,
    firstName: user.firstName || fullName[0] || "",
    middleName: user.middleName || (fullName.length > 2 ? fullName.slice(1, -1).join(" ") : ""),
    lastName: user.lastName || (fullName.length > 1 ? fullName[fullName.length - 1] : ""),
    phone: user.phone || "",
    email: user.email || "",
    address: user.address || "",
    state: user.registrationState || user.state || "",
    lga: user.registrationLga || user.lga || "",
  });
  return profile;
};

const isAdultDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const threshold = new Date();
  threshold.setFullYear(threshold.getFullYear() - 18);
  return date <= threshold;
};

exports.getOrCreateProfile = getOrCreateProfile;

exports.getMyKycStatus = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user?._id || req.user?.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      kyc: safeKycProfile(profile),
      servicepayLimits:
        SERVICEPAY_KYC_LIMITS[normalizeRequestedKycLevel(profile.level)],
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message: "Unable to load KYC status.",
    });
  }
};

exports.verifyMyKycIdentity = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user?._id || req.user?.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }
    if (!canEditKyc(profile)) {
      return res.status(409).json({
        success: false,
        code: "KYC_LOCKED_FOR_REVIEW",
        message: "Your submitted KYC application cannot be changed while it is under review.",
      });
    }

    const identityType = normalizeIdentityType(req.body?.identityType);
    const identityNumber = String(req.body?.identityNumber || "");
    if (req.body?.consentAccepted !== true) {
      return res.status(400).json({
        success: false,
        code: "CONSENT_REQUIRED",
        message: "Your consent is required before identity verification.",
      });
    }

    const result = await verifyIdentity({
      type: identityType,
      identifier: identityNumber,
      profile,
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        code: result.code,
        message: result.message,
      });
    }

    const now = new Date();
    if (result.identityType === "NIN") {
      profile.ninVerified = true;
      profile.ninLast4 = result.maskedIdentifier.slice(-4);
      profile.ninVerificationId = result.providerReference;
      profile.ninVerifiedAt = now;
    } else {
      profile.bvnVerified = true;
      profile.bvnLast4 = result.maskedIdentifier.slice(-4);
      profile.bvnVerificationId = result.providerReference;
      profile.bvnVerifiedAt = now;
    }
    profile.identityMatchStatus = result.matchStatus;
    await profile.save();

    return res.status(200).json({
      success: true,
      message: `${result.identityType} verified successfully.`,
      identity: safeKycProfile(profile).identity,
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message: "Unable to verify identity right now. Please try again later.",
    });
  }
};

exports.submitMyKyc = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user?._id || req.user?.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }
    if (!canEditKyc(profile)) {
      return res.status(409).json({
        success: false,
        code: "KYC_ALREADY_SUBMITTED",
        message: "Your KYC application is already submitted for review.",
      });
    }

    const {
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      state,
      lga,
      documentType,
      requestedLevel,
      consentAccepted,
    } = req.body || {};

    if (
      !String(firstName || "").trim() ||
      !String(lastName || "").trim() ||
      !String(phone || "").trim() ||
      !String(email || "").trim() ||
      !String(address || "").trim() ||
      !String(state || "").trim() ||
      !String(lga || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        code: "PERSONAL_INFORMATION_REQUIRED",
        message: "Complete all required personal information before submitting.",
      });
    }
    if (!isAdultDate(dateOfBirth)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_DATE_OF_BIRTH",
        message: "You must be at least 18 years old to submit KYC.",
      });
    }
    if (!["MALE", "FEMALE", "OTHER"].includes(String(gender || "").toUpperCase())) {
      return res.status(400).json({
        success: false,
        code: "GENDER_REQUIRED",
        message: "Select your gender before submitting.",
      });
    }
    if (consentAccepted !== true) {
      return res.status(400).json({
        success: false,
        code: "CONSENT_REQUIRED",
        message: "Your consent is required before submitting KYC.",
      });
    }
    if (!profile.ninVerified && !profile.bvnVerified) {
      return res.status(400).json({
        success: false,
        code: "KYC_IDENTITY_VERIFICATION_REQUIRED",
        message: "Verify your NIN or BVN before submitting KYC.",
      });
    }

    profile.firstName = String(firstName).trim();
    profile.middleName = String(middleName || "").trim();
    profile.lastName = String(lastName).trim();
    profile.dateOfBirth = new Date(dateOfBirth);
    profile.gender = String(gender).toUpperCase();
    profile.phone = String(phone).trim();
    profile.email = String(email).trim().toLowerCase();
    profile.address = String(address).trim();
    profile.state = String(state).trim();
    profile.lga = String(lga).trim();
    const normalizedDocumentType = normalizeDocumentType(
      documentType || profile.documentType,
    );
    if (
      profile.requestedLevel !== "TIER_1" &&
      !normalizedDocumentType
    ) {
      return res.status(400).json({
        success: false,
        code: "GOVERNMENT_ID_TYPE_REQUIRED",
        message: "Select a supported government ID type before submitting.",
      });
    }
    profile.documentType = normalizedDocumentType;
    profile.requestedLevel = normalizeRequestedKycLevel(
      requestedLevel || profile.requestedLevel || profile.level,
    );
    profile.level = normalizeRequestedKycLevel(profile.level);

    const documentCheck = validateDocumentsForTier(profile, profile.requestedLevel);
    if (!documentCheck.valid) {
      return res.status(400).json({
        success: false,
        code: "KYC_DOCUMENTS_REQUIRED",
        message: documentCheck.message,
        requestedLevel: profile.requestedLevel,
      });
    }

    profile.status = "PENDING";
    profile.submittedAt = new Date();
    profile.rejectionReason = "";
    profile.reviewReason = "";
    profile.reviewHistory.push({
      action: "SUBMITTED",
      occurredAt: profile.submittedAt,
    });
    await profile.save();

    return res.status(200).json({
      success: true,
      message: "KYC submitted successfully and is awaiting review.",
      kyc: safeKycProfile(profile),
    });
  } catch (_) {
    return res.status(500).json({
      success: false,
      message: "Unable to submit KYC.",
    });
  }
};