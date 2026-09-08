const TrustSearchRateLimit = require(
  "../models/trustSearchRateLimit.model"
);

const WINDOW_MS = 10 * 60 * 1000;
const MAX_SEARCHES_PER_WINDOW = 20;

const bucketFor = (timestamp) =>
  Math.floor(timestamp / WINDOW_MS);

const createTrustSearchRateLimit = ({
  rateLimitModel = TrustSearchRateLimit,
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
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (Number(record?.count || 0) > MAX_SEARCHES_PER_WINDOW) {
      return res.status(429).json({
        success: false,
        message:
          "Too many Trust searches. Please wait before trying again.",
      });
    }

    return next();
  } catch (error) {
    console.error("Trust search rate limit error:", error);

    return res.status(503).json({
      success: false,
      message:
        "Trust search is temporarily unavailable. Please try again shortly.",
    });
  }
};

const trustSearchRateLimit = createTrustSearchRateLimit();

module.exports = {
  bucketFor,
  createTrustSearchRateLimit,
  MAX_SEARCHES_PER_WINDOW,
  trustSearchRateLimit,
  WINDOW_MS,
};