const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const KycProfile = require("../models/kycProfile.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const AccountRestriction = require("../models/accountRestriction.model");
const WalletHold = require("../models/walletHold.model");
const FintechWatchlist = require("../models/fintechWatchlist.model");
const FintechFraudAlert = require("../models/fintechFraudAlert.model");
const FintechFinancialAction = require("../models/fintechFinancialAction.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const FintechDispute = require("../models/fintechDispute.model");

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const restrictionTypes = new Set([
  "BLOCK_LOGIN",
  "BLOCK_OUTGOING_TRANSFERS",
  "BLOCK_WITHDRAWALS",
  "BLOCK_WALLET_DEBIT",
  "BLOCK_BILL_PURCHASES",
  "BLOCK_MARKETPLACE_PURCHASE",
  "BLOCK_PARTNER_API",
  "FULL_FREEZE",
]);

const text = (value) => String(value || "").trim();
const normalize = (value) => text(value).toUpperCase().replace(/[\s-]+/g, "_");
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const requestIp = (req) => text(req.headers["x-forwarded-for"]).split(",")[0].trim() || req.ip || "";
const pageOptions = (query) => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.limit, 10) || PAGE_SIZE));
  return { page, limit, skip: (page - 1) * limit };
};
const reference = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const idempotencyKey = (req) =>
  text(req.headers["x-idempotency-key"] || req.body?.idempotencyKey);

const audit = async (req, {
  targetUser = null,
  action,
  reason,
  previousData = null,
  newData = null,
  metadata = null,
  session = null,
}) => {
  const entry = {
    actorId: req.user._id,
    actorRole: "HEAD_OFFICE",
    actorName: req.user.fullName || req.user.name || "Head Office",
    targetUserId: targetUser?._id || targetUser || null,
    targetUserName: targetUser?.fullName || targetUser?.name || targetUser?.phone || "",
    action: "FINTECH_OPERATION",
    reason,
    previousData,
    newData,
    metadata: { operation: action, ...metadata },
    ipAddress: requestIp(req),
    userAgent: text(req.headers["user-agent"]),
    requestMethod: req.method,
    requestPath: req.originalUrl,
  };
  await AdminAuditLog.create([entry], session ? { session } : undefined);
};

const customerSearchQuery = (value) => {
  const search = text(value);
  if (!search) return {};
  const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const clauses = [{ fullName: regex }, { phone: regex }, { email: regex }];
  if (isObjectId(search)) clauses.push({ _id: search });
  return { $or: clauses };
};

const publicCustomer = (user, restrictions = []) => ({
  id: String(user._id),
  fullName: user.fullName || "",
  phone: user.phone || "",
  email: user.email || "",
  role: user.role || "CUSTOMER",
  status: user.status || "",
  kycVerified: user.kycVerified === true,
  walletBalance: Number(user.walletBalance || 0),
  heldBalance: Number(user.walletHeldBalance || 0),
  spendableBalance: Math.max(0, Number(user.walletBalance || 0) - Number(user.walletHeldBalance || 0)),
  restrictions,
});

const requireReason = (res, reason) => {
  if (text(reason).length < 5) {
    res.status(400).json({ success: false, message: "A reason of at least 5 characters is required." });
    return false;
  }
  return true;
};

const requireIdempotency = (req, res) => {
  const key = idempotencyKey(req);
  if (key.length < 8 || key.length > 160) {
    res.status(400).json({
      success: false,
      message: "Provide an X-Idempotency-Key of 8 to 160 characters for this action.",
    });
    return null;
  }
  return key;
};

