const crypto = require("crypto");
const User = require("../models/user.model");
const email = require("./email.service");
const sms = require("./logisticsSms.service");

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });
const digest = value => {
  if (!process.env.JWT_SECRET) throw fail(503, "Verification is unavailable.");
  return crypto.createHmac("sha256", process.env.JWT_SECRET).update(value).digest("hex");
};
const proof = (id, label, code) => digest(`${id}:${label}:${code}`);
const clean = (value, max) => {
  if (typeof value !== "string" || value.length > max || /[\x00-\x1f]/.test(value)) {
    throw fail(400, "Invalid profile information.");
  }
  return value.trim();
};
function normalize(field, value) {
  const v = clean(value, field === "email" ? 254 : 32);
  if (field === "email") {
    const result = v.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw fail(400, "Enter a valid email address.");
    return result;
  }
  if (field !== "phone") throw fail(400, "Only email and phone can be verified.");
  const digits = v.replace(/[\s()+-]/g, "");
  const local = /^234\d{10}$/.test(digits) ? `0${digits.slice(3)}` : digits;
  if (!/^0[789]\d{9}$/.test(local)) throw fail(400, "Enter a valid Nigerian mobile phone number.");
  return local;
}
const aliases = value => {
  const local = normalize("phone", value);
  return [local, `234${local.slice(1)}`, `+234${local.slice(1)}`];
};
async function unique(field, value, targetId, session) {
  const condition = field === "phone" ? { phone: { $in: aliases(value) } }
    : { email: { $regex: `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } };
  const query = User.exists({ _id: { $ne: targetId }, ...condition });
  if (session) query.session(session);
  if (await query) throw fail(409, "Another account already uses this contact information.");
}
async function send(channel, value, code, approval) {
  const text = approval
    ? `Your ServicePay profile change approval code is ${code}. It expires in 10 minutes. Do not share it if you did not request this change.`
    : `Your ServicePay new contact verification code is ${code}. It expires in 10 minutes.`;
  if (channel === "email") {
    const result = await email.sendEmail({ to: value, subject: "ServicePay profile verification", text, html: `<p>${text}</p>` });
    return result?.success === true;
  }
  const result = await sms.sendDeliveryOtp({ phone: `+234${normalize("phone", value).slice(1)}`, code, message: text });
  return result?.sent === true;
}
async function request({ actorId, targetId, field, value, currentPassword, reason }) {
  const targetValue = normalize(field, value);
  if (typeof currentPassword !== "string" || !currentPassword || currentPassword.length > 128) {
    throw fail(400, "Your current password is required.");
  }
  const actor = await User.findById(actorId).select("+password +authTokenVersion");
  const target = await User.findOne({ _id: targetId, role: "CUSTOMER" }).select("+authTokenVersion");
  if (!actor || !target) throw fail(404, "Customer account not found.");
  if (!await actor.comparePassword(currentPassword)) throw fail(401, "Current password is incorrect.");
  if (target[field] && normalize(field, target[field]) === targetValue) throw fail(400, "Contact information has not changed.");
  await unique(field, targetValue, targetId);
  // Proof of possession of the existing account contact prevents staff from
  // taking over a customer simply by verifying a new destination they control.
  const approvalChannel = target.email ? "email" : "phone";
  const approvalValue = normalize(approvalChannel, target[approvalChannel]);
  const now = Date.now();
  const id = crypto.randomUUID();
  const code = String(crypto.randomInt(1000000)).padStart(6, "0");
  const approvalCode = String(crypto.randomInt(1000000)).padStart(6, "0");
  const challenge = { id, actorId: String(actorId), field, value: targetValue,
    oldEmail: target.email || "", oldPhone: target.phone,
    actorVersion: Number(actor.authTokenVersion || 0), targetVersion: Number(target.authTokenVersion || 0),
    codeHash: proof(id, "new", code), approvalHash: proof(id, "old", approvalCode),
    expiresAt: new Date(now + 600000), attempts: 0, ready: false, reason: String(reason || "").slice(0, 500) };
  // A persistent per-customer cooldown and hourly cap survive process restarts.
  const reserved = await User.findOneAndUpdate({
    _id: targetId, role: "CUSTOMER",
    $and: [
      { $or: [{ "profileContactRate.lastSent": { $exists: false } }, { "profileContactRate.lastSent": { $lte: new Date(now - 60000) } }] },
      { $or: [{ "profileContactRate.hour": { $exists: false } }, { "profileContactRate.hour": { $lte: new Date(now - 3600000) } }, { "profileContactRate.count": { $lt: 5 } }] },
    ],
  }, [
    { $set: {
      profileContactChallenge: { $literal: challenge },
      profileContactRate: {
        lastSent: { $literal: new Date(now) },
        hour: { $cond: [{ $gt: ["$profileContactRate.hour", new Date(now - 3600000)] }, "$profileContactRate.hour", { $literal: new Date(now) }] },
        count: { $cond: [{ $gt: ["$profileContactRate.hour", new Date(now - 3600000)] }, { $add: [{ $ifNull: ["$profileContactRate.count", 0] }, 1] }, 1] },
      },
    } },
  ], { new: true, updatePipeline: true });
  if (!reserved) throw fail(429, "Please wait before requesting another verification. At most five requests are allowed per hour.");
  let delivered = false;
  try {
    delivered = await send(field, targetValue, code, false) &&
      await send(approvalChannel, approvalValue, approvalCode, true);
  } catch (_) { /* Fail closed; no provider error or destination in response. */ }
  if (!delivered) {
    await User.updateOne({ _id: targetId, "profileContactChallenge.id": id }, { $unset: { profileContactChallenge: 1 } });
    throw fail(503, "Verification delivery is unavailable. Your contact information has not changed.");
  }
  const ready = await User.updateOne({ _id: targetId, "profileContactChallenge.id": id }, { $set: { "profileContactChallenge.ready": true } });
  if (!ready.matchedCount) throw fail(409, "Verification was superseded. Please request a new code.");
  return { challengeId: id, expiresInSeconds: 600, approvalChannel };
}
async function verify({ user, actor, field, value, verification, session }) {
  const c = user.profileContactChallenge;
  const invalid = () => fail(400, "Contact verification is invalid or expired. Request new codes.");
  if (!c || !verification || c.id !== verification.challengeId || c.field !== field ||
      c.actorId !== String(actor._id) || c.value !== value || !c.ready ||
      new Date(c.expiresAt) <= new Date() || c.attempts >= 5 ||
      c.oldEmail !== (user.email || "") || c.oldPhone !== user.phone ||
      c.actorVersion !== Number(actor.authTokenVersion || 0) || c.targetVersion !== Number(user.authTokenVersion || 0)) throw invalid();
  const valid = /^\d{6}$/.test(String(verification.code || "")) &&
    /^\d{6}$/.test(String(verification.approvalCode || "")) &&
    proof(c.id, "new", verification.code) === c.codeHash &&
    proof(c.id, "old", verification.approvalCode) === c.approvalHash;
  if (!valid) {
    // Outside the aborted transaction so invalid attempts cannot roll back.
    await User.updateOne({ _id: user._id, "profileContactChallenge.id": c.id }, { $inc: { "profileContactChallenge.attempts": 1 } });
    throw invalid();
  }
  await unique(field, value, user._id, session);
}
module.exports = { request, verify, normalize, unique, clean, fail };
