const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require(
  "../models/transaction.model"
);
const SecurewaveWebhook = require(
  "../models/securewaveWebhook.model"
);

const getHeaderValue = (req, name) => {
  const value = req.headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] || "";
  }

  return String(value || "").trim();
};

const safeCompare = (firstValue, secondValue) => {
  const firstBuffer = Buffer.from(
    String(firstValue || ""),
    "utf8"
  );

  const secondBuffer = Buffer.from(
    String(secondValue || ""),
    "utf8"
  );

  if (
    firstBuffer.length === 0 ||
    firstBuffer.length !== secondBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer
  );
};

const verifySecureWaveSignature = (req) => {
  const webhookSecret =
    process.env.SECUREWAVE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    const error = new Error(
      "SecureWaveNG webhook secret is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  const receivedSignature =
    getHeaderValue(req, "x-signature");

  if (!receivedSignature) {
    return false;
  }

  const rawPayload = req.rawBody;

  if (
    !rawPayload ||
    !Buffer.isBuffer(rawPayload)
  ) {
    return false;
  }

  const expectedHexSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawPayload)
    .digest("hex");

  const expectedBase64Signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawPayload)
    .digest("base64");

  const normalizedReceivedSignature =
    receivedSignature
      .replace(/^sha256=/i, "")
      .trim();

  return (
    safeCompare(
      normalizedReceivedSignature,
      expectedHexSignature
    ) ||
    safeCompare(
      normalizedReceivedSignature,
      expectedBase64Signature
    )
  );
};

const firstNonEmptyValue = (...values) => {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return null;
};

const normalizeMoney = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.round(amount * 100) / 100;
};

const normalizeText = (value) => {
  return String(value || "").trim();
};

const extractWebhookData = (payload) => {
  const data =
    payload?.data &&
    typeof payload.data === "object"
      ? payload.data
      : payload;

  const virtualAccount =
    data?.virtual_account &&
    typeof data.virtual_account === "object"
      ? data.virtual_account
      : {};

  const customer =
    data?.customer &&
    typeof data.customer === "object"
      ? data.customer
      : {};

  const transactionId = normalizeText(
    firstNonEmptyValue(
      data?.transaction_id,
      data?.transactionId,
      data?.id,
      payload?.transaction_id,
      payload?.transactionId,
      payload?.id
    )
  );

  const providerReference = normalizeText(
    firstNonEmptyValue(
      data?.provider_reference,
      data?.providerReference,
      data?.reference,
      payload?.provider_reference,
      payload?.providerReference,
      payload?.reference
    )
  );

  const accountNumber = normalizeText(
    firstNonEmptyValue(
      data?.account_number,
      data?.accountNumber,
      data?.virtual_account_number,
      data?.virtualAccountNumber,
      virtualAccount?.account_number,
      virtualAccount?.accountNumber,
      virtualAccount?.number,
      customer?.account_number,
      customer?.accountNumber,
      payload?.account_number,
      payload?.accountNumber
    )
  );

  const notificationStatus = normalizeText(
    firstNonEmptyValue(
      data?.notification_status,
      data?.notificationStatus,
      payload?.notification_status,
      payload?.notificationStatus
    )
  ).toLowerCase();

  const transactionStatus = normalizeText(
    firstNonEmptyValue(
      data?.transaction_status,
      data?.transactionStatus,
      data?.status,
      payload?.transaction_status,
      payload?.transactionStatus,
      payload?.status
    )
  ).toLowerCase();

  const transactionType = normalizeText(
    firstNonEmptyValue(
      data?.transaction_type,
      data?.transactionType,
      data?.type,
      payload?.transaction_type,
      payload?.transactionType,
      payload?.type
    )
  ).toLowerCase();

  const amount = normalizeMoney(
    firstNonEmptyValue(
      data?.amount,
      payload?.amount
    )
  );

  const fees = normalizeMoney(
    firstNonEmptyValue(
      data?.fees,
      data?.fee,
      payload?.fees,
      payload?.fee
    )
  );

  const settlementAmount = normalizeMoney(
    firstNonEmptyValue(
      data?.settlement_amount,
      data?.settlementAmount,
      payload?.settlement_amount,
      payload?.settlementAmount,
      amount
    )
  );

  const currency = normalizeText(
    firstNonEmptyValue(
      data?.currency,
      payload?.currency,
      "NGN"
    )
  ).toUpperCase();

  return {
    transactionId,
    providerReference,
    accountNumber,
    notificationStatus,
    transactionStatus,
    transactionType,
    amount,
    fees,
    settlementAmount,
    currency,
  };
};

