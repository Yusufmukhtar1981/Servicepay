const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 30;
const MAX_TRACKED_CLIENTS = 10000;

const clients = new Map();
let requestCount = 0;

const clientKey = (req) =>
  String(req.ip || req.socket?.remoteAddress || "unknown").trim();

const pruneExpiredClients = (now) => {
  for (const [key, value] of clients) {
    if (value.resetAt <= now) {
      clients.delete(key);
    }
  }

  while (clients.size > MAX_TRACKED_CLIENTS) {
    clients.delete(clients.keys().next().value);
  }
};

const referralValidationRateLimit = (req, res, next) => {
  const now = Date.now();
  requestCount += 1;
  const key = clientKey(req);
  let record = clients.get(key);

  if (!record || record.resetAt <= now) {
    record = {
      count: 0,
      resetAt: now + WINDOW_MS,
    };
  }

  record.count += 1;
  clients.set(key, record);

  if (clients.size > MAX_TRACKED_CLIENTS || requestCount % 256 === 0) {
    pruneExpiredClients(now);
  }

  res.set?.("RateLimit-Limit", String(MAX_REQUESTS));
  res.set?.(
    "RateLimit-Remaining",
    String(Math.max(0, MAX_REQUESTS - record.count))
  );
  res.set?.(
    "RateLimit-Reset",
    String(Math.ceil(record.resetAt / 1000))
  );

  if (record.count > MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      valid: false,
      message: "Too many referral validation requests. Please try again later.",
    });
  }

  return next();
};

module.exports = {
  referralValidationRateLimit,
  _resetReferralValidationRateLimitForTests: () => {
    clients.clear();
    requestCount = 0;
  },
};