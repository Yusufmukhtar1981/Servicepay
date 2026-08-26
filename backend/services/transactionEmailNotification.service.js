const crypto = require("crypto");
const TransactionEmailDelivery = require(
  "../models/transactionEmailDelivery.model"
);
const {
  sendTransactionEmail,
} = require("./email.service");

const DIRECTIONS = new Set(["DEBIT", "CREDIT"]);
const PROCESSING_LEASE_MS = 10 * 60 * 1000;

const cleanText = (value, fallback = "") =>
  String(value ?? fallback).trim();

const normalizeStatus = (value) => {
  const status = cleanText(value, "PENDING").toUpperCase();

  if (status === "POSTED" || status === "PAID" || status === "COMPLETED") {
    return "SUCCESSFUL";
  }

  if (status === "REVERSED" || status === "REVERSED_SUCCESSFULLY") {
    return "REFUNDED";
  }

  return status || "PENDING";
};

const normalizeDirection = (value, status = "PENDING") => {
  const direction = cleanText(value).toUpperCase();

  if (DIRECTIONS.has(direction)) {
    return direction;
  }

  return normalizeStatus(status) === "REFUNDED"
    ? "CREDIT"
    : "DEBIT";
};

const maskSensitive = (value) =>
  cleanText(value)
    .replace(
      /\b(\d{3})\d{3,7}(\d{4})\b/g,
      (_match, start, end) => `${start}****${end}`
    )
    .replace(
      /\b([A-Z0-9]{4})[A-Z0-9]{6,}([A-Z0-9]{4})\b/gi,
      (_match, start, end) => `${start}****${end}`
    )
    .slice(0, 240);

const normalizeAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : 0;
};

const normalizeBalance = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const balance = Number(value);
  return Number.isFinite(balance) && balance >= 0
    ? Math.round((balance + Number.EPSILON) * 100) / 100
    : null;
};

const normalizeEvent = (input = {}) => {
  const email = cleanText(input.email).toLowerCase();
  const reference = cleanText(
    input.reference || input.sourceId
  );
  const status = normalizeStatus(input.status);
  const direction = normalizeDirection(input.direction, status);
  const type = cleanText(
    input.type || input.serviceType,
    "TRANSACTION"
  )
    .replace(/_/g, " ")
    .toUpperCase();

  return {
    email,
    userId: cleanText(input.userId) || null,
    name: maskSensitive(
      input.name || "ServicePay Customer"
    ),
    type,
    amount: normalizeAmount(input.amount),
    reference,
    status,
    direction,
    date: input.date || new Date(),
    balance: normalizeBalance(input.balance),
    counterparty: maskSensitive(input.counterparty),
    provider: maskSensitive(input.provider),
    serviceDetails: maskSensitive(input.serviceDetails),
    message: maskSensitive(input.message),
  };
};

const buildEventKey = (event) => {
  const recipient = event.userId || event.email;
  const source = [
    cleanText(recipient).toLowerCase(),
    cleanText(event.reference).toUpperCase(),
    normalizeStatus(event.status),
    normalizeDirection(event.direction, event.status),
  ].join("|");

  return crypto
    .createHash("sha256")
    .update(source)
    .digest("hex");
};

const mongoDeliveryStore = {
  async claim(event, eventKey) {
    try {
      const record = await TransactionEmailDelivery.create({
        eventKey,
        reference: event.reference,
        recipientUser: event.userId || null,
        recipientEmail: event.email,
        serviceType: event.type,
        direction: event.direction,
        transactionStatus: event.status,
        deliveryStatus: "PROCESSING",
        attempts: 1,
        nextAttemptAt: null,
        processingStartedAt: new Date(),
        payload: event,
      });

      return {
        claimed: true,
        id: record._id,
      };
    } catch (error) {
      if (error?.code === 11000) {
        const now = new Date();
        const leaseExpiredAt = new Date(
          now.getTime() - PROCESSING_LEASE_MS
        );
        const retry = await TransactionEmailDelivery.findOneAndUpdate(
          {
            eventKey,
            attempts: { $lt: 5 },
            $or: [
              {
                deliveryStatus: {
                  $in: ["FAILED", "SKIPPED"],
                },
                $or: [
                  { nextAttemptAt: null },
                  {
                    nextAttemptAt: {
                      $lte: now,
                    },
                  },
                ],
              },
              {
                deliveryStatus: "PROCESSING",
                processingStartedAt: {
                  $lte: leaseExpiredAt,
                },
              },
            ],
          },
          {
            $set: {
              deliveryStatus: "PROCESSING",
              failureReason: "",
              nextAttemptAt: null,
              processingStartedAt: now,
            },
            $inc: { attempts: 1 },
          },
          { new: true }
        );

        if (retry) {
          return {
            claimed: true,
            id: retry._id,
            retry: true,
          };
        }

        return {
          claimed: false,
          duplicate: true,
        };
      }

      throw error;
    }
  },

  async complete(id, result) {
    await TransactionEmailDelivery.updateOne(
      { _id: id },
      {
        $set: {
          deliveryStatus: result.success
            ? "SENT"
            : result.skipped
            ? "SKIPPED"
            : "FAILED",
          providerMessageId: result.messageId || null,
          failureReason: cleanText(
            result.error || result.reason
          ).slice(0, 500),
          nextAttemptAt: result.success
            ? null
            : new Date(
                Date.now() +
                  (result.skipped
                    ? 5 * 60 * 1000
                    : 60 * 1000)
              ),
          completedAt: new Date(),
          processingStartedAt: null,
        },
      }
    );
  },

  async fail(id, error) {
    await TransactionEmailDelivery.updateOne(
      { _id: id },
      {
        $set: {
          deliveryStatus: "FAILED",
          failureReason: cleanText(
            error?.message || error
          ).slice(0, 500),
          nextAttemptAt: new Date(
            Date.now() + 60 * 1000
          ),
          completedAt: new Date(),
          processingStartedAt: null,
        },
      }
    );
  },
};

