const mongoose = require("mongoose");
const AirtimeToCash = require(
  "../models/airtimeToCash.model"
);
const User = require("../models/user.model");

const SETTINGS = {
  MTN: {
    enabled: Boolean(process.env.ATC_MTN_RECEIVING_PHONE),
    ratePercent: 80,
    minAmount: 1000,
    maxAmount: 50000,
    receivingPhone:
      process.env.ATC_MTN_RECEIVING_PHONE || "",
  },
  AIRTEL: {
    enabled: Boolean(process.env.ATC_AIRTEL_RECEIVING_PHONE),
    ratePercent: 78,
    minAmount: 1000,
    maxAmount: 50000,
    receivingPhone:
      process.env.ATC_AIRTEL_RECEIVING_PHONE || "",
  },
  GLO: {
    enabled: Boolean(process.env.ATC_GLO_RECEIVING_PHONE),
    ratePercent: 75,
    minAmount: 1000,
    maxAmount: 50000,
    receivingPhone:
      process.env.ATC_GLO_RECEIVING_PHONE || "",
  },
  "9MOBILE": {
    enabled: Boolean(process.env.ATC_9MOBILE_RECEIVING_PHONE),
    ratePercent: 75,
    minAmount: 1000,
    maxAmount: 50000,
    receivingPhone:
      process.env.ATC_9MOBILE_RECEIVING_PHONE || "",
  },
};


const isHeadOffice = (req) =>
  String(req.user?.role || "")
    .trim()
    .toUpperCase() === "HEAD_OFFICE";

const headOfficeOnly = (req, res) => {
  if (isHeadOffice(req)) {
    return true;
  }

  res.status(403).json({
    success: false,
    message:
      "Only Head Office can perform this Airtime to Cash action.",
  });

  return false;
};

const createHttpError = (
  statusCode,
  message
) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const createReference = () =>
  `ATC-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;

exports.getSettings = async (req, res) => {
  return res.status(200).json({
    success: true,
    networks: SETTINGS,
  });
};

exports.createRequest = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const network = String(
      req.body?.network || ""
    )
      .trim()
      .toUpperCase();

    const senderPhone = String(
      req.body?.senderPhone || ""
    ).trim();

    const airtimeAmount = Number(
      req.body?.airtimeAmount
    );

    const setting = SETTINGS[network];

    if (!setting || setting.enabled !== true) {
      return res.status(400).json({
        success: false,
        message:
          "This network is not currently available for Airtime to Cash.",
      });
    }

    if (!/^\d{10,14}$/.test(senderPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number.",
      });
    }

    if (
      !Number.isFinite(airtimeAmount) ||
      airtimeAmount < setting.minAmount ||
      airtimeAmount > setting.maxAmount
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Amount must be between ₦${setting.minAmount} and ₦${setting.maxAmount}.`,
      });
    }

    const cashAmount = Number(
      (
        airtimeAmount *
        (setting.ratePercent / 100)
      ).toFixed(2)
    );

    const request = await AirtimeToCash.create({
      user: userId,
      reference: createReference(),
      network,
      airtimeAmount,
      ratePercent: setting.ratePercent,
      cashAmount,
      senderPhone,
      receivingPhone: setting.receivingPhone,
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message:
        "Airtime to Cash request created successfully.",
      request,
      instruction:
        `Transfer exactly ₦${airtimeAmount} airtime to ${setting.receivingPhone}. Your request will remain pending until ServicePay confirms receipt.`,
    });
  } catch (error) {
    console.error(
      "CREATE AIRTIME TO CASH ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create Airtime to Cash request.",
    });
  }
};

exports.myRequests = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    const requests = await AirtimeToCash.find({
      user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(100);

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load Airtime to Cash history.",
    });
  }
};

exports.adminList = async (req, res) => {
  if (!headOfficeOnly(req, res)) return;

  try {
    const status = String(
      req.query?.status || ""
    )
      .trim()
      .toUpperCase();

    const filter = {};

    if (
      ["PENDING", "APPROVED", "REJECTED"].includes(
        status
      )
    ) {
      filter.status = status;
    }

    const requests = await AirtimeToCash.find(
      filter
    )
      .populate(
        "user",
        "fullName phone email walletBalance"
      )
      .sort({ createdAt: -1 })
      .limit(300);

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to load Airtime to Cash requests.",
    });
  }
};

exports.approveRequest = async (req, res) => {
  if (!headOfficeOnly(req, res)) return;

  const session = await mongoose.startSession();

  try {
    let approvedRequest = null;
    let walletBalance = 0;

    await session.withTransaction(async () => {
      const request =
        await AirtimeToCash.findOne({
          _id: req.params.id,
          status: "PENDING",
          walletCredited: false,
        }).session(session);

      if (!request) {
        const existing =
          await AirtimeToCash.findById(
            req.params.id
          ).session(session);

        if (!existing) {
          throw createHttpError(
            404,
            "Request not found."
          );
        }

        if (
          existing.status === "APPROVED" ||
          existing.walletCredited === true
        ) {
          throw createHttpError(
            409,
            "This request has already been approved and credited."
          );
        }

        throw createHttpError(
          409,
          "Only pending requests can be approved."
        );
      }

      const creditAmount =
        Number(request.cashAmount);

      if (
        !Number.isFinite(creditAmount) ||
        creditAmount <= 0
      ) {
        throw createHttpError(
          400,
          "Invalid Airtime to Cash credit amount."
        );
      }

      const customer =
        await User.findByIdAndUpdate(
          request.user,
          {
            $inc: {
              walletBalance: creditAmount,
            },
          },
          {
            new: true,
            session,
          }
        );

      if (!customer) {
        throw createHttpError(
          404,
          "Customer account not found."
        );
      }

      request.status = "APPROVED";
      request.walletCredited = true;
      request.walletCreditedAt =
        new Date();
      request.approvedAt = new Date();
      request.approvedBy =
        req.user?._id || req.user?.id;
      request.adminNote = String(
        req.body?.adminNote || ""
      ).trim();

      await request.save({
        session,
      });

      approvedRequest = request;
      walletBalance = Number(
        customer.walletBalance || 0
      );
    });

    return res.status(200).json({
      success: true,
      message:
        "Airtime to Cash approved and wallet credited successfully.",
      walletBalance,
      request: approvedRequest,
    });
  } catch (error) {
    console.error(
      "APPROVE AIRTIME TO CASH ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to approve Airtime to Cash request.",
      });
  } finally {
    await session.endSession();
  }
};

exports.rejectRequest = async (req, res) => {
  if (!headOfficeOnly(req, res)) return;

  try {
    const request = await AirtimeToCash.findById(
      req.params.id
    );

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found.",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(409).json({
        success: false,
        message:
          "Only pending requests can be rejected.",
      });
    }

    request.status = "REJECTED";
    request.rejectedAt = new Date();
    request.adminNote = String(
      req.body?.adminNote || ""
    ).trim();

    await request.save();

    return res.status(200).json({
      success: true,
      message:
        "Airtime to Cash request rejected.",
      request,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        "Unable to reject Airtime to Cash request.",
    });
  }
};