const activeRestrictionQuery = (userId) => ({
  user: userId,
  status: "ACTIVE",
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

exports.searchCustomers = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = customerSearchQuery(req.query.search);
    const [customers, total] = await Promise.all([
      User.find(query)
        .select("fullName phone email role status kycVerified walletBalance walletHeldBalance")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(query),
    ]);
    const ids = customers.map((item) => item._id);
    const restrictions = ids.length
      ? await AccountRestriction.find({ ...activeRestrictionQuery({ $in: ids }) })
        .select("user type status expiresAt reason createdAt")
        .lean()
      : [];
    const byUser = new Map();
    restrictions.forEach((item) => {
      const key = String(item.user);
      byUser.set(key, [...(byUser.get(key) || []), item]);
    });
    res.json({
      success: true,
      customers: customers.map((item) => publicCustomer(item, byUser.get(String(item._id)) || [])),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("FINTECH CUSTOMER SEARCH ERROR:", error);
    res.status(500).json({ success: false, message: "Unable to search customers." });
  }
};

exports.getCustomerOperations = async (req, res) => {
  try {
    if (!isObjectId(req.params.userId)) {
      return res.status(400).json({ success: false, message: "Invalid customer ID." });
    }
    const user = await User.findById(req.params.userId)
      .select("fullName phone email role status kycVerified walletBalance walletHeldBalance virtualAccount")
      .lean();
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    const [restrictions, holds, kyc] = await Promise.all([
      AccountRestriction.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
      WalletHold.find({ user: user._id }).sort({ createdAt: -1 }).lean(),
      KycProfile.findOne({ user: user._id }).lean(),
    ]);
    return res.json({
      success: true,
      customer: { ...publicCustomer(user, restrictions), kycStatus: kyc?.status || (user.kycVerified ? "VERIFIED" : "UNVERIFIED") },
      holds,
    });
  } catch (error) {
    console.error("FINTECH CUSTOMER DETAIL ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to load customer operations." });
  }
};

exports.createRestriction = async (req, res) => {
  const type = normalize(req.body.type);
  const reason = text(req.body.reason);
  if (!isObjectId(req.body.userId)) return res.status(400).json({ success: false, message: "Invalid customer ID." });
  if (!restrictionTypes.has(type)) return res.status(400).json({ success: false, message: "Invalid restriction type." });
  if (!requireReason(res, reason)) return;
  const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.valueOf())) return res.status(400).json({ success: false, message: "Invalid expiry date." });
  if (expiresAt && expiresAt <= new Date()) return res.status(400).json({ success: false, message: "Expiry must be in the future." });
  try {
    const user = await User.findById(req.body.userId);
    if (!user) return res.status(404).json({ success: false, message: "Customer not found." });
    const existing = await AccountRestriction.findOne({ ...activeRestrictionQuery(user._id), type });
    if (existing) return res.status(409).json({ success: false, code: "RESTRICTION_ALREADY_ACTIVE", message: "This restriction is already active.", restriction: existing });
    const restriction = await AccountRestriction.create({ user: user._id, type, reason, expiresAt, createdBy: req.user._id });
    await audit(req, { targetUser: user, action: "ACCOUNT_RESTRICTION_CREATED", reason, newData: { type, expiresAt }, metadata: { restrictionId: restriction._id } });
    return res.status(201).json({ success: true, restriction });
  } catch (error) {
    console.error("CREATE ACCOUNT RESTRICTION ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to create account restriction." });
  }
};

exports.removeRestriction = async (req, res) => {
  const reason = text(req.body.reason);
  if (!requireReason(res, reason)) return;
  try {
    const restriction = await AccountRestriction.findOneAndUpdate(
      { _id: req.params.restrictionId, status: "ACTIVE" },
      { $set: { status: "REMOVED", removedBy: req.user._id, removedAt: new Date(), removalReason: reason } },
      { new: true }
    ).populate("user", "fullName phone");
    if (!restriction) return res.status(409).json({ success: false, code: "RESTRICTION_NOT_ACTIVE", message: "Restriction is already inactive or was not found." });
    await audit(req, { targetUser: restriction.user, action: "ACCOUNT_RESTRICTION_REMOVED", reason, previousData: { type: restriction.type, status: "ACTIVE" }, newData: { status: "REMOVED" }, metadata: { restrictionId: restriction._id } });
    return res.json({ success: true, restriction });
  } catch (error) {
    console.error("REMOVE ACCOUNT RESTRICTION ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to remove account restriction." });
  }
};

