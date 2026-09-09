const mongoose = require("mongoose");

const Partner = require("../models/partner.model");
const PartnerWalletAdjustment = require(
  "../models/partnerWalletAdjustment.model"
);

function makeReference(type = "ADJUSTMENT") {
  return [
    "SP",
    "PARTNER",
    type,
    Date.now(),
    Math.random().toString(36).slice(2, 8).toUpperCase(),
  ].join("-");
}

function normalizeAmount(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function getAdminInfo(req) {
  return {
    id:
      req.user?._id ||
      req.user?.id ||
      req.user?.userId ||
      null,

    role:
      req.user?.role ||
      "",

    name:
      req.user?.fullName ||
      req.user?.name ||
      "",

    email:
      req.user?.email ||
      "",
  };
}

exports.adjustPartnerWallet = async (req, res) => {
  try {
    const partnerId = String(
      req.params.id ||
      req.params.partnerId ||
      ""
    ).trim();

    const rawType = String(
      req.body?.type ||
      ""
    )
      .trim()
      .toUpperCase();

    const amount = normalizeAmount(
      req.body?.amount
    );

    const narration = String(
      req.body?.narration ||
      req.body?.description ||
      ""
    )
      .trim()
      .slice(0, 250);

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid partner ID.",
      });
    }

    if (!["CREDIT", "DEBIT"].includes(rawType)) {
      return res.status(400).json({
        success: false,
        message:
          "Transaction type must be CREDIT or DEBIT.",
      });
    }

    if (!amount) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid amount greater than zero.",
      });
    }

    const existingPartner =
      await Partner.findById(partnerId).lean();

    if (!existingPartner) {
      return res.status(404).json({
        success: false,
        message: "Partner not found.",
      });
    }

    const walletBefore = Number(
      existingPartner.walletBalance || 0
    );

    let updatedPartner;

    if (rawType === "CREDIT") {
      updatedPartner =
        await Partner.findByIdAndUpdate(
          partnerId,
          {
            $inc: {
              walletBalance: amount,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );
    } else {
      updatedPartner =
        await Partner.findOneAndUpdate(
          {
            _id: partnerId,
            walletBalance: {
              $gte: amount,
            },
          },
          {
            $inc: {
              walletBalance: -amount,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (!updatedPartner) {
        return res.status(400).json({
          success: false,
          message:
            "Insufficient partner wallet balance.",
          walletBalance: walletBefore,
        });
      }
    }

    const walletAfter = Number(
      updatedPartner.walletBalance || 0
    );

    const reference =
      makeReference(rawType);

    try {
      await PartnerWalletAdjustment.create({
        partner: updatedPartner._id,
        type: rawType,
        amount,
        walletBefore,
        walletAfter,
        reference,
        narration,
        performedBy: getAdminInfo(req),
        status: "SUCCESSFUL",
      });
    } catch (auditError) {
      console.error(
        "Partner wallet audit error:",
        auditError
      );
    }

    return res.json({
      success: true,
      message:
        rawType === "CREDIT"
          ? "Partner wallet credited successfully."
          : "Partner wallet debited successfully.",

      transaction: {
        reference,
        type: rawType,
        amount,
        walletBefore,
        walletAfter,
        narration,
      },

      partner: {
        id: updatedPartner._id,
        businessName:
          updatedPartner.businessName ||
          "",
        contactName:
          updatedPartner.contactName ||
          "",
        status:
          updatedPartner.status ||
          "",
        walletBalance:
          walletAfter,
      },
    });
  } catch (error) {
    console.error(
      "Partner wallet adjustment error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to update partner wallet.",
    });
  }
};

exports.getWalletAdjustments = async (
  req,
  res
) => {
  try {
    const partnerId = String(
      req.params.id ||
      req.params.partnerId ||
      ""
    ).trim();

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid partner ID.",
      });
    }

    const transactions =
      await PartnerWalletAdjustment.find({
        partner: partnerId,
      })
        .sort({
          createdAt: -1,
        })
        .limit(200)
        .lean();

    return res.json({
      success: true,
      count: transactions.length,
      transactions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Unable to load partner wallet history.",
    });
  }
};
