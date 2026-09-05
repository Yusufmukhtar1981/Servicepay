const crypto = require("node:crypto");
const envScope = { environment: "SANDBOX" };
const hash = (secret, pepper) => crypto.createHmac("sha256", pepper).update(String(secret)).digest("hex");
const equal = (one, two) => {
  const a = Buffer.from(String(one || ""), "utf8");
  const b = Buffer.from(String(two || ""), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};
function auth(models, cfg) {
  return async (req, res, next) => {
    try {
      const key = String(req.get("X-VULL-API-Key") || "");
      const secret = String(req.get("X-VULL-API-Secret") || "");
      if (!/^vull_sb_[A-Za-z0-9_-]+$/.test(key) || !secret) return res.status(401).json({ error: "Invalid sandbox credentials." });
      const credential = await models.Credential.findOne({ ...envScope, apiKey: key }).select("+secretHash");
      if (!credential || credential.status !== "ACTIVE" || !equal(hash(secret, cfg.authPepper), credential.secretHash)) return res.status(401).json({ error: "Invalid sandbox credentials." });
      req.vullCredential = credential;
      next();
    } catch (_) { res.status(500).json({ error: "Sandbox authentication failed." }); }
  };
}
function requireScope(scope) {
  return (req, res, next) => (req.vullCredential.scopes.includes(scope) ? next() : res.status(403).json({ error: `Missing scope: ${scope}` }));
}
module.exports = { auth, requireScope, envScope, hash, equal };