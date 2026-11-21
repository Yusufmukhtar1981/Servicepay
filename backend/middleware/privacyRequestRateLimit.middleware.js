const crypto = require("crypto");
const PrivacyRequestRateLimit = require("../models/privacyRequestRateLimit.model");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

const clientIp = (req) =>
  // Express applies the configured proxy trust boundary; do not trust a raw,
  // client-supplied forwarded header as an independent rate-limit identity.
  String(req.ip || req.socket?.remoteAddress || "unknown").trim();

const createPrivacyRequestRateLimit = ({
  rateLimitModel = PrivacyRequestRateLimit,
  now = () => Date.now(),
  maxRequests = MAX_REQUESTS_PER_WINDOW,
  keyForRequest = req => `${clientIp(req)}:${String(req.body?.email || "").trim().toLowerCase()}`,
} = {}) => async (req, res, next) => {
  const key = crypto.createHash("sha256")
    .update(keyForRequest(req))
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

    if (Number(record?.count || 0) > maxRequests) {
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
    req.log?.warn({ event: "privacy.rate_limit.unavailable" });
    return res.status(503).json({
      success: false,
      message: "Privacy requests are temporarily unavailable. Please contact Support.",
    });
  }
};

// Separate IP and account budgets stop identifier rotation from bypassing the
// IP limit and distributed guesses from bypassing the account limit.
const deletionIpRateLimit = createPrivacyRequestRateLimit({
  maxRequests: 30,
  keyForRequest: req => `privacy-deletion:ip:${clientIp(req)}`,
});
const deletionIdentityKey = req => {
  const { identifierFilter } = require("../services/privacyDeletionVerification.service");
  const identifier = req.body?.identifier;
  const filter = identifierFilter(identifier);
  const canonical = filter?.email ||
    filter?.phone?.$in?.slice().sort().join("|") ||
    String(req.body?.challengeId || identifier || "").trim().toLowerCase();
  return `privacy-deletion:identity:${canonical}`;
};
const deletionIdentityRateLimit = createPrivacyRequestRateLimit({
  maxRequests: 5,
  keyForRequest: deletionIdentityKey,
});

module.exports = {
  WINDOW_MS,
  MAX_REQUESTS_PER_WINDOW,
  createPrivacyRequestRateLimit,
  privacyRequestRateLimit: createPrivacyRequestRateLimit(),
  deletionIpRateLimit,
  deletionIdentityRateLimit,
  deletionIdentityKey,
};