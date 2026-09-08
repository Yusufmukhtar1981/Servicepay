const mongoose = require("mongoose");

const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");

const crypto = require("crypto");

const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
const ServicePayTransferAttempt = require("../models/servicePayTransferAttempt.model");
const { verifyTransactionPin } = require("../services/transactionPin.service");
const Transaction = require(
  "../models/transaction.model"
);

const generateReference = () => {
  return `SPT-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

const CLIENT_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const TRANSFER_ATTEMPT_LEASE_MS = 5 * 60 * 1000;
const nextAttemptLease = () => new Date(Date.now() + TRANSFER_ATTEMPT_LEASE_MS);
const recipientHistoryReference = (reference) =>
  `SPTR-${crypto.createHash("sha256").update(reference).digest("hex").slice(0, 48)}`;

const transferLog = (event, fields = {}) => {
  // Keep these logs useful for reconciliation without placing PII or credentials
  // in application logs.
  console.info("servicepay_transfer", { event, ...fields });
};

const intentMatches = (attempt, { senderId, receiverPhone, amount, reference, idempotencyKey }) =>
  String(attempt.sender) === String(senderId) &&
  attempt.receiverPhone === receiverPhone &&
  Number(attempt.amount) === Number(amount) &&
  attempt.reference === reference &&
  attempt.idempotencyKey === idempotencyKey;

const normalizedAttemptStatus = (attempt, transfer) => {
  if (transfer || attempt?.status === "SUCCESS") return "SUCCESS";
  if (attempt?.status === "FAILED") return "FAILED";
  return "PENDING";
};

const MAX_TRANSFER_TRANSACTION_ATTEMPTS = 3;
const TRANSFER_RETRY_ATTEMPT = Symbol("servicePayTransferRetryAttempt");
const TRANSFER_PIN_RETRY_ATTEMPT = Symbol("servicePayTransferPinRetryAttempt");
const TRANSFER_PIN_VERIFIED = Symbol("servicePayTransferPinVerified");
const TRANSFER_ATTEMPT_ID = Symbol("servicePayTransferAttemptId");

const errorLabels = (error) => {
  const labels = new Set();
  for (const candidate of [error, error?.cause, error?.errorResponse]) {
    if (!candidate) continue;
    if (Array.isArray(candidate.errorLabels)) {
      candidate.errorLabels.forEach((label) => labels.add(String(label)));
    }
    for (const label of ["TransientTransactionError", "UnknownTransactionCommitResult"]) {
      if (typeof candidate.hasErrorLabel === "function" && candidate.hasErrorLabel(label)) {
        labels.add(label);
      }
    }
  }
  return [...labels];
};

const mongoErrorCode = (error) =>
  error?.code ?? error?.cause?.code ?? error?.errorResponse?.code;

const mongoErrorCodeName = (error) =>
  error?.codeName ?? error?.cause?.codeName ?? error?.errorResponse?.codeName;

const isUnknownCommitResult = (error) =>
  errorLabels(error).includes("UnknownTransactionCommitResult");

const isRetryableTransferTransactionError = (error) => {
  const labels = errorLabels(error);
  return labels.includes("TransientTransactionError") ||
    isUnknownCommitResult(error) ||
    Number(mongoErrorCode(error)) === 112 ||
    String(mongoErrorCodeName(error) || "").toUpperCase() === "WRITECONFLICT";
};

const retryDelay = async (attempt) => {
  const base = 35 * (2 ** Math.max(0, attempt - 1));
  const jitter = crypto.randomInt(0, 26);
  await new Promise((resolve) => setTimeout(resolve, base + jitter));
};

const logRetryableTransferError = ({ error, reference, attempt, exhausted }) => {
  transferLog("retry", {
    reference,
    attempt,
    exhausted,
    status: "PENDING",
    committed: false,
    mongoCode: mongoErrorCode(error) ?? null,
    mongoCodeName: mongoErrorCodeName(error) ?? null,
    labels: errorLabels(error),
  });
};

const sendCompletedTransfer = ({
  res,
  transfer,
  sender,
  receiver,
  transactionId = null,
  duplicate = false,
}) => {
  return res.status(200).json({
    success: true,
    duplicate,
    message: duplicate
      ? "This payment was already completed."
      : "Transfer completed successfully.",
    data: {
      transferId:
        transfer._id,
      transactionId:
        transactionId ||
        undefined,
      reference:
        transfer.reference,
      status:
        transfer.status,
      amount:
        transfer.amount,
      sender: {
        id:
          sender._id,
        fullName:
          sender.fullName,
        phone:
          sender.phone,
        walletBalance:
          transfer.senderBalanceAfter,
      },
      receiver: {
        id:
          receiver._id,
        fullName:
          receiver.fullName,
        phone:
          receiver.phone,
      },
      receipt: {
        title:
          "ServicePay Transfer Receipt",
        reference:
          transfer.reference,
        status:
          transfer.status,
        amount:
          transfer.amount,
        senderName:
          sender.fullName,
        senderPhone:
          sender.phone,
        beneficiaryName:
          receiver.fullName,
        beneficiaryPhone:
          receiver.phone,
        createdAt:
          transfer.createdAt,
      },
      createdAt:
        transfer.createdAt,
    },
  });
};

/*
 * Check a beneficiary before transfer.
 *
 * Only safe information is returned.
 */
exports.lookupBeneficiary = async (
  req,
  res
) => {
  try {
    const senderId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const receiverPhone = String(
      req.params.phone || ""
    ).trim();

    if (!senderId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before checking a beneficiary.",
      });
    }

    if (!/^\d{11}$/.test(receiverPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 11-digit phone number.",
      });
    }

    const receiver = await User.findOne({
      phone: receiverPhone,
    }).select(
      "_id fullName phone status"
    );

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message:
          "No ServicePay user was found with this phone number.",
      });
    }

    const receiverStatus = String(
      receiver.status || ""
    )
      .trim()
      .toUpperCase();

    if (receiverStatus !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message:
          "The beneficiary account is not active.",
      });
    }

    if (
      receiver._id.toString() ===
      senderId.toString()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "You cannot transfer money to your own account.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Beneficiary found successfully.",
      data: {
        beneficiary: {
          id: receiver._id,
          fullName: receiver.fullName,
          phone: receiver.phone,
        },
      },
    });
  } catch (error) {
    console.error("servicepay_beneficiary_lookup", {
      event: "error",
      senderId: req.user?._id || req.user?.id || req.userId || null,
    });

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify the beneficiary.",
    });
  }
};

exports.getServicePayTransferStatus = async (req, res) => {
  const senderId = req.user?._id || req.user?.id || req.userId;
  const reference = String(req.params.reference || "").trim();
  if (!senderId) {
    return res.status(401).json({ success: false, message: "Please sign in before checking a transfer." });
  }
  if (!CLIENT_REFERENCE_PATTERN.test(reference)) {
    return res.status(400).json({ success: false, message: "Enter a valid transfer reference." });
  }

  try {
    // A committed Transfer is authoritative: an acknowledgement can be lost
    // after Mongo commits, before the request record is marked successful.
    let [attempt, transfer] = await Promise.all([
      ServicePayTransferAttempt.findOne({ sender: senderId, reference }).select(
        "reference status amount failureCode transfer leaseExpiresAt createdAt updatedAt"
      ),
      Transfer.findOne({ sender: senderId, reference })
        .select("sender receiver reference amount status senderBalanceAfter receiverBalanceAfter createdAt")
        .populate([
          { path: "sender", select: "_id fullName phone" },
          { path: "receiver", select: "_id fullName phone" },
        ]),
    ]);
    if (!attempt && !transfer) {
      return res.status(404).json({ success: false, message: "Transfer request was not found." });
    }
    if (
      attempt?.status === "PENDING" &&
      !transfer &&
      attempt.leaseExpiresAt &&
      attempt.leaseExpiresAt <= new Date()
    ) {
      // Compare-and-set is essential: a transaction which acquires SUCCESS
      // first prevents expiry reconciliation, and a reconciliation which wins
      // makes the transaction's guarded SUCCESS update abort.
      const reconciled = await ServicePayTransferAttempt.updateOne(
        {
          _id: attempt._id,
          status: "PENDING",
          leaseExpiresAt: { $lte: new Date() },
        },
        { $set: { status: "FAILED", failureCode: "TRANSFER_REQUEST_EXPIRED" } }
      );
      if (reconciled.matchedCount === 1 || reconciled.n === 1) {
        attempt.status = "FAILED";
        attempt.failureCode = "TRANSFER_REQUEST_EXPIRED";
        transferLog("expired_reconciled", {
          senderId: String(senderId), reference, status: "FAILED", committed: false,
        });
      } else {
        [attempt, transfer] = await Promise.all([
          ServicePayTransferAttempt.findOne({ sender: senderId, reference }).select(
            "reference status amount failureCode transfer leaseExpiresAt createdAt updatedAt"
          ),
          Transfer.findOne({ sender: senderId, reference })
            .select("sender receiver reference amount status senderBalanceAfter receiverBalanceAfter createdAt")
            .populate([
              { path: "sender", select: "_id fullName phone" },
              { path: "receiver", select: "_id fullName phone" },
            ]),
        ]);
      }
    }
    const status = normalizedAttemptStatus(attempt, transfer);
    transferLog("status_lookup", {
      senderId: String(senderId),
      reference,
      status,
      committed: Boolean(transfer),
    });
    const committedReceipt = transfer ? {
      title: "ServicePay Transfer Receipt",
      reference: transfer.reference,
      status: "SUCCESS",
      amount: transfer.amount,
      senderName: transfer.sender?.fullName,
      senderPhone: transfer.sender?.phone,
      beneficiaryName: transfer.receiver?.fullName,
      beneficiaryPhone: transfer.receiver?.phone,
      createdAt: transfer.createdAt,
    } : undefined;
    return res.status(200).json({
      success: true,
      data: {
        reference,
        status,
        amount: Number(transfer?.amount ?? attempt?.amount),
        failureCode: status === "FAILED" ? attempt?.failureCode || undefined : undefined,
        createdAt: transfer?.createdAt || attempt?.createdAt,
        ...(transfer ? {
          sender: {
            id: transfer.sender?._id,
            fullName: transfer.sender?.fullName,
            phone: transfer.sender?.phone,
            walletBalance: transfer.senderBalanceAfter,
          },
          receiver: {
            id: transfer.receiver?._id,
            fullName: transfer.receiver?.fullName,
            phone: transfer.receiver?.phone,
          },
          receipt: committedReceipt,
        } : {}),
      },
    });
  } catch (error) {
    transferLog("status_lookup_error", { senderId: String(senderId), reference });
    return res.status(500).json({ success: false, message: "Unable to check transfer status." });
  }
};

/*
 * ServicePay-to-ServicePay transfer.
 */
exports.transfer = async (
  req,
  res
) => {
  let session = null;
  let senderId = null;
  let idempotencyKey = "";
  let reference = req.servicePayTransferReference || "";
  let attemptRecord = null;
  const markAttemptFailed = async (failureCode) => {
    if (!attemptRecord?._id) return;
    try {
      await ServicePayTransferAttempt.updateOne(
        { _id: attemptRecord._id, status: "PENDING" },
        { $set: { status: "FAILED", failureCode } }
      );
      transferLog("attempt_failed", {
        senderId: senderId ? String(senderId) : null,
        reference,
        status: "FAILED",
        failureCode,
        committed: false,
      });
    } catch (_) {
      // Do not turn a failed attempt-state write into a claimed final outcome.
      // It remains PENDING and is recoverable by the status endpoint.
      transferLog("attempt_failure_state_unavailable", {
        senderId: senderId ? String(senderId) : null,
        reference,
        status: "PENDING",
        committed: false,
      });
    }
  };
  const transactionAttempt = Number(req[TRANSFER_RETRY_ATTEMPT] || 1);
  const pinRetryAttempt = Number(req[TRANSFER_PIN_RETRY_ATTEMPT] || 1);

  try {
    senderId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const receiverPhone = String(
      req.body.receiverPhone || ""
    ).trim();

    // Accept legacy aliases only at the request boundary.
    const transactionPin = req.body.transactionPin ?? req.body.pin;

    const transferAmount = Number(
      req.body.amount
    );

    idempotencyKey = String(
      req.get("Idempotency-Key") ||
      req.body.idempotencyKey ||
      ""
    ).trim();

    if (!senderId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before making a transfer.",
      });
    }

    transferLog("received", {
      senderId: String(senderId),
      reference: reference || null,
      status: "PENDING",
      committed: false,
    });

    if (
      !receiverPhone ||
      req.body.amount === undefined
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Recipient phone number and amount are required.",
      });
    }

    if (!/^\d{11}$/.test(receiverPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 11-digit recipient phone number.",
      });
    }

    if (
      !Number.isFinite(transferAmount) ||
      transferAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid transfer amount.",
      });
    }

    if (idempotencyKey.length < 12 || idempotencyKey.length > 128) {
      return res.status(400).json({
        success: false,
        message:
          "A valid payment request identifier is required.",
      });
    }

    const suppliedReference = req.body.clientReference;
    if (suppliedReference !== undefined && suppliedReference !== null) {
      reference = String(suppliedReference).trim();
      if (!CLIENT_REFERENCE_PATTERN.test(reference)) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid client transfer reference.",
        });
      }
    } else if (!reference) {
      // Existing mobile clients did not send a reference.  Keep them working,
      // while pinning the generated value to this request for transaction retry.
      reference = generateReference();
    }
    req.servicePayTransferReference = reference;

    const amount =
      Math.round(
        (
          transferAmount +
          Number.EPSILON
        ) *
          100
      ) / 100;

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message:
          "Minimum transfer amount is ₦100.",
      });
    }

    /*
     * Reserve the request before PIN admission or wallet work.  It binds both
     * replay identifiers to the complete transfer intent and gives recovery a
     * durable PENDING/FAILED record without making Transfer non-financial.
     */
    let existingAttempt = await ServicePayTransferAttempt.findOne({
      $or: [
        { reference },
        { sender: senderId, idempotencyKey },
      ],
    });
    if (existingAttempt) {
      const sameBaseIntent =
        String(existingAttempt.sender) === String(senderId) &&
        existingAttempt.receiverPhone === receiverPhone &&
        Number(existingAttempt.amount) === Number(amount) &&
        existingAttempt.idempotencyKey === idempotencyKey;
      const isInternalRetry =
        String(req[TRANSFER_ATTEMPT_ID] || "") === String(existingAttempt._id);
      // A legacy caller has no stable client reference.  Its idempotency key
      // is therefore the stable replay identity; adopt the original reference
      // before checking/returning the original outcome.
      const legacyIdempotentRequest =
        (suppliedReference === undefined || suppliedReference === null) &&
        !req[TRANSFER_ATTEMPT_ID] &&
        sameBaseIntent;
      if (legacyIdempotentRequest) {
        reference = existingAttempt.reference;
        req.servicePayTransferReference = reference;
      }
      if (!sameBaseIntent || (!isInternalRetry && !legacyIdempotentRequest &&
        !intentMatches(existingAttempt, {
          senderId, receiverPhone, amount, reference, idempotencyKey,
        }))) {
        return res.status(409).json({
          success: false,
          code: sameBaseIntent ? "TRANSFER_INTENT_REUSED" : "IDEMPOTENCY_KEY_REUSED",
          message: "This transfer reference or payment request identifier was already used for a different transfer.",
        });
      }
      if (isInternalRetry) {
        attemptRecord = existingAttempt;
        const leaseExpiresAt = nextAttemptLease();
        const refreshed = await ServicePayTransferAttempt.updateOne(
          { _id: attemptRecord._id, status: "PENDING" },
          { $set: { leaseExpiresAt } }
        );
        if (!(refreshed.matchedCount === 1 || refreshed.n === 1)) {
          return res.status(409).json({
            success: false,
            code: "TRANSFER_REQUEST_EXPIRED",
            message: "This transfer request has expired. Use a new reference to try again.",
          });
        }
        attemptRecord.leaseExpiresAt = leaseExpiresAt;
      } else {
      let committed = null;
      // A duplicate tap can arrive while the first request is at commit. Give
      // that short window a chance to resolve before returning recoverable
      // PENDING, keeping normal duplicate taps pleasant without inventing an
      // outcome.
      for (let wait = 0; wait < 10 && !committed; wait += 1) {
        committed = await Transfer.findOne({ sender: senderId, reference })
          .populate([{ path: "sender", select: "_id fullName phone" }, { path: "receiver", select: "_id fullName phone" }]);
        if (!committed && existingAttempt.status === "PENDING" && wait < 9) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (committed?.sender && committed?.receiver) {
        transferLog("duplicate_success", { senderId: String(senderId), reference, status: "SUCCESS", committed: true });
        return sendCompletedTransfer({
          res, transfer: committed, sender: committed.sender, receiver: committed.receiver, duplicate: true,
        });
      }
      return res.status(existingAttempt.status === "FAILED" ? 409 : 202).json({
        success: false,
        code: existingAttempt.status === "FAILED" ? existingAttempt.failureCode || "TRANSFER_FAILED" : "TRANSFER_PENDING",
        message: existingAttempt.status === "FAILED"
          ? "This transfer request failed. Use a new reference to try again."
          : "Transfer outcome is still being confirmed.",
        data: { reference, status: normalizedAttemptStatus(existingAttempt) },
      });
      }
    }
    if (!attemptRecord) try {
      attemptRecord = await ServicePayTransferAttempt.create({
        sender: senderId, receiverPhone, amount, reference, idempotencyKey,
        status: "PENDING", leaseExpiresAt: nextAttemptLease(),
      });
      req[TRANSFER_ATTEMPT_ID] = attemptRecord._id;
    } catch (createError) {
      if (createError?.code === 11000) {
        // A competing tap reserved it; rerun the idempotent admission path.
        return exports.transfer(req, res);
      }
      throw createError;
    }

    /*
     * PIN admission updates lockout counters outside the business transaction.
     * Running it after a transactional read of the sender makes MongoDB see a
     * stale snapshot when the wallet is later debited, causing a WriteConflict.
     */
    if (!req[TRANSFER_PIN_VERIFIED]) {
      await verifyTransactionPin(senderId, transactionPin);
      req[TRANSFER_PIN_VERIFIED] = true;
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const sender = await User.findById(
      senderId
    ).session(session);

    if (!sender) {
      await session.abortTransaction();
      await markAttemptFailed("SENDER_NOT_FOUND");

      return res.status(404).json({
        success: false,
        message:
          "Sender account was not found.",
      });
    }

    const senderStatus = String(
      sender.status || ""
    )
      .trim()
      .toUpperCase();

    if (senderStatus !== "ACTIVE") {
      await session.abortTransaction();
      await markAttemptFailed("SENDER_NOT_ACTIVE");

      return res.status(403).json({
        success: false,
        message:
          "Your account is not active.",
      });
    }

    const receiver = await User.findOne({
      phone: receiverPhone,
    }).session(session);

    if (!receiver) {
      await session.abortTransaction();
      await markAttemptFailed("INVALID_RECIPIENT");

      return res.status(404).json({
        success: false,
        message:
          "No ServicePay user was found with this phone number.",
      });
    }

    const receiverStatus = String(
      receiver.status || ""
    )
      .trim()
      .toUpperCase();

    if (receiverStatus !== "ACTIVE") {
      await session.abortTransaction();
      await markAttemptFailed("RECIPIENT_NOT_ACTIVE");

      return res.status(403).json({
        success: false,
        message:
          "The beneficiary account is not active.",
      });
    }

    if (
      sender._id.toString() ===
      receiver._id.toString()
    ) {
      await session.abortTransaction();
      await markAttemptFailed("SELF_TRANSFER");

      return res.status(400).json({
        success: false,
        message:
          "You cannot transfer money to your own account.",
      });
    }

    if (idempotencyKey) {
      const existingTransfer =
        await Transfer.findOne({
          sender: sender._id,
          idempotencyKey,
        }).session(session);

      if (existingTransfer) {
        await session.abortTransaction();

        if (
          String(existingTransfer.receiver) !== String(receiver._id) ||
          Number(existingTransfer.amount) !== amount
        ) {
          return res.status(409).json({
            success: false,
            code: "IDEMPOTENCY_KEY_REUSED",
            message:
              "This payment request identifier was already used for a different transfer.",
          });
        }

        return sendCompletedTransfer({
          res,
          transfer:
            existingTransfer,
          sender,
          receiver,
          duplicate: true,
        });
      }
    }

    if (
      Number(sender.walletBalance || 0) <
      amount
    ) {
      await session.abortTransaction();
      await markAttemptFailed("INSUFFICIENT_FUNDS");

      return res.status(400).json({
        success: false,
        message:
          "Your wallet balance is insufficient for this transfer.",
        data: {
          walletBalance: Number(
            sender.walletBalance || 0
          ),
          amount,
        },
      });
    }

    /*
     * Debit sender.
     */
    const updatedSender =
      await User.findOneAndUpdate(
        {
          _id: sender._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: amount,
          },
        },
        {
          $inc: {
            walletBalance: -amount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

    if (!updatedSender) {
      await session.abortTransaction();
      await markAttemptFailed("INSUFFICIENT_FUNDS");

      return res.status(400).json({
        success: false,
        message:
          "Your wallet balance is insufficient, or the debit could not be completed.",
      });
    }

    /*
     * Credit beneficiary.
     */
    const updatedReceiver =
      await User.findOneAndUpdate(
        {
          _id: receiver._id,
          status: "ACTIVE",
        },
        {
          $inc: {
            walletBalance: amount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
          runValidators: true,
        }
      );

    if (!updatedReceiver) {
      throw new Error(
        "Unable to credit the beneficiary wallet."
      );
    }

    /*
     * Save transfer record.
     */
    const transfers =
      await Transfer.create(
        [
          {
            sender:
              updatedSender._id,
            receiver:
              updatedReceiver._id,
            amount,
            reference,
            idempotencyKey:
              idempotencyKey ||
              undefined,
            status: "SUCCESSFUL",
            senderBalanceAfter:
              updatedSender.walletBalance,
            receiverBalanceAfter:
              updatedReceiver.walletBalance,
          },
        ],
        {
          session,
        }
      );

    const savedTransfer =
      transfers[0];

    /*
     * Save sender transaction history.
     *
     * providerResponse contains receipt details.
     */
    const senderTransactions =
      await Transaction.create(
        [
          {
            reference,
            customerId:
              updatedSender._id,

            agentId:
              updatedSender.agentId ||
              null,

            stateManagerId:
              updatedSender
                .stateManagerId ||
              null,

            zonalManagerId:
              updatedSender
                .zonalManagerId ||
              null,

            serviceType: "TRANSFER",
            provider:
              "SERVICEPAY",

            phone:
              updatedReceiver.phone,

            amount,
            status: "SUCCESSFUL",

            providerResponse: {
              transactionDirection:
                "DEBIT",

              transferType:
                "SERVICEPAY_TO_SERVICEPAY",

              narration:
                `Transfer to ${updatedReceiver.fullName}`,

              sender: {
                id:
                  updatedSender._id,
                fullName:
                  updatedSender.fullName,
                phone:
                  updatedSender.phone,
                balanceAfter:
                  updatedSender
                    .walletBalance,
              },

              beneficiary: {
                id:
                  updatedReceiver._id,
                fullName:
                  updatedReceiver
                    .fullName,
                phone:
                  updatedReceiver.phone,
                balanceAfter:
                  updatedReceiver
                    .walletBalance,
              },

              transferId:
                savedTransfer._id,

              reference,
              amount,
              status:
                "SUCCESSFUL",

              receiptTitle:
                "ServicePay Transfer Receipt",
            },
          },
        ],
        {
          session,
        }
      );

    const savedTransaction =
      senderTransactions[0];

    // Transaction.reference is globally unique, so the beneficiary receives a
    // deterministic sibling reference while the provider receipt retains the
    // canonical client reference.
    await Transaction.create(
      [
        {
          reference: recipientHistoryReference(reference),
          customerId: updatedReceiver._id,
          agentId: updatedReceiver.agentId || null,
          stateManagerId: updatedReceiver.stateManagerId || null,
          zonalManagerId: updatedReceiver.zonalManagerId || null,
          serviceType: "TRANSFER",
          provider: "SERVICEPAY",
          phone: updatedSender.phone,
          amount,
          status: "SUCCESSFUL",
          providerResponse: {
            transactionDirection: "CREDIT",
            transferType: "SERVICEPAY_TO_SERVICEPAY",
            narration: `Transfer from ${updatedSender.fullName}`,
            transferId: savedTransfer._id,
            reference,
            amount,
            status: "SUCCESSFUL",
            receiptTitle: "ServicePay Transfer Receipt",
          },
        },
      ],
      { session }
    );

    /*
     * =====================================================
     * SERVICEPAY_CORE_LEDGER_TRANSFER_V1
     * =====================================================
     * Wallet debit + credit + ledger entries all live inside
     * the same MongoDB session.
     *
     * If any ledger write fails, the complete transfer rolls
     * back before commit.
     */

    const senderClosingBalance =
      Number(updatedSender.walletBalance);

    const senderOpeningBalance =
      Number(
        (
          senderClosingBalance +
          Number(amount)
        ).toFixed(2)
      );

    const receiverClosingBalance =
      Number(updatedReceiver.walletBalance);

    const receiverOpeningBalance =
      Number(
        (
          receiverClosingBalance -
          Number(amount)
        ).toFixed(2)
      );

    await postDebit({
      userId: updatedSender._id,
      amount,
      openingBalance:
        senderOpeningBalance,
      closingBalance:
        senderClosingBalance,
      service:
        "SERVICEPAY_TRANSFER",
      reference,
      idempotencyKey:
        `TRANSFER:${reference}:SENDER:DEBIT`,
      transactionId:
        savedTransaction._id,
      relatedUser:
        updatedReceiver._id,
      narration:
        `Transfer to ${updatedReceiver.fullName}`,
      metadata: {
        transferId:
          savedTransfer?._id
            ? String(savedTransfer._id)
            : null,
        senderPhone:
          updatedSender.phone,
        receiverPhone:
          updatedReceiver.phone,
        transferType:
          "SERVICEPAY_TO_SERVICEPAY",
      },
      session,
    });

    await postCredit({
      userId: updatedReceiver._id,
      amount,
      openingBalance:
        receiverOpeningBalance,
      closingBalance:
        receiverClosingBalance,
      service:
        "SERVICEPAY_TRANSFER",
      reference,
      idempotencyKey:
        `TRANSFER:${reference}:RECEIVER:CREDIT`,
      transactionId:
        savedTransaction._id,
      relatedUser:
        updatedSender._id,
      narration:
        `Transfer from ${updatedSender.fullName}`,
      metadata: {
        transferId:
          savedTransfer?._id
            ? String(savedTransfer._id)
            : null,
        senderPhone:
          updatedSender.phone,
        receiverPhone:
          updatedReceiver.phone,
        transferType:
          "SERVICEPAY_TO_SERVICEPAY",
      },
      session,
    });

    // This write shares the financial commit.  A successful request record
    // therefore cannot exist without the debit, credit, histories and ledger.
    const successAttemptUpdate = await ServicePayTransferAttempt.updateOne(
      { _id: attemptRecord._id, status: "PENDING" },
      {
        $set: {
          status: "SUCCESS",
          transfer: savedTransfer._id,
          receiver: updatedReceiver._id,
          failureCode: null,
        },
      },
      { session }
    );
    if (!(successAttemptUpdate.matchedCount === 1 || successAttemptUpdate.n === 1)) {
      const leaseLost = new Error("Transfer attempt was reconciled before commit.");
      leaseLost.code = "TRANSFER_REQUEST_EXPIRED";
      throw leaseLost;
    }

    await session.commitTransaction();

    transferLog("committed", {
      senderId: String(updatedSender._id),
      receiverId: String(updatedReceiver._id),
      reference,
      status: "SUCCESS",
      committed: true,
    });

    return sendCompletedTransfer({
      res,
      transfer:
        savedTransfer,
      sender:
        updatedSender,
      receiver:
        updatedReceiver,
      transactionId:
        savedTransaction._id,
    });
  } catch (error) {
    if (session?.inTransaction()) {
      await session.abortTransaction();
    }

    if (idempotencyKey && senderId) {
      let existingTransfer = null;

      for (
        let attempt = 0;
        attempt < 10 && !existingTransfer;
        attempt += 1
      ) {
        existingTransfer =
          await Transfer.findOne({
            sender:
              senderId,
            idempotencyKey,
          }).populate([
            {
              path: "sender",
              select:
                "_id fullName phone",
            },
            {
              path: "receiver",
              select:
                "_id fullName phone",
            },
          ]);

        if (!existingTransfer && attempt < 9) {
          await new Promise(
            (resolve) =>
              setTimeout(resolve, 50)
          );
        }
      }

      if (
        existingTransfer &&
        existingTransfer.sender &&
        existingTransfer.receiver
      ) {
        const sameReceiver =
          String(existingTransfer.receiver.phone || "") ===
          String(req.body.receiverPhone || "").trim();
        const sameAmount =
          Number(existingTransfer.amount) ===
          Math.round((Number(req.body.amount) + Number.EPSILON) * 100) / 100;
        if (!sameReceiver || !sameAmount) {
          return res.status(409).json({
            success: false,
            code: "IDEMPOTENCY_KEY_REUSED",
            message:
              "This payment request identifier was already used for a different transfer.",
          });
        }
        return sendCompletedTransfer({
          res,
          transfer:
            existingTransfer,
          sender:
            existingTransfer.sender,
          receiver:
            existingTransfer.receiver,
          duplicate: true,
        });
      }
    }

    if (isRetryableTransferTransactionError(error)) {
      const exhausted =
        transactionAttempt >= MAX_TRANSFER_TRANSACTION_ATTEMPTS;
      logRetryableTransferError({
        error,
        reference,
        attempt: transactionAttempt,
        exhausted,
      });

      if (!exhausted) {
        if (session) {
          await session.endSession();
          session = null;
        }
        await retryDelay(transactionAttempt);
        req[TRANSFER_RETRY_ATTEMPT] = transactionAttempt + 1;
        return exports.transfer(req, res);
      }

      return res.status(503).json({
        success: false,
        code: isUnknownCommitResult(error)
          ? "TRANSFER_RESULT_UNCONFIRMED"
          : "TRANSFER_TEMPORARILY_UNAVAILABLE",
        message:
          "Transfer could not be completed at the moment. No duplicate charge was made. Please try again.",
      });
    }

    if (
      error?.code === "TRANSACTION_PIN_RETRY_REQUIRED" &&
      pinRetryAttempt < MAX_TRANSFER_TRANSACTION_ATTEMPTS
    ) {
      transferLog("pin_admission_retry", {
        senderId: senderId ? String(senderId) : null,
        reference: reference || null,
        attempt: pinRetryAttempt,
        status: "PENDING",
        committed: false,
      });
      await retryDelay(pinRetryAttempt);
      req[TRANSFER_PIN_RETRY_ATTEMPT] = pinRetryAttempt + 1;
      return exports.transfer(req, res);
    }

    const definitiveFailureCodes = [
      "INVALID_TRANSACTION_PIN",
      "TRANSACTION_PIN_NOT_SET",
      "INCORRECT_TRANSACTION_PIN",
      "TRANSACTION_PIN_LOCKED",
      "USER_NOT_FOUND",
    ];
    if (!isRetryableTransferTransactionError(error)) {
      await markAttemptFailed(
        definitiveFailureCodes.includes(error?.code)
          ? error.code
          : "TRANSFER_PROCESSING_FAILED"
      );
    }
    transferLog("rollback", {
      senderId: senderId ? String(senderId) : null,
      reference: reference || null,
      status: isRetryableTransferTransactionError(error) ? "PENDING" : "FAILED",
      committed: false,
      mongoCode: mongoErrorCode(error) ?? null,
      labels: errorLabels(error),
    });

    if (error?.statusCode && [
      "INVALID_TRANSACTION_PIN",
      "TRANSACTION_PIN_NOT_SET",
      "INCORRECT_TRANSACTION_PIN",
      "TRANSACTION_PIN_LOCKED",
      "TRANSACTION_PIN_RETRY_REQUIRED",
      "USER_NOT_FOUND",
    ].includes(error.code)) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "The transfer reference was duplicated. Please try again.",
      });
    }

    if (error?.code === "TRANSFER_REQUEST_EXPIRED") {
      return res.status(409).json({
        success: false,
        code: "TRANSFER_REQUEST_EXPIRED",
        message: "This transfer request has expired. Use a new reference to try again.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Transfer could not be completed at the moment. No duplicate charge was made. Please try again.",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

exports.__testOnly = {
  errorLabels,
  isRetryableTransferTransactionError,
  isUnknownCommitResult,
};