const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Activation = require("../models/businessPartnerActivation.model");
const logisticsSms = require("./logisticsSms.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");

const normalizePhone = value => {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+234\d{10}$/.test(digits)) return digits;
  if (/^234\d{10}$/.test(digits)) return `+${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+234${digits.slice(1)}`;
  return digits;
};
const phoneAliases = value => {
  const raw = String(value || "").trim();
  const compact = raw.replace(/\D/g, "");
  const normalized = normalizePhone(value);
  const local = compact.startsWith("234") ? `0${compact.slice(3)}` : compact;
  return [...new Set([raw, compact, local, normalized].filter(Boolean))];
};
const hash = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const randomOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");
const requestBuckets = new Map();
const activationFailure = () => Object.assign(new Error("Activation code is invalid or expired."), { statusCode: 400 });

async function requestPhoneActivation({ phone, requestSource = "unknown" }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { accepted: true };
  const bucketKey = `${String(requestSource || "unknown").slice(0, 128)}:${normalized}`;
  const now = Date.now();
  const bucket = requestBuckets.get(bucketKey) || { count: 0, resetAt: now + 60 * 1000 };
  if (bucket.resetAt <= now) { bucket.count = 0; bucket.resetAt = now + 60 * 1000; }
  bucket.count += 1;
  requestBuckets.set(bucketKey, bucket);
  if (bucket.count > 5) return { accepted: true };
  const user = await User.findOne({
    role: "CUSTOMER", activationPending: true,
    $or: phoneAliases(phone).map(value => ({ phone: value })),
  });
  if (!user) return { accepted: true };
  const previous = await Activation.findOne({ user: user._id, purpose: "CUSTOMER_ACTIVATION", channel: "PHONE" });
  if (previous && previous.expiresAt > new Date() && previous.createdAt > new Date(Date.now() - 60 * 1000)) {
    return { accepted: true };
  }
  const otp = randomOtp();
  let delivery;
  try {
    delivery = await logisticsSms.sendDeliveryOtp({ phone: normalized, code: otp });
  } catch (error) {
    console.error("Customer activation SMS delivery error:", error);
    return { accepted: true };
  }
  if (!delivery?.sent) return { accepted: true };
  await Activation.findOneAndUpdate(
    { user: user._id, purpose: "CUSTOMER_ACTIVATION", channel: "PHONE" },
    { $set: { otpHash: hash(otp), expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, consumedAt: null, updatedAt: new Date() }, $setOnInsert: { user: user._id, purpose: "CUSTOMER_ACTIVATION", channel: "PHONE" } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return { accepted: true, sent: true, userId: user._id, channel: "PHONE", expiresInSeconds: 600 };
}

async function verifyPhoneActivation({ phone, otp, newPassword, confirmPassword }) {
  const normalized = normalizePhone(phone);
  if (!normalized || !/^\d{6}$/.test(String(otp || ""))) throw activationFailure();
  if (!newPassword || newPassword !== confirmPassword) throw Object.assign(new Error("New password and confirmation must match."), { statusCode: 400 });
  const passwordCheck = validateStrongPassword(newPassword);
  if (!passwordCheck.valid) throw Object.assign(new Error(passwordCheck.message), { statusCode: 400 });
  const user = await User.findOne({ role: "CUSTOMER", activationPending: true, $or: phoneAliases(phone).map(value => ({ phone: value })) });
  if (!user) throw activationFailure();
  const activation = await Activation.findOneAndUpdate(
    { user: user._id, purpose: "CUSTOMER_ACTIVATION", channel: "PHONE", consumedAt: null, expiresAt: { $gt: new Date() }, $expr: { $lt: ["$attempts", "$maxAttempts"] } },
    { $inc: { attempts: 1 } },
    { new: true }
  ).select("+otpHash");
  if (!activation) throw activationFailure();
  if (!crypto.timingSafeEqual(Buffer.from(activation.otpHash), Buffer.from(hash(otp)))) throw activationFailure();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await User.findOne({ _id: user._id, activationPending: true, status: "PENDING" }).session(session);
      const currentActivation = await Activation.findOne({ _id: activation._id, consumedAt: null }).session(session);
      if (!current || !currentActivation) throw activationFailure();
      current.password = newPassword;
      current.activationPending = false;
      current.activationRequestedAt = null;
      current.status = "ACTIVE";
      current.mustChangePassword = false;
      current.passwordResetToken = undefined;
      current.passwordResetExpires = undefined;
      await current.save({ session });
      currentActivation.consumedAt = new Date();
      await currentActivation.save({ session });
    });
  } finally { await session.endSession(); }
  return { activated: true, userId: user._id };
}

module.exports = { normalizePhone, requestPhoneActivation, verifyPhoneActivation };