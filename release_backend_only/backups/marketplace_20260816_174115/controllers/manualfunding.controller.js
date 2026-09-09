const mongoose = require("mongoose");

const {
  postCredit,
} = require("../services/ledger.service");


const ManualFunding = require(
  "../models/manualfunding.model"
);

const User = require("../models/user.model");

const getUserId = (req) => {
  return req.user?._id || req.user?.id || req.userId;
};

const normalizeReference = (value) => {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
};

exports.createManualFundingRequest = async (
  req,
  res
) => {
  try {
    const userId = getUserId(req);

    const {
      amount,
      senderName,
      senderBank,
      paymentReference,
      note,
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const parsedAmount = Number(amount);

    if (
      !Number.isFinite(parsedAmount) ||
      parsedAmount < 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum manual funding amount is ₦100.",
      });
    }

    if (
      !senderName ||
      !String(senderName).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Sender name is required.",
      });
    }

    if (
      !senderBank ||
      !String(senderBank).trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Sender bank is required.",
      });
    }

    const normalizedReference =
      normalizeReference(paymentReference);

    if (!normalizedReference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required.",
      });
    }

    const existingRequest =
      await ManualFunding.findOne({
        user: userId,
        paymentReference: normalizedReference,
      });

    if (existingRequest) {
      return res.status(409).json({
        success: false,
        message:
          "A funding request with this payment reference already exists.",
      });
    }

    const request =
      await ManualFunding.create({
        user: userId,
        amount: parsedAmount,
        senderName: String(senderName).trim(),
        senderBank: String(senderBank).trim(),
        paymentReference: normalizedReference,
        note: String(note || "").trim(),
      });

    return res.status(201).json({
      success: true,
      message:
        "Manual funding request submitted successfully.",
      request,
    });
  } catch (error) {
    console.error(
      "Create manual funding request error:",
      error
    );

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A funding request with this payment reference already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to submit manual funding request.",
    });
  }
};

exports.getMyManualFundingRequests = async (
  req,
  res
) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const requests =
      await ManualFunding.find({
        user: userId,
      })
        .sort({
          createdAt: -1,
        })
        .lean();

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error(
      "Get customer funding requests error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load manual funding requests.",
    });
  }
};

exports.getAllManualFundingRequests = async (
  req,
  res
) => {
  try {
    const requestedStatus = String(
      req.query.status || ""
    ).toUpperCase();

    const filter = {};

    if (
      ["PENDING", "APPROVED", "REJECTED"].includes(
        requestedStatus
      )
    ) {
      filter.status = requestedStatus;
    }

    const requests =
      await ManualFunding.find(filter)
        .populate(
          "user",
          "fullName name phone email walletBalance role"
        )
        .populate(
          "reviewedBy",
          "fullName name email role"
        )
        .sort({
          createdAt: -1,
        })
        .lean();

    return res.status(200).json({
      success: true,
      requests,
    });
  } catch (error) {
    console.error(
      "Get all manual funding requests error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load manual funding requests.",
    });
  }
};

exports.approveManualFundingRequest = async (
  req,
  res
) => {
  const session = await mongoose.startSession();

  try {
    const adminId = getUserId(req);
    const requestId = req.params.id;
    const adminNote = String(
      req.body.adminNote || ""
    ).trim();

    if (
      !mongoose.Types.ObjectId.isValid(requestId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid funding request ID.",
      });
    }

    session.startTransaction();

    const fundingRequest =
      await ManualFunding.findOne({
        _id: requestId,
        status: "PENDING",
      }).session(session);

    if (!fundingRequest) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "Pending funding request was not found.",
      });
    }

    const customer = await User.findById(
      fundingRequest.user
    ).session(session);

    if (!customer) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message: "Customer account was not found.",
      });
    }

    const balanceBefore = Number(
      customer.walletBalance || 0
    );

    const balanceAfter =
      balanceBefore +
      Number(fundingRequest.amount);

    customer.walletBalance = balanceAfter;

    await customer.save({
      session,
    });

    fundingRequest.status = "APPROVED";
    fundingRequest.reviewedBy = adminId;
    fundingRequest.reviewedAt = new Date();
    fundingRequest.adminNote = adminNote;
    fundingRequest.balanceBefore = balanceBefore;
    fundingRequest.balanceAfter = balanceAfter;

    await fundingRequest.save({
      session,
    });

    /*
     * =====================================================
     * SERVICEPAY_CORE_LEDGER_MANUAL_FUNDING_V1
     * =====================================================
     * Manual Funding approval and ledger CREDIT happen
     * inside the same MongoDB transaction.
     *
     * If ledger posting fails, wallet funding rolls back.
     */

    const manualFundingAmount =
      Number(fundingRequest.amount || 0);

    const manualFundingReference =
      String(
        fundingRequest.paymentReference ||
        fundingRequest._id
      ).trim();

    const manualFundingLedger =
      await postCredit({
        userId: customer._id,
        amount: manualFundingAmount,
        openingBalance: balanceBefore,
        closingBalance: balanceAfter,
        service: "MANUAL_FUNDING",
        reference:
          manualFundingReference,
        idempotencyKey:
          `MANUAL_FUNDING:${fundingRequest._id}:CREDIT`,
        relatedUser: adminId || null,
        narration:
          "Manual wallet funding approved",
        metadata: {
          fundingRequestId:
            String(fundingRequest._id),
          paymentReference:
            manualFundingReference,
          reviewedBy:
            adminId
              ? String(adminId)
              : null,
          source:
            "ADMIN_MANUAL_FUNDING",
        },
        session,
      });

    /*
     * If an old ledger entry already exists for this exact
     * funding request, never allow another wallet credit.
     */
    if (manualFundingLedger.duplicate) {
      throw new Error(
        "Duplicate manual funding ledger detected."
      );
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message:
        "Manual funding request approved successfully.",
      walletBalance: balanceAfter,
      request: fundingRequest,
    });
  } catch (error) {
    await session.abortTransaction();

    console.error(
      "Approve manual funding request error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to approve manual funding request.",
    });
  } finally {
    await session.endSession();
  }
};

exports.rejectManualFundingRequest = async (
  req,
  res
) => {
  try {
    const adminId = getUserId(req);
    const requestId = req.params.id;
    const adminNote = String(
      req.body.adminNote || ""
    ).trim();

    if (
      !mongoose.Types.ObjectId.isValid(requestId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid funding request ID.",
      });
    }

    const fundingRequest =
      await ManualFunding.findOneAndUpdate(
        {
          _id: requestId,
          status: "PENDING",
        },
        {
          $set: {
            status: "REJECTED",
            reviewedBy: adminId,
            reviewedAt: new Date(),
            adminNote,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!fundingRequest) {
      return res.status(404).json({
        success: false,
        message:
          "Pending funding request was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Manual funding request rejected.",
      request: fundingRequest,
    });
  } catch (error) {
    console.error(
      "Reject manual funding request error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to reject manual funding request.",
    });
  }
};