const isSuccessfulPayment = ({
  notificationStatus,
  transactionStatus,
}) => {
  const successfulNotificationStatuses = [
    "payment_successful",
    "successful",
    "success",
    "completed",
  ];

  const successfulTransactionStatuses = [
    "successful",
    "success",
    "completed",
  ];

  return (
    successfulNotificationStatuses.includes(
      notificationStatus
    ) ||
    successfulTransactionStatuses.includes(
      transactionStatus
    )
  );
};

/*
 * POST /api/securewave/webhook
 */
exports.handleVirtualAccountWebhook = async (
  req,
  res
) => {
  let webhookEvent = null;
  let session = null;

  try {
    const isValidSignature =
      verifySecureWaveSignature(req);

    if (!isValidSignature) {
      return res.status(401).json({
        success: false,
        message:
          "Invalid SecureWaveNG webhook signature.",
      });
    }

    const payload = req.body || {};

    const webhookData =
      extractWebhookData(payload);

    if (!webhookData.transactionId) {
      return res.status(400).json({
        success: false,
        message:
          "Webhook transaction ID is missing.",
      });
    }

    /*
     * Idempotency:
     * If SecureWaveNG resends the same event,
     * acknowledge it without crediting again.
     */
    const existingEvent =
      await SecurewaveWebhook.findOne({
        transactionId:
          webhookData.transactionId,
      });

    if (existingEvent) {
      return res.status(200).json({
        success: true,
        message:
          "Webhook event was already received.",
      });
    }

    try {
      webhookEvent =
        await SecurewaveWebhook.create({
          transactionId:
            webhookData.transactionId,

          providerReference:
            webhookData.providerReference ||
            null,

          notificationStatus:
            webhookData.notificationStatus ||
            null,

          transactionStatus:
            webhookData.transactionStatus ||
            null,

          transactionType:
            webhookData.transactionType ||
            null,

          accountNumber:
            webhookData.accountNumber ||
            null,

          amount: webhookData.amount,

          fees: webhookData.fees,

          settlementAmount:
            webhookData.settlementAmount,

          currency:
            webhookData.currency || "NGN",

          status: "RECEIVED",

          payload,
        });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(200).json({
          success: true,
          message:
            "Webhook event was already received.",
        });
      }

      throw error;
    }

    if (
      !isSuccessfulPayment(webhookData)
    ) {
      webhookEvent.status = "IGNORED";
      webhookEvent.failureReason =
        "Webhook is not a successful payment event.";
      webhookEvent.processedAt = new Date();

      await webhookEvent.save();

      return res.status(200).json({
        success: true,
        message:
          "Webhook received but no wallet credit was required.",
      });
    }

    if (
      webhookData.currency &&
      webhookData.currency !== "NGN"
    ) {
      webhookEvent.status = "IGNORED";
      webhookEvent.failureReason =
        `Unsupported currency: ${webhookData.currency}`;
      webhookEvent.processedAt = new Date();

      await webhookEvent.save();

      return res.status(200).json({
        success: true,
        message:
          "Webhook currency is not supported.",
      });
    }

    if (!webhookData.accountNumber) {
      webhookEvent.status = "FAILED";
      webhookEvent.failureReason =
        "Virtual account number is missing.";
      webhookEvent.processedAt = new Date();

      await webhookEvent.save();

      return res.status(400).json({
        success: false,
        message:
          "Virtual account number is missing.",
      });
    }

    if (webhookData.amount <= 0) {
      webhookEvent.status = "FAILED";
      webhookEvent.failureReason =
        "Webhook amount must be greater than zero.";
      webhookEvent.processedAt = new Date();

      await webhookEvent.save();

      return res.status(400).json({
        success: false,
        message:
          "Webhook amount is invalid.",
      });
    }

    const customer = await User.findOne({
      "virtualAccount.accountNumber":
        webhookData.accountNumber,

      "virtualAccount.provider":
        "SECUREWAVENG",
    });

    if (!customer) {
      webhookEvent.status = "FAILED";
      webhookEvent.failureReason =
        "No ServicePay customer matches the virtual account number.";
      webhookEvent.processedAt = new Date();

      await webhookEvent.save();

      return res.status(404).json({
        success: false,
        message:
          "Virtual account customer was not found.",
      });
    }

    /*
     * Wallet credit uses the incoming amount.
     * Provider fees and settlement figures remain
     * recorded in the webhook event for reconciliation.
     */
    const walletCreditAmount =
      webhookData.amount;

    session = await mongoose.startSession();

    await session.withTransaction(
      async () => {
        const duplicateTransaction =
          await Transaction.findOne({
            reference:
              webhookData.transactionId,
          }).session(session);

        if (duplicateTransaction) {
          return;
        }

        const updatedCustomer =
          await User.findOneAndUpdate(
            {
              _id: customer._id,
              status: "ACTIVE",
            },
            {
              $inc: {
                walletBalance:
                  walletCreditAmount,
                totalTransactions: 1,
              },
            },
            {
              new: true,
              session,
            }
          );

        if (!updatedCustomer) {
          throw new Error(
            "Customer is not active or could not be updated."
          );
        }

        await Transaction.create(
          [
            {
              reference:
                webhookData.transactionId,

              customerId:
                updatedCustomer._id,

              agentId:
                updatedCustomer.agentId ||
                null,

              stateManagerId:
                updatedCustomer
                  .stateManagerId || null,

              zonalManagerId:
                updatedCustomer
                  .zonalManagerId || null,

              serviceType:
                "WALLET_FUNDING",

              provider: "SECUREWAVENG",

              phone:
                updatedCustomer.phone,

              amount:
                walletCreditAmount,

              status: "SUCCESSFUL",

              providerResponse: payload,
            },
          ],
          {
            session,
          }
        );

        await SecurewaveWebhook.updateOne(
          {
            _id: webhookEvent._id,
          },
          {
            $set: {
              status: "PROCESSED",

              creditedUserId:
                updatedCustomer._id,

              walletCreditedAmount:
                walletCreditAmount,

              failureReason: null,

              processedAt: new Date(),
            },
          },
          {
            session,
          }
        );
      }
    );

    const processedEvent =
      await SecurewaveWebhook.findById(
        webhookEvent._id
      );

    if (
      processedEvent?.status ===
      "PROCESSED"
    ) {
      return res.status(200).json({
        success: true,
        message:
          "Wallet funded successfully.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Webhook was already processed.",
    });
  } catch (error) {
    console.error(
      "SecureWave webhook error:",
      error
    );

    if (webhookEvent?._id) {
      try {
        await SecurewaveWebhook.updateOne(
          {
            _id: webhookEvent._id,
            status: {
              $ne: "PROCESSED",
            },
          },
          {
            $set: {
              status: "FAILED",
              failureReason:
                error.message ||
                "Webhook processing failed.",
              processedAt: new Date(),
            },
          }
        );
      } catch (updateError) {
        console.error(
          "Unable to update webhook failure:",
          updateError.message
        );
      }
    }

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to process SecureWaveNG webhook.",
      });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};