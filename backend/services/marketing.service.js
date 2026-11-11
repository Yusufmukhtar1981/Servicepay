"use strict";
const mongoose = require("mongoose");
const { MarketingRecord: Record } = require("../models/marketingRecord.model");
const User = require("../models/user.model");

const CHANNELS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "WHATSAPP", "X", "GOOGLE", "OFFLINE"];
const STATUSES = {
  campaign: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "ACTIVE", "PAUSED", "COMPLETED"],
  task: ["TODO", "IN_PROGRESS", "SUBMITTED", "COMPLETED"],
  report: ["SUBMITTED", "APPROVED", "REJECTED"],
  budget: ["SUBMITTED", "APPROVED", "REJECTED"],
  expense: ["SUBMITTED", "APPROVED", "REJECTED", "PAID"],
  attribution: ["CONFIRMED"],
  content: ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "PUBLISHED"],
  social: ["REPORTED"], strategy: ["SUBMITTED", "APPROVED", "REJECTED"],
  proposal: ["SUBMITTED", "APPROVED", "REJECTED"], announcement: ["PUBLISHED"],
  target: ["ACTIVE", "COMPLETED"], attendance: ["REPORTED"],
  partnership: ["SUBMITTED", "APPROVED", "REJECTED", "COMPLETED"],
  contribution: ["SUBMITTED", "APPROVED", "REJECTED"],
};
const PERMISSIONS = {
  campaign: "marketing.campaigns.manage", task: "marketing.team.manage",
  report: "marketing.reports.manage", budget: "marketing.budgets.submit",
  expense: "marketing.budgets.submit", attribution: "marketing.attribution.manage",
  content: "marketing.content.manage", social: "marketing.content.manage",
  strategy: "marketing.reports.manage", proposal: "marketing.reports.manage",
  announcement: "marketing.team.manage", target: "marketing.targets.manage",
  attendance: "marketing.reports.manage",
  partnership: "marketing.reports.manage", contribution: "marketing.reports.manage",
};
const FIELDS = {
  campaign: ["objective", "channel", "audience", "startsAt", "endsAt", "budgetNaira"],
  task: ["dueAt", "responsibility"],
  report: ["period", "startsAt", "endsAt", "acquired", "completedTasks", "evidence"],
  budget: ["amountNaira", "category", "evidence"],
  expense: ["amountNaira", "category", "budgetId", "assetId", "incurredAt"],
  attribution: ["source", "referralCode", "utmSource", "utmMedium", "utmCampaign", "evidence"],
  content: ["scheduledAt", "channel", "assetId", "publishedUrl", "publishedAt"],
  social: ["channel", "reach", "impressions", "engagements", "evidence", "reportedAt"],
  strategy: ["evidence"], proposal: ["evidence"],
  announcement: [], target: ["metric", "value", "period", "startsAt", "endsAt"],
  attendance: ["occurredAt", "evidence"],
  partnership: ["organization", "evidence", "startsAt", "endsAt"],
  contribution: ["transactionId", "evidence"],
};
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = value => {
  if (!mongoose.isObjectIdOrHexString(value)) throw fail("Invalid record identifier.");
  return new mongoose.Types.ObjectId(String(value));
};
const text = (value, max = 5000) => {
  if (typeof value !== "string" || value.length > max) throw fail("Invalid text field.");
  return value.trim();
};
function allowed(access, permission) {
  return access?.isHeadOffice === true ||
    (access?.permissions || []).includes(permission);
}
function requireGrant(access, permission) {
  if (!allowed(access, permission)) throw fail("Marketing permission required: " + permission, 403);
}
function range(query = {}, now = new Date()) {
  // UTC reporting boundaries are explicit; both bounds are half-open.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from, to = new Date(today.getTime() + 86400000);
  switch (query.preset || "month") {
    case "today": from = today; break;
    case "yesterday": from = new Date(today - 86400000); to = today; break;
    case "7days": from = new Date(today - 6 * 86400000); break;
    case "30days": from = new Date(today - 29 * 86400000); break;
    case "month": from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); break;
    case "lastMonth":
      from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); break;
    case "custom": from = new Date(query.from); to = new Date(query.to); break;
    default: throw fail("Invalid date preset.");
  }
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from >= to ||
      to - from > 366 * 86400000) throw fail("Choose a valid date range of at most 366 days.");
  return { $gte: from, $lt: to };
}
async function ready(db = mongoose.connection.db) {
  if (!db) return false;
  const exists = await db.listCollections({ name: "marketingrecords" }, { nameOnly: true }).hasNext();
  if (!exists) return false;
  const indexes = await db.collection("marketingrecords").listIndexes().toArray();
  return [
    { createdBy: 1, requestKey: 1 }, { customerId: 1 }, { "data.transactionId": 1 },
  ].every(key => indexes.some(index => index.unique &&
    JSON.stringify(index.key) === JSON.stringify(key) &&
    (!key.customerId || index.partialFilterExpression?.kind === "attribution") &&
    (!key["data.transactionId"] || index.partialFilterExpression?.kind === "contribution")));
}
function parse(kind, body, { patch = false } = {}) {
  if (!STATUSES[kind]) throw fail("Unknown marketing module.", 404);
  const result = {}, accepted = ["title", "description", "campaignId", "officerId", "customerId", "data",
    ...(patch ? ["revision"] : [])];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !accepted.includes(key))) throw fail("Unsupported marketing field.");
  if (!patch || body.title !== undefined) {
    result.title = text(body.title, 180);
    if (!result.title) throw fail("Title is required.");
  }
  if (body.description !== undefined) result.description = text(body.description);
  for (const key of ["campaignId", "officerId", "customerId"]) {
    if (body[key] !== undefined) result[key] = body[key] ? id(body[key]) : null;
  }
  if (kind !== "attribution" && body.customerId !== undefined) throw fail("Customer IDs are limited to attribution.");
  if (body.data !== undefined) {
    if (!body.data || Array.isArray(body.data) || typeof body.data !== "object" ||
      Object.keys(body.data).some(k => !FIELDS[kind].includes(k))) throw fail("Unsupported module field.");
    result.data = {};
    for (const [key, value] of Object.entries(body.data)) {
      if (["amountNaira", "budgetNaira", "value", "reach", "impressions", "engagements", "acquired", "completedTasks"].includes(key)) {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
          value > 1e12 || Math.abs(Math.round(value * 100) - value * 100) > 0.00001) throw fail("Invalid non-negative amount or count.");
        if (!["amountNaira", "budgetNaira"].includes(key) && !Number.isSafeInteger(value)) throw fail("Counts must be whole numbers.");
        result.data[key] = value;
      } else if (key.endsWith("At")) {
        const date = new Date(value);
        if (!Number.isFinite(+date)) throw fail("Invalid date.");
        result.data[key] = date.toISOString();
      } else if (key.endsWith("Id")) {
        result.data[key] = String(id(value));
      } else {
        result.data[key] = text(value, key === "evidence" ? 2000 : 1000);
      }
    }
  }
  const d = result.data || {};
  if (d.channel && !CHANNELS.includes(d.channel)) throw fail("Unsupported marketing channel.");
  if (d.period && !["DAILY", "WEEKLY", "MONTHLY"].includes(d.period)) throw fail("Invalid reporting period.");
  if (d.startsAt && d.endsAt && d.startsAt >= d.endsAt) throw fail("End date must follow start date.");
  if (d.publishedUrl && !/^https:\/\/[^\s]+$/.test(d.publishedUrl)) throw fail("A secure publication URL is required.");
  return result;
}
async function validateLinks(record, session) {
  if (record.campaignId && !await Record.exists({ _id: record.campaignId, kind: "campaign" }).session(session)) {
    throw fail("Campaign not found.");
  }
  if (record.officerId && !await User.exists({
    _id: record.officerId, isStaff: true, department: "MARKETING", status: "ACTIVE",
  }).session(session)) throw fail("Active marketing officer not found.");
  const d = record.data || {};
  if (d.assetId && !await Record.exists({ _id: id(d.assetId), kind: "asset" }).session(session)) throw fail("Asset not found.");
  if (["budget", "expense"].includes(record.kind) && !(d.amountNaira > 0)) throw fail("A positive amount is required.");
  if (record.kind === "expense") {
    if (!d.assetId || !d.budgetId) throw fail("Expense requires a receipt and approved budget.");
    const budget = await Record.findOne({ _id: id(d.budgetId), kind: "budget", status: "APPROVED" }).session(session);
    if (!budget || String(budget.campaignId || "") !== String(record.campaignId || "")) throw fail("Approved budget must match this campaign.");
  }
  if (record.kind === "campaign" && (!d.channel || !d.startsAt || !d.endsAt || !d.objective)) throw fail("Campaign requires a channel, objective and date range.");
  if (record.kind === "social" && (!d.evidence || !d.reportedAt)) throw fail("Social statistics require a verified-report source and reporting date.");
  if (record.kind === "partnership" && (!d.organization || !d.evidence)) throw fail("Partnership requires organization and supporting evidence.");
  if (record.kind === "target" && !["ACQUISITIONS", "FIRST_TRANSACTIONS", "TASKS", "REPORTS", "CONTENT", "ATTENDANCE"].includes(d.metric)) throw fail("Unsupported performance metric.");
  if (record.kind === "contribution") {
    if (!record.campaignId || !d.transactionId || !d.evidence) throw fail("Contribution requires campaign, transaction and financial evidence.");
    const Transaction = require("../models/transaction.model");
    const transaction = await Transaction.findOne({
      _id: id(d.transactionId), status: "SUCCESSFUL",
      serviceType: { $in: ["DATA", "AIRTIME", "ELECTRICITY", "CABLE", "EXAM_PIN", "DELIVERY", "ID_VERIFICATION", "INTERSTATE_LOGISTICS", "EDUPAY"] },
      reversalTransactionId: null, reversalReference: { $in: ["", null] },
      servicepayProfit: { $gt: 0 },
    }).session(session).lean();
    if (!transaction || !await Record.exists({ kind: "attribution", status: "CONFIRMED",
      customerId: transaction.customerId, campaignId: record.campaignId }).session(session)) {
      throw fail("No unreversed successful transaction with recorded contribution and confirmed campaign attribution was found.");
    }
    // Snapshot recorded platform contribution, never gross customer spend.
    record.data = { ...d, observedContributionNaira: transaction.servicepayProfit };
  }
  if (record.kind === "attribution") {
    if (!record.customerId || !d.evidence || !["CAMPAIGN", "REFERRAL"].includes(d.source)) throw fail("Attribution requires a customer, evidence and source.");
    const customer = await User.findOne({ _id: record.customerId, role: "CUSTOMER" })
      .select("_id createdAt referredBy").session(session);
    if (!customer) throw fail("Customer not found.");
    if (d.source === "REFERRAL" && !customer.referredBy) throw fail("No existing referral relationship confirms this source.");
    if (d.source === "CAMPAIGN") {
      const campaign = record.campaignId && await Record.findById(record.campaignId).session(session);
      if (!campaign || customer.createdAt < new Date(campaign.data.startsAt) ||
          customer.createdAt > new Date(campaign.data.endsAt)) throw fail("Registration is outside this campaign's dates.");
    }
  }
  if (record.kind === "target" && (!d.metric || !d.period || !d.startsAt || !d.endsAt || !(d.value > 0))) throw fail("Target requires a metric, positive value, period and dates.");
}
async function audit(req, session, action, record, before) {
  const snapshot = value => !value ? null : ({
    title: value.title, description: value.description, status: value.status,
    campaignId: value.campaignId || null, officerId: value.officerId || null,
    customerId: value.customerId || null, revision: value.revision,
    data: Object.fromEntries(Object.entries(value.data || {})
      .filter(([key]) => key !== "submissionDigest")),
  });
  await Record.create([{
    kind: "activity", title: action, status: "RECORDED",
    createdBy: req.user._id, updatedBy: req.user._id,
    requestKey: "audit:" + new mongoose.Types.ObjectId(),
    campaignId: record.campaignId,
    data: { recordId: String(record._id), recordKind: record.kind,
      revision: record.revision, previousStatus: before?.status || null,
      status: record.status, before: snapshot(before), after: snapshot(record),
      reason: text(req.body?.reason || "Marketing record saved.", 1000) },
  }], { session });
}
async function mutate(req, operation) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await operation(session); });
    return result;
  } finally { await session.endSession(); }
}
async function create(req) {
  const kind = req.params.kind;
  requireGrant(req.staffAccess, PERMISSIONS[kind]);
  if (kind === "target" && !req.staffAccess.isHeadOffice) throw fail("Only Head Office can configure targets.", 403);
  const payload = parse(kind, req.body);
  const key = text(req.headers["idempotency-key"] || "", 100);
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw fail("A unique Idempotency-Key of 16–100 characters is required.");
  const recordData = { ...payload, kind, status: STATUSES[kind][0], createdBy: req.user._id,
    updatedBy: req.user._id, requestKey: key };
  const digest = require("node:crypto").createHash("sha256").update(JSON.stringify(recordData)).digest("hex");
  return mutate(req, async session => {
    const existing = await Record.findOne({ createdBy: req.user._id, requestKey: key }).session(session);
    if (existing) {
      if (existing.data?.submissionDigest !== digest) throw fail("Idempotency key was already used for a different submission.", 409);
      return existing;
    }
    await validateLinks(recordData, session);
    recordData.data = { ...recordData.data, submissionDigest: digest };
    const [record] = await Record.create([recordData], { session });
    await audit(req, session, "MARKETING_CREATED", record);
    return record;
  });
}
const TRANSITIONS = {
  campaign: { DRAFT: ["SUBMITTED", "ACTIVE"], SUBMITTED: ["APPROVED", "REJECTED"],
    REJECTED: ["SUBMITTED"], APPROVED: ["ACTIVE"], ACTIVE: ["PAUSED", "COMPLETED"], PAUSED: ["ACTIVE", "COMPLETED"] },
  expense: { SUBMITTED: ["APPROVED", "REJECTED"], APPROVED: ["PAID"] },
  partnership: { SUBMITTED: ["APPROVED", "REJECTED"], APPROVED: ["COMPLETED"] },
  contribution: { SUBMITTED: ["APPROVED", "REJECTED"], REJECTED: ["SUBMITTED"] },
  task: { TODO: ["IN_PROGRESS"], IN_PROGRESS: ["SUBMITTED"], SUBMITTED: ["COMPLETED", "IN_PROGRESS"] },
  content: { DRAFT: ["SUBMITTED"], SUBMITTED: ["APPROVED", "REJECTED"], REJECTED: ["SUBMITTED"], APPROVED: ["PUBLISHED"] },
};
async function update(req, transition = false) {
  const kind = req.params.kind;
  requireGrant(req.staffAccess, PERMISSIONS[kind]);
  if (kind === "target" && !req.staffAccess.isHeadOffice) throw fail("Only Head Office can configure targets.", 403);
  if (kind === "attribution") throw fail("Confirmed attribution is immutable.", 409);
  const revision = req.body?.revision;
  if (!Number.isSafeInteger(revision) || revision < 0) throw fail("Current revision required.");
  return mutate(req, async session => {
    const record = await Record.findOne({ _id: id(req.params.id), kind }).session(session);
    if (!record) throw fail("Marketing record not found.", 404);
    if (record.revision !== revision) throw fail("Record changed; reload before saving.", 409);
    const before = record.toObject();
    if (transition) {
      if (Object.keys(req.body).some(k => !["status", "reason", "revision",
        ...(kind === "expense" ? ["paymentEvidence"] : [])].includes(k))) throw fail("Unsupported transition field.");
      const next = text(req.body.status, 32);
      if (!text(req.body.reason || "", 1000)) throw fail("A reason is required.");
      const managementDecision = ["budget", "expense", "proposal", "strategy", "partnership", "contribution"].includes(kind) &&
        ["APPROVED", "REJECTED", "PAID"].includes(next) ||
        kind === "campaign" && (["APPROVED", "REJECTED"].includes(next) || record.status === "DRAFT" && next === "ACTIVE");
      const needsApproval = managementDecision || kind === "report" ||
        kind === "content" && ["APPROVED", "REJECTED"].includes(next);
      if (needsApproval) {
        const permission = managementDecision ? "marketing.budgets.approve" : "marketing.content.approve";
        requireGrant(req.staffAccess, permission);
        if (managementDecision && !req.staffAccess.isHeadOffice) throw fail("Only Head Office can authorize management decisions.", 403);
        if (String(record.createdBy) === String(req.user._id)) throw fail("You cannot approve your own submission.", 403);
      }
      const valid = TRANSITIONS[kind]?.[record.status] ||
        (record.status === "SUBMITTED" && needsApproval ? ["APPROVED", "REJECTED"] :
          record.status === "ACTIVE" && kind === "target" ? ["COMPLETED"] : []);
      if (!valid.includes(next)) throw fail("Invalid status transition.", 409);
      if (kind === "contribution" && next === "APPROVED") await validateLinks(record, session);
      if (kind === "expense" && next === "PAID") {
        const evidence = text(req.body.paymentEvidence || "", 2000);
        if (!evidence) throw fail("Independent evidence of the completed external payment is required. This action never sends money.");
        record.data = { ...record.data, paymentEvidence: evidence, paidAt: new Date().toISOString() };
      }
      if (kind === "expense" && next === "APPROVED") {
        // Serialize approvals against the shared budget document inside this
        // transaction to prevent concurrent expense approvals overspending it.
        const budget = await Record.findOneAndUpdate({
          _id: id(record.data.budgetId), kind: "budget", status: "APPROVED",
          $expr: { $lte: [{ $add: [{ $ifNull: ["$data.committedNaira", 0] }, record.data.amountNaira] }, "$data.amountNaira"] },
        }, { $inc: { "data.committedNaira": record.data.amountNaira, revision: 1 } }, { session, new: true });
        if (!budget) throw fail("Approved budget has insufficient uncommitted allocation.", 409);
      }
      if (kind === "content" && next === "PUBLISHED" && (!record.data.publishedUrl || !record.data.publishedAt)) throw fail("Record the actual publication URL and time first.");
      record.status = next;
      record.data = { ...record.data, lastDecisionBy: String(req.user._id), lastDecisionAt: new Date().toISOString() };
    } else {
      if (["APPROVED", "COMPLETED", "PUBLISHED", "CONFIRMED", "PAID"].includes(record.status)) {
        if (kind !== "content" || record.status !== "APPROVED" ||
            Object.keys(req.body).some(k => !["revision", "data"].includes(k)) ||
            Object.keys(req.body.data || {}).some(k => !["publishedUrl", "publishedAt"].includes(k))) throw fail("Final records cannot be edited.", 409);
      }
      const patch = parse(kind, req.body, { patch: true });
      if (patch.data) patch.data = { ...record.data, ...patch.data };
      Object.assign(record, patch);
      await validateLinks(record, session);
    }
    record.updatedBy = req.user._id;
    record.revision++;
    record.markModified("data");
    await record.save({ session });
    await audit(req, session, transition ? "MARKETING_STATUS_CHANGED" : "MARKETING_UPDATED", record, before);
    return record;
  });
}
module.exports = { Record, CHANNELS, STATUSES, PERMISSIONS, FIELDS, fail, id,
  allowed, requireGrant, range, ready, parse, create, update, audit, mutate };
