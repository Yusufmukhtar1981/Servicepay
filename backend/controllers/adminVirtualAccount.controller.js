const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const securewave = require("./securewave.controller");

const REQUESTED = "VIRTUAL_ACCOUNT_GENERATION_REQUESTED";
const RESULT = "VIRTUAL_ACCOUNT_GENERATION_RESULT";
const safeRetry = new Set(["PROVIDER_ACCESS_REJECTED", "CONFIGURATION_UNAVAILABLE"]);
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
// Include the private claim ID for eligibility without mixing a parent projection
// with its child path (MongoDB rejects that as a projection collision).
const select = "fullName phone email role status isDeleted deletedAt " +
  ["provider", "accountNumber", "accountName", "bankName", "bankCode", "status",
    "failureReason", "createdAt", "updatedAt", "customerReference", "providerCustomerId",
    "isDeleted", "deletedAt"].map(key => `virtualAccount.${key}`).join(" ") +
  " +virtualAccount.creationAttemptId";

async function target(req) {
  if (!req.user?._id) throw fail(401, "Authentication is required.");
  if (req.user.role !== "HEAD_OFFICE") throw fail(403, "Head Office access is required.");
  const actor = await User.findOne({
    _id: req.user._id, role: "HEAD_OFFICE", status: "ACTIVE",
    isDeleted: { $ne: true }, deletedAt: null,
  }).select("_id");
  if (!actor) throw fail(403, "An active Head Office administrator is required.");
  if (!mongoose.isValidObjectId(req.params.id)) throw fail(400, "Invalid customer ID.");
  const user = await User.findOne({ _id: req.params.id, role: "CUSTOMER" }).select(select);
  if (!user) throw fail(404, "Customer account not found.");
  return user;
}

function eligibility(user) {
  const va = user.virtualAccount || {};
  const result = (reason, requiresReconciliation = false, canGenerate = false, canRetry = false) =>
    ({ reason, requiresReconciliation, canGenerate, canRetry });
  if (user.isDeleted || user.deletedAt || user.status !== "ACTIVE") {
    return result("Generation is unavailable for deleted, blocked or inactive customers.");
  }
  // Preserve every assigned number, even if legacy status or formatting is invalid.
  if (String(va.accountNumber || "").trim()) return result("An account number is already assigned. It will not be replaced.");
  const priorEvidence = va.customerReference || va.providerCustomerId || va.createdAt;
  const incompleteAttempt = (!va.status || va.status === "NOT_CREATED") &&
    (va.creationAttemptId || va.failureReason || va.updatedAt);
  if (va.isDeleted || va.deletedAt || priorEvidence || incompleteAttempt ||
      va.status && !["NOT_CREATED", "FAILED"].includes(va.status) ||
      va.status === "FAILED" && !safeRetry.has(va.failureReason)) {
    return result("The previous outcome requires provider confirmation. Do not create another account.", true);
  }
  if (!String(user.fullName || "").trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email || "").trim()) ||
      !/^\d{11}$/.test(String(user.phone || "").trim())) {
    return result("A customer name, valid email and 11-digit phone are required by the existing integration.");
  }
  if (va.status === "FAILED") {
    return result(va.failureReason === "PROVIDER_ACCESS_REJECTED"
      ? "SecureWave rejected API access or the outbound IP. Retry only after authorization is restored."
      : "Provider configuration was unavailable before dispatch. Retry only after configuration is restored.",
    false, false, true);
  }
  return result("Eligible under the existing SecureWave customer identity requirements.", false, true);
}

function accountView(va = {}) {
  const keys = ["provider", "accountNumber", "accountName", "bankName", "bankCode", "createdAt", "updatedAt"];
  const view = Object.fromEntries(keys.map(key => [key, va[key] || null]));
  view.status = va.status || "NOT_CREATED";
  view.failureReason = va.failureReason
    ? safeRetry.has(va.failureReason) ? va.failureReason : "PROVIDER_OUTCOME_UNCONFIRMED"
    : null;
  return view;
}

async function snapshot(user, before) {
  const query = { targetUserId: user._id, action: { $in: [REQUESTED, RESULT] } };
  if (before) {
    if (!mongoose.isValidObjectId(before)) throw fail(400, "Invalid history cursor.");
    const anchor = await Audit.findOne({ _id: before, targetUserId: user._id,
      action: { $in: [REQUESTED, RESULT] } }).select("createdAt");
    if (!anchor) throw fail(400, "Invalid history cursor.");
    query.$or = [{ createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lt: anchor._id } }];
  }
  const rows = await Audit.find(query).sort({ createdAt: -1, _id: -1 }).limit(51).lean();
  const history = rows.slice(0, 50).map(row => ({
    id: String(row._id), action: row.action, actorName: row.actorName,
    reason: row.reason, createdAt: row.createdAt,
    outcome: row.metadata?.outcome || "REQUEST_RECORDED",
    requestId: row.metadata?.requestId || null,
  }));
  return {
    customer: { fullName: user.fullName, phone: user.phone, email: user.email || null },
    virtualAccount: accountView(user.virtualAccount), eligibility: eligibility(user),
    history, nextCursor: rows.length > 50 ? String(rows[49]._id) : null,
    // No supported dedicated-account lookup-by-customer contract is currently established.
    // Withdrawal bank-info is NOT a virtual-account absence check.
    lookupSupported: false,
  };
}

