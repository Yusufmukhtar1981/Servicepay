const TransactionPinResetRateLimit = require(
  "../models/transactionPinResetRateLimit.model"
);

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

const bucketFor = (timestamp) =>
  Math.floor(timestamp / WINDOW_MS);

const createTransactionPinResetRateLimit = ({
  rateLimitModel = TransactionPinResetRateLimit,
  now = () => Date.now(),
} = {}) => async (req, res, next) => {
  const userId = req.user?._id || req.user?.id;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized.",
    });
  }

  const timestamp = now();
  const bucket = bucketFor(timestamp);

  try {
    const record = await rateLimitModel.findOneAndUpdate(
      { user: userId, bucket },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          user: userId,
          bucket,
          expiresAt: new Date((bucket + 2) * WINDOW_MS),
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (
      Number(record?.count || 0) >
      MAX_ATTEMPTS_PER_WINDOW
    ) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          ((bucket + 1) * WINDOW_MS - timestamp) / 1000
        )
      );

      res.set?.("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "TRANSACTION_PIN_RESET_RATE_LIMITED",
        message:
          "Too many transaction PIN reset attempts. Please try again later.",
        retryAfterSeconds,
      });
    }

    return next();
  } catch (error) {
    console.error(
      "Transaction PIN reset rate limit error:",
      error.message
    );

    return res.status(503).json({
      success: false,
      message:
        "Transaction PIN reset is temporarily unavailable. Please try again later.",
    });
  }
};

module.exports = {
  MAX_ATTEMPTS_PER_WINDOW,
  WINDOW_MS,
  bucketFor,
  createTransactionPinResetRateLimit,
  transactionPinResetRateLimit:
    createTransactionPinResetRateLimit(),
};