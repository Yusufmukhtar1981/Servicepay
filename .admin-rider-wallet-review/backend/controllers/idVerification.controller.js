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
  const value = String(idNumber || "").trim();

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

    default:
      return null;
  }
};

const getProviderMessage = (providerData) => {
  return (
    providerData?.detail ||
    providerData?.message ||
    providerData?.error ||
    providerData?.response_message ||
    providerData?.responseMessage ||
    "ID verification failed."
  );
};

const getResultData = (providerData) => {
  if (
    providerData?.data &&
    typeof providerData.data === "object"
  ) {
    return providerData.data;
  }

  if (
    providerData?.verification &&
    typeof providerData.verification === "object"
  ) {
    return providerData.verification;
  }

  return {};
};

const verificationWasSuccessful = (
  statusCode,
  providerData
) => {
  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }

  if (
    providerData?.status === false ||
    providerData?.success === false
  ) {
    return false;
  }

  const responseCode =
    providerData?.response_code ||
    providerData?.responseCode ||
    providerData?.code;

  if (
    responseCode &&
    !["00", "200", 200].includes(responseCode)
  ) {
    return false;
  }

  return Boolean(
    providerData?.status === true ||
      providerData?.success === true ||
      providerData?.data ||
      providerData?.verification
  );
};

exports.verifyId = async (req, res) => {
  let verificationRecord = null;

  try {
    const idType = String(req.body?.idType || "")
      .trim()
      .toUpperCase();

    const idNumber = String(req.body?.idNumber || "")
      .trim();

    const consent =
      req.body?.consent === true ||
      req.body?.consent === "true";

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
        message:
          "Consent is required before verification.",
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

    if (!process.env.PREMBLY_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message:
          "Prembly Secret Key is not configured on the server.",
      });
    }

    const userId =
      req.user?.id ||
      req.user?._id ||
      req.user;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication failed. Please log in again.",
      });
    }

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

    const premblyRequest = getPremblyRequest(
      idType,
      idNumber
    );

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
      providerReference: "",
      verificationData: {},
      providerResponse: {},
      errorMessage: "",
    });

    const premblyResponse = await axios.post(
      premblyRequest.url,
      premblyRequest.body,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "x-api-key":
            process.env.PREMBLY_SECRET_KEY,
        },
        timeout: 60000,
        validateStatus: () => true,
      }
    );

    const providerData =
      premblyResponse.data &&
      typeof premblyResponse.data === "object"
        ? premblyResponse.data
        : {
            rawResponse: String(
              premblyResponse.data || ""
            ),
          };

    const successful = verificationWasSuccessful(
      premblyResponse.status,
      providerData
    );

    if (!successful) {
      const failureMessage =
        getProviderMessage(providerData);

      verificationRecord.status = "FAILED";
      verificationRecord.providerResponse =
        providerData;
      verificationRecord.errorMessage =
        failureMessage;

      await verificationRecord.save();

      return res.status(
        premblyResponse.status >= 400 &&
          premblyResponse.status < 500
          ? premblyResponse.status
          : 400
      ).json({
        success: false,
        message:
          `${failureMessage} No money was deducted.`,
      });
    }

    const resultData = getResultData(providerData);

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
      resultData.name ||
      [firstName, middleName, lastName]
        .filter(Boolean)
        .join(" ") ||
      "Verified identity";

    const dateOfBirth =
      resultData.dateOfBirth ||
      resultData.date_of_birth ||
      resultData.birthdate ||
      resultData.dob ||
      "";

    const gender =
      resultData.gender || "";

    const phone =
      resultData.phoneNumber ||
      resultData.phone_number ||
      resultData.phone ||
      "";

    const photo =
      resultData.photo ||
      resultData.image ||
      resultData.base64Image ||
      resultData.photo_base64 ||
      "";

    const providerReference =
      providerData?.verification?.reference ||
      providerData?.reference ||
      providerData?.transaction_reference ||
      providerData?.transactionReference ||
      "";

    user.walletBalance =
      Number(user.walletBalance || 0) - fee;

    await user.save();

    verificationRecord.status = "SUCCESS";
    verificationRecord.amountCharged = fee;
    verificationRecord.providerReference =
      providerReference;

    verificationRecord.verificationData = {
      fullName,
      dateOfBirth,
      gender,
      phone,
      photo,
      maskedIdNumber: maskIdNumber(idNumber),
      status: "Verified",
    };

    verificationRecord.providerResponse =
      providerData;

    verificationRecord.errorMessage = "";

    await verificationRecord.save();

    return res.status(200).json({
      success: true,
      message: "ID verified successfully.",
      verification: {
        id: verificationRecord._id,
        idType,
        fullName,
        dateOfBirth,
        gender,
        phone,
        photo,
        maskedIdNumber:
          verificationRecord.verificationData
            .maskedIdNumber,
        status: "Verified",
        amountCharged: fee,
        walletBalance: user.walletBalance,
        reference: providerReference,
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

      await verificationRecord
        .save()
        .catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to complete ID verification. No money was deducted.",
    });
  }
};