exports.listWalletHolds = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    if (req.query.userId && isObjectId(req.query.userId)) query.user = req.query.userId;
    if (text(req.query.search)) {
      const userIds = await User.find(customerSearchQuery(req.query.search)).distinct("_id");
      query.$or = [{ reference: new RegExp(text(req.query.search), "i") }, { linkedReference: new RegExp(text(req.query.search), "i") }, { user: { $in: userIds } }];
    }
    const [holds, total] = await Promise.all([
      WalletHold.find(query).populate("user", "fullName phone email walletBalance walletHeldBalance").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WalletHold.countDocuments(query),
    ]);
    return res.json({ success: true, holds, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("LIST WALLET HOLDS ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to load wallet holds." });
  }
};

exports.createWalletHold = async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = text(req.body.reason);
  const key = requireIdempotency(req, res);
  if (!key) return;
  if (!isObjectId(req.body.userId) || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Provide a customer and a valid hold amount." });
  if (!requireReason(res, reason)) return;
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        {
          _id: req.body.userId,
          $expr: { $gte: ["$walletBalance", { $add: [{ $ifNull: ["$walletHeldBalance", 0] }, amount] }] },
        },
        { $inc: { walletHeldBalance: amount } },
        { new: true, session }
      );
      if (!user) throw Object.assign(new Error("Insufficient spendable wallet balance."), { statusCode: 400, code: "INSUFFICIENT_SPENDABLE_BALANCE" });
      created = await WalletHold.create([{
        user: user._id, reference: reference("HOLD"), linkedReference: text(req.body.linkedReference),
        initialAmount: amount, remainingAmount: amount, reason, createdBy: req.user._id,
      }], { session }).then((items) => items[0]);
      await LedgerEntry.create([{
        user: user._id, direction: "DEBIT", amount, openingBalance: Number(user.walletBalance), closingBalance: Number(user.walletBalance),
        service: "WALLET_HOLD", reference: created.reference, idempotencyKey: `hold:${key}`,
        narration: `Wallet hold: ${reason}`, metadata: { holdId: String(created._id), spendableBalance: Number(user.walletBalance) - Number(user.walletHeldBalance) },
      }], { session });
      await audit(req, { targetUser: user, action: "WALLET_HOLD_CREATED", reason, newData: { amount, reference: created.reference }, metadata: { holdId: created._id, idempotencyKey: key }, session });
    });
    return res.status(201).json({ success: true, hold: created });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: "DUPLICATE_HOLD", message: "This hold request was already processed." });
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message || "Unable to place wallet hold." });
  } finally {
    await session.endSession();
  }
};

exports.releaseWalletHold = async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = text(req.body.reason);
  const key = requireIdempotency(req, res);
  if (!key) return;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "Provide a valid release amount." });
  if (!requireReason(res, reason)) return;
  const session = await mongoose.startSession();
  try {
    let released;
    await session.withTransaction(async () => {
      const hold = await WalletHold.findOneAndUpdate(
        { _id: req.params.holdId, status: { $in: ["ACTIVE", "PARTIALLY_RELEASED"] }, remainingAmount: { $gte: amount }, "releases.idempotencyKey": { $ne: key } },
        { $inc: { remainingAmount: -amount }, $push: { releases: { amount, reason, releasedBy: req.user._id, idempotencyKey: key } } },
        { new: true, session }
      );
      if (!hold) throw Object.assign(new Error("Hold is not active, release exceeds the remaining amount, or the request was already processed."), { statusCode: 409, code: "HOLD_RELEASE_REJECTED" });
      const nextStatus = hold.remainingAmount === 0 ? "RELEASED" : "PARTIALLY_RELEASED";
      released = await WalletHold.findByIdAndUpdate(hold._id, { $set: { status: nextStatus } }, { new: true, session });
      const user = await User.findOneAndUpdate({ _id: hold.user, walletHeldBalance: { $gte: amount } }, { $inc: { walletHeldBalance: -amount } }, { new: true, session });
      if (!user) throw new Error("Wallet hold balance is inconsistent and requires investigation.");
      await LedgerEntry.create([{
        user: user._id, direction: "CREDIT", amount, openingBalance: Number(user.walletBalance), closingBalance: Number(user.walletBalance),
        service: "WALLET_HOLD_RELEASE", reference: released.reference, idempotencyKey: `release:${key}`,
        narration: `Wallet hold release: ${reason}`, metadata: { holdId: String(released._id), remainingAmount: released.remainingAmount },
      }], { session });
      await audit(req, { targetUser: user, action: "WALLET_HOLD_RELEASED", reason, previousData: { remainingAmount: hold.remainingAmount + amount }, newData: { remainingAmount: released.remainingAmount, status: nextStatus }, metadata: { holdId: released._id, idempotencyKey: key }, session });
    });
    return res.json({ success: true, hold: released });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message || "Unable to release wallet hold." });
  } finally {
    await session.endSession();
  }
};

