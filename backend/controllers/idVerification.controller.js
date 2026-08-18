const axios = require("axios");

const IdVerification = require("../models/idVerification.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const PREMBLY_BASE_URL =
  process.env.PREMBLY_BASE_URL || "https://api.prembly.com";

const PREMBLY_APP_ID = process.env.PREMBLY_APP_ID || "";
const PREMBLY_SECRET_KEY =
  process.env.PREMBLY_SECRET_KEY || "";

const verificationFees = {
  PREMIUM: 250,
  STANDARD: 250,
  REGULAR: 200,
  INFORMATION: 150,
};

const generateReference = (prefix = "NIN") => {
  const random = Math.floor(
    100000 + Math.random() * 900000
  );
  return `${prefix}-${Date.now()}-${random}`;
};

const maskIdNumber = (value) => {
  const id = String(value || "").trim();

  if (id.length <= 4) {
    return "****";
  }

  return `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
};

const normalizeSlipType = (value) => {
  const slipType = String(value || "")
    .trim()
    .toUpperCase();

  if (
    ["PREMIUM", "STANDARD", "REGULAR", "INFORMATION"].includes(
      slipType
    )
  ) {
    return slipType;
  }

  return "PREMIUM";
};

const normalizeSearchType = (value) => {
  const searchType = String(value || "")
    .trim()
    .toUpperCase();

  if (
    ["NIN_NUMBER", "PHONE_NUMBER", "DEMOGRAPHIC"].includes(
      searchType
    )
  ) {
    return searchType;
  }

  return "NIN_NUMBER";
};

const getPremblyHeaders = () => {
  return {
    "Content-Type": "application/json",
    app_id: PREMBLY_APP_ID,
    "x-api-key": PREMBLY_SECRET_KEY,
  };
};

const extractNinData = (payload) => {
  const possibleSources = [
    payload?.data,
    payload?.nin_data,
    payload?.data?.nin_data,
    payload?.response?.data,
    payload?.response?.nin_data,
    payload?.verificationData,
    payload,
  ];

  const data =
    possibleSources.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (
          item.firstname ||
          item.first_name ||
          item.surname ||
          item.nin ||
          item.birthdate
        )
    ) || {};

  const firstName =
    data.firstname ||
    data.first_name ||
    data.firstName ||
    "";

  const middleName =
    data.middlename ||
    data.middle_name ||
    data.middleName ||
    "";

  const lastName =
    data.surname ||
    data.lastname ||
    data.last_name ||
    data.lastName ||
    "";

  const fullName =
    data.fullname ||
    data.full_name ||
    data.fullName ||
    [firstName, middleName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    fullName,
    firstName,
    middleName,
    lastName,

    nin:
      data.nin ||
      data.number_nin ||
      data.id_number ||
      "",

    phone:
      data.telephoneno ||
      data.phone ||
      data.phone_number ||
      data.mobile ||
      "",

    gender:
      data.gender ||
      data.sex ||
      "",

    dateOfBirth:
      data.birthdate ||
      data.date_of_birth ||
      data.dateOfBirth ||
      data.dob ||
      "",

    address:
      data.residence_address ||
      data.residential_address ||
      data.address ||
      "",

    stateOfOrigin:
      data.self_origin_state ||
      data.state_of_origin ||
      data.birthstate ||
      "",

    lga:
      data.self_origin_lga ||
      data.lga ||
      data.local_government ||
      "",

    photo:
      data.photo ||
      data.passport ||
      data.passport_photo ||
      data.image ||
      "",
  };
};

const createWalletTransaction = async ({
  user,
  amount,
  reference,
  description,
  verificationId,
  slipType,
  maskedNin,
}) => {
  try {
    await Transaction.create({
      userId: user._id,
      customerId: user._id,
      amount,
      type: "DEBIT",
      status: "SUCCESSFUL",
      serviceType: "ID_VERIFICATION",
      reference,
      description,
      meta: {
        verificationId,
        slipType,
        ninNumberMasked: maskedNin,
      },
    });
  } catch (error) {
    console.error(
      "Transaction logging failed:",
      error.message
    );
  }
};

exports.verifyNin = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const ninNumber =
      req.body.ninNumber || req.body.idNumber;

    const slipType =
      req.body.slipType || "PREMIUM";

    const searchType =
      req.body.searchType || "NIN_NUMBER";

    const consentAccepted =
      req.body.consentAccepted ??
      req.body.consent ??
      false;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!ninNumber || String(ninNumber).trim().length !== 11) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 11-digit NIN.",
      });
    }

    if (!consentAccepted) {
      return res.status(400).json({
        success: false,
        message:
          "Consent confirmation is required before verification.",
      });
    }

    const normalizedSlipType =
      normalizeSlipType(slipType);
    const normalizedSearchType =
      normalizeSearchType(searchType);

    const amount =
      verificationFees[normalizedSlipType] || 250;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      Number(user.walletBalance || 0) < Number(amount)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance for NIN verification.",
      });
    }

    if (!PREMBLY_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message:
          "Prembly secret key is missing on the server.",
      });
    }

    const reference = generateReference("NIN");
    const maskedNin = maskIdNumber(ninNumber);

    const verification = await IdVerification.create({
      userId: user._id,
      idType: "NIN",
      searchType: normalizedSearchType,
      slipType: normalizedSlipType,
      reference,
      amountCharged: amount,
      status: "PENDING",
      ninNumberMasked: maskedNin,
      consentAccepted: true,
    });

    let premblyResponse;

    try {
      premblyResponse = await axios.post(
        `${PREMBLY_BASE_URL}/verification/vnin-basic`,
        {
          number: String(ninNumber).trim(),
        },
        {
          headers: getPremblyHeaders(),
          timeout: 45000,
        }
      );
    } catch (error) {
      verification.status = "FAILED";
      verification.failureReason =
        error?.response?.data?.message ||
        error?.message ||
        "Verification request failed.";
      verification.rawResponse =
        error?.response?.data || {};
      await verification.save();

      return res.status(400).json({
        success: false,
        message:
          verification.failureReason ||
          "NIN verification failed.",
      });
    }

    const responseData = premblyResponse?.data || {};
    const ninData = extractNinData(responseData);

    if (!ninData.fullName) {
      verification.status = "FAILED";
      verification.failureReason =
        responseData?.message ||
        "No valid NIN data returned from provider.";
      verification.rawResponse = responseData;
      await verification.save();

      return res.status(400).json({
        success: false,
        message:
          verification.failureReason ||
          "Verification failed. No data returned.",
      });
    }

    const previousBalance = Number(
      user.walletBalance || 0
    );

    user.walletBalance = previousBalance - Number(amount);
    await user.save();

    verification.status = "SUCCESSFUL";
    verification.verificationData = {
      ...ninData,
      nin: String(ninNumber).trim(),
    };
    verification.rawResponse = responseData;
    await verification.save();

    await createWalletTransaction({
      user,
      amount,
      reference,
      description: `NIN verification (${normalizedSlipType})`,
      verificationId: verification._id,
      slipType: normalizedSlipType,
      maskedNin,
    });

    const cleanVerificationData =
      verification.verificationData?.toObject
        ? verification.verificationData.toObject()
        : verification.verificationData || {};

    return res.status(200).json({
      success: true,
      message: "NIN verified successfully.",

      // Compatibility for both the old and new ServicePay APK.
      verification: {
        ...cleanVerificationData,
        status: "Verified",
        reference: verification.reference,
        amountCharged: verification.amountCharged,
        walletBalance: user.walletBalance,
        createdAt: verification.createdAt,
        maskedIdNumber: verification.ninNumberMasked,
      },

      data: {
        ...cleanVerificationData,
        verificationId: verification._id,
        reference: verification.reference,
        searchType: verification.searchType,
        slipType: verification.slipType,
        amountCharged: verification.amountCharged,
        walletBalance: user.walletBalance,
        verificationData: cleanVerificationData,
        status: "Verified",
        maskedIdNumber: verification.ninNumberMasked,
        createdAt: verification.createdAt,
      },
    });
  } catch (error) {
    console.error("verifyNin error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while verifying NIN.",
      error: error.message,
    });
  }
};

exports.getNinVerificationHistory = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const verifications = await IdVerification.find({
      userId,
      idType: "NIN",
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      data: verifications,
    });
  } catch (error) {
    console.error(
      "getNinVerificationHistory error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching verification history.",
    });
  }
};

exports.getSingleNinVerification = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    const verification = await IdVerification.findOne({
      _id: id,
      userId,
      idType: "NIN",
    });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "Verification record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: verification,
    });
  } catch (error) {
    console.error(
      "getSingleNinVerification error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching verification details.",
    });
  }
};

// ===== BVN VERIFICATION FUNCTIONS =====

const BVN_VERIFICATION_FEE = 200;

const extractBvnData = (payload) => {
  const possibleSources = [
    payload?.data?.data,
    payload?.data?.bvn_data,
    payload?.data,
    payload?.bvn_data,
    payload?.response?.data,
    payload?.response,
    payload,
  ];

  const data =
    possibleSources.find(
      (item) =>
        item &&
        typeof item === "object" &&
        (
          item.firstName ||
          item.firstname ||
          item.first_name ||
          item.lastName ||
          item.lastname ||
          item.last_name ||
          item.bvn
        )
    ) || {};

  const firstName =
    data.firstName ||
    data.firstname ||
    data.first_name ||
    "";

  const middleName =
    data.middleName ||
    data.middlename ||
    data.middle_name ||
    "";

  const lastName =
    data.lastName ||
    data.lastname ||
    data.last_name ||
    data.surname ||
    "";

  const fullName =
    data.fullName ||
    data.fullname ||
    data.full_name ||
    [firstName, middleName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    fullName,
    firstName,
    middleName,
    lastName,

    bvn:
      data.bvn ||
      data.number ||
      data.bvnNumber ||
      data.bvn_number ||
      "",

    phone:
      data.phoneNumber ||
      data.phone_number ||
      data.phone ||
      data.mobile ||
      data.telephone ||
      data.telephoneno ||
      "",

    gender:
      data.gender ||
      data.sex ||
      "",

    dateOfBirth:
      data.dateOfBirth ||
      data.date_of_birth ||
      data.birthdate ||
      data.dob ||
      "",

    address:
      data.address ||
      data.residence_address ||
      data.residential_address ||
      "",

    stateOfOrigin:
      data.stateOfOrigin ||
      data.state_of_origin ||
      data.state ||
      "",

    lga:
      data.lga ||
      data.local_government ||
      data.localGovernment ||
      "",

    photo:
      data.photo ||
      data.image ||
      data.passport ||
      data.passport_photo ||
      "",
  };
};

const createBvnWalletTransaction = async ({
  user,
  amount,
  reference,
  verificationId,
  maskedBvn,
}) => {
  try {
    await Transaction.create({
      userId: user._id,
      customerId: user._id,
      amount,
      type: "DEBIT",
      status: "SUCCESSFUL",
      serviceType: "ID_VERIFICATION",
      reference,
      description: "BVN verification",
      meta: {
        verificationId,
        idType: "BVN",
        bvnNumberMasked: maskedBvn,
      },
    });
  } catch (error) {
    console.error(
      "BVN transaction logging failed:",
      error.message
    );
  }
};

exports.verifyBvn = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const bvnNumber =
      req.body.bvnNumber ||
      req.body.bvn ||
      req.body.idNumber;

    const consentAccepted =
      req.body.consentAccepted ??
      req.body.consent ??
      false;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const cleanBvn = String(bvnNumber || "").trim();

    if (!/^\d{11}$/.test(cleanBvn)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 11-digit BVN.",
      });
    }

    if (!consentAccepted) {
      return res.status(400).json({
        success: false,
        message:
          "Consent confirmation is required before BVN verification.",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      Number(user.walletBalance || 0) <
      BVN_VERIFICATION_FEE
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance for BVN verification.",
      });
    }

    if (!PREMBLY_SECRET_KEY) {
      return res.status(500).json({
        success: false,
        message:
          "Prembly secret key is missing on the server.",
      });
    }

    const reference = generateReference("BVN");
    const maskedBvn = maskIdNumber(cleanBvn);

    const verification = await IdVerification.create({
      userId: user._id,
      idType: "BVN",
      searchType: "BVN_NUMBER",
      slipType: "BASIC",
      reference,
      amountCharged: BVN_VERIFICATION_FEE,
      status: "PENDING",
      bvnNumberMasked: maskedBvn,
      idNumberMasked: maskedBvn,
      consentAccepted: true,
    });

    let premblyResponse;

    try {
      premblyResponse = await axios.post(
        `${PREMBLY_BASE_URL}/verification/bvn_validation`,
        {
          number: cleanBvn,
        },
        {
          headers: getPremblyHeaders(),
          timeout: 45000,
        }
      );
    } catch (error) {
      verification.status = "FAILED";
      verification.failureReason =
        error?.response?.data?.message ||
        error?.response?.data?.detail ||
        error?.message ||
        "BVN verification request failed.";

      verification.rawResponse =
        error?.response?.data || {};

      await verification.save();

      return res.status(400).json({
        success: false,
        message:
          verification.failureReason ||
          "BVN verification failed.",
      });
    }

    const responseData = premblyResponse?.data || {};
    const bvnData = extractBvnData(responseData);

    if (!bvnData.fullName) {
      verification.status = "FAILED";
      verification.failureReason =
        responseData?.message ||
        responseData?.detail ||
        "No valid BVN data returned from provider.";

      verification.rawResponse = responseData;

      await verification.save();

      return res.status(400).json({
        success: false,
        message: verification.failureReason,
      });
    }

    const previousBalance = Number(
      user.walletBalance || 0
    );

    user.walletBalance =
      previousBalance - BVN_VERIFICATION_FEE;

    await user.save();

    verification.status = "SUCCESSFUL";
    verification.verificationData = {
      ...bvnData,
      bvn: cleanBvn,
    };
    verification.rawResponse = responseData;

    await verification.save();

    await createBvnWalletTransaction({
      user,
      amount: BVN_VERIFICATION_FEE,
      reference,
      verificationId: verification._id,
      maskedBvn,
    });

    const cleanVerificationData =
      verification.verificationData?.toObject
        ? verification.verificationData.toObject()
        : verification.verificationData || {};

    return res.status(200).json({
      success: true,
      message: "BVN verified successfully.",

      verification: {
        ...cleanVerificationData,
        status: "Verified",
        reference: verification.reference,
        amountCharged: verification.amountCharged,
        walletBalance: user.walletBalance,
        createdAt: verification.createdAt,
        maskedIdNumber: verification.bvnNumberMasked,
      },

      data: {
        ...cleanVerificationData,
        verificationId: verification._id,
        reference: verification.reference,
        searchType: verification.searchType,
        slipType: verification.slipType,
        amountCharged: verification.amountCharged,
        walletBalance: user.walletBalance,
        verificationData: cleanVerificationData,
        status: "Verified",
        maskedIdNumber: verification.bvnNumberMasked,
        createdAt: verification.createdAt,
      },
    });
  } catch (error) {
    console.error("verifyBvn error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while verifying BVN.",
      error: error.message,
    });
  }
};

exports.getBvnVerificationHistory = async (
  req,
  res
) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const verifications = await IdVerification.find({
      userId,
      idType: "BVN",
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      data: verifications,
    });
  } catch (error) {
    console.error(
      "getBvnVerificationHistory error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching BVN verification history.",
    });
  }
};

exports.getSingleBvnVerification = async (
  req,
  res
) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { id } = req.params;

    const verification =
      await IdVerification.findOne({
        _id: id,
        userId,
        idType: "BVN",
      });

    if (!verification) {
      return res.status(404).json({
        success: false,
        message: "BVN verification record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: verification,
    });
  } catch (error) {
    console.error(
      "getSingleBvnVerification error:",
      error.message
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching BVN verification details.",
    });
  }
};

