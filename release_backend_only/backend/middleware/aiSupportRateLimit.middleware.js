const AISupportRateLimit = require(
  "../models/aiSupportRateLimit.model"
);

const WINDOW_MS = 10 * 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 20;

const bucketFor = (timestamp) =>
  Math.floor(timestamp / WINDOW_MS);

const createAiSupportRateLimit = ({
  rateLimitModel = AISupportRateLimit,
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

    if (Number(record?.count || 0) > MAX_MESSAGES_PER_WINDOW) {
      const secondsRemaining = Math.max(
        1,
        Math.ceil(((bucket + 1) * WINDOW_MS - timestamp) / 1000)
      );

      res.set?.("Retry-After", String(secondsRemaining));
      return res.status(429).json({
        success: false,
        code: "AI_SUPPORT_RATE_LIMITED",
        message:
          "Too many AI Support messages. Please wait before trying again.",
        retryAfterSeconds: secondsRemaining,
      });
    }

    return next();
  } catch (error) {
    console.error("AI Support rate limit error:", error);

    return res.status(503).json({
      success: false,
      message:
        "AI Support is temporarily unavailable. Please contact ServicePay Support.",
    });
  }
};

const aiSupportCustomerOnly = (req, res, next) => {
  const role = String(req.user?.role || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (role !== "CUSTOMER") {
    return res.status(403).json({
      success: false,
      message:
        "AI Support is available only to ServicePay customer accounts.",
    });
  }

  return next();
};

module.exports = {
  MAX_MESSAGES_PER_WINDOW,
  WINDOW_MS,
  aiSupportCustomerOnly,
  aiSupportRateLimit: createAiSupportRateLimit(),
  bucketFor,
  createAiSupportRateLimit,
};