exports.listFailedTransactions = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = { status: { $in: ["FAILED", "PENDING"] } };
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    if (req.query.serviceType && normalize(req.query.serviceType) !== "ALL") query.serviceType = normalize(req.query.serviceType);
    if (text(req.query.provider)) query.provider = new RegExp(text(req.query.provider), "i");
    if (text(req.query.reference)) query.reference = new RegExp(text(req.query.reference), "i");
    if (req.query.from || req.query.to) query.createdAt = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lte: new Date(req.query.to) } : {}) };
    const [transactions, total] = await Promise.all([
      Transaction.find(query).populate("customerId", "fullName phone email walletBalance").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Transaction.countDocuments(query),
    ]);
    return res.json({ success: true, transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("LIST FAILED TRANSACTIONS ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to load failed transactions." });
  }
};

exports.listVirtualAccounts = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = { "virtualAccount.accountNumber": { $exists: true, $ne: "" } };
    if (text(req.query.search)) {
      const regex = new RegExp(text(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ fullName: regex }, { phone: regex }, { "virtualAccount.accountNumber": regex }, { "virtualAccount.provider": regex }];
    }
    if (req.query.status && normalize(req.query.status) !== "ALL") query["virtualAccount.status"] = normalize(req.query.status);
    if (text(req.query.provider)) query["virtualAccount.provider"] = new RegExp(text(req.query.provider), "i");
    const [accounts, total] = await Promise.all([
      User.find(query).select("fullName phone email virtualAccount createdAt").sort({ "virtualAccount.createdAt": -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(query),
    ]);
    return res.json({ success: true, accounts, providerActions: { deactivate: false, reactivate: false, message: "The current provider integration does not expose safe admin lifecycle controls." }, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("LIST VIRTUAL ACCOUNTS ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to load virtual accounts." });
  }
};

exports.listDedicatedAccounts = exports.listVirtualAccounts;

const integrationStatus = () => {
  const squad = Boolean(
    text(process.env.SQUAD_SECRET_KEY) &&
    text(process.env.SQUAD_MERCHANT_ID) &&
    text(process.env.SQUAD_TRANSFER_ENABLED).toLowerCase() === "true"
  );
  const clubKonnect = Boolean(
    text(process.env.CLUBKONNECT_USER_ID) && text(process.env.CLUBKONNECT_API_KEY)
  );
  const secureWave = Boolean(
    text(process.env.SECUREWAVE_API_KEY) ||
    text(process.env.SECUREWAVE_SECRET_KEY) ||
    text(process.env.SECUREWAVE_MERCHANT_ID)
  );
  return { squad, clubKonnect, secureWave };
};

exports.listBankPartners = async (req, res) => {
  const configured = integrationStatus();
  return res.json({
    success: true,
    providers: [
      {
        code: "SECUREWAVE",
        name: "SecureWave",
        status: configured.secureWave ? "CONFIGURED" : "NOT_CONFIGURED",
        capabilities: ["Dedicated account provisioning", "Bank account name enquiry"],
        credentialsExposed: false,
      },
      {
        code: "SQUAD",
        name: "Squad",
        status: configured.squad ? "CONFIGURED" : "NOT_CONFIGURED",
        capabilities: ["Bank transfer routing", "Transfer requery"],
        credentialsExposed: false,
      },
      {
        code: "CLUBKONNECT",
        name: "NelloBytes / ClubKonnect integration",
        status: configured.clubKonnect ? "CONFIGURED" : "NOT_CONFIGURED",
        capabilities: ["Airtime", "Data", "Cable TV", "Exam PIN"],
        credentialsExposed: false,
      },
    ],
    pagination: { page: 1, limit: 3, total: 3, pages: 1 },
  });
};

exports.listRoutingStatus = async (req, res) => {
  const configured = integrationStatus();
  const routes = [
    {
      service: "Dedicated Accounts",
      provider: "SecureWave",
      status: configured.secureWave ? "CONFIGURED" : "NOT_CONFIGURED",
      mode: "READ_ONLY",
      detail: "Customer dedicated-account records are provisioned by the configured provider.",
    },
    {
      service: "Bank Transfers",
      provider: "Squad",
      status: configured.squad ? "CONFIGURED" : "NOT_CONFIGURED",
      mode: "READ_ONLY",
      detail: "Existing transfer routing is preserved; automatic switching is not implemented.",
    },
    {
      service: "Airtime, Data, Cable and Exam PIN",
      provider: "NelloBytes / ClubKonnect integration",
      status: configured.clubKonnect ? "CONFIGURED" : "NOT_CONFIGURED",
      mode: "READ_ONLY",
      detail: "Existing service routing is preserved; no imaginary failover is exposed.",
    },
  ];
  return res.json({
    success: true,
    routes,
    pagination: { page: 1, limit: routes.length, total: routes.length, pages: 1 },
  });
};

exports.listFraudAlerts = async (req, res) => {
  try {
    /*
     * Persist a small, explainable signal from ServicePay's own ledger.
     * No external intelligence is claimed: this is only a repeated-failure
     * signal from real failed transactions during the last hour.
     */
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const repeatedFailures = await Transaction.aggregate([
      { $match: { status: "FAILED", createdAt: { $gte: since } } },
      { $group: { _id: "$customerId", count: { $sum: 1 }, latestTransaction: { $last: "$_id" } } },
      { $match: { count: { $gte: 3 } } },
    ]);
    for (const signal of repeatedFailures) {
      const exists = await FintechFraudAlert.exists({
        user: signal._id,
        transaction: signal.latestTransaction,
        rule: "FAILED_TRANSACTION_VELOCITY",
        status: { $in: ["OPEN", "REVIEWING", "ESCALATED"] },
      });
      if (!exists) {
        await FintechFraudAlert.create({
          user: signal._id,
          transaction: signal.latestTransaction,
          riskLevel: signal.count >= 6 ? "HIGH" : "MEDIUM",
          rule: "FAILED_TRANSACTION_VELOCITY",
          details: `${signal.count} failed ServicePay transactions were recorded for this customer within one hour.`,
        });
      }
    }
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    if (req.query.riskLevel && normalize(req.query.riskLevel) !== "ALL") query.riskLevel = normalize(req.query.riskLevel);
    const [alerts, total] = await Promise.all([
      FintechFraudAlert.find(query).populate("user", "fullName phone email").populate("transaction", "reference amount status serviceType").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      FintechFraudAlert.countDocuments(query),
    ]);
    return res.json({ success: true, alerts, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load fraud alerts." });
  }
};

exports.markTransactionInvestigation = async (req, res) => {
  const reason = text(req.body.reason);
  if (!requireReason(res, reason)) return;
  try {
    const transaction = await Transaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found." });
    const alert = await FintechFraudAlert.findOneAndUpdate(
      {
        transaction: transaction._id,
        rule: "MANUAL_TRANSACTION_INVESTIGATION",
        status: { $in: ["OPEN", "REVIEWING", "ESCALATED"] },
      },
      {
        $setOnInsert: {
          user: transaction.customerId,
          transaction: transaction._id,
          riskLevel: "MEDIUM",
          rule: "MANUAL_TRANSACTION_INVESTIGATION",
          details: `Manual investigation requested for ${transaction.reference}.`,
          status: "OPEN",
        },
        $push: { notes: { note: reason, author: req.user._id } },
      },
      { new: true, upsert: true }
    );
    await audit(req, {
      targetUser: transaction.customerId,
      action: "FAILED_TRANSACTION_MARKED_FOR_INVESTIGATION",
      reason,
      newData: { transactionReference: transaction.reference, alertStatus: alert.status },
      metadata: { transactionId: transaction._id, alertId: alert._id },
    });
    return res.status(201).json({ success: true, alert });
  } catch (error) {
    console.error("MARK TRANSACTION INVESTIGATION ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to mark this transaction for investigation." });
  }
};

exports.updateFraudAlert = async (req, res) => {
  const status = normalize(req.body.status);
  const note = text(req.body.note);
  if (!["OPEN", "REVIEWING", "CLEARED", "ESCALATED"].includes(status) || !requireReason(res, note)) return;
  try {
    const alert = await FintechFraudAlert.findByIdAndUpdate(req.params.alertId, { $set: { status, reviewedBy: req.user._id }, $push: { notes: { note, author: req.user._id } } }, { new: true });
    if (!alert) return res.status(404).json({ success: false, message: "Fraud alert not found." });
    await audit(req, { targetUser: alert.user, action: "FRAUD_ALERT_UPDATED", reason: note, newData: { status }, metadata: { alertId: alert._id } });
    return res.json({ success: true, alert });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to update fraud alert." });
  }
};

exports.listWatchlist = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    if (req.query.identifierType && normalize(req.query.identifierType) !== "ALL") query.identifierType = normalize(req.query.identifierType);
    if (text(req.query.search)) query.$or = [{ identifierValue: new RegExp(text(req.query.search), "i") }, { identifierDisplay: new RegExp(text(req.query.search), "i") }];
    const [entries, total] = await Promise.all([FintechWatchlist.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), FintechWatchlist.countDocuments(query)]);
    return res.json({ success: true, entries, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load watchlist." });
  }
};

exports.createWatchlistEntry = async (req, res) => {
  const identifierType = normalize(req.body.identifierType);
  const identifierValue = text(req.body.identifierValue).toLowerCase();
  const status = normalize(req.body.status);
  const severity = normalize(req.body.severity || "MEDIUM");
  const reason = text(req.body.reason);
  if (!["USER_ID", "PHONE", "EMAIL", "BANK_ACCOUNT", "DEVICE", "PARTNER"].includes(identifierType) || !identifierValue || !["WATCHLIST", "BLACKLISTED"].includes(status) || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity) || !requireReason(res, reason)) {
    return res.status(400).json({ success: false, message: "Provide a valid identifier, status, severity and reason." });
  }
  try {
    const entry = await FintechWatchlist.create({ identifierType, identifierValue, identifierDisplay: text(req.body.identifierDisplay), status, severity, reason, notes: text(req.body.notes), expiresAt: req.body.expiresAt || null, createdBy: req.user._id });
    await audit(req, { action: "WATCHLIST_ENTRY_CREATED", reason, newData: { identifierType, status, severity }, metadata: { watchlistId: entry._id } });
    return res.status(201).json({ success: true, entry });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: "IDENTIFIER_ALREADY_LISTED", message: "An active watchlist entry already exists for this identifier." });
    return res.status(500).json({ success: false, message: "Unable to add watchlist entry." });
  }
};

