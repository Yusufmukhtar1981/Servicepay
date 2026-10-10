const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const digest = token => crypto.createHash("sha256").update(token).digest("hex");
const invalid = () => Object.assign(new Error("Please sign in again."), { statusCode: 401 });

function createCustomerRefreshSession({
  model = User, secret = () => process.env.JWT_SECRET,
  restricted = async () => { throw new Error("Restriction verifier is required"); },
  now = () => Date.now(),
} = {}) {
  function tokenFor(user, expiresAt, authTime) {
    return jwt.sign({
      id: String(user._id), authTokenVersion: Number(user.authTokenVersion || 0),
      tokenUse: "refresh", jti: crypto.randomBytes(32).toString("hex"), auth_time: authTime,
      exp: Math.floor(expiresAt.getTime() / 1000),
    }, secret(), { audience: "servicepay-refresh", issuer: "servicepay-api" });
  }
  const versionFilter = version => version === 0
    ? { $or: [{ authTokenVersion: 0 }, { authTokenVersion: { $exists: false } }] }
    : { authTokenVersion: version };

  async function issue(user) {
    if (user.role !== "CUSTOMER" || user.status !== "ACTIVE") return null;
    const expiresAt = new Date(now() + 30 * 86400000);
    const authTime = Math.floor(now() / 1000);
    const refreshToken = tokenFor(user, expiresAt, authTime);
    const changed = await model.updateOne({
      _id: user._id, role: "CUSTOMER", status: "ACTIVE",
      ...versionFilter(Number(user.authTokenVersion || 0)),
    }, { $push: { customerRefreshSessions: {
      $each: [{ tokenHash: digest(refreshToken), expiresAt, authTime }], $slice: -5,
    } } });
    if (changed.modifiedCount !== 1) throw invalid();
    return refreshToken;
  }
  async function refresh(token) {
    if (typeof token !== "string" || token.length > 2048) throw invalid();
    let claims;
    try {
      claims = jwt.verify(token, secret(), {
        algorithms: ["HS256"], audience: "servicepay-refresh", issuer: "servicepay-api",
      });
    } catch (_) { throw invalid(); }
    if (claims.tokenUse !== "refresh" || !/^[a-f0-9]{64}$/.test(claims.jti || "")) throw invalid();
    const user = await model.findById(claims.id).select("+authTokenVersion +customerRefreshSessions");
    if (!user || user.role !== "CUSTOMER" || user.status !== "ACTIVE" ||
        Number(user.authTokenVersion || 0) !== claims.authTokenVersion ||
        await restricted(user)) throw invalid();
    const hash = digest(token);
    const session = user.customerRefreshSessions?.find(s =>
      s.tokenHash === hash && new Date(s.expiresAt).getTime() > now());
    if (!session) throw invalid();
    const expiresAt = new Date(session.expiresAt);
    const refreshToken = tokenFor(user, expiresAt, session.authTime);
    const changed = await model.updateOne({
      _id: user._id, role: "CUSTOMER", status: "ACTIVE",
      ...versionFilter(claims.authTokenVersion),
      customerRefreshSessions: { $elemMatch: { tokenHash: hash, expiresAt: { $gt: new Date(now()) } } },
    }, { $set: { "customerRefreshSessions.$.tokenHash": digest(refreshToken) } });
    if (changed.modifiedCount !== 1) throw invalid();
    const accessToken = jwt.sign({
      id: String(user._id), authTokenVersion: claims.authTokenVersion,
      tokenUse: "access", amr: ["pwd"], auth_time: session.authTime,
    }, secret(), { algorithm: "HS256", expiresIn: "7d" });
    return { token: accessToken, refreshToken };
  }
  async function revoke(token) {
    if (typeof token !== "string" || token.length > 2048) throw invalid();
    let claims;
    try {
      claims = jwt.verify(token, secret(), {
        algorithms: ["HS256"], audience: "servicepay-refresh", issuer: "servicepay-api",
      });
    } catch (_) { throw invalid(); }
    if (claims.tokenUse !== "refresh") throw invalid();
    await model.updateOne({ _id: claims.id }, {
      $pull: { customerRefreshSessions: { tokenHash: digest(token) } },
    });
  }
  return { issue, refresh, revoke };
}
module.exports = { createCustomerRefreshSession };
