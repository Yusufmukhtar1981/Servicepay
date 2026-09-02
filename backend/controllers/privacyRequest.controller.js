const crypto = require("crypto");
const mongoose = require("mongoose");
const PrivacyRequest = require("../models/privacyRequest.model");
const PrivacyRequestRateLimit = require("../models/privacyRequestRateLimit.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { sendEmail } = require("../services/email.service");

const ACTIVE_STATUSES = ["PENDING", "UNDER_REVIEW", "APPROVED", "OPEN", "IN_REVIEW"];
const PUBLIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{10,15}$/;
const REQUEST_TYPES = ["ACCESS", "CORRECTION", "PORTABILITY", "OBJECTION", "OTHER"];

const cleanText = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const escapeHtml = (value) => cleanText(value, 2000)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const normalizePhone = (value) => cleanText(value, 20).replace(/[()\s-]/g, "");
const normalizeEmail = (value) => cleanText(value, 254).toLowerCase();
const actorId = (req) => req.user?._id || req.user?.id;
const requestReference = () =>
  `SP-PR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const requesterFilter = (email) => ({
  "requester.email": email,
  status: { $in: ACTIVE_STATUSES },
});

const audit = (req, action, reason, request) => AdminAuditLog.create({
  actorId: actorId(req),
  actorRole: String(req.user?.role || "PUBLIC"),
  actorName: req.user?.fullName || "Public request",
  targetUserId: request?.subjectUser || undefined,
  targetUserName: request?.requester?.fullName || undefined,
  action,
  reason,
  metadata: {
    referenceId: request?.referenceId,
    requestKind: request?.requestKind,
    status: request?.status,
  },
  ipAddress: String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim(),
  userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
  requestMethod: req.method,
  requestPath: req.baseUrl + req.path,
}).catch(() => null);

const validatePublicRequest = (body, kind) => {
  const fullName = cleanText(body.fullName, 120);
  const phone = normalizePhone(body.phone);
  const email = normalizeEmail(body.email);
  const description = cleanText(body.description || body.reason, 2000);
  const errors = [];
  if (fullName.length < 2) errors.push("Full name is required.");
  if (!PHONE.test(phone)) errors.push("Enter a valid registered phone number.");
  if (!PUBLIC_EMAIL.test(email) || email.length > 254) errors.push("Enter a valid registered email address.");
  if (kind === "ACCOUNT_DELETION" && body.confirmation !== true) {
    errors.push("You must confirm that account deletion is irreversible.");
  }
  let dataRequestType = null;
  if (kind === "DATA_REQUEST") {
    dataRequestType = cleanText(body.requestType, 30).toUpperCase();
    if (!REQUEST_TYPES.includes(dataRequestType)) errors.push("Choose a valid data request type.");
    if (description.length < 10) errors.push("Please describe the specific data request.");
  }
  return { errors, fullName, phone, email, description, dataRequestType };
};

const findMatchingUser = async ({ phone, email }) => User.findOne({
  phone,
  email,
  role: "CUSTOMER",
}).select("_id").lean();

const sendRequesterEmail = (request, subject, statusText) => {
  if (!request.requester?.email) return Promise.resolve();
  return sendEmail({
    to: request.requester.email,
    subject,
    idempotencyKey: `privacy-request:${request.referenceId}:${request.status}`,
    html: `<p>Hello ${escapeHtml(request.requester.fullName)},</p><p>${escapeHtml(statusText)}</p><p>Your reference ID is <strong>${escapeHtml(request.referenceId)}</strong>.</p><p>ServicePay will retain records required for legal, regulatory, financial, fraud-prevention, security, dispute-resolution and audit purposes.</p><p>For help, contact <a href="mailto:support@servicepay.ng">support@servicepay.ng</a>.</p>`,
    text: `Hello ${request.requester.fullName}, ${statusText} Reference ID: ${request.referenceId}. Contact support@servicepay.ng for help.`,
  }).catch(() => null);
};

const sendAdminEmail = (request) => sendEmail({
  to: process.env.PRIVACY_REQUEST_ADMIN_EMAIL || process.env.ADMIN_EMAIL || "admin@servicepay.ng",
  subject: `ServicePay privacy request ${request.referenceId}`,
  idempotencyKey: `privacy-request-admin:${request.referenceId}:${request.status}`,
  html: `<p>A privacy request needs attention.</p><p>Reference: <strong>${escapeHtml(request.referenceId)}</strong><br>Status: ${escapeHtml(request.status)}<br>Type: ${escapeHtml(request.requestKind)}</p><p>Review it in the Admin Control Center.</p>`,
  text: `Privacy request ${request.referenceId} is ${request.status}. Review it in the Admin Control Center.`,
}).catch(() => null);

const createPublicRequest = async (req, res, next, kind) => {
  try {
    const parsed = validatePublicRequest(req.body || {}, kind);
    if (parsed.errors.length) return res.status(400).json({ success: false, message: parsed.errors.join(" ") });

    const activeRequestKey = `${kind}:${parsed.email}:${parsed.dataRequestType || "ACCOUNT"}`;
    const duplicate = await PrivacyRequest.findOne({
      ...requesterFilter(parsed.email),
      requestKind: kind,
      activeRequestKey,
    }).select("referenceId status").lean();
    if (duplicate) return res.status(409).json({
      success: false,
      code: "ACTIVE_PRIVACY_REQUEST_EXISTS",
      message: `An active request already exists. Reference: ${duplicate.referenceId}.`,
      data: { referenceId: duplicate.referenceId, status: duplicate.status },
    });

    const matchedUser = await findMatchingUser(parsed);
    const request = await PrivacyRequest.create({
      subjectUser: matchedUser?._id,
      type: kind === "ACCOUNT_DELETION" ? "ACCOUNT_DELETION" : "DATA_REQUEST",
      requestKind: kind,
      dataRequestType: parsed.dataRequestType,
      status: "PENDING",
      description: parsed.description,
      requester: { fullName: parsed.fullName, phone: parsed.phone, email: parsed.email },
      confirmationAccepted: kind === "ACCOUNT_DELETION",
      referenceId: requestReference(),
      activeRequestKey,
      submittedAt: new Date(),
      createdBy: matchedUser?._id,
      history: [{ status: "PENDING", note: "Submitted through the public privacy request form.", actorType: "PUBLIC" }],
    });

    await Promise.all([
      audit(req, "PRIVACY_REQUEST_CREATED", "Public privacy request submitted", request),
      sendRequesterEmail(request, "ServicePay privacy request received", "We received your privacy request and it is pending review."),
      sendAdminEmail(request),
    ]);
    return res.status(201).json({
      success: true,
      message: "Your request was submitted securely.",
      data: { referenceId: request.referenceId, status: request.status, submittedAt: request.submittedAt },
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({
      success: false,
      code: "ACTIVE_PRIVACY_REQUEST_EXISTS",
      message: "An active privacy request already exists for these details.",
    });
    return next(error);
  }
};

exports.createAccountDeletionRequest = (req, res, next) =>
  createPublicRequest(req, res, next, "ACCOUNT_DELETION");
exports.createDataRequest = (req, res, next) =>
  createPublicRequest(req, res, next, "DATA_REQUEST");

exports.listAccountDeletionRequests = async (req, res, next) => {
  try {
    const filter = { requestKind: req.query.kind ? String(req.query.kind).toUpperCase() : { $in: ["ACCOUNT_DELETION", "DATA_REQUEST"] } };
    if (req.query.status) filter.status = String(req.query.status).toUpperCase();
    if (req.query.type) filter.dataRequestType = String(req.query.type).toUpperCase();
    if (req.query.search) {
      const search = new RegExp(cleanText(req.query.search, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ referenceId: search }, { "requester.fullName": search }, { "requester.email": search }, { "requester.phone": search }];
    }
    const page = Math.min(100, Math.max(1, Number(req.query.page || 1)));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25)));
    const [items, total] = await Promise.all([
      PrivacyRequest.find(filter).populate("subjectUser", "fullName phone email status isDeleted").sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PrivacyRequest.countDocuments(filter),
    ]);
    return res.json({ success: true, data: { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } } });
  } catch (error) { return next(error); }
};

exports.getAccountDeletionRequest = async (req, res, next) => {
  try {
    const request = await PrivacyRequest.findOne({
      $or: [{ _id: mongoose.Types.ObjectId.isValid(req.params.id) ? req.params.id : null }, { referenceId: String(req.params.id).toUpperCase() }],
      requestKind: { $in: ["ACCOUNT_DELETION", "DATA_REQUEST"] },
    }).populate("subjectUser", "fullName phone email status isDeleted").lean();
    if (!request) return res.status(404).json({ success: false, message: "Privacy request not found." });
    return res.json({ success: true, data: request });
  } catch (error) { return next(error); }
};

const transitionAllowed = {
  PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["PENDING", "APPROVED", "REJECTED"],
  APPROVED: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};

const anonymizeCustomer = async (request, req) => {
  if (!request.subjectUser) return false;
  const userId = request.subjectUser;
  const suffix = String(userId);
  const update = {
    $set: {
      fullName: "Deleted ServicePay Customer",
      phone: `DELETED_${suffix}`,
      email: `deleted-${suffix}@deleted.servicepay.ng`,
      status: "BLOCKED",
      isDeleted: true,
      deletedAt: new Date(),
      deletedBy: String(actorId(req) || "PRIVACY_WORKFLOW"),
    },
    $inc: { authTokenVersion: 1 },
    $unset: { passwordResetToken: 1, passwordResetExpires: 1, transactionPin: 1 },
  };
  const result = await User.updateOne({ _id: userId, role: "CUSTOMER" }, update);
  return result.modifiedCount === 1 || Boolean(await User.exists({ _id: userId, isDeleted: true }));
};

exports.updateAccountDeletionRequest = async (req, res, next) => {
  try {
    const status = String(req.body.status || "").toUpperCase();
    const note = cleanText(req.body.note || req.body.reason, 1000);
    if (!Object.prototype.hasOwnProperty.call(transitionAllowed, status)) return res.status(400).json({ success: false, message: "Invalid privacy request status." });
    const request = await PrivacyRequest.findOne({ _id: req.params.id, requestKind: { $in: ["ACCOUNT_DELETION", "DATA_REQUEST"] } });
    if (!request) return res.status(404).json({ success: false, message: "Privacy request not found." });
    if (request.status === status) return res.json({ success: true, data: request });
    if (!transitionAllowed[request.status]?.includes(status)) return res.status(409).json({ success: false, message: "This privacy request transition is not allowed." });
    if ((status === "REJECTED" || status === "COMPLETED") && note.length < 10) return res.status(400).json({ success: false, message: "A meaningful note of at least 10 characters is required." });
    if (status === "COMPLETED" && request.requestKind === "ACCOUNT_DELETION") {
      const anonymized = await anonymizeCustomer(request, req);
      if (!anonymized) return res.status(409).json({ success: false, message: "Verify the customer account before completing this deletion request." });
    }
    request.status = status;
    request.history.push({ status, note, changedBy: actorId(req), actorType: "ADMIN" });
    if (["COMPLETED", "REJECTED"].includes(status)) request.activeRequestKey = undefined;
    await request.save();
    await Promise.all([
      audit(req, "PRIVACY_REQUEST_UPDATED", `Privacy request marked ${status}`, request),
      sendRequesterEmail(request, `ServicePay privacy request ${status.toLowerCase()}`, `Your privacy request has been marked ${status.toLowerCase()}.`),
    ]);
    return res.json({ success: true, data: request });
  } catch (error) { return next(error); }
};