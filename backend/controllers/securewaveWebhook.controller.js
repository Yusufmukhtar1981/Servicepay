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
  const value =
    req.headers[String(name).toLowerCase()];

  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return String(value || "").trim();
};

const safeCompare = (first, second) => {
  const firstBuffer = Buffer.from(
    String(first || ""),
    "utf8"
  );

  const secondBuffer = Buffer.from(
    String(second || ""),
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

const verifySignature = (req) => {
  const secret = String(
    process.env.SECUREWAVE_WEBHOOK_SECRET || ""
  ).trim();

  if (!secret) {
    const error = new Error(
      "SecureWaveNG webhook secret is not configured."
    );

    error.statusCode = 503;
    throw error;
  }

  const receivedSignature =
    getHeaderValue(req, "x-signature") ||
    getHeaderValue(
      req,
      "x-securewave-signature"
    ) ||
    getHeaderValue(
      req,
      "securewave-signature"
    );

  if (!receivedSignature) {
    return false;
  }

  if (!Buffer.isBuffer(req.rawBody)) {
    return false;
  }

  const normalizedSignature =
    receivedSignature
      .replace(/^sha256=/i, "")
      .trim();

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex");

  const expectedBase64 = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("base64");

  return (
    safeCompare(
      normalizedSignature,
      expectedHex
    ) ||
    safeCompare(
      normalizedSignature,
      expectedBase64
    )
  );
};

const normalizeText = (value) => {
  return String(value ?? "").trim();
};

const normalizeAccountNumber = (value) => {
  return normalizeText(value).replace(
    /\D/g,
    ""
  );
};

const normalizePhone = (value) => {
  const phone = normalizeText(value).replace(
    /\D/g,
    ""
  );

  if (phone.startsWith("234") && phone.length === 13) {
    return `0${phone.slice(3)}`;
  }

  return phone;
};

const normalizeMoney = (value) => {
  const amount = Number(
    String(value ?? 0).replace(/,/g, "")
  );

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.round(amount * 100) / 100;
};

const findValueByKeys = (
  value,
  keys,
  visited = new Set()
) => {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    return null;
  }

  if (visited.has(value)) {
    return null;
  }

  visited.add(value);

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        value,
        key
      )
    ) {
      const result = value[key];

      if (
        result !== undefined &&
        result !== null &&
        normalizeText(result) !== ""
      ) {
        return result;
      }
    }
  }

  const children = Array.isArray(value)
    ? value
    : Object.values(value);

  for (const child of children) {
    if (
      child &&
      typeof child === "object"
    ) {
      const result = findValueByKeys(
        child,
        keys,
        visited
      );

      if (
        result !== undefined &&
        result !== null &&
        normalizeText(result) !== ""
      ) {
        return result;
      }
    }
  }

  return null;
};

const extractWebhookData = (payload) => {
  const transactionId = normalizeText(
    findValueByKeys(payload, [
      "transaction_id",
      "transactionId",
      "bank_transaction_id",
      "reference",
      "id",
    ])
  );

  const accountNumber =
    normalizeAccountNumber(
      findValueByKeys(payload, [
        "account_number",
        "accountNumber",
        "virtual_account_number",
        "virtualAccountNumber",
        "destination_account_number",
        "destinationAccountNumber",
        "beneficiary_account_number",
        "beneficiaryAccountNumber",
        "recipient_account_number",
        "recipientAccountNumber",
      ])
    );

  const providerCustomerId =
    normalizeText(
      findValueByKeys(payload, [
        "customer_id",
        "customerId",
        "provider_customer_id",
        "providerCustomerId",
      ])
    );

  const customerEmail =
    normalizeText(
      findValueByKeys(payload, [
        "email",
        "customer_email",
        "customerEmail",
      ])
    ).toLowerCase();

  const customerPhone =
    normalizePhone(
      findValueByKeys(payload, [
        "phone",
        "phone_number",
        "phoneNumber",
        "customer_phone",
        "customerPhone",
      ])
    );

  const amount = normalizeMoney(
    findValueByKeys(payload, [
      "amount",
      "paid_amount",
      "paidAmount",
      "transaction_amount",
      "transactionAmount",
    ])
  );

  const fees = normalizeMoney(
    findValueByKeys(payload, [
      "fees",
      "fee",
    ])
  );

  const settlementAmount =
    normalizeMoney(
      findValueByKeys(payload, [
        "settlement_amount",
        "settlementAmount",
      ]) || amount
    );

  const notificationStatus =
    normalizeText(
      findValueByKeys(payload, [
        "notification_status",
        "notificationStatus",
        "event",
      ])
    ).toLowerCase();

  const transactionStatus =
    normalizeText(
      findValueByKeys(payload, [
        "transaction_status",
        "transactionStatus",
        "payment_status",
        "paymentStatus",
        "status",
      ])
    ).toLowerCase();

  const transactionType =
    normalizeText(
      findValueByKeys(payload, [
        "transaction_type",
        "transactionType",
        "type",
        "channel",
      ])
    ).toLowerCase();

  const currency =
    normalizeText(
      findValueByKeys(payload, [
        "currency",
      ]) || "NGN"
    ).toUpperCase();

  return {
    transactionId,
    accountNumber,
    providerCustomerId,
    customerEmail,
    customerPhone,
    amount,
    fees,
    settlementAmount,
    notificationStatus,
    transactionStatus,
    transactionType,
    currency,
  };
};