exports.clearWatchlistEntry = async (req, res) => {
  const reason = text(req.body.reason);
  if (!requireReason(res, reason)) return;
  try {
    const entry = await FintechWatchlist.findOneAndUpdate({ _id: req.params.entryId, status: { $in: ["WATCHLIST", "BLACKLISTED"] } }, { $set: { status: "CLEARED", clearedBy: req.user._id, clearedAt: new Date(), clearReason: reason } }, { new: true });
    if (!entry) return res.status(409).json({ success: false, message: "Entry is already cleared or was not found." });
    await audit(req, { action: "WATCHLIST_ENTRY_CLEARED", reason, previousData: { status: "ACTIVE" }, newData: { status: "CLEARED" }, metadata: { watchlistId: entry._id } });
    return res.json({ success: true, entry });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to clear watchlist entry." });
  }
};

exports.listLoginRisk = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (text(req.query.search)) {
      const userIds = await User.find(customerSearchQuery(req.query.search)).distinct("_id");
      query.$or = [{ identifier: new RegExp(text(req.query.search), "i") }, { user: { $in: userIds } }];
    }
    if (req.query.outcome && normalize(req.query.outcome) !== "ALL") query.outcome = normalize(req.query.outcome);
    const [events, total] = await Promise.all([
      LoginSecurityEvent.find(query).populate("user", "fullName phone email status").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LoginSecurityEvent.countDocuments(query),
    ]);
    return res.json({ success: true, events, providerControls: { revokeSessions: false, message: "Token sessions are stateless in the current authentication design; use Account Restrictions to force a safe login block." }, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load login risk events." });
  }
};

