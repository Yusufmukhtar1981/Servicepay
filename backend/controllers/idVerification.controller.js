const axios = require("axios");

const IdVerification = require("../models/idVerification.model");
const User = require("../models/user.model");

const PREMBLY_BASE_URL =
  process.env.PREMBLY_BASE_URL || "https://api.prembly.com";

const verificationFees = {
  NIN: 500,
  BVN: 500,
  DRIVER_LICENSE: 700,
  PASSPORT: 700,
  VOTER_CARD: 700,
};

const supportedIdTypes = Object.keys(verificationFees);

const maskIdNumber = (idNumber) => {
  const value = String(idNumber || "");

  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
};

const getPremblyRequest = (idType, idNumber) => {
  switch (idType) {
    case "NIN":
      return {
        url: `${PREMBLY_BASE_URL}/verification/vnin`,
        body: {
          number_nin: idNumber,
        },
      };

    /*
     * BVN, DRIVER_LICENSE, PASSPORT and VOTER_CARD
     * will be added after confirming the exact Prembly products
     * enabled on your account.
     */
    default:
      return null;
  }
};

exports.verifyId = async (req, res) => {
  let verificationRecord = null;

  try {
    const idType = String(req.body.idType || "")
      .trim()
      .toUpperCase();

    const idNumber = String(req.body.idNumber || "").trim();

    const consent =
      req.body.consent === true ||
      req.body.consent === "true";

    if (!idType || !idNumber) {
      return res.status(400).json({
        success: false,
        message: "ID type and ID number are required.",
      });
    }

    if (!supportedIdTypes.includes(idType)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported ID type.",
      });
    }

    if (!consent) {
      return res.status(400).json({
        success: false,
        message: "Consent is required before verification.",
      });
    }

    if (
      (idType === "NIN" || idType === "BVN") &&
      !/^\d{11}$/.test(idNumber)
    ) {
      return res.status(400).json({
        success: false,
        message: `${idType} must be exactly 11 digits.`,
      });
    }

    if (
      !process.env.PREMBLY_SECRET_KEY ||
      !process.env.PREMBLY_PUBLIC_KEY
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Prembly credentials are not configured on the server.",
      });
    }

    const userId = req.user?.id || req.user?._id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const fee = verificationFees[idType];

    if (Number(user.walletBalance || 0) < fee) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance.",
      });
    }

    const premblyRequest = getPremblyRequest(idType, idNumber);

    if (!premblyRequest) {
      return res.status(503).json({
        success: false,
        message:
          `${idType} verification has not been connected yet. No money was deducted.`,
      });
    }

    verificationRecord = await IdVerification.create({
      user: user._id,
      idType,
      idNumber,
      amountCharged: 0,
      consent: true,
      status: "PENDING",
      provider: "PREMBLY",
      verificationData: {},
      providerResponse: {},
    });

    const premblyResponse = await axios.post(
      premblyRequest.url,
      premblyRequest.body,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key": process.env.PREMBLY_SECRET_KEY,
          "app-id": process.env.PREMBLY_PUBLIC_KEY,
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );

    const providerData =
      typeof premblyResponse.data === "object" &&
      premblyResponse.data !== null
        ? premblyResponse.data
        : {
            rawResponse: String(premblyResponse.data || ""),
          };

    const verificationSucceeded =
      premblyResponse.status >= 200 &&
      premblyResponse.status < 300 &&
      providerData.status === true &&
      (
        providerData.response_code === "00" ||
        providerData.responseCode === "00" ||
        providerData.data
      );

    if (!verificationSucceeded) {
      verificationRecord.status = "FAILED";
      verificationRecord.providerResponse = providerData;
      verificationRecord.errorMessage =
        providerData.detail ||
        providerData.message ||
        "Prembly verification failed.";

      await verificationRecord.save();

      return res.status(400).json({
        success: false,
        message:
          providerData.detail ||
          providerData.message ||
          "ID verification failed. No money was deducted.",
      });
    }

    /*
     * Only deduct money after Prembly confirms success.
     */
    user.walletBalance = Number(user.walletBalance || 0) - fee;
    await user.save();

    const resultData = providerData.data || {};

    const firstName =
      resultData.firstName ||
      resultData.firstname ||
      resultData.first_name ||
      "";

    const middleName =
      resultData.middleName ||
      resultData.middlename ||
      resultData.middle_name ||
      "";

    const lastName =
      resultData.lastName ||
      resultData.lastname ||
      resultData.last_name ||
      "";

    const fullName =
      resultData.fullName ||
      resultData.full_name ||
      [firstName, middleName, lastName]
        .filter(Boolean)
        .join(" ") ||
      "Verified identity";

    verificationRecord.status = "SUCCESS";
    verificationRecord.amountCharged = fee;
    verificationRecord.providerReference =
      providerData.verification?.reference ||
      providerData.reference ||
      "";

    verificationRecord.verificationData = {
      fullName,
      dateOfBirth:
        resultData.dateOfBirth ||
        resultData.date_of_birth ||
        resultData.dob ||
        "",
      gender: resultData.gender || "",
      phone:
        resultData.phoneNumber ||
        resultData.phone_number ||
        resultData.phone ||
        "",
      photo:
        resultData.photo ||
        resultData.image ||
        resultData.base64Image ||
        "",
      maskedIdNumber: maskIdNumber(idNumber),
      status: "Verified",
    };

    verificationRecord.providerResponse = providerData;

    await verificationRecord.save();

    return res.status(200).json({
      success: true,
      message: "ID verified successfully.",
      verification: {
        id: verificationRecord._id,
        idType,
        fullName,
        dateOfBirth:
          verificationRecord.verificationData.dateOfBirth,
        gender: verificationRecord.verificationData.gender,
        phone: verificationRecord.verificationData.phone,
        photo: verificationRecord.verificationData.photo,
        maskedIdNumber:
          verificationRecord.verificationData.maskedIdNumber,
        status: "Verified",
        amountCharged: fee,
        walletBalance: user.walletBalance,
        reference: verificationRecord.providerReference,
        createdAt: verificationRecord.createdAt,
      },
    });
  } catch (error) {
    console.error(
      "Prembly ID verification error:",
      error.response?.data || error.message
    );

    if (verificationRecord) {
      verificationRecord.status = "FAILED";
      verificationRecord.errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Verification failed.";

      verificationRecord.providerResponse =
        error.response?.data || {};

      await verificationRecord.save().catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to complete ID verification. No money was deducted.",
    });
  }
};