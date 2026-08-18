const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");
const {
  validateDocumentsForTier,
} = require("./kycDocument.controller");


const normalizeRequestedKycLevel = (value) => {
  const level = String(value || "TIER_1")
    .trim()
    .toUpperCase();

  if (["TIER_1", "TIER_2", "TIER_3"].includes(level)) {
    return level;
  }

  return "TIER_1";
};

const SERVICEPAY_KYC_LIMITS = {
  TIER_1: {
    perTransaction: Number(
      process.env.KYC_TIER1_PER_TRANSACTION || 50000
    ),
    daily: Number(
      process.env.KYC_TIER1_DAILY_LIMIT || 200000
    ),
  },
  TIER_2: {
    perTransaction: Number(
      process.env.KYC_TIER2_PER_TRANSACTION || 200000
    ),
    daily: Number(
      process.env.KYC_TIER2_DAILY_LIMIT || 1000000
    ),
  },
  TIER_3: {
    perTransaction: Number(
      process.env.KYC_TIER3_PER_TRANSACTION || 1000000
    ),
    daily: Number(
      process.env.KYC_TIER3_DAILY_LIMIT || 5000000
    ),
  },
};



const getOrCreateProfile = async (userId) => {
  let profile = await KycProfile.findOne({
    user: userId,
  });

  if (!profile) {
    const user = await User.findById(userId);

    if (!user) {
      return null;
    }

    const fullName = String(user.fullName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    profile = await KycProfile.create({
      user: user._id,
      firstName: fullName[0] || "",
      middleName:
        fullName.length > 2
          ? fullName.slice(1, -1).join(" ")
          : "",
      lastName:
        fullName.length > 1
          ? fullName[fullName.length - 1]
          : "",
      phone: user.phone || "",
      email: user.email || "",
      state: user.state || "",
      lga: user.lga || "",
      status: "NOT_STARTED",
      level: "TIER_1",
    });
  }

  return profile;
};

exports.getMyKycStatus = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(
      req.user._id
    );

    if (!profile) {
      
    // SERVICEPAY_KYC_REGISTRATION_FALLBACK
    const servicePayUserId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const servicePayUser = servicePayUserId
      ? await User.findById(servicePayUserId).select(
          "firstName middleName lastName fullName dateOfBirth gender address state lga registrationState registrationLga transactionPinSet transactionPinHash"
        ).lean()
      : null;

    if (kyc && servicePayUser) {
      if (!kyc.firstName && servicePayUser.firstName) {
        kyc.firstName = servicePayUser.firstName;
      }
      if (!kyc.middleName && servicePayUser.middleName) {
        kyc.middleName = servicePayUser.middleName;
      }
      if (!kyc.lastName && servicePayUser.lastName) {
        kyc.lastName = servicePayUser.lastName;
      }
      if (!kyc.dateOfBirth && servicePayUser.dateOfBirth) {
        kyc.dateOfBirth = servicePayUser.dateOfBirth;
      }
      if (!kyc.gender && servicePayUser.gender) {
        kyc.gender = servicePayUser.gender;
      }
      if (!kyc.address && servicePayUser.address) {
        kyc.address = servicePayUser.address;
      }
      if (!kyc.state) {
        kyc.state =
          servicePayUser.registrationState ||
          servicePayUser.state ||
          "";
      }
      if (!kyc.lga) {
        kyc.lga =
          servicePayUser.registrationLga ||
          servicePayUser.lga ||
          "";
      }
    }

return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      kyc: profile,
      servicepayLimits:
        SERVICEPAY_KYC_LIMITS[
          normalizeRequestedKycLevel(profile.level)
        ],
    });
  } catch (error) {
    console.error("GET KYC STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load KYC status.",
      error: error.message,
    });
  }
};

exports.submitMyKyc = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(
      req.user._id
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    const {
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      gender,
      address,
      state,
      lga,
      selfieUrl,
      idDocumentUrl,
      proofOfAddressUrl,
    } = req.body || {};

    if (
      !String(firstName || "").trim() ||
      !String(lastName || "").trim() ||
      !String(address || "").trim() ||
      !String(state || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "First name, last name, address and state are required.",
      });
    }

    profile.firstName = String(firstName).trim();
    profile.middleName = String(
      middleName || ""
    ).trim();
    profile.lastName = String(lastName).trim();

    if (dateOfBirth) {
      profile.dateOfBirth = new Date(dateOfBirth);
    }

    if (
      ["MALE", "FEMALE", "OTHER"].includes(
        String(gender || "").toUpperCase()
      )
    ) {
      profile.gender =
        String(gender).toUpperCase();
    }

    profile.address = String(address).trim();
    profile.state = String(state).trim();
    profile.lga = String(lga || "").trim();

    profile.selfieUrl = String(
      selfieUrl || profile.selfieUrl || ""
    ).trim();

    profile.idDocumentUrl = String(
      idDocumentUrl ||
        profile.idDocumentUrl ||
        ""
    ).trim();

    profile.proofOfAddressUrl = String(
      proofOfAddressUrl ||
        profile.proofOfAddressUrl ||
        ""
    ).trim();

    profile.requestedLevel = normalizeRequestedKycLevel(
      req.body.requestedLevel ||
      req.body.level ||
      profile.requestedLevel ||
      profile.level ||
      "TIER_1"
    );

    profile.level = normalizeRequestedKycLevel(
      profile.level || "TIER_1"
    );

    /*
   * SERVICEPAY KYC DOCUMENT REQUIREMENTS
   *
   * Tier 1:
   * Basic KYC information.
   *
   * Tier 2:
   * Government ID + Selfie.
   *
   * Tier 3:
   * Government ID + Selfie + Proof of Address.
   */
  const documentCheck =
    validateDocumentsForTier(
      profile,
      profile.requestedLevel ||
        profile.level ||
        "TIER_1"
    );

  if (!documentCheck.valid) {
    return res.status(400).json({
      success: false,
      message: documentCheck.message,
      code: "KYC_DOCUMENTS_REQUIRED",
      requestedLevel:
        profile.requestedLevel ||
        profile.level ||
        "TIER_1",
    });
  }

profile.status = "PENDING";
    profile.submittedAt = new Date();
    profile.rejectionReason = "";

    await profile.save();

    return res.status(200).json({
      success: true,
      message:
        "KYC submitted successfully and is awaiting review.",
      kyc: profile,
    });
  } catch (error) {
    console.error("SUBMIT KYC ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit KYC.",
      error: error.message,
    });
  }
};