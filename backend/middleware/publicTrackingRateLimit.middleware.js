const buckets = new Map();
module.exports = (req, res, next) => {
  const key = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now(); const entry = buckets.get(key) || { start: now, count: 0 };
  if (now - entry.start > 60 * 1000) { entry.start = now; entry.count = 0; }
  entry.count += 1; buckets.set(key, entry);
  if (entry.count > 30) return res.status(429).json({ success: false, message: "Too many tracking requests. Please try again shortly." });
  return next();
};