const isSuccessfulPayment = (data) => {
  const acceptedStatuses = [
    "payment_successful",
    "payment successful",
    "successful",
    "success",
    "completed",
    "complete",
    "approved",
    "paid",
  ];

  return (
    acceptedStatuses.includes(
      data.notificationStatus
    ) ||
    acceptedStatuses.includes(
      data.transactionStatus
    )
  );
};

const findCustomer = async (data) => {
  const conditions = [];

  if (data.accountNumber) {
    conditions.push({
      "virtualAccount.accountNumber":
        data.accountNumber,
    });
  }

  if (data.providerCustomerId) {
    conditions.push({
      "virtualAccount.providerCustomerId":
        data.providerCustomerId,
    });
  }

  if (data.customerEmail) {
    conditions.push({
      email: data.customerEmail,
    });
  }

  if (data.customerPhone) {
    conditions.push({
      phone: data.customerPhone,
    });
  }

  if (conditions.length === 0) {
    return null;
  }

  return User.findOne({
    $or: conditions,
  });
};

const markFailed = async (
  webhookId,
  reason
) => {
  if (!webhookId) {
    return;
  }

  await SecurewaveWebhook.updateOne(
    {
      _id: webhookId,
      status: {
        $ne: "PROCESSED",
      },
    },
    {
      $set: {
        status: "FAILED",
        failureReason: reason,
        processedAt: new Date(),
      },
    }
  );
};

