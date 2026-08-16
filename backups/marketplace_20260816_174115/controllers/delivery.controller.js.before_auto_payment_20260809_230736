const crypto = require("crypto");
const mongoose = require("mongoose");

const Delivery = require("../models/delivery.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

// Kirkirar tracking number
const generateTrackingNumber = () => {
  const randomCode = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `SP-${Date.now()}-${randomCode}`;
};

// Kirkirar delivery payment reference
const generateDeliveryPaymentReference = () => {
  const randomCode = crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase();

  return `DELIVERY-${Date.now()}-${randomCode}`;
};

// Customer ya kirkiri delivery request
exports.createDelivery = async (req, res) => {
  try {
    const {
      pickupState,
      deliveryState,
      pickupAddress,
      deliveryAddress,
      senderName,
      senderPhone,
      receiverName,
      receiverPhone,
      packageName,
      packageDescription,
      packageWeight,
    } = req.body;

    if (
      !pickupState ||
      !deliveryState ||
      !pickupAddress ||
      !deliveryAddress ||
      !senderName ||
      !senderPhone ||
      !receiverName ||
      !receiverPhone ||
      !packageName
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide all required delivery information.",
      });
    }

    const parsedWeight = Number(packageWeight || 0);

    if (
      Number.isNaN(parsedWeight) ||
      parsedWeight < 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Package weight must be a valid number.",
      });
    }

    const delivery = await Delivery.create({
      customerId: req.user._id,
      trackingNumber: generateTrackingNumber(),

      pickupState:
        req.deliveryCoverage?.pickupStateCode ||
        String(pickupState).trim().toUpperCase(),

      deliveryState:
        req.deliveryCoverage?.deliveryStateCode ||
        String(deliveryState).trim().toUpperCase(),

      pickupAddress: pickupAddress.trim(),
      deliveryAddress: deliveryAddress.trim(),
      senderName: senderName.trim(),
      senderPhone: senderPhone.trim(),
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      packageName: packageName.trim(),
      packageDescription:
        packageDescription?.trim() || "",
      packageWeight: parsedWeight,
      deliveryFee: 1500,
      paymentStatus: "UNPAID",
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message:
        "Delivery request created successfully.",
      delivery,
    });
  } catch (error) {
    console.error(
      "Create delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create delivery request.",
      error: error.message,
    });
  }
};

// Customer ya ga duk deliveries dinsa
exports.getMyDeliveries = async (req, res) => {
  try {
    const deliveries = await Delivery.find({
      customerId: req.user._id,
    })
      .populate(
        "assignedRiderId",
        "fullName phone email"
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error(
      "Get my deliveries error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load delivery history.",
      error: error.message,
    });
  }
};

// Customer ko admin ya ga delivery guda daya
exports.getDeliveryById = async (req, res) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery ID.",
      });
    }

    const delivery = await Delivery.findById(
      req.params.id
    )
      .populate(
        "customerId",
        "fullName phone email"
      )
      .populate(
        "assignedRiderId",
        "fullName phone email"
      );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    const userRole = req.user.role;

    const customerId =
      delivery.customerId?._id ||
      delivery.customerId;

    const isOwner =
      customerId?.toString() ===
      req.user._id.toString();

    const isAdmin = [
      "HEAD_OFFICE",
      "ZONAL_MANAGER",
      "STATE_MANAGER",
    ].includes(userRole);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          "You are not allowed to view this delivery.",
      });
    }

    return res.status(200).json({
      success: true,
      delivery,
    });
  } catch (error) {
    console.error(
      "Get delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load delivery information.",
      error: error.message,
    });
  }
};

// Bincike da tracking number
exports.trackDelivery = async (req, res) => {
  try {
    const trackingNumber = String(
      req.params.trackingNumber || ""
    )
      .trim()
      .toUpperCase();

    const delivery = await Delivery.findOne({
      trackingNumber,
    }).select(
      "trackingNumber packageName pickupAddress deliveryAddress status paymentStatus deliveryFee createdAt updatedAt deliveredAt"
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Invalid tracking number.",
      });
    }

    return res.status(200).json({
      success: true,
      delivery,
    });
  } catch (error) {
    console.error(
      "Track delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to track delivery.",
      error: error.message,
    });
  }
};

