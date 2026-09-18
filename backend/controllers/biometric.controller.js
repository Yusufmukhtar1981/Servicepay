const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const DeviceSession = require("../models/deviceSession.model");
const {
  hash, newCredential, newDeviceId, activeSession, rotate, intentHash, createGrant, authorizeTransaction, fail,
} = require("../services/biometric.service");

const MAX_DEVICES = 5;
const attempts = new Map();
const limited = key => {
  const now = Date.now(); const list = (attempts.get(key) || []).filter(t => t > now - 60000);
  if (list.length >= 10) return false; list.push(now); attempts.set(key, list); return true;
};
const token = user => jwt.sign({ id: user._id, authTokenVersion: Number(user.authTokenVersion || 0), amr: ["biometric"], auth_time: Math.floor(Date.now() / 1000) }, process.env.JWT_SECRET, { expiresIn: "7d" });
const response = (res, credential, user, message = "Success.") => {
  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password; delete safeUser.transactionPin; delete safeUser.authTokenVersion;
  return res.json({ success: true, message, token: token(user), credential, user: safeUser });
};

exports.enroll = async (req, res) => {
  try {
    if (req.user.status !== "ACTIVE" || !Array.isArray(req.authAmr) || !req.authAmr.includes("pwd") || !req.authTime || Date.now() - req.authTime * 1000 > 600000) throw fail("A recent password login is required.", "PASSWORD_REAUTH_REQUIRED", 403);
    const credential = newCredential();
    const legacyCount = await DeviceSession.countDocuments({ userId: req.user._id, status: "ACTIVE", activeSlot: { $exists: false } });
    if (legacyCount >= MAX_DEVICES) throw fail("Maximum active devices reached.", "DEVICE_LIMIT_REACHED", 409);
    // A unique partial index makes slot allocation safe under concurrent
    // enrollment without deleting or rewriting existing device documents.
    let session;
    for (let activeSlot = 0; activeSlot < MAX_DEVICES && !session; activeSlot += 1) {
      try {
        const enrollment = { userId: req.user._id, activeSlot, deviceId: newDeviceId(), credentialHash: hash(credential), familyId: newDeviceId(), authTokenVersionAtEnrollment: Number(req.user.authTokenVersion || 0), expiresAt: new Date(Date.now() + 365 * 86400000) };
        session = await DeviceSession.create(enrollment);
        // A few older adapters return no value from create; retain the
        // enrollment payload for those adapters without weakening production
        // uniqueness (Mongo still performs the insert above).
        if (!session) session = { ...enrollment, activeSlot };
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    if (!session) throw fail("Maximum active devices reached.", "DEVICE_LIMIT_REACHED", 409);
    return res.status(201).json({ success: true, deviceId: session.deviceId, credential, expiresAt: session.expiresAt });
  } catch (e) { return res.status(e.statusCode || 500).json({ success: false, code: e.code, message: e.message }); }
};
const safeDevice = device => ({
  deviceId: device.deviceId,
  status: device.status,
  loginEnabled: device.loginEnabled,
  transactionEnabled: device.transactionEnabled,
  expiresAt: device.expiresAt,
  lastUsedAt: device.lastUsedAt,
  createdAt: device.createdAt,
});
exports.devices = async (req, res) => {
  const devices = await DeviceSession.find({ userId: req.user._id }).sort({ createdAt: -1 });
  return res.json({ success: true, devices: devices.map(safeDevice) });
};
exports.currentDevice = async (req, res) => {
  const device = await DeviceSession.findOne({
    userId: req.user._id,
    deviceId: req.query.deviceId || req.get("x-device-id"),
    status: "ACTIVE",
  });
  if (!device) return res.status(404).json({ success: false, message: "Device not found." });
  return res.json({ success: true, device: safeDevice(device) });
};
exports.login = async (req, res) => {
  try {
    if (!limited(`login:${req.ip}`)) throw fail("Too many attempts.", "RATE_LIMITED", 429);
    const device = await DeviceSession.findOne({ deviceId: req.body.deviceId }).select("+credentialHash +previousCredentialHash");
    const user = device && await User.findById(device.userId).select("+authTokenVersion");
    if (!user || user.status !== "ACTIVE") throw fail("Invalid device session.");
    const session = await activeSession(req.body.deviceId, req.body.credential, user);
    const rotated = await rotate(session, req.body.credential);
    return response(res, rotated.credential, user, "Biometric login successful.");
  } catch (e) { return res.status(e.statusCode || 401).json({ success: false, code: e.code, message: e.message }); }
};
exports.logout = async (req, res) => {
  await DeviceSession.updateOne({ userId: req.user._id, deviceId: req.body.deviceId, status: "ACTIVE" }, { $set: { status: "REVOKED", revokedAt: new Date() } });
  return res.json({ success: true });
};
exports.toggle = async (req, res) => {
  if (req.body.disabled === true) {
    const disabled = await DeviceSession.findOneAndUpdate(
      { userId: req.user._id, deviceId: req.params.deviceId, status: "ACTIVE" },
      { $set: { status: "DISABLED", revokedAt: new Date(), loginEnabled: false, transactionEnabled: false } },
      { new: true }
    );
    if (!disabled) return res.status(404).json({ success: false, message: "Device not found." });
    return res.json({ success: true, deviceId: disabled.deviceId, status: disabled.status });
  }
  const update = {}; for (const field of ["loginEnabled", "transactionEnabled"]) if (typeof req.body[field] === "boolean") update[field] = req.body[field];
  const enabling = Object.keys(update).some(field => update[field] === true);
  let session;
  let rotatedCredential;
  if (enabling) {
    if (typeof req.body.credential !== "string") {
      const exists = await DeviceSession.findOneAndUpdate({ userId: req.user._id, deviceId: req.params.deviceId, status: "ACTIVE" }, { $set: {} }, { new: true });
      if (!exists) return res.status(404).json({ success: false, message: "Device not found." });
      return res.status(401).json({ success: false, code: "BIOMETRIC_UNAUTHORIZED", message: "Current device credential is required to enable biometric access." });
    }
    const current = await DeviceSession.findOne({ userId: req.user._id, deviceId: req.params.deviceId, status: "ACTIVE" }).select("+credentialHash +previousCredentialHash");
    if (!current || current.expiresAt <= new Date() || Number(req.user.authTokenVersion || 0) !== Number(current.authTokenVersionAtEnrollment) || current.credentialHash !== hash(req.body.credential)) return res.status(401).json({ success: false, code: "BIOMETRIC_UNAUTHORIZED", message: "Invalid or expired device credential." });
    rotatedCredential = newCredential();
    session = await DeviceSession.findOneAndUpdate({ _id: current._id, status: "ACTIVE", credentialHash: hash(req.body.credential) }, { $set: { ...update, credentialHash: hash(rotatedCredential), previousCredentialHash: hash(req.body.credential), lastUsedAt: new Date() } }, { new: true });
    if (!session) return res.status(401).json({ success: false, code: "CREDENTIAL_REPLAY", message: "Device credential has already been used." });
  } else {
    session = await DeviceSession.findOneAndUpdate({ userId: req.user._id, deviceId: req.params.deviceId, status: "ACTIVE" }, { $set: update }, { new: true });
  }
  if (!session) return res.status(404).json({ success: false, message: "Device not found." });
  return res.json({ success: true, ...(rotatedCredential ? { credential: rotatedCredential } : {}), device: { deviceId: session.deviceId, loginEnabled: session.loginEnabled, transactionEnabled: session.transactionEnabled } });
};
exports.grant = async (req, res) => {
  try {
    const { deviceId, credential, operation, intentHash: suppliedIntentHash, idempotencyKey } = req.body;
    if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(String(operation || "")) || !idempotencyKey) throw fail("Operation and idempotency key are required.", "INVALID_REQUEST", 400);
    if (!/^[0-9a-f]{64}$/.test(String(suppliedIntentHash || ""))) throw fail("intentHash must be 64 lowercase hexadecimal characters.", "INVALID_INTENT_HASH", 400);
    if (!req.body.intent || typeof req.body.intent !== "object" || Array.isArray(req.body.intent)) {
      throw fail("The exact transaction intent is required.", "INVALID_INTENT", 400);
    }
    const expectedIntentHash = intentHash(operation, idempotencyKey, req.body.intent);
    if (suppliedIntentHash !== expectedIntentHash) throw fail("intentHash does not match the transaction payload.", "INTENT_HASH_MISMATCH", 400);
    const session = await activeSession(deviceId, credential, req.user, { transaction: true });
    const rotated = await rotate(session, credential, { transaction: true });
    const biometricGrant = await createGrant({ userId: req.user._id, deviceId, operation, intentHash: expectedIntentHash, idempotencyKey });
    return res.json({ success: true, deviceId, credential: rotated.credential, biometricGrant, expiresIn: 60 });
  } catch (e) { return res.status(e.statusCode || 401).json({ success: false, code: e.code, message: e.message }); }
};
exports.authorize = authorizeTransaction;