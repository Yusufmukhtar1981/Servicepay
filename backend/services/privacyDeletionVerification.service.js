"use strict";

const crypto = require("node:crypto");

const OTP_TTL_MS = 10 * 60 * 1000;
const STATUS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE = ["PENDING", "UNDER_REVIEW", "APPROVED", "OPEN", "IN_REVIEW"];
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEe.0PEafB6WNfSls7uCZ0pGqi5DQr3O9/G";
const digest = value => crypto.createHash("sha256").update(String(value)).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" &&
  /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
  crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
const fail = (status, message, code) => Object.assign(new Error(message), { status, statusCode: status, code });
const invalid = () => fail(400, "Verification is invalid or expired. Please verify ownership again.", "PRIVACY_VERIFICATION_REQUIRED");
const text = (value, limit) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const publicReference = () => `SP-PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

function identifierFilter(identifier) {
  const value = text(identifier, 254);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { email: value.toLowerCase() };
  const phone = value.replace(/[()\s-]/g, "");
  if (!/^\+?\d{10,15}$/.test(phone)) return null;
  const variants = new Set([phone, phone.replace(/^\+/, "")]);
  const nigeria = phone.match(/^(?:\+?234|0)([789]\d{9})$/);
  if (nigeria) {
    variants.add(`0${nigeria[1]}`);
    variants.add(`234${nigeria[1]}`);
    variants.add(`+234${nigeria[1]}`);
  }
  return { phone: { $in: [...variants] } };
}

function createDeletionVerification({
  requests, users, sendEmail, makeId,
  now = () => new Date(),
  randomToken = () => crypto.randomBytes(32).toString("hex"),
  randomCode = () => String(crypto.randomInt(100000, 1000000)),
  secret = () => process.env.JWT_SECRET,
  verifyPassword = async (user, password) => {
    // Unknown identifiers receive the same expensive comparison and public error.
    const subject = user || users.hydrate({ password: DUMMY_HASH });
    const matched = await subject.comparePassword(password);
    return Boolean(user && matched);
  },
} = {}) {
  const otpHash = (id, code) => {
    const key = secret();
    if (typeof key !== "string" || key.length < 32) {
      throw fail(503, "Verification is temporarily unavailable. Please contact Support.", "PRIVACY_VERIFICATION_UNAVAILABLE");
    }
    return crypto.createHmac("sha256", key).update(`servicepay:account-deletion:${id}:${code}`).digest("hex");
  };
  const findUser = async identifier => {
    const filter = identifierFilter(identifier);
    if (!filter) return null;
    return users.findOne({ ...filter, role: "CUSTOMER", isDeleted: { $ne: true } })
      .select("_id fullName phone email emailVerified +profileRecoveryBlocked +password");
  };
  const publicStatus = request => ({
    referenceId: request.referenceId,
    status: request.status,
    submittedAt: request.submittedAt,
    processingDeadlineAt: request.processingDeadlineAt,
    // Internal staff notes can contain sensitive compliance information.
    history: (request.history || []).map(entry => ({ status: entry.status, changedAt: entry.changedAt })),
  });
  const receipt = async request => {
    const token = randomToken();
    const timestamp = now();
    const saved = await requests.findOneAndUpdate(
      { _id: request._id },
      { $set: { statusAccess: { hash: digest(token), expiresAt: new Date(+timestamp + STATUS_TTL_MS) } } },
      { returnDocument: "after" },
    );
    if (!saved) throw invalid();
    return { ...publicStatus(saved), requestId: String(saved._id), statusToken: token };
  };

  async function challenge(identifier) {
    const id = String(makeId());
    const proof = randomToken();
    const code = randomCode();
    const codeHash = otpHash(id, code);
    const expiresAt = new Date(+now() + OTP_TTL_MS);
    const response = { challengeId: `${id}.${proof}`, expiresAt };
    const user = await findUser(identifier);
    // Never send to a newly supplied destination or an unverified correction.
    if (!user?.email || user.emailVerified !== true || user.profileRecoveryBlocked?.email) return response;
    await requests.create({
      _id: id, type: "ACCOUNT_DELETION", requestKind: "ACCOUNT_DELETION",
      subjectUser: user._id, status: "AWAITING_VERIFICATION", referenceId: publicReference(),
      deletionVerification: {
        proofHash: digest(proof), codeHash, expiresAt, attempts: 0,
        destinationHash: digest(user.email.toLowerCase()), deliveryStatus: "PENDING",
      },
      history: [{ status: "AWAITING_VERIFICATION", actorType: "SYSTEM", note: "Ownership verification requested." }],
    });
    let accepted = false;
    try {
      const sent = await sendEmail({
        to: user.email, subject: "Verify your ServicePay account-deletion request",
        text: `Your ServicePay account-deletion verification code is ${code}. It expires in 10 minutes. Enter it only on the official ServicePay deletion form. This code alone does not delete your account. If you did not request this, ignore this message.`,
        html: `<p>Your ServicePay account-deletion verification code is <strong>${code}</strong>.</p><p>It expires in 10 minutes. Enter it only on the official ServicePay deletion form. This code alone does not delete your account. If you did not request this, ignore this message.</p>`,
        idempotencyKey: `privacy-deletion-otp:${id}`, sensitive: true,
      });
      accepted = sent?.success === true;
    } catch (_) { /* No credentials, destination or OTP in logs or public errors. */ }
    await requests.updateOne({ _id: id, status: "AWAITING_VERIFICATION" },
      { $set: { "deletionVerification.deliveryStatus": accepted ? "ACCEPTED" : "FAILED" } });
    return response; // Same result for unknown identifiers and unavailable contacts.
  }

  async function verifiedSubject(body) {
    if (typeof body.currentPassword === "string") {
      if (!body.currentPassword || body.currentPassword.length > 1024) throw invalid();
      const user = await findUser(body.identifier);
      if (!await verifyPassword(user, body.currentPassword)) throw invalid();
      return { user, method: "PASSWORD", challenge: null };
    }
    const parts = typeof body.challengeId === "string" && body.challengeId.match(/^([a-f0-9]{24})\.([a-f0-9]{64})$/);
    if (!parts || !/^\d{6}$/.test(body.code || "")) throw invalid();
    const timestamp = now();
    // Each guess consumes a database-backed attempt before code comparison.
    const request = await requests.findOneAndUpdate({
      _id: parts[1], status: "AWAITING_VERIFICATION",
      "deletionVerification.proofHash": digest(parts[2]),
      "deletionVerification.deliveryStatus": "ACCEPTED",
      "deletionVerification.expiresAt": { $gt: timestamp },
      "deletionVerification.attempts": { $lt: 5 },
    }, { $inc: { "deletionVerification.attempts": 1 } }, { returnDocument: "after" })
      .select("+deletionVerification");
    if (!request || !equal(request.deletionVerification.codeHash, otpHash(parts[1], body.code))) throw invalid();
    const user = await users.findOne({ _id: request.subjectUser, role: "CUSTOMER", isDeleted: { $ne: true } })
      .select("_id fullName phone email emailVerified +profileRecoveryBlocked");
    if (!user?.email || !user.emailVerified || user.profileRecoveryBlocked?.email ||
        !equal(digest(user.email.toLowerCase()), request.deletionVerification.destinationHash)) throw invalid();
    return { user, method: "EMAIL_OTP", challenge: request };
  }

  async function submit(body) {
    if (body.confirmation !== true) throw fail(400, "Please confirm the account-deletion consequences.");
    const { user, method, challenge: pending } = await verifiedSubject(body);
    const verifiedAt = now();
    const ownershipVerification = { method, verifiedAt, subjectUser: user._id };
    const existing = await requests.findOne({
      subjectUser: user._id, requestKind: "ACCOUNT_DELETION", status: { $in: ACTIVE },
    });
    if (existing) {
      const refreshed = await requests.findOneAndUpdate({ _id: existing._id, status: { $in: ACTIVE } }, {
        $set: {
          ownershipVerification, confirmationAccepted: true,
          processingDeadlineAt: existing.processingDeadlineAt || new Date(+verifiedAt + 30 * 24 * 60 * 60 * 1000),
          requester: {
            fullName: user.fullName, phone: user.phone,
            email: user.emailVerified && !user.profileRecoveryBlocked?.email ? user.email : undefined,
          },
        },
        $push: { history: { status: existing.status, actorType: "PUBLIC", note: "Account ownership reverified." } },
      }, { returnDocument: "after" });
      if (!refreshed) throw invalid();
      if (pending) await requests.updateOne(
        { _id: pending._id, status: "AWAITING_VERIFICATION" },
        { $set: { status: "EXPIRED" }, $unset: { deletionVerification: 1 } },
      );
      return receipt(refreshed);
    }
    const fields = {
      subjectUser: user._id, type: "ACCOUNT_DELETION", requestKind: "ACCOUNT_DELETION",
      status: "PENDING", description: text(body.reason, 2000),
      requester: {
        fullName: user.fullName, phone: user.phone,
        email: user.emailVerified && !user.profileRecoveryBlocked?.email ? user.email : undefined,
      },
      confirmationAccepted: true, ownershipVerification,
      activeRequestKey: `ACCOUNT_DELETION:${user._id}`,
      submittedAt: verifiedAt, createdBy: user._id,
      processingDeadlineAt: new Date(+verifiedAt + 30 * 24 * 60 * 60 * 1000),
    };
    const history = { status: "PENDING", actorType: "PUBLIC", changedBy: user._id, note: `Account ownership verified by ${method}; deletion requested and consequences confirmed.` };
    let request;
    try {
      if (pending) {
        request = await requests.findOneAndUpdate(
          { _id: pending._id, status: "AWAITING_VERIFICATION" },
          { $set: fields, $push: { history }, $unset: { deletionVerification: 1 } },
          { returnDocument: "after" },
        );
        if (!request) throw invalid(); // A consumed challenge can never create another request.
      } else {
        request = await requests.create({ ...fields, referenceId: publicReference(), history: [history] });
      }
    } catch (error) {
      if (error?.code !== 11000) throw error;
      request = await requests.findOne({ activeRequestKey: fields.activeRequestKey });
      if (!request) throw error;
    }
    return receipt(request);
  }

  async function status({ requestId, statusToken } = {}) {
    if (!/^[a-f0-9]{24}$/.test(requestId || "") || !/^[a-f0-9]{64}$/.test(statusToken || "")) throw invalid();
    const request = await requests.findOne({
      _id: requestId, requestKind: "ACCOUNT_DELETION",
      "statusAccess.hash": digest(statusToken), "statusAccess.expiresAt": { $gt: now() },
    });
    if (!request) throw invalid();
    return publicStatus(request);
  }
  return { challenge, submit, status, publicStatus };
}

module.exports = { createDeletionVerification, identifierFilter, OTP_TTL_MS, STATUS_TTL_MS };