// Customer ya biya delivery fee daga wallet
exports.payDeliveryFee = async (req, res) => {
  const session =
    await mongoose.startSession();

  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery ID.",
      });
    }

    session.startTransaction();

    const delivery =
      await Delivery.findOneAndUpdate(
        {
          _id: req.params.id,
          customerId: req.user._id,
          paymentStatus: "UNPAID",
          status: {
            $nin: ["CANCELLED", "DELIVERED"],
          },
          deliveryFee: {
            $gt: 0,
          },
        },
        {
          $set: {
            paymentStatus: "PAID",
            paidAt: new Date(),
          },
        },
        {
          new: true,
          session,
        }
      );

    if (!delivery) {
      const existingDelivery =
        await Delivery.findOne({
          _id: req.params.id,
          customerId: req.user._id,
        }).session(session);

      await session.abortTransaction();

      if (!existingDelivery) {
        return res.status(404).json({
          success: false,
          message:
            "Delivery request not found.",
        });
      }

      if (
        existingDelivery.paymentStatus ===
        "PAID"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This delivery fee has already been paid.",
        });
      }

      if (
        existingDelivery.status ===
        "CANCELLED"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A cancelled delivery cannot be paid.",
        });
      }

      if (
        existingDelivery.status ===
        "DELIVERED"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "This delivery has already been completed.",
        });
      }

      if (
        Number(
          existingDelivery.deliveryFee || 0
        ) <= 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "The delivery fee has not been provided yet.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Unable to process this delivery payment.",
      });
    }

    const deliveryFee = Number(
      delivery.deliveryFee
    );

    const updatedUser =
      await User.findOneAndUpdate(
        {
          _id: req.user._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: deliveryFee,
          },
        },
        {
          $inc: {
            walletBalance: -deliveryFee,
            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
        }
      );

    if (!updatedUser) {
      await session.abortTransaction();

      const currentUser =
        await User.findById(req.user._id)
          .select("walletBalance status");

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account not found.",
        });
      }

      if (
        currentUser.status !== "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance. Please fund your wallet and try again.",
        walletBalance:
          Number(
            currentUser.walletBalance || 0
          ),
      });
    }

    const reference =
      generateDeliveryPaymentReference();

    const transaction =
      await Transaction.create(
        [
          {
            reference,
            customerId: updatedUser._id,
            agentId:
              updatedUser.agentId || null,
            stateManagerId:
              updatedUser.stateManagerId ||
              null,
            zonalManagerId:
              updatedUser.zonalManagerId ||
              null,
            serviceType: "DELIVERY",
            provider:
              "SERVICEPAY_LOGISTICS",
            phone:
              delivery.receiverPhone || "",
            amount: deliveryFee,
            agentCommission: 0,
            stateManagerCommission: 0,
            zonalManagerCommission: 0,
            servicepayProfit: 0,
            status: "SUCCESSFUL",
            providerResponse: {
              deliveryId: delivery._id,
              trackingNumber:
                delivery.trackingNumber,
              packageName:
                delivery.packageName,
              paymentStatus: "PAID",
            },
          },
        ],
        {
          session,
        }
      );

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message:
        "Delivery fee paid successfully.",
      delivery,
      transaction: transaction[0],
      walletBalance:
        Number(updatedUser.walletBalance),
    });
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }

    console.error(
      "Pay delivery fee error:",
      error
    );

    if (
      error?.code === 112 ||
      error?.errorLabels?.includes(
        "TransientTransactionError"
      )
    ) {
      return res.status(409).json({
        success: false,
        message:
          "This payment is already being processed. Please refresh and try again.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to process delivery payment.",
      error: error.message,
    });
  } finally {
    await session.endSession();
  }
};

// Customer ya soke delivery idan har ba a dauka ba
exports.cancelDelivery = async (req, res) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery ID.",
      });
    }

    const delivery = await Delivery.findOne({
      _id: req.params.id,
      customerId: req.user._id,
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    if (
      delivery.paymentStatus === "PAID"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A paid delivery cannot be cancelled directly. Please contact Servicepay support.",
      });
    }

    if (
      [
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED",
      ].includes(delivery.status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This delivery can no longer be cancelled.",
      });
    }

    if (
      delivery.status === "CANCELLED"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This delivery has already been cancelled.",
      });
    }

    delivery.status = "CANCELLED";
    await delivery.save();

    return res.status(200).json({
      success: true,
      message:
        "Delivery request cancelled successfully.",
      delivery,
    });
  } catch (error) {
    console.error(
      "Cancel delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to cancel delivery request.",
      error: error.message,
    });
  }
};

