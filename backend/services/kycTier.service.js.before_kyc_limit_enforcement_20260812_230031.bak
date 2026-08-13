const KycProfile = require("../models/kycProfile.model");
const LedgerEntry = require("../models/ledgerEntry.model");

const TIER_LIMITS = {
  TIER_1: {
    perTransaction: Number(
      process.env.KYC_TIER1_PER_TRANSACTION || 50000
    ),
    daily: Number(
      process.env.KYC_TIER1_DAILY_LIMIT || 200000
    ),
  },

  TIER_2: {
    perTransaction: Number(
      process.env.KYC_TIER2_PER_TRANSACTION || 200000
    ),
    daily: Number(
      process.env.KYC_TIER2_DAILY_LIMIT || 1000000
    ),
  },

  TIER_3: {
    perTransaction: Number(
      process.env.KYC_TIER3_PER_TRANSACTION || 1000000
    ),
    daily: Number(
      process.env.KYC_TIER3_DAILY_LIMIT || 5000000
    ),
  },
};

const normalizeTier = (value) => {
  const tier = String(value || "")
    .trim()
    .toUpperCase();

  if (["TIER_1", "TIER_2", "TIER_3"].includes(tier)) {
    return tier;
  }

  return "TIER_1";
};

const getEffectiveTier = async (userId) => {
  const profile = await KycProfile.findOne({
    user: userId,
  }).lean();

  if (!profile) {
    return {
      tier: "TIER_1",
      status: "NOT_STARTED",
      profile: null,
    };
  }

  /*
   * Only VERIFIED KYC can unlock a higher tier.
   *
   * A pending Tier 2/3 request must never grant the
   * requested higher transaction limit before approval.
   */
  if (
    String(profile.status || "").toUpperCase() !==
    "VERIFIED"
  ) {
    return {
      tier: "TIER_1",
      status: String(
        profile.status || "NOT_STARTED"
      ).toUpperCase(),
      profile,
    };
  }

  return {
    tier: normalizeTier(profile.level),
    status: "VERIFIED",
    profile,
  };
};

const getTierSummary = async (userId) => {
  const result = await getEffectiveTier(userId);

  const limit =
    TIER_LIMITS[result.tier] ||
    TIER_LIMITS.TIER_1;

  return {
    tier: result.tier,
    status: result.status,
    perTransactionLimit: limit.perTransaction,
    dailyLimit: limit.daily,
  };
};

const checkDebitLimit = async ({
  userId,
  amount,
}) => {
  const numericAmount = Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error(
      "Invalid transaction amount."
    );
  }

  const {
    tier,
    status,
    perTransactionLimit,
    dailyLimit,
  } = await getTierSummary(userId);

  if (numericAmount > perTransactionLimit) {
    const error = new Error(
      `${tier.replace("_", " ")} transaction limit exceeded. ` +
      `Maximum per transaction is ₦${perTransactionLimit.toLocaleString("en-NG")}.`
    );

    error.code = "KYC_PER_TRANSACTION_LIMIT";
    error.statusCode = 403;

    throw error;
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const tomorrow = new Date(startOfDay);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const totals = await LedgerEntry.aggregate([
    {
      $match: {
        userId:
          typeof userId === "string"
            ? require("mongoose").Types.ObjectId.createFromHexString(
                userId
              )
            : userId,
        direction: "DEBIT",
        status: "POSTED",
        createdAt: {
          $gte: startOfDay,
          $lt: tomorrow,
        },
      },
    },
    {
      $group: {
        _id: null,
        total: {
          $sum: "$amount",
        },
      },
    },
  ]);

  const spentToday =
    totals.length > 0
      ? Number(totals[0].total || 0)
      : 0;

  if (
    spentToday + numericAmount >
    dailyLimit
  ) {
    const remaining = Math.max(
      0,
      dailyLimit - spentToday
    );

    const error = new Error(
      `${tier.replace("_", " ")} daily transaction limit exceeded. ` +
      `Remaining today: ₦${remaining.toLocaleString("en-NG")}.`
    );

    error.code = "KYC_DAILY_LIMIT";
    error.statusCode = 403;

    throw error;
  }

  return {
    allowed: true,
    tier,
    status,
    perTransactionLimit,
    dailyLimit,
    spentToday,
    remainingAfterTransaction:
      dailyLimit -
      spentToday -
      numericAmount,
  };
};

module.exports = {
  TIER_LIMITS,
  normalizeTier,
  getEffectiveTier,
  getTierSummary,
  checkDebitLimit,
};