const sendTransactionNotification = async (
  input,
  {
    store = mongoDeliveryStore,
    sender = sendTransactionEmail,
  } = {}
) => {
  const event = normalizeEvent(input);

  if (!event.email || !event.reference) {
    console.log(
      `[TRANSACTION EMAIL] Skipped ${event.reference || "NO_REFERENCE"}: recipient or reference missing`
    );

    return {
      success: false,
      skipped: true,
      reason: "RECIPIENT_OR_REFERENCE_MISSING",
    };
  }

  const eventKey = buildEventKey(event);
  let claim;

  try {
    claim = await store.claim(event, eventKey);
  } catch (error) {
    console.error(
      `[TRANSACTION EMAIL] Dedupe reservation failed for ${event.reference}: ${error.message}`
    );

    return {
      success: false,
      error: error.message,
    };
  }

  if (!claim?.claimed) {
    console.log(
      `[TRANSACTION EMAIL] Duplicate suppressed for ${event.reference} (${event.status}/${event.direction})`
    );

    return {
      success: true,
      duplicate: true,
      skipped: true,
    };
  }

  try {
    const result = await sender({
      ...event,
      idempotencyKey: eventKey,
    });

    try {
      await store.complete(claim.id, result);
    } catch (completionError) {
      console.error(
        `[TRANSACTION EMAIL] Delivery result persistence failed for ${event.reference}: ${completionError.message}`
      );
    }

    if (result.success) {
      console.log(
        `[TRANSACTION EMAIL] Sent ${event.reference} (${event.status}/${event.direction})`
      );
    } else {
      console.error(
        `[TRANSACTION EMAIL] Failed ${event.reference}: ${result.error || result.reason || "UNKNOWN_ERROR"}`
      );
    }

    return result;
  } catch (error) {
    try {
      await store.fail(claim.id, error);
    } catch (persistenceError) {
      console.error(
        `[TRANSACTION EMAIL] Failure persistence failed for ${event.reference}: ${persistenceError.message}`
      );
    }

    console.error(
      `[TRANSACTION EMAIL] Failed ${event.reference}: ${error.message}`
    );

    return {
      success: false,
      error: error.message,
    };
  }
};

const notifyTransactionAsync = (input, options) => {
  setImmediate(() => {
    sendTransactionNotification(input, options).catch(
      (error) =>
        console.error(
          `[TRANSACTION EMAIL] Unexpected async failure for ${cleanText(input?.reference, "NO_REFERENCE")}: ${error.message}`
        )
    );
  });
};

const retryPendingTransactionEmails = async ({
  limit = 50,
} = {}) => {
  try {
    const pending =
      await TransactionEmailDelivery.find({
        attempts: { $lt: 5 },
        $or: [
          {
            deliveryStatus: {
              $in: ["FAILED", "SKIPPED"],
            },
            $or: [
              { nextAttemptAt: null },
              {
                nextAttemptAt: {
                  $lte: new Date(),
                },
              },
            ],
          },
          {
            deliveryStatus: "PROCESSING",
            processingStartedAt: {
              $lte: new Date(
                Date.now() -
                  PROCESSING_LEASE_MS
              ),
            },
          },
        ],
      })
        .select("+payload")
        .sort({ nextAttemptAt: 1, createdAt: 1 })
        .limit(limit)
        .lean();

    for (const delivery of pending) {
      await sendTransactionNotification(
        delivery.payload
      );
    }

    return {
      processed: pending.length,
    };
  } catch (error) {
    console.error(
      `[TRANSACTION EMAIL] Retry worker failed: ${error.message}`
    );

    return {
      processed: 0,
      error: error.message,
    };
  }
};

module.exports = {
  buildEventKey,
  maskSensitive,
  normalizeDirection,
  normalizeEvent,
  normalizeStatus,
  notifyTransactionAsync,
  retryPendingTransactionEmails,
  sendTransactionNotification,
};