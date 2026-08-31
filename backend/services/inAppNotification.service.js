const mongoose = require("mongoose");
const Notification = require("../models/notification.model");

const ALLOWED_TYPES = new Set([
  "GENERAL",
  "DELIVERY",
  "TRANSFER",
  "WALLET",
  "AIRTIME",
  "DATA",
  "CABLE",
  "ELECTRICITY",
  "EXAM_PIN",
  "ID_VERIFICATION",
  "GROUP_WALLET",
  "SOLAR",
  "PHONE",
  "TRUST",
  "BUSINESS_PARTNER",
  "SECURITY",
  "KYC",
  "ACCOUNT",
  "MARKETPLACE",
  "WITHDRAWAL",
  "PAYMENT",
  "SYSTEM",
  "CALL",
]);

const TRANSACTION_TYPES = new Set([
  "TRANSFER",
  "WALLET",
  "AIRTIME",
  "DATA",
  "CABLE",
  "ELECTRICITY",
  "EXAM_PIN",
  "GROUP_WALLET",
  "WITHDRAWAL",
  "PAYMENT",
]);

const clean = (value, max = 500) =>
  String(value ?? "").trim().slice(0, max);

const normalizeNotificationType = (value) => {
  const normalized = clean(value, 80)
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
  if (ALLOWED_TYPES.has(normalized)) return normalized;
  if (normalized.includes("MARKETPLACE")) return "MARKETPLACE";
  if (normalized.includes("WITHDRAW")) return "WITHDRAWAL";
  if (normalized.includes("TRANSFER")) return "TRANSFER";
  if (normalized.includes("FUND") || normalized.includes("PAYMENT")) {
    return "PAYMENT";
  }
  if (normalized.includes("SOLAR")) return "SOLAR";
  if (normalized.includes("PHONE")) return "PHONE";
  return "GENERAL";
};

const inferNotificationCategory = ({ category, type, referenceType }) => {
  const requested = clean(category, 40).toUpperCase();
  if (["TRANSACTION", "SECURITY", "ACCOUNT", "OTHER"].includes(requested)) {
    return requested;
  }

  const normalizedType = normalizeNotificationType(type);
  const reference = clean(referenceType, 100).toUpperCase();
  if (
    TRANSACTION_TYPES.has(normalizedType) ||
    reference.includes("TRANSACTION") ||
    reference.includes("PAYMENT")
  ) {
    return "TRANSACTION";
  }
  if (normalizedType === "SECURITY" || reference.includes("SECURITY")) {
    return "SECURITY";
  }
  if (
    ["KYC", "ACCOUNT", "ID_VERIFICATION"].includes(normalizedType) ||
    reference.includes("KYC") ||
    reference.includes("ACCOUNT")
  ) {
    return "ACCOUNT";
  }
  return "OTHER";
};

const inferNotificationAction = ({ action, type, referenceType }) => {
  const requested = clean(action, 40).toUpperCase();
  if (requested) return requested;
  const normalizedType = normalizeNotificationType(type);
  const reference = clean(referenceType, 100).toUpperCase();
  if (
    TRANSACTION_TYPES.has(normalizedType) ||
    reference.includes("TRANSACTION") ||
    reference.includes("PAYMENT")
  ) {
    return "TRANSACTION";
  }
  if (
    ["KYC", "ACCOUNT", "ID_VERIFICATION"].includes(normalizedType) ||
    reference.includes("KYC")
  ) {
    return "KYC";
  }
  if (normalizedType === "SECURITY" || reference.includes("SECURITY")) {
    return "SECURITY";
  }
  if (normalizedType === "DELIVERY") return "DELIVERY";
  if (normalizedType === "MARKETPLACE") return "MARKETPLACE";
  if (normalizedType === "SOLAR") return "SOLAR";
  if (normalizedType === "PHONE") return "PHONE";
  if (reference.includes("SUPPORT")) return "SUPPORT";
  return "";
};

const createInAppNotification = async (input, { session = null } = {}) => {
  const userId = input?.userId || input?.user;
  if (!mongoose.Types.ObjectId.isValid(userId)) return null;

  const type = normalizeNotificationType(input.type);
  const referenceType = clean(input.referenceType, 120);
  const referenceId = mongoose.Types.ObjectId.isValid(input.referenceId)
    ? input.referenceId
    : null;
  const reference = clean(input.reference || input.referenceKey, 200);
  const relatedStatus = clean(input.relatedStatus || input.status, 50)
    .toUpperCase();
  const suppliedKey = clean(input.dedupeKey || input.eventKey, 300);
  const derivedKey =
    suppliedKey ||
    (referenceType && (reference || referenceId)
      ? [
          String(userId),
          referenceType.toUpperCase(),
          reference || String(referenceId),
          relatedStatus,
        ].join(":")
      : "");

  const document = {
    userId,
    title: clean(input.title, 180),
    message: clean(input.message, 1200),
    type,
    category: inferNotificationCategory({
      category: input.category,
      type,
      referenceType,
    }),
    referenceId,
    referenceType,
    reference,
    relatedStatus,
    action: inferNotificationAction({
      action: input.action,
      type,
      referenceType,
    }),
    ...(derivedKey ? { dedupeKey: derivedKey } : {}),
  };

  if (!document.title || !document.message) return null;

  if (!derivedKey) {
    const created = await Notification.create(
      [document],
      session ? { session } : undefined
    );
    return created[0];
  }

  try {
    return await Notification.findOneAndUpdate(
      { dedupeKey: derivedKey },
      { $setOnInsert: document },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        ...(session ? { session } : {}),
      }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return Notification.findOne({ dedupeKey: derivedKey }).session(
      session || null
    );
  }
};

const transactionNotificationContent = (event) => {
  const type = clean(event.type || "Transaction", 80)
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const status = clean(event.status || "PENDING", 50).toUpperCase();
  const statusLabel =
    status === "SUCCESSFUL"
      ? "successful"
      : status === "REFUNDED" || status === "REVERSED"
        ? "reversed"
        : status.toLowerCase();
  const amount = Number(event.amount);
  const amountText = Number.isFinite(amount) && amount > 0
    ? ` of ₦${amount.toLocaleString("en-NG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : "";
  return {
    title: `${type} ${statusLabel}`,
    message: `Your ${type.toLowerCase()}${amountText} is ${statusLabel}.`,
  };
};

const createTransactionInAppNotification = async (event, eventKey) => {
  if (!event?.userId || !event?.reference) return null;
  const content = transactionNotificationContent(event);
  return createInAppNotification({
    userId: event.userId,
    ...content,
    type: event.type,
    category: "TRANSACTION",
    reference: event.reference,
    referenceType: "TRANSACTION_EVENT",
    relatedStatus: event.status,
    action: "TRANSACTION",
    dedupeKey: `transaction:${eventKey}`,
  });
};

module.exports = {
  createInAppNotification,
  createTransactionInAppNotification,
  inferNotificationAction,
  inferNotificationCategory,
  normalizeNotificationType,
};