// Admin ya ga duk deliveries
exports.getAllDeliveries = async (
  req,
  res
) => {
  try {
    const {
      status,
      paymentStatus,
      search,
    } = req.query;

    const filter = {};

    if (status) {
      filter.status =
        status.toUpperCase();
    }

    if (paymentStatus) {
      filter.paymentStatus =
        paymentStatus.toUpperCase();
    }

    if (search) {
      filter.$or = [
        {
          trackingNumber: {
            $regex: search,
            $options: "i",
          },
        },
        {
          senderPhone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          receiverPhone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          receiverName: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const deliveries =
      await Delivery.find(filter)
        .populate(
          "customerId",
          "fullName phone email"
        )
        .populate(
          "assignedRiderId",
          "fullName phone email"
        )
        .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error(
      "Get all deliveries error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load deliveries.",
      error: error.message,
    });
  }
};

// Admin ya saka kudin delivery
exports.setDeliveryFee = async (
  req,
  res
) => {
  try {
    const deliveryFee = 1500;

    if (
      Number.isNaN(deliveryFee) ||
      deliveryFee <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid delivery fee greater than zero.",
      });
    }

    const existingDelivery =
      await Delivery.findById(
        req.params.id
      );

    if (!existingDelivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    if (
      existingDelivery.paymentStatus ===
      "PAID"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The price of a paid delivery cannot be changed.",
      });
    }

    if (
      existingDelivery.status ===
      "CANCELLED"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A cancelled delivery cannot be priced.",
      });
    }

    existingDelivery.deliveryFee =
      deliveryFee;

    await existingDelivery.save();

    return res.status(200).json({
      success: true,
      message:
        "Delivery fee updated successfully.",
      delivery: existingDelivery,
    });
  } catch (error) {
    console.error(
      "Set delivery fee error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update delivery fee.",
      error: error.message,
    });
  }
};

// Admin ya canza delivery status
exports.updateDeliveryStatus = async (
  req,
  res
) => {
  try {
    const status = String(
      req.body.status || ""
    ).toUpperCase();

    const allowedStatuses = [
      "PENDING",
      "ACCEPTED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
    ];

    if (
      !allowedStatuses.includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid delivery status.",
      });
    }

    const updateData = {
      status,
    };

    if (
      req.body.adminNote !== undefined
    ) {
      updateData.adminNote = String(
        req.body.adminNote
      ).trim();
    }

    if (status === "DELIVERED") {
      updateData.deliveredAt =
        new Date();
    } else {
      updateData.deliveredAt = null;
    }

    const delivery =
      await Delivery.findByIdAndUpdate(
        req.params.id,
        updateData,
        {
          new: true,
          runValidators: true,
        }
      );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Delivery status updated successfully.",
      delivery,
    });
  } catch (error) {
    console.error(
      "Update delivery status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update delivery status.",
      error: error.message,
    });
  }
};

// Admin ya canza payment status
exports.updatePaymentStatus = async (
  req,
  res
) => {
  try {
    const paymentStatus = String(
      req.body.paymentStatus || ""
    ).toUpperCase();

    const allowedPaymentStatuses = [
      "UNPAID",
      "PAID",
      "REFUNDED",
    ];

    if (
      !allowedPaymentStatuses.includes(
        paymentStatus
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid payment status.",
      });
    }

    const delivery =
      await Delivery.findByIdAndUpdate(
        req.params.id,
        {
          paymentStatus,
          paidAt:
            paymentStatus === "PAID"
              ? new Date()
              : null,
          refundedAt:
            paymentStatus === "REFUNDED"
              ? new Date()
              : null,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Payment status updated successfully.",
      delivery,
    });
  } catch (error) {
    console.error(
      "Update payment status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update payment status.",
      error: error.message,
    });
  }
};