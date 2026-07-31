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
  const root = payload?.data || payload || {};
  const data =
    root?.data ||
    root?.response ||
    root?.verification ||
    root;

  const firstName =
    data?.first_name ||
    data?.firstname ||
    data?.firstName ||
    "";

  const middleName =
    data?.middle_name ||
    data?.middlename ||
    data?.middleName ||
    "";

  const lastName =
    data?.last_name ||
    data?.surname ||
    data?.lastname ||
    data?.lastName ||
    "";

  const fullName =
    data?.full_name ||
    data?.fullname ||
    data?.fullName ||
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
      data?.nin ||
      data?.number_nin ||
      data?.id_number ||
      data?.idNumber ||
      "",
    phone:
      data?.phone ||
      data?.mobile ||
      data?.telephone ||
      "",
    gender: data?.gender || "",
    dateOfBirth:
      data?.date_of_birth ||
      data?.dob ||
      data?.birthdate ||
      "",
    address:
      data?.address ||
      data?.residence_address ||
      data?.residential_address ||
      "",
    stateOfOrigin:
      data?.state_of_origin ||
      data?.state ||
      "",
    lga:
      data?.lga ||
      data?.local_government ||
      data?.local_government_area ||
      "",
    photo:
      data?.photo ||
      data?.image ||
      data?.passport ||
      data?.passport_photo ||
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

    const {
      ninNumber,
      slipType,
      searchType,
      consentAccepted,
    } = req.body;

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
        `${PREMBLY_BASE_URL}/verification/vnin`,
        {
          number_nin: String(ninNumber).trim(),
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

    if (!ninData.nin && !ninData.fullName) {
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

    return res.status(200).json({
      success: true,
      message: "NIN verified successfully.",
      data: {
        verificationId: verification._id,
        reference: verification.reference,
        searchType: verification.searchType,
        slipType: verification.slipType,
        amountCharged: verification.amountCharged,
        walletBalance: user.walletBalance,
        verificationData: verification.verificationData,
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