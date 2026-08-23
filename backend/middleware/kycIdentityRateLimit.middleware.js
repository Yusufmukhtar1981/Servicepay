const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const kycIdentityRateLimit = (req, res, next) => {
  const key = String(req.user?._id || req.user?.id || "");
  const now = Date.now();
  const activeAttempts = (attempts.get(key) || []).filter(
    (timestamp) => now - timestamp < WINDOW_MS,
  );

  if (activeAttempts.length >= MAX_ATTEMPTS) {
    return res.status(429).json({
      success: false,
      code: "IDENTITY_VERIFICATION_RATE_LIMITED",
      message: "Too many identity verification attempts. Please try again later.",
    });
  }

  activeAttempts.push(now);
  attempts.set(key, activeAttempts);
  return next();
};

module.exports = { kycIdentityRateLimit };