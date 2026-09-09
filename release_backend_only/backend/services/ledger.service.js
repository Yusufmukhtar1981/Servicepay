const crypto = require("crypto");

const LedgerEntry = require(
  "../models/ledgerEntry.model"
);

const buildLedgerReference = (
  prefix = "SPLEDGER"
) => {
  const time = Date.now();
  const random = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `${prefix}-${time}-${random}`;
};

const normalizeAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      "Ledger amount must be greater than zero."
    );
  }

  return Math.round(
    (amount + Number.EPSILON) * 100
  ) / 100;
};

const normalizeBalance = (value) => {
  const balance = Number(value);

  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error(
      "Ledger balance cannot be negative."
    );
  }

  return Math.round(
    (balance + Number.EPSILON) * 100
  ) / 100;
};

const postLedgerEntry = async ({
  userId,
  direction,
  amount,
  openingBalance,
  closingBalance,
  service,
  reference,
  idempotencyKey,
  transactionId = null,
  relatedUser = null,
  narration = "",
  metadata = {},
  session = null,
}) => {
  if (!userId) {
    throw new Error(
      "Ledger userId is required."
    );
  }

  const normalizedDirection = String(
    direction || ""
  )
    .trim()
    .toUpperCase();

  if (
    !["DEBIT", "CREDIT"].includes(
      normalizedDirection
    )
  ) {
    throw new Error(
      "Ledger direction must be DEBIT or CREDIT."
    );
  }

  const normalizedAmount =
    normalizeAmount(amount);

  const normalizedOpening =
    normalizeBalance(openingBalance);

  const normalizedClosing =
    normalizeBalance(closingBalance);

  if (normalizedDirection === "DEBIT") {
    const expected =
      Math.round(
        (
          normalizedOpening -
          normalizedAmount +
          Number.EPSILON
        ) * 100
      ) / 100;

    if (expected !== normalizedClosing) {
      throw new Error(
        "Invalid DEBIT ledger balance calculation."
      );
    }
  }

  if (normalizedDirection === "CREDIT") {
    const expected =
      Math.round(
        (
          normalizedOpening +
          normalizedAmount +
          Number.EPSILON
        ) * 100
      ) / 100;

    if (expected !== normalizedClosing) {
      throw new Error(
        "Invalid CREDIT ledger balance calculation."
      );
    }
  }

  const finalReference =
    String(reference || "").trim() ||
    buildLedgerReference();

  const finalIdempotencyKey =
    String(idempotencyKey || "").trim();

  if (!finalIdempotencyKey) {
    throw new Error(
      "Ledger idempotencyKey is required."
    );
  }

  /*
   * Idempotency protection:
   * same key can never create a second ledger entry.
   */
  const existingQuery =
    LedgerEntry.findOne({
      idempotencyKey:
        finalIdempotencyKey,
    });

  if (session) {
    existingQuery.session(session);
  }

  const existing =
    await existingQuery;

  if (existing) {
    return {
      entry: existing,
      duplicate: true,
    };
  }

  const payload = {
    user: userId,
    direction:
      normalizedDirection,
    amount:
      normalizedAmount,
    openingBalance:
      normalizedOpening,
    closingBalance:
      normalizedClosing,
    currency: "NGN",
    service:
      String(service || "GENERAL")
        .trim()
        .toUpperCase(),
    reference:
      finalReference,
    idempotencyKey:
      finalIdempotencyKey,
    transactionId,
    relatedUser,
    narration:
      String(narration || "").trim(),
    metadata:
      metadata &&
      typeof metadata === "object"
        ? metadata
        : {},
    status: "POSTED",
  };

  let created;

  if (session) {
    const docs =
      await LedgerEntry.create(
        [payload],
        { session }
      );

    created = docs[0];
  } else {
    created =
      await LedgerEntry.create(
        payload
      );
  }

  return {
    entry: created,
    duplicate: false,
  };
};

const postDebit = async ({
  userId,
  amount,
  openingBalance,
  closingBalance,
  service,
  reference,
  idempotencyKey,
  transactionId = null,
  relatedUser = null,
  narration = "",
  metadata = {},
  session = null,
}) => {

  /*
   * SERVICEPAY_KYC_LIMIT_GUARD_V1
   *
   * Disabled by default.
   * Enable in Render only after testing:
   *
   * KYC_LIMIT_ENFORCEMENT_ENABLED=true
   */
  const kycLimitEnforcementEnabled =
    String(
      process.env.KYC_LIMIT_ENFORCEMENT_ENABLED || "false"
    )
      .trim()
      .toLowerCase() === "true";

  if (kycLimitEnforcementEnabled) {
    const {
      checkDebitLimit,
    } = require("./kycTier.service");

    await checkDebitLimit({
      userId,
      amount,
    });
  }


  return postLedgerEntry({
    userId,
    direction: "DEBIT",
    amount,
    openingBalance,
    closingBalance,
    service,
    reference,
    idempotencyKey,
    transactionId,
    relatedUser,
    narration,
    metadata,
    session,
  });
};

const postCredit = async ({
  userId,
  amount,
  openingBalance,
  closingBalance,
  service,
  reference,
  idempotencyKey,
  transactionId = null,
  relatedUser = null,
  narration = "",
  metadata = {},
  session = null,
}) => {
  return postLedgerEntry({
    userId,
    direction: "CREDIT",
    amount,
    openingBalance,
    closingBalance,
    service,
    reference,
    idempotencyKey,
    transactionId,
    relatedUser,
    narration,
    metadata,
    session,
  });
};

const reverseLedgerEntry = async ({
  originalEntryId,
  openingBalance,
  closingBalance,
  idempotencyKey,
  narration = "",
  metadata = {},
  session = null,
}) => {
  const query =
    LedgerEntry.findById(
      originalEntryId
    );

  if (session) {
    query.session(session);
  }

  const original =
    await query;

  if (!original) {
    throw new Error(
      "Original ledger entry not found."
    );
  }

  const reverseDirection =
    original.direction === "DEBIT"
      ? "CREDIT"
      : "DEBIT";

  const result =
    await postLedgerEntry({
      userId: original.user,
      direction:
        reverseDirection,
      amount:
        original.amount,
      openingBalance,
      closingBalance,
      service:
        `${original.service}_REVERSAL`,
      reference:
        original.reference,
      idempotencyKey,
      transactionId:
        original.transactionId,
      relatedUser:
        original.relatedUser,
      narration:
        narration ||
        `Reversal of ledger entry ${original._id}`,
      metadata: {
        ...metadata,
        originalLedgerEntry:
          String(original._id),
      },
      session,
    });

  /*
   * We do NOT mutate the original ledger row.
   * Reversal is represented by a new opposite entry.
   */

  return result;
};

module.exports = {
  buildLedgerReference,
  postLedgerEntry,
  postDebit,
  postCredit,
  reverseLedgerEntry,
};