exports.handleVirtualAccountWebhook =
  async (req, res) => {
    let webhookEvent = null;
    let session = null;

    try {
      if (!verifySignature(req)) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid SecureWaveNG webhook signature.",
        });
      }

      const payload = req.body || {};
      const data =
        extractWebhookData(payload);

      console.log(
        "SecureWave normalized webhook:",
        data
      );

      if (!data.transactionId) {
        return res.status(400).json({
          success: false,
          message:
            "Webhook transaction ID is missing.",
        });
      }

      const existingEvent =
        await SecurewaveWebhook.findOne({
          transactionId:
            data.transactionId,
        });

      if (
        existingEvent?.status ===
        "PROCESSED"
      ) {
        return res.status(200).json({
          success: true,
          message:
            "Webhook was already processed.",
        });
      }

      if (existingEvent) {
        webhookEvent = existingEvent;

        webhookEvent.accountNumber =
          data.accountNumber || null;

        webhookEvent.notificationStatus =
          data.notificationStatus || null;

        webhookEvent.transactionStatus =
          data.transactionStatus || null;

        webhookEvent.transactionType =
          data.transactionType || null;

        webhookEvent.amount = data.amount;
        webhookEvent.fees = data.fees;

        webhookEvent.settlementAmount =
          data.settlementAmount;

        webhookEvent.currency =
          data.currency;

        webhookEvent.status =
          "PROCESSING";

        webhookEvent.failureReason =
          null;

        webhookEvent.processedAt =
          null;

        webhookEvent.payload =
          payload;

        await webhookEvent.save();
      } else {
        webhookEvent =
          await SecurewaveWebhook.create({
            transactionId:
              data.transactionId,

            accountNumber:
              data.accountNumber || null,

            notificationStatus:
              data.notificationStatus ||
              null,

            transactionStatus:
              data.transactionStatus ||
              null,

            transactionType:
              data.transactionType || null,

            amount: data.amount,
            fees: data.fees,

            settlementAmount:
              data.settlementAmount,

            currency: data.currency,

            status: "PROCESSING",

            payload,
          });
      }

      if (!isSuccessfulPayment(data)) {
        webhookEvent.status =
          "IGNORED";

        webhookEvent.failureReason =
          "Webhook is not a successful payment event.";

        webhookEvent.processedAt =
          new Date();

        await webhookEvent.save();

        return res.status(200).json({
          success: true,
          message:
            "Webhook received but no wallet credit was required.",
        });
      }

      if (data.currency !== "NGN") {
        await markFailed(
          webhookEvent._id,
          `Unsupported currency: ${data.currency}`
        );

        return res.status(400).json({
          success: false,
          message:
            "Webhook currency is not supported.",
        });
      }

      if (data.amount <= 0) {
        await markFailed(
          webhookEvent._id,
          "Webhook amount is invalid."
        );

        return res.status(400).json({
          success: false,
          message:
            "Webhook amount is invalid.",
        });
      }

      const customer =
        await findCustomer(data);

      if (!customer) {
        console.error(
          "SecureWave customer not found:",
          data
        );

        await markFailed(
          webhookEvent._id,
          "No ServicePay customer matches the webhook customer details."
        );

        return res.status(404).json({
          success: false,
          message:
            "Virtual account customer was not found.",
        });
      }

      session =
        await mongoose.startSession();

      await session.withTransaction(
        async () => {
          const duplicateTransaction =
            await Transaction.findOne({
              reference:
                data.transactionId,
            }).session(session);

          if (duplicateTransaction) {
            await SecurewaveWebhook.updateOne(
              {
                _id:
                  webhookEvent._id,
              },
              {
                $set: {
                  status:
                    "PROCESSED",

                  creditedUserId:
                    duplicateTransaction
                      .customerId,

                  walletCreditedAmount:
                    duplicateTransaction
                      .amount,

                  failureReason:
                    null,

                  processedAt:
                    new Date(),
                },
              },
              {
                session,
              }
            );

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
                    data.amount,

                  totalTransactions:
                    1,
                },

                $set: {
                  "virtualAccount.providerCustomerId":
                    data.providerCustomerId ||
                    customer.virtualAccount
                      ?.providerCustomerId ||
                    null,
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
                  data.transactionId,

                customerId:
                  updatedCustomer._id,

                agentId:
                  updatedCustomer.agentId ||
                  null,

                stateManagerId:
                  updatedCustomer
                    .stateManagerId ||
                  null,

                zonalManagerId:
                  updatedCustomer
                    .zonalManagerId ||
                  null,

                serviceType:
                  "WALLET_FUNDING",

                provider:
                  "SECUREWAVENG",

                phone:
                  updatedCustomer.phone,

                amount:
                  data.amount,

                status:
                  "SUCCESSFUL",

                providerResponse:
                  payload,
              },
            ],
            {
              session,
            }
          );

          await SecurewaveWebhook.updateOne(
            {
              _id:
                webhookEvent._id,
            },
            {
              $set: {
                status:
                  "PROCESSED",

                creditedUserId:
                  updatedCustomer._id,

                walletCreditedAmount:
                  data.amount,

                failureReason:
                  null,

                processedAt:
                  new Date(),
              },
            },
            {
              session,
            }
          );
        }
      );

      console.log(
        "SecureWave wallet credited:",
        {
          customerId: customer._id,
          accountNumber:
            data.accountNumber,
          amount: data.amount,
          transactionId:
            data.transactionId,
        }
      );

      return res.status(200).json({
        success: true,
        message:
          "Wallet funded successfully.",
      });
    } catch (error) {
      console.error(
        "SecureWave webhook error:",
        error
      );

      if (webhookEvent?._id) {
        try {
          await markFailed(
            webhookEvent._id,
            error.message ||
              "Webhook processing failed."
          );
        } catch (updateError) {
          console.error(
            "Unable to update webhook failure:",
            updateError.message
          );
        }
      }

      return res
        .status(
          error.statusCode ||
            error.status ||
            500
        )
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
