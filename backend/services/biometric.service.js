const crypto = require("crypto");
const DeviceSession = require("../models/deviceSession.model");
const BiometricGrant = require("../models/biometricGrant.model");
const User = require("../models/user.model");
const { verifyTransactionPin } = require("./transactionPin.service");

const BIOMETRIC_OPERATIONS = Object.freeze({
  TRANSFER: "TRANSFER",
  WITHDRAWAL: "WITHDRAWAL",
  REQUEST_MONEY_PAYMENT: "REQUEST_MONEY_PAYMENT",
  PAY_LINK_PAYMENT: "PAY_LINK_PAYMENT",
  GROUP_WALLET_CONTRIBUTION: "GROUP_WALLET_CONTRIBUTION",
  ORGANIZATION_PAYMENT: "ORGANIZATION_PAYMENT",
  ORGANIZATION_TREASURY_WITHDRAWAL: "ORGANIZATION_TREASURY_WITHDRAWAL",
  TRUST_FUND: "TRUST_FUND",
  TRUST_RELEASE: "TRUST_RELEASE",
  INTERSTATE_PAYMENT: "INTERSTATE_PAYMENT",
  INTERSTATE_ADJUSTMENT: "INTERSTATE_ADJUSTMENT",
});

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const newCredential = () => crypto.randomBytes(32).toString("base64url");
const newDeviceId = () => crypto.randomUUID();
const fail = (message, code = "BIOMETRIC_UNAUTHORIZED", statusCode = 401) => {
  const e = new Error(message); e.code = code; e.statusCode = statusCode; return e;
};

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((o, k) => {
    // deviceId and idempotencyKey are bound independently by consumeGrant;
    // clients may add or omit them in the final request body.
    if (!["transactionPin", "pin", "biometricGrant", "intentHash", "authorization", "auth", "token", "deviceId", "idempotencyKey"].includes(k)) o[k] = canonicalize(value[k]);
    return o;
  }, {});
  return value;
}
function intentHash(operation, idempotencyKey, body) {
  return hash(`${String(operation)}:${String(idempotencyKey)}:${JSON.stringify(canonicalize(body || {}))}`);
}
async function activeSession(deviceId, credential, user, { transaction = false } = {}) {
  if (!deviceId || typeof credential !== "string" || Buffer.from(credential, "base64url").length !== 32) throw fail("Invalid device credential.");
  const session = await DeviceSession.findOne({ deviceId, status: "ACTIVE", [transaction ? "transactionEnabled" : "loginEnabled"]: true }).select("+credentialHash +previousCredentialHash");
  if (!session || String(session.userId) !== String(user._id) || session.expiresAt <= new Date()) throw fail("Invalid or expired device session.");
  if (Number(user.authTokenVersion || 0) !== Number(session.authTokenVersionAtEnrollment)) throw fail("Device session revoked.", "TOKEN_REVOKED");
  return session;
}
async function rotate(session, credential, { transaction = false } = {}) {
  const next = newCredential();
  const updated = await DeviceSession.findOneAndUpdate(
    { _id: session._id, status: "ACTIVE", credentialHash: hash(credential) },
    { $set: { credentialHash: hash(next), previousCredentialHash: hash(credential), lastUsedAt: new Date() } },
    { new: true }
  ).select("+credentialHash +previousCredentialHash");
  if (updated) return { session: updated, credential: next };
  const replay = await DeviceSession.findOne({ _id: session._id, status: "ACTIVE" }).select("+previousCredentialHash");
  if (replay && replay.previousCredentialHash === hash(credential)) {
    await DeviceSession.updateOne({ _id: replay._id, status: "ACTIVE" }, { $set: { status: "REVOKED", revokedAt: new Date(), reuseDetectedAt: new Date() } });
  }
  throw fail("Device credential has already been used.", "CREDENTIAL_REPLAY");
}
async function createGrant({ userId, deviceId, operation, intentHash: ih, idempotencyKey }) {
  const raw = newCredential();
  await BiometricGrant.create({ grantHash: hash(raw), userId, deviceId, operation, intentHash: ih, idempotencyKey, expiresAt: new Date(Date.now() + 60000) });
  return raw;
}
async function consumeGrant({ userId, deviceId, operation, intentHash: ih, idempotencyKey, grant }) {
  const found = await BiometricGrant.findOneAndDelete({ grantHash: hash(grant), userId, deviceId, operation, intentHash: ih, idempotencyKey, expiresAt: { $gt: new Date() } }).select("+grantHash");
  if (!found) throw fail("Invalid, expired, or already used biometric grant.", "BIOMETRIC_GRANT_INVALID");
  return found;
}
async function authorizeTransaction({ userId, body, operation, idempotencyKey, session }) {
  const user = await User.findById(userId).select("+transactionPin +transactionPinFailedAttempts +transactionPinLockedUntil +transactionPinAttemptVersion");
  if (!user) throw fail("User not found.", "UNAUTHORIZED");
  const pin = String(body?.transactionPin ?? body?.pin ?? "").trim();
  if (pin) {
    await verifyTransactionPin(userId, pin, { session });
    return { method: "pin" };
  }
  const deviceId = body?.deviceId;
  const grant = body?.biometricGrant;
  if (!deviceId || !grant) throw fail("Transaction PIN or biometric grant is required.", "TRANSACTION_AUTH_REQUIRED", 400);
  await consumeGrant({ userId, deviceId, operation, intentHash: intentHash(operation, idempotencyKey, body), idempotencyKey, grant });
  return { method: "biometric" };
}
module.exports = { BIOMETRIC_OPERATIONS, hash, newCredential, newDeviceId, canonicalize, intentHash, activeSession, rotate, createGrant, consumeGrant, authorizeTransaction, fail };