exports.listFinancialActions = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (req.query.type && normalize(req.query.type) !== "ALL") query.type = normalize(req.query.type);
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    const [actions, total] = await Promise.all([
      FintechFinancialAction.find(query).populate("customer", "fullName phone email").populate("originalTransaction", "reference amount status serviceType provider").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      FintechFinancialAction.countDocuments(query),
    ]);
    return res.json({ success: true, actions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load financial actions." });
  }
};

exports.executeFinancialAction = async (req, res) => {
  const type = normalize(req.params.type);
  const reason = text(req.body.reason);
  const key = requireIdempotency(req, res);
  if (!key) return;
  if (!["REFUND", "REVERSAL"].includes(type) || !isObjectId(req.body.transactionId) || !requireReason(res, reason)) {
    return res.status(400).json({ success: false, message: "Provide an eligible transaction and a clear reason." });
  }
  const session = await mongoose.startSession();
  try {
    let action;
    await session.withTransaction(async () => {
      const transaction = await Transaction.findById(req.body.transactionId).session(session);
      if (!transaction || transaction.status !== "FAILED" || transaction.providerResponse?.walletDebited !== true) {
        throw Object.assign(new Error("Only a failed transaction with a confirmed wallet debit is eligible for a controlled refund or reversal."), { statusCode: 409, code: "TRANSACTION_NOT_ELIGIBLE" });
      }
      const customer = await User.findById(transaction.customerId).session(session);
      if (!customer) throw Object.assign(new Error("Transaction customer was not found."), { statusCode: 404 });
      action = await FintechFinancialAction.create([{
        type, originalTransaction: transaction._id, customer: customer._id, reference: reference(type === "REFUND" ? "RFD" : "RVSL"),
        amount: Number(transaction.amount), status: "PENDING", reason, initiatedBy: req.user._id,
      }], { session }).then((items) => items[0]);
      const balanceBefore = Number(customer.walletBalance || 0);
      const updated = await User.findByIdAndUpdate(customer._id, { $inc: { walletBalance: Number(transaction.amount) } }, { new: true, session });
      await LedgerEntry.create([{
        user: customer._id, direction: "CREDIT", amount: Number(transaction.amount), openingBalance: balanceBefore, closingBalance: Number(updated.walletBalance),
        service: type, reference: action.reference, idempotencyKey: `${type.toLowerCase()}:${key}`, transactionId: transaction._id,
        narration: `${type === "REFUND" ? "Refund" : "Reversal"} for ${transaction.reference}: ${reason}`,
      }], { session });
      const field = type === "REFUND" ? "refundStatus" : "reversalStatus";
      transaction[field] = "COMPLETED";
      transaction.status = "REFUNDED";
      await transaction.save({ session });
      action.status = "COMPLETED";
      action.completedAt = new Date();
      await action.save({ session });
      await audit(req, { targetUser: customer, action: `${type}_COMPLETED`, reason, previousData: { balance: balanceBefore, transactionStatus: "FAILED" }, newData: { balance: Number(updated.walletBalance), actionReference: action.reference }, metadata: { transactionId: transaction._id, financialActionId: action._id, idempotencyKey: key }, session });
    });
    return res.status(201).json({ success: true, action });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: "DUPLICATE_FINANCIAL_ACTION", message: "A refund or reversal already exists for this transaction." });
    return res.status(error.statusCode || 500).json({ success: false, code: error.code, message: error.message || "Unable to complete financial action." });
  } finally {
    await session.endSession();
  }
};

