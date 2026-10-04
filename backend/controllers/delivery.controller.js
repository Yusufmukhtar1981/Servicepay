const crypto = require("crypto");
const mongoose = require("mongoose");

const Delivery = require("../models/delivery.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const {
  reconcileReferralReward,
  enqueueReferralRewardEvent,
} = require("../services/referralReward.service");

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

const hasDeliveryIdempotencyIndex = async () => {
  try {
    const indexes = await Delivery.collection.indexes();
    return indexes.some((index) =>
      index.unique === true &&
      Object.keys(index.key || {}).length === 2 &&
      index.key?.customerId === 1 &&
      index.key?.idempotencyKey === 1 &&
      Object.keys(index.partialFilterExpression || {}).length === 1 &&
      Object.keys(index.partialFilterExpression?.idempotencyKey || {}).length === 1 &&
      index.partialFilterExpression?.idempotencyKey?.$type === "string"
    );
  } catch {
    return false;
  }
};

// Customer ya kirkiri delivery request
// ServicePay Delivery: fixed ₦1,500 automatic wallet charge.
exports.createDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  let idempotencyKey = "";
  let requestFingerprint = "";
  const returnExistingRequest = async (existing) => {
    if (existing.idempotencyFingerprint !== requestFingerprint) {
      return res.status(409).json({
        success: false,
        code: "DELIVERY_IDEMPOTENCY_KEY_REUSED",
        message:
          "This delivery request key was already used for different details. Check your delivery history before submitting another request.",
      });
    }

    const [currentUser, transaction] = await Promise.all([
      User.findById(existing.customerId).select("walletBalance").lean(),
      Transaction.findOne({
        serviceType: "DELIVERY",
        "providerResponse.deliveryId": existing._id,
      }).lean(),
    ]);
    const deliveryResponse = { ...existing };
    delete deliveryResponse.idempotencyKey;
    delete deliveryResponse.idempotencyFingerprint;
    return res.status(200).json({
      success: true,
      duplicate: true,
      message: "This delivery request has already been submitted.",
      delivery: deliveryResponse,
      transaction,
      walletBalance: Number(currentUser?.walletBalance || 0),
      payment: {
        status: existing.paymentStatus,
        amount: Number(existing.deliveryFee || 0),
        reference: transaction?.reference || null,
      },
    });
  };

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
      !pickupAddress ||
      !deliveryAddress ||
      !senderName ||
      !senderPhone ||
      !receiverName ||
      !receiverPhone
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

    const normalizedPackageName =
      String(
        packageName ||
        "Delivery item"
      ).trim() ||
      "Delivery item";

    const headerIdempotencyKey = String(
      req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"] || ""
    ).trim();
    const bodyIdempotencyKey = String(req.body?.idempotencyKey || "").trim();
    if (headerIdempotencyKey && bodyIdempotencyKey &&
        headerIdempotencyKey !== bodyIdempotencyKey) {
      return res.status(400).json({
        success: false,
        message: "Conflicting delivery idempotency keys were supplied.",
      });
    }
    idempotencyKey = headerIdempotencyKey || bodyIdempotencyKey;
    if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        code: "DELIVERY_IDEMPOTENCY_KEY_REQUIRED",
        message: "A valid Idempotency-Key is required for delivery requests.",
      });
    }
    if (!(await hasDeliveryIdempotencyIndex())) {
      return res.status(503).json({
        success: false,
        code: "DELIVERY_IDEMPOTENCY_INDEX_NOT_READY",
        message:
          "Delivery requests are temporarily unavailable while safe retry protection is being prepared.",
      });
    }

    const normalizedPickupState =
      req.deliveryCoverage?.pickupStateCode ||
      (pickupState ? String(pickupState).trim().toUpperCase() : null);
    const normalizedDeliveryState =
      req.deliveryCoverage?.deliveryStateCode ||
      (deliveryState ? String(deliveryState).trim().toUpperCase() : null);
    requestFingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        pickupState: normalizedPickupState,
        deliveryState: normalizedDeliveryState,
        pickupAddress: String(pickupAddress).trim(),
        deliveryAddress: String(deliveryAddress).trim(),
        senderName: String(senderName).trim(),
        senderPhone: String(senderPhone).trim(),
        receiverName: String(receiverName).trim(),
        receiverPhone: String(receiverPhone).trim(),
        packageName: normalizedPackageName,
        packageDescription: String(packageDescription || "").trim(),
        packageWeight: parsedWeight,
      }))
      .digest("hex");

    const existingRequest = await Delivery.findOne({
      customerId: req.user._id,
      idempotencyKey,
    }).select("+idempotencyFingerprint").lean();
    if (existingRequest) return await returnExistingRequest(existingRequest);

    const deliveryFee = Delivery.STANDARD_DELIVERY_FEE;

    session.startTransaction();

    const concurrentRequest = await Delivery.findOne({
      customerId: req.user._id,
      idempotencyKey,
    }).select("+idempotencyFingerprint").session(session).lean();
    if (concurrentRequest) {
      await session.abortTransaction();
      return await returnExistingRequest(concurrentRequest);
    }

    /*
     * Atomic wallet debit.
     * Only the unheld wallet amount can be spent.
     */
    const updatedUser =
      await User.findOneAndUpdate(
        {
          _id: req.user._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: deliveryFee,
          },
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$walletBalance",
                  { $ifNull: ["$walletHeldBalance", 0] },
                ],
              },
              deliveryFee,
            ],
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
        await User.findById(
          req.user._id
        ).select(
          "walletBalance walletHeldBalance status branchId"
        );

      if (!currentUser) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account not found.",
        });
      }

      if (
        String(currentUser.status || "")
          .toUpperCase() !== "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your account is not active.",
        });
      }


      return res.status(400).json({
        success: false,
        code:
          "INSUFFICIENT_WALLET_BALANCE",
        message:
          "Insufficient spendable wallet balance to request a delivery. Please fund your wallet and try again.",
        requiredAmount:
          deliveryFee,
        walletBalance:
          Number(
            currentUser.walletBalance || 0
          ),
        spendableBalance: Math.max(
          Number(currentUser.walletBalance || 0) -
            Number(currentUser.walletHeldBalance || 0),
          0
        ),
      });
    }

    // Unbranched customers are dispatched only by a validated, live pickup
    // state with a verified, online rider in that state. Never debit an order
    // which cannot be shown to any rider, or infer a branch from an address.
    if (!updatedUser.branchId) {
      const coveredState = req.deliveryCoverage?.pickupStateCode;
      const riderAvailable = coveredState && await User.exists({
        role: "DELIVERY_RIDER",
        status: "ACTIVE",
        riderVerificationStatus: "VERIFIED",
        availabilityStatus: "ONLINE",
        branchId: null,
        riderState: { $regex: `^${coveredState}$`, $options: "i" },
      }).session(session);
      if (!riderAvailable) {
        await session.abortTransaction();
        return res.status(409).json({
          success: false,
          code: "DELIVERY_RIDER_UNAVAILABLE",
          message: "No verified rider is available for this pickup state. Choose a live pickup state with a rider or try again later. Your wallet was not charged.",
        });
      }
    }

    const trackingNumber =
      generateTrackingNumber();

    const reference =
      generateDeliveryPaymentReference();

    /*
     * Create delivery inside same transaction.
     * If this fails, wallet debit rolls back.
     */
    const created =
      await Delivery.create(
        [
          {
            customerId:
              req.user._id,
            // Never trust a client-supplied branch. The authenticated
            // customer is the authority for delivery tenancy.
            branchId: updatedUser.branchId || null,

            trackingNumber,
            idempotencyKey,
            idempotencyFingerprint: requestFingerprint,

            pickupState:
              normalizedPickupState,

            deliveryState:
              normalizedDeliveryState,

            pickupAddress:
              String(
                pickupAddress
              ).trim(),

            deliveryAddress:
              String(
                deliveryAddress
              ).trim(),

            senderName:
              String(
                senderName
              ).trim(),

            senderPhone:
              String(
                senderPhone
              ).trim(),

            receiverName:
              String(
                receiverName
              ).trim(),

            receiverPhone:
              String(
                receiverPhone
              ).trim(),

            packageName:
              normalizedPackageName,

            packageDescription:
              String(
                packageDescription || ""
              ).trim(),

            packageWeight:
              parsedWeight,

            deliveryFee:
              deliveryFee,

            pricingType:
              "STANDARD",

            riderCommissionType:
              "PERCENTAGE",

            riderCommissionValue:
              30,

            paymentStatus:
              "PAID",

            paidAt:
              new Date(),

            status:
              "PENDING",
          },
        ],
        {
          session,
        }
      );

    const delivery =
      created[0];
    const deliverySplit = delivery.calculateCommission();
    await delivery.save({ session });

    /*
     * Record the automatic wallet debit.
     */
    const transactions =
      await Transaction.create(
        [
          {
            reference,

            customerId:
              updatedUser._id,
            branchId: updatedUser.branchId || null,

            agentId:
              updatedUser.agentId ||
              null,

            stateManagerId:
              updatedUser
                .stateManagerId ||
              null,

            zonalManagerId:
              updatedUser
                .zonalManagerId ||
              null,

            serviceType:
              "DELIVERY",

            provider:
              "SERVICEPAY_LOGISTICS",

            phone:
              String(
                receiverPhone
              ).trim(),

            amount:
              deliveryFee,

            agentCommission: 0,
            stateManagerCommission: 0,
            zonalManagerCommission: 0,

            /*
             * Snapshot the standard Rider and company shares
             * with the authoritative wallet charge.
             */
            servicepayProfit:
              deliverySplit.servicepayProfit,

            status:
              "SUCCESSFUL",

            providerResponse: {
              deliveryId:
                delivery._id,

              trackingNumber,

              paymentMode:
                "AUTOMATIC_WALLET_DEBIT",

              paymentStatus:
                "PAID",

              deliveryFee:
                deliveryFee,

              riderShare:
                deliverySplit.riderCommissionAmount,

              servicepayShare:
                deliverySplit.servicepayProfit,
            },
          },
        ],
        {
          session,
        }
      );

    await session.commitTransaction();

    const deliveryResponse = delivery.toObject();
    delete deliveryResponse.idempotencyKey;
    delete deliveryResponse.idempotencyFingerprint;
    return res.status(201).json({
      success: true,

      message:
        `Delivery request submitted successfully. ₦${deliveryFee.toLocaleString()} has been deducted from your wallet.`,

      delivery: deliveryResponse,

      transaction:
        transactions[0],

      walletBalance:
        Number(
          updatedUser.walletBalance || 0
        ),

      payment: {
        status:
          "PAID",

        amount:
          deliveryFee,

        reference,
      },
    });
  } catch (error) {
    if (
      session.inTransaction()
    ) {
      await session.abortTransaction();
    }

    const concurrentRequestConflict =
      error?.code === 11000 ||
      error?.code === 112 ||
      error?.hasErrorLabel?.("TransientTransactionError");
    if (concurrentRequestConflict && idempotencyKey) {
      let existingRequest = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        existingRequest = await Delivery.findOne({
          customerId: req.user._id,
          idempotencyKey,
        }).select("+idempotencyFingerprint").lean();
        if (existingRequest) break;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
      if (existingRequest) return await returnExistingRequest(existingRequest);
      return res.status(503).json({
        success: false,
        code: "DELIVERY_REQUEST_RESULT_UNKNOWN",
        message:
          "The delivery request is still being confirmed. Retry with the same Idempotency-Key.",
      });
    }

    console.error(
      "Create delivery error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create delivery request.",
      error:
        error.message,
    });
  } finally {
    await session.endSession();
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
      .select("+idempotencyKey")
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
      "ADMIN",
      "SUPER_ADMIN",
      "HEAD_OFFICE_ADMIN",
      "STATE_MANAGER",
    ].includes(userRole);

    const isScopedManager = userRole === "STATE_MANAGER" &&
      Boolean(await User.exists({
        _id: customerId,
        role: "CUSTOMER",
        stateManagerId: req.user._id,
        isDeleted: { $ne: true },
      }));
    if (!isOwner && (!isAdmin || (userRole === "STATE_MANAGER" && !isScopedManager))) {
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
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$walletBalance",
                  { $ifNull: ["$walletHeldBalance", 0] },
                ],
              },
              deliveryFee,
            ],
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
          .select("walletBalance walletHeldBalance status");

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
        code: "INSUFFICIENT_SPENDABLE_BALANCE",
        message:
          "Insufficient spendable wallet balance. Please fund your wallet and try again.",
        walletBalance:
          Number(
            currentUser.walletBalance || 0
          ),
        spendableBalance: Math.max(
          Number(currentUser.walletBalance || 0) -
            Number(currentUser.walletHeldBalance || 0),
          0
        ),
      });
    }

    const deliverySplit = delivery.calculateCommission();
    await delivery.save({ session });

    const reference =
      generateDeliveryPaymentReference();

    const transaction =
      await Transaction.create(
        [
          {
            reference,
            customerId: updatedUser._id,
            // A later payment belongs to the delivery's original branch,
            // even if the customer is moved after creating the delivery.
            branchId: delivery.branchId || null,
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
            servicepayProfit:
              deliverySplit.servicepayProfit,
            status: "SUCCESSFUL",
            providerResponse: {
              deliveryId: delivery._id,
              trackingNumber:
                delivery.trackingNumber,
              packageName:
                delivery.packageName,
              deliveryFee,
              riderShare:
                deliverySplit.riderCommissionAmount,
              servicepayShare:
                deliverySplit.servicepayProfit,
              paymentStatus: "PAID",
            },
          },
        ],
        {
          session,
        }
      );

    if (delivery.counter) {
      delivery.counter.payment = { method: "WALLET", amount: deliveryFee,
        recordedBy: req.user._id, recordedByName: req.user.fullName || "",
        recordedAt: delivery.paidAt, confirmation: "CUSTOMER_AUTHORIZED_WALLET" };
      delivery.markModified("counter");
      await delivery.save({ session });
      await require("../models/branchAuditLog.model").create([{
        branchId: delivery.branchId, actorId: req.user._id, action: "BRANCH_DELIVERY_WALLET_PAYMENT",
        reason: "Customer authorized the existing Wallet payment.",
        metadata: { orderId: delivery._id, amount: deliveryFee, method: "WALLET" },
      }], { session });
    }
    await enqueueReferralRewardEvent({
      referredCustomerId: delivery.customerId,
      sourceType: "DELIVERY",
      sourceId: delivery._id,
      session,
    });

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
    const sourceSession = await mongoose.startSession();
    try {
      await sourceSession.withTransaction(async () => {
        await delivery.save({ session: sourceSession });
        await enqueueReferralRewardEvent({
          referredCustomerId: delivery.customerId,
          sourceType: "DELIVERY",
          sourceId: delivery._id,
          session: sourceSession,
        });
      });
    } finally {
      await sourceSession.endSession();
    }
    await reconcileReferralReward({
      referredCustomerId: delivery.customerId,
      sourceType: "DELIVERY",
      sourceId: delivery._id,
    });

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
    if (req.user.role === "STATE_MANAGER") {
      filter.customerId = {
        $in: await User.find({
          role: "CUSTOMER",
          stateManagerId: req.user._id,
          isDeleted: { $ne: true },
        }).distinct("_id"),
      };
    }

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
  let session;
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

    const fail = (statusCode, code, message) => {
      throw Object.assign(new Error(message), { statusCode, code });
    };
    session = await mongoose.startSession();
    let updatedDelivery = null;
    await session.withTransaction(async () => {
      const existingDelivery = await Delivery.findById(
        req.params.id
      ).session(session);

      if (!existingDelivery) {
        fail(404, "DELIVERY_NOT_FOUND", "Delivery request not found.");
      }
      if (existingDelivery.paymentStatus !== "UNPAID") {
        fail(
          409,
          "PAID_DELIVERY_PRICE_LOCKED",
          "The price of a paid delivery cannot be changed."
        );
      }
      if (existingDelivery.status === "CANCELLED") {
        fail(400, "DELIVERY_CANCELLED", "A cancelled delivery cannot be priced.");
      }
      if (Number(existingDelivery.deliveryFee) === deliveryFee) {
        updatedDelivery = existingDelivery;
        return;
      }

      updatedDelivery = await Delivery.findOneAndUpdate(
        {
          _id: existingDelivery._id,
          paymentStatus: "UNPAID",
          deliveryFee: existingDelivery.deliveryFee,
          status: existingDelivery.status,
        },
        {
          $set: {
            deliveryFee,
            pricingType: "CUSTOM",
          },
        },
        {
          new: true,
          runValidators: true,
          session,
        }
      );
      if (!updatedDelivery) {
        fail(
          409,
          "DELIVERY_FEE_EDIT_CONFLICT",
          "The delivery payment or fee changed while this edit was being saved. Refresh and try again."
        );
      }
    });

    return res.status(200).json({
      success: true,
      message:
        "Delivery fee updated successfully.",
      delivery: updatedDelivery,
    });
  } catch (error) {
    console.error(
      "Set delivery fee error:",
      error
    );

    const status = error?.statusCode ||
      (error?.code === 112 || error?.code === 251 ||
        error?.hasErrorLabel?.("TransientTransactionError") ? 409 : 500);
    return res.status(status).json({
      success: false,
      message:
        "Unable to update delivery fee.",
      code: error?.code,
      error: error.message,
    });
  } finally {
    if (session) await session.endSession();
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

    const sourceSession = await mongoose.startSession();
    let delivery;
    try {
      await sourceSession.withTransaction(async () => {
        const scope = req.user.role === "STATE_MANAGER"
          ? {
              customerId: {
                $in: await User.find({
                  role: "CUSTOMER",
                  stateManagerId: req.user._id,
                  isDeleted: { $ne: true },
                }).session(sourceSession).distinct("_id"),
              },
            }
          : {};
        delivery = await Delivery.findOneAndUpdate(
          { _id: req.params.id, ...scope },
          updateData,
          {
            new: true,
            runValidators: true,
            session: sourceSession,
          }
        );
        if (delivery) {
          await enqueueReferralRewardEvent({
            referredCustomerId: delivery.customerId,
            sourceType: "DELIVERY",
            sourceId: delivery._id,
            session: sourceSession,
          });
        }
      });
    } finally {
      await sourceSession.endSession();
    }

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery request not found.",
      });
    }

    try {
      await reconcileReferralReward({
        referredCustomerId: delivery.customerId,
        sourceType: "DELIVERY",
        sourceId: delivery._id,
      });
    } catch (error) {
      console.error("DELIVERY_REFERRAL_REWARD_ERROR:", error.message);
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
  return res.status(409).json({
    success: false,
    code: "DELIVERY_PAYMENT_STATUS_REQUIRES_LEDGER",
    message:
      "Delivery payment status cannot be edited directly. Record the payment, refund, or reconciliation through its authoritative financial flow.",
  });
};