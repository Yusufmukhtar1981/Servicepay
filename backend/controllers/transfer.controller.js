const mongoose = require("mongoose");

const {
  postDebit,
  postCredit,
} = require("../services/ledger.service");

const crypto = require("crypto");

const User = require("../models/user.model");
const Transfer = require("../models/transfer.model");
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

const MAX_TRANSFER_TRANSACTION_ATTEMPTS = 3;
const TRANSFER_RETRY_ATTEMPT = Symbol("servicePayTransferRetryAttempt");
const TRANSFER_PIN_RETRY_ATTEMPT = Symbol("servicePayTransferPinRetryAttempt");
const TRANSFER_PIN_VERIFIED = Symbol("servicePayTransferPinVerified");

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
  console.error("ServicePay transfer transaction retry:", {
    reference,
    attempt,
    exhausted,
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
    console.error(
      "Beneficiary lookup error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify the beneficiary.",
    });
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
  const transactionAttempt = Number(req[TRANSFER_RETRY_ATTEMPT] || 1);
  const pinRetryAttempt = Number(req[TRANSFER_PIN_RETRY_ATTEMPT] || 1);

  try {
    console.log(
      "========== NEW SERVICEPAY TRANSFER =========="
    );

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
     * PIN admission updates lockout counters outside the business transaction.
     * Running it after a transactional read of the sender makes MongoDB see a
     * stale snapshot when the wallet is later debited, causing a WriteConflict.
     */
    if (!req[TRANSFER_PIN_VERIFIED]) {
      await verifyTransactionPin(senderId, transactionPin);
      req[TRANSFER_PIN_VERIFIED] = true;
    }

    if (!reference) {
      reference = generateReference();
      req.servicePayTransferReference = reference;
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const sender = await User.findById(
      senderId
    ).session(session);

    if (!sender) {
      await session.abortTransaction();

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

    await session.commitTransaction();

    console.log(
      "ServicePay transfer successful:",
      {
        reference,
        sender:
          updatedSender.phone,
        receiver:
          updatedReceiver.phone,
        amount,
      }
    );

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
      console.warn("ServicePay transfer PIN admission retry:", {
        reference: reference || null,
        attempt: pinRetryAttempt,
      });
      await retryDelay(pinRetryAttempt);
      req[TRANSFER_PIN_RETRY_ATTEMPT] = pinRetryAttempt + 1;
      return exports.transfer(req, res);
    }

    console.error(
      "ServicePay transfer error:",
      error
    );

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