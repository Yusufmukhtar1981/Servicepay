const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");

const Transaction = require(
  "../models/transaction.model"
);

const SecurewaveWebhook = require(
  "../models/securewaveWebhook.model"
);

/*
 * Read a request header safely.
 */
const getHeaderValue = (req, name) => {
  const value =
    req.headers[String(name).toLowerCase()];

  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }

  return String(value || "").trim();
};

/*
 * Compare signatures safely.
 */
const safeCompare = (
  firstValue,
  secondValue
) => {
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
    secondBuffer.length === 0 ||
    firstBuffer.length !==
      secondBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    firstBuffer,
    secondBuffer
  );
};

/*
 * Verify SecureWaveNG webhook signature.
 *
 * Ensure index.js keeps req.rawBody as a Buffer:
 *
 * verify: (req, res, buffer) => {
 *   req.rawBody = buffer;
 * }
 */
const verifySecureWaveSignature = (
  req
) => {
  const webhookSecret = String(
    process.env
      .SECUREWAVE_WEBHOOK_SECRET || ""
  ).trim();

  if (!webhookSecret) {
    const error = new Error(
      "SecureWaveNG webhook secret is not configured."
    );

    error.statusCode = 503;

    throw error;
  }

  /*
   * Support common SecureWave signature
   * header names.
   */
  const receivedSignature =
    getHeaderValue(
      req,
      "x-signature"
    ) ||
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

  const rawPayload = req.rawBody;

  if (
    !rawPayload ||
    !Buffer.isBuffer(rawPayload)
  ) {
    return false;
  }

  const expectedHexSignature =
    crypto
      .createHmac(
        "sha256",
        webhookSecret
      )
      .update(rawPayload)
      .digest("hex");

  const expectedBase64Signature =
    crypto
      .createHmac(
        "sha256",
        webhookSecret
      )
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

/*
 * Return the first value that is not empty.
 */
const firstNonEmptyValue = (
  ...values
) => {
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

/*
 * Convert money to a safe two-decimal number.
 */
const normalizeMoney = (value) => {
  let normalizedValue = value;

  if (typeof normalizedValue === "string") {
    normalizedValue =
      normalizedValue.replace(
        /,/g,
        ""
      );
  }

  const amount = Number(
    normalizedValue
  );

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return (
    Math.round(
      (amount +
        Number.EPSILON) *
        100
    ) / 100
  );
};

/*
 * Convert any value to trimmed text.
 */
const normalizeText = (value) => {
  return String(value || "").trim();
};

/*
 * Normalize an account number.
 */
const normalizeAccountNumber = (
  value
) => {
  return normalizeText(value).replace(
    /\s+/g,
    ""
  );
};

/*
 * Escape text before using it in MongoDB regex.
 */
const escapeRegex = (value) => {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
};

/*
 * Extract the useful information from
 * different possible SecureWaveNG payload
 * formats.
 */
const extractWebhookData = (
  payload
) => {
  const data =
    payload?.data &&
    typeof payload.data === "object"
      ? payload.data
      : payload;

  const transaction =
    data?.transaction &&
    typeof data.transaction ===
      "object"
      ? data.transaction
      : {};

  const virtualAccount =
    data?.virtual_account &&
    typeof data.virtual_account ===
      "object"
      ? data.virtual_account
      : data?.virtualAccount &&
          typeof data.virtualAccount ===
            "object"
        ? data.virtualAccount
        : {};

  const customer =
    data?.customer &&
    typeof data.customer ===
      "object"
      ? data.customer
      : {};

  const transactionId =
    normalizeText(
      firstNonEmptyValue(
        data?.transaction_id,
        data?.transactionId,
        transaction?.transaction_id,
        transaction?.transactionId,
        transaction?.id,
        data?.id,
        payload?.transaction_id,
        payload?.transactionId,
        payload?.id
      )
    );

  const providerReference =
    normalizeText(
      firstNonEmptyValue(
        data?.provider_reference,
        data?.providerReference,
        data?.payment_reference,
        data?.paymentReference,
        transaction?.provider_reference,
        transaction?.providerReference,
        transaction?.reference,
        data?.reference,
        payload?.provider_reference,
        payload?.providerReference,
        payload?.reference
      )
    );

  const accountNumber =
    normalizeAccountNumber(
      firstNonEmptyValue(
        data?.account_number,
        data?.accountNumber,

        data?.destination_account_number,
        data?.destinationAccountNumber,

        data?.recipient_account_number,
        data?.recipientAccountNumber,

        data?.beneficiary_account_number,
        data?.beneficiaryAccountNumber,

        data?.virtual_account_number,
        data?.virtualAccountNumber,

        data?.credited_account_number,
        data?.creditedAccountNumber,

        data?.receiving_account_number,
        data?.receivingAccountNumber,

        data?.destination_account?.account_number,
        data?.destination_account?.accountNumber,

        data?.destinationAccount?.account_number,
        data?.destinationAccount?.accountNumber,

        data?.beneficiary_account?.account_number,
        data?.beneficiary_account?.accountNumber,

        data?.beneficiaryAccount?.account_number,
        data?.beneficiaryAccount?.accountNumber,

        transaction?.account_number,
        transaction?.accountNumber,

        transaction?.destination_account_number,
        transaction?.destinationAccountNumber,

        transaction?.recipient_account_number,
        transaction?.recipientAccountNumber,

        transaction?.beneficiary_account_number,
        transaction?.beneficiaryAccountNumber,

        transaction?.virtual_account_number,
        transaction?.virtualAccountNumber,

        virtualAccount?.account_number,
        virtualAccount?.accountNumber,

        virtualAccount?.virtual_account_number,
        virtualAccount?.virtualAccountNumber,

        virtualAccount?.number,

        customer?.account_number,
        customer?.accountNumber,

        payload?.account_number,
        payload?.accountNumber,

        payload?.destination_account_number,
        payload?.destinationAccountNumber,

        payload?.recipient_account_number,
        payload?.recipientAccountNumber,

        payload?.beneficiary_account_number,
        payload?.beneficiaryAccountNumber,

        payload?.virtual_account_number,
        payload?.virtualAccountNumber,

        payload?.credited_account_number,
        payload?.creditedAccountNumber,

        payload?.receiving_account_number,
        payload?.receivingAccountNumber,

        payload?.destination_account?.account_number,
        payload?.destination_account?.accountNumber,

        payload?.destinationAccount?.account_number,
        payload?.destinationAccount?.accountNumber,

        payload?.beneficiary_account?.account_number,
        payload?.beneficiary_account?.accountNumber,

        payload?.beneficiaryAccount?.account_number,
        payload?.beneficiaryAccount?.accountNumber
      )
    );

  const notificationStatus =
    normalizeText(
      firstNonEmptyValue(
        data?.notification_status,
        data?.notificationStatus,
        payload?.notification_status,
        payload?.notificationStatus,
        payload?.event
      )
    ).toLowerCase();

  const transactionStatus =
    normalizeText(
      firstNonEmptyValue(
        data?.transaction_status,
        data?.transactionStatus,
        transaction?.status,
        data?.payment_status,
        data?.paymentStatus,
        data?.status,
        payload?.transaction_status,
        payload?.transactionStatus,
        payload?.payment_status,
        payload?.paymentStatus,
        payload?.status
      )
    ).toLowerCase();

  const transactionType =
    normalizeText(
      firstNonEmptyValue(
        data?.transaction_type,
        data?.transactionType,
        transaction?.type,
        data?.type,
        payload?.transaction_type,
        payload?.transactionType,
        payload?.type,
        payload?.event
      )
    ).toLowerCase();

  const amount = normalizeMoney(
    firstNonEmptyValue(
      data?.amount,
      data?.paid_amount,
      data?.paidAmount,
      transaction?.amount,
      transaction?.paid_amount,
      transaction?.paidAmount,
      payload?.amount,
      payload?.paid_amount,
      payload?.paidAmount
    )
  );

  const fees = normalizeMoney(
    firstNonEmptyValue(
      data?.fees,
      data?.fee,
      transaction?.fees,
      transaction?.fee,
      payload?.fees,
      payload?.fee,
      0
    )
  );

  const settlementAmount =
    normalizeMoney(
      firstNonEmptyValue(
        data?.settlement_amount,
        data?.settlementAmount,
        transaction
          ?.settlement_amount,
        transaction
          ?.settlementAmount,
        payload?.settlement_amount,
        payload?.settlementAmount,
        amount
      )
    );

  const currency =
    normalizeText(
      firstNonEmptyValue(
        data?.currency,
        transaction?.currency,
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

/*
 * Decide whether the event represents
 * a successful incoming payment.
 */
const isSuccessfulPayment = ({
  notificationStatus,
  transactionStatus,
}) => {
  const successfulStatuses = [
    "payment_successful",
    "payment successful",
    "successful",
    "success",
    "completed",
    "complete",
    "paid",
    "approved",
  ];

  return (
    successfulStatuses.includes(
      notificationStatus
    ) ||
    successfulStatuses.includes(
      transactionStatus
    )
  );
};

/*
 * Find the ServicePay customer that owns
 * the virtual account.
 */
const findCustomerByAccountNumber =
  async (accountNumber) => {
    const normalizedAccount =
      normalizeAccountNumber(
        accountNumber
      );

    if (!normalizedAccount) {
      return null;
    }

    /*
     * Try the current expected User model
     * structure first.
     */
    let customer =
      await User.findOne({
        "virtualAccount.accountNumber":
          normalizedAccount,
      });

    if (customer) {
      return customer;
    }

    /*
     * Try older possible field names so
     * existing accounts do not stop working.
     */
    customer = await User.findOne({
      $or: [
        {
          virtualAccountNumber:
            normalizedAccount,
        },
        {
          dedicatedAccountNumber:
            normalizedAccount,
        },
        {
          accountNumber:
            normalizedAccount,
        },
      ],
    });

    if (customer) {
      return customer;
    }

    /*
     * Final case-insensitive exact match.
     */
    const exactAccountRegex =
      new RegExp(
        `^${escapeRegex(
          normalizedAccount
        )}$`,
        "i"
      );

    return User.findOne({
      $or: [
        {
          "virtualAccount.accountNumber":
            exactAccountRegex,
        },
        {
          virtualAccountNumber:
            exactAccountRegex,
        },
        {
          dedicatedAccountNumber:
            exactAccountRegex,
        },
        {
          accountNumber:
            exactAccountRegex,
        },
      ],
    });
  };

/*
 * Mark a webhook as failed.
 */
const markWebhookAsFailed = async (
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
        failureReason:
          reason ||
          "Webhook processing failed.",
        processedAt: new Date(),
      },
    }
  );
};

/*
 * POST /api/securewave/webhook
 */
exports.handleVirtualAccountWebhook =
  async (req, res) => {
    let webhookEvent = null;
    let session = null;

    try {
      const isValidSignature =
        verifySecureWaveSignature(
          req
        );

      if (!isValidSignature) {
        console.error(
          "SecureWave webhook signature verification failed.",
          {
            availableHeaders:
              Object.keys(
                req.headers || {}
              ),
            hasRawBody:
              Buffer.isBuffer(
                req.rawBody
              ),
          }
        );

        return res.status(401).json({
          success: false,
          message:
            "Invalid SecureWaveNG webhook signature.",
        });
      }

      const payload = req.body || {};

      console.log(
        "SECUREWAVE_RAW_PAYLOAD_START"
      );

      console.log(
        JSON.stringify(payload, null, 2)
      );

      console.log(
        "SECUREWAVE_RAW_PAYLOAD_END"
      );

      console.log(
        "SecureWave complete webhook payload:",
        JSON.stringify(payload, null, 2)
      );

      const webhookData =
        extractWebhookData(
          payload
        );

      console.log(
        "SecureWave webhook received:",
        {
          transactionId:
            webhookData.transactionId,
          accountNumber:
            webhookData.accountNumber,
          amount:
            webhookData.amount,
          currency:
            webhookData.currency,
          notificationStatus:
            webhookData.notificationStatus,
          transactionStatus:
            webhookData.transactionStatus,
          transactionType:
            webhookData.transactionType,
        }
      );

      if (
        !webhookData.transactionId
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Webhook transaction ID is missing.",
        });
      }

      /*
       * Find an existing webhook event.
       *
       * PROCESSED events must never credit
       * the wallet again.
       */
      const existingEvent =
        await SecurewaveWebhook.findOne({
          transactionId:
            webhookData.transactionId,
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

      if (
        existingEvent?.status ===
        "IGNORED"
      ) {
        return res.status(200).json({
          success: true,
          message:
            "Webhook was already received and ignored.",
        });
      }

      /*
       * Retry events that were previously
       * RECEIVED, PROCESSING or FAILED.
       */
      if (existingEvent) {
        webhookEvent =
          existingEvent;

        webhookEvent.providerReference =
          webhookData
            .providerReference ||
          null;

        webhookEvent.notificationStatus =
          webhookData
            .notificationStatus ||
          null;

        webhookEvent.transactionStatus =
          webhookData
            .transactionStatus ||
          null;

        webhookEvent.transactionType =
          webhookData
            .transactionType ||
          null;

        webhookEvent.accountNumber =
          webhookData.accountNumber ||
          null;

        webhookEvent.amount =
          webhookData.amount;

        webhookEvent.fees =
          webhookData.fees;

        webhookEvent.settlementAmount =
          webhookData
            .settlementAmount;

        webhookEvent.currency =
          webhookData.currency ||
          "NGN";

        webhookEvent.status =
          "PROCESSING";

        webhookEvent.failureReason =
          null;

        webhookEvent.payload =
          payload;

        webhookEvent.processedAt =
          null;

        await webhookEvent.save();
      } else {
        try {
          webhookEvent =
            await SecurewaveWebhook.create(
              {
                transactionId:
                  webhookData
                    .transactionId,

                providerReference:
                  webhookData
                    .providerReference ||
                  null,

                notificationStatus:
                  webhookData
                    .notificationStatus ||
                  null,

                transactionStatus:
                  webhookData
                    .transactionStatus ||
                  null,

                transactionType:
                  webhookData
                    .transactionType ||
                  null,

                accountNumber:
                  webhookData
                    .accountNumber ||
                  null,

                amount:
                  webhookData.amount,

                fees:
                  webhookData.fees,

                settlementAmount:
                  webhookData
                    .settlementAmount,

                currency:
                  webhookData
                    .currency ||
                  "NGN",

                status:
                  "PROCESSING",

                payload,
              }
            );
        } catch (error) {
          if (error?.code === 11000) {
            const duplicateEvent =
              await SecurewaveWebhook.findOne(
                {
                  transactionId:
                    webhookData
                      .transactionId,
                }
              );

            if (
              duplicateEvent?.status ===
              "PROCESSED"
            ) {
              return res
                .status(200)
                .json({
                  success: true,
                  message:
                    "Webhook was already processed.",
                });
            }

            return res
              .status(200)
              .json({
                success: true,
                message:
                  "Webhook is currently being processed.",
              });
          }

          throw error;
        }
      }

      /*
       * Ignore events that do not represent
       * successful payments.
       */
      if (
        !isSuccessfulPayment(
          webhookData
        )
      ) {
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

      /*
       * ServicePay wallet currently accepts
       * NGN funding only.
       */
      if (
        webhookData.currency !==
        "NGN"
      ) {
        webhookEvent.status =
          "IGNORED";

        webhookEvent.failureReason =
          `Unsupported currency: ${webhookData.currency}`;

        webhookEvent.processedAt =
          new Date();

        await webhookEvent.save();

        return res.status(200).json({
          success: true,
          message:
            "Webhook currency is not supported.",
        });
      }

      if (
        !webhookData.accountNumber
      ) {
        await markWebhookAsFailed(
          webhookEvent._id,
          "Virtual account number is missing."
        );

        return res.status(400).json({
          success: false,
          message:
            "Virtual account number is missing.",
        });
      }

      if (
        webhookData.amount <= 0
      ) {
        await markWebhookAsFailed(
          webhookEvent._id,
          "Webhook amount must be greater than zero."
        );

        return res.status(400).json({
          success: false,
          message:
            "Webhook amount is invalid.",
        });
      }

      /*
       * Find the customer using the virtual
       * account number.
       */
      const customer =
        await findCustomerByAccountNumber(
          webhookData.accountNumber
        );

      if (!customer) {
        await markWebhookAsFailed(
          webhookEvent._id,
          "No ServicePay customer matches the virtual account number."
        );

        console.error(
          "SecureWave customer not found:",
          {
            accountNumber:
              webhookData.accountNumber,
            transactionId:
              webhookData.transactionId,
          }
        );

        return res.status(404).json({
          success: false,
          message:
            "Virtual account customer was not found.",
        });
      }

      /*
       * Credit the amount paid by the sender.
       *
       * The provider fees and settlement
       * amount remain stored for reconciliation.
       */
      const walletCreditAmount =
        webhookData.amount;

      session =
        await mongoose.startSession();

      await session.withTransaction(
        async () => {
          /*
           * Transaction reference provides
           * another layer of idempotency.
           */
          const duplicateTransaction =
            await Transaction.findOne({
              reference:
                webhookData
                  .transactionId,
            }).session(session);

          if (
            duplicateTransaction
          ) {
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
                      .customerId ||
                    customer._id,

                  walletCreditedAmount:
                    duplicateTransaction
                      .amount ||
                    walletCreditAmount,

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

                /*
                 * Permit older customers whose
                 * status field may be missing.
                 */
                $or: [
                  {
                    status:
                      "ACTIVE",
                  },
                  {
                    status: {
                      $exists:
                        false,
                    },
                  },
                  {
                    status:
                      null,
                  },
                ],
              },
              {
                $inc: {
                  walletBalance:
                    walletCreditAmount,

                  totalTransactions:
                    1,
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
                  webhookData
                    .transactionId,

                customerId:
                  updatedCustomer._id,

                agentId:
                  updatedCustomer
                    .agentId ||
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
                  updatedCustomer
                    .phone,

                amount:
                  walletCreditAmount,

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
                  walletCreditAmount,

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

      const processedEvent =
        await SecurewaveWebhook.findById(
          webhookEvent._id
        );

      if (
        processedEvent?.status ===
        "PROCESSED"
      ) {
        console.log(
          "SecureWave wallet credited:",
          {
            transactionId:
              webhookData.transactionId,
            customerId:
              processedEvent
                .creditedUserId,
            amount:
              processedEvent
                .walletCreditedAmount,
          }
        );

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
          await markWebhookAsFailed(
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