const crypto = require("crypto");
const PrivacyRequestRateLimit = require("../models/privacyRequestRateLimit.model");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

const clientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.ip || "")
    .split(",")[0]
    .trim();

const createPrivacyRequestRateLimit = ({
  rateLimitModel = PrivacyRequestRateLimit,
  now = () => Date.now(),
} = {}) => async (req, res, next) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const key = crypto.createHash("sha256")
    .update(`${clientIp(req)}:${email}`)
    .digest("hex");
  const timestamp = now();
  const bucket = Math.floor(timestamp / WINDOW_MS);

  try {
    const record = await rateLimitModel.findOneAndUpdate(
      { key, bucket },
      {
        $inc: { count: 1 },
        $setOnInsert: {
          key,
          bucket,
          expiresAt: new Date((bucket + 2) * WINDOW_MS),
        },
      },
      { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
    );

    if (Number(record?.count || 0) > MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(((bucket + 1) * WINDOW_MS - timestamp) / 1000),
      );
      res.set?.("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        code: "PRIVACY_REQUEST_RATE_LIMITED",
        message: "Too many privacy requests. Please try again later.",
        retryAfterSeconds,
      });
    }
    return next();
  } catch (error) {
    console.error("Privacy request rate limit error:", error.message);
    return res.status(503).json({
      success: false,
      message: "Privacy requests are temporarily unavailable. Please contact Support.",
    });
  }
};

module.exports = {
  WINDOW_MS,
  MAX_REQUESTS_PER_WINDOW,
  createPrivacyRequestRateLimit,
  privacyRequestRateLimit: createPrivacyRequestRateLimit(),
};