exports.listDisputes = async (req, res) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const query = {};
    if (req.query.status && normalize(req.query.status) !== "ALL") query.status = normalize(req.query.status);
    if (text(req.query.search)) {
      const search = text(req.query.search);
      const customerIds = await User.find(customerSearchQuery(search)).distinct("_id");
      query.$or = [
        { reference: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { customer: { $in: customerIds } },
      ];
    }
    const [disputes, total] = await Promise.all([
      FintechDispute.find(query)
        .populate("customer", "fullName phone email")
        .populate("transaction", "reference amount status serviceType provider")
        .populate("createdBy", "fullName")
        .populate("resolvedBy", "fullName")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      FintechDispute.countDocuments(query),
    ]);
    return res.json({ success: true, disputes, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("LIST FINTECH DISPUTES ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to load disputes." });
  }
};

exports.createDispute = async (req, res) => {
  const reason = text(req.body.reason);
  const category = normalize(req.body.category);
  if (!isObjectId(req.body.transactionId) || !["UNRECOGNISED", "SERVICE_NOT_RECEIVED", "DUPLICATE_CHARGE", "INCORRECT_AMOUNT", "OTHER"].includes(category) || !requireReason(res, reason)) {
    return res.status(400).json({ success: false, message: "Provide a transaction, valid category and clear reason." });
  }
  try {
    const transaction = await Transaction.findById(req.body.transactionId);
    if (!transaction) return res.status(404).json({ success: false, message: "Transaction not found." });
    const dispute = await FintechDispute.create({
      reference: reference("DSP"),
      transaction: transaction._id,
      customer: transaction.customerId,
      category,
      reason,
      amount: Number(transaction.amount),
      notes: [{ note: reason, author: req.user._id }],
      createdBy: req.user._id,
    });
    await audit(req, {
      targetUser: transaction.customerId,
      action: "DISPUTE_CREATED",
      reason,
      newData: { disputeReference: dispute.reference, category, amount: dispute.amount },
      metadata: { disputeId: dispute._id, transactionId: transaction._id },
    });
    return res.status(201).json({ success: true, dispute });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, code: "DISPUTE_ALREADY_EXISTS", message: "A dispute already exists for this transaction." });
    console.error("CREATE FINTECH DISPUTE ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to create dispute." });
  }
};

exports.updateDispute = async (req, res) => {
  const status = normalize(req.body.status);
  const note = text(req.body.note);
  if (!["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED", "CLOSED"].includes(status) || !requireReason(res, note)) {
    return res.status(400).json({ success: false, message: "Provide a valid status and clear note." });
  }
  try {
    const dispute = await FintechDispute.findById(req.params.disputeId);
    if (!dispute) return res.status(404).json({ success: false, message: "Dispute not found." });
    const previousStatus = dispute.status;
    dispute.status = status;
    dispute.notes.push({ note, author: req.user._id });
    if (status === "RESOLVED" || status === "REJECTED" || status === "CLOSED") {
      dispute.resolution = note;
      dispute.resolvedBy = req.user._id;
      dispute.resolvedAt = new Date();
    }
    await dispute.save();
    await audit(req, {
      targetUser: dispute.customer,
      action: "DISPUTE_UPDATED",
      reason: note,
      previousData: { status: previousStatus },
      newData: { status },
      metadata: { disputeId: dispute._id },
    });
    return res.json({ success: true, dispute });
  } catch (error) {
    console.error("UPDATE FINTECH DISPUTE ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to update dispute." });
  }
};