function error(res, err) {
  return res.status(err.statusCode || 503).json({
    success: false,
    message: err.statusCode ? err.message
      : "Unable to complete this operation. Refresh account status before attempting another request.",
  });
}

exports.get = async (req, res) => {
  try {
    const user = await target(req);
    return res.json({ success: true, data: await snapshot(user, req.query?.before) });
  } catch (err) { return error(res, err); }
};

exports.generate = async (req, res) => {
  try {
    const user = await target(req);
    if (!req.body || Object.keys(req.body).some(key => !["reason", "requestId"].includes(key))) {
      throw fail(400, "Only an administrative reason and request ID are accepted.");
    }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    const requestId = req.body.requestId;
    if (reason.length < 5 || reason.length > 500 || /[\x00-\x1f]/.test(reason)) {
      throw fail(400, "A reason of 5 to 500 characters is required.");
    }
    if (typeof requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)) {
      throw fail(400, "A valid unique request ID is required.");
    }
    // Deterministic _id uses MongoDB's existing unique _id index. No new collection
    // or production index migration is needed for durable request replay protection.
    const intentId = new mongoose.Types.ObjectId(crypto.createHash("sha256")
      .update(`admin-virtual-account:${user._id}:${requestId.toLowerCase()}`).digest("hex").slice(0, 24));
    const intent = await Audit.findById(intentId).select("_id");
    if (intent) return res.json({ success: true, message: "Request already recorded. Current account status returned.",
      data: await snapshot(user) });
    if (user.isDeleted || user.deletedAt || user.status !== "ACTIVE") {
      throw fail(403, "Generation is unavailable for deleted, blocked or inactive customers.");
    }
    if (user.virtualAccount?.accountNumber) {
      return res.json({ success: true, message: "Existing account returned without creating another account.",
        data: await snapshot(user) });
    }
    const allowed = eligibility(user);
    if (!allowed.canGenerate && !allowed.canRetry) {
      return res.status(allowed.requiresReconciliation ? 409 : 400).json({
        success: false, message: allowed.reason, data: await snapshot(user),
      });
    }
    const recent = await Audit.countDocuments({ targetUserId: user._id, action: REQUESTED,
      createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } });
    if (recent >= 5) throw fail(429, "Too many generation attempts. Check the existing status before retrying later.");
    const audit = {
      actorId: req.user._id, actorRole: "HEAD_OFFICE", actorName: req.user.fullName || "",
      targetUserId: user._id, targetUserName: user.fullName, reason,
    };
    try {
      // Fail closed: do not contact the provider unless immutable intent is saved.
      await Audit.create({ ...audit, _id: intentId, action: REQUESTED,
        metadata: { requestId, outcome: "REQUEST_RECORDED" } });
    } catch (err) {
      if (err.code !== 11000) throw err;
      const current = await User.findById(user._id).select(select);
      return res.json({ success: true, data: await snapshot(current) });
    }
    let status = 500;
    // Reuse the exact customer controller and its atomic provisioning claim.
    // Keep the original authenticated staff request intact for authorization/audit.
    const result = {
      status(code) { status = code; return this; },
      json() { return this; },
    };
    await securewave.generateVirtualAccount({ user: { _id: user._id }, body: {} }, result);
    const current = await User.findById(user._id).select(select);
    const va = current?.virtualAccount || {};
    const outcome = va.accountNumber ? "ACCOUNT_AVAILABLE"
      : va.status === "PENDING" ? "PROVIDER_CONFIRMATION_REQUIRED"
      : va.status === "FAILED" && safeRetry.has(va.failureReason) ? va.failureReason
      : status === 409 ? "CONCURRENT_REQUEST_OR_RECONCILIATION_REQUIRED" : "GENERATION_NOT_COMPLETED";
    await Audit.create({ ...audit, action: RESULT, metadata: {
      requestId, intentId: String(intentId), outcome, responseStatus: status,
    } });
    const data = await snapshot(current);
    if (status >= 400) return res.status(status).json({
      success: false,
      message: data.eligibility.reason,
      data,
    });
    return res.status(status).json({ success: true, data });
  } catch (err) { return error(res, err); }
};
