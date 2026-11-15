const mongoose = require("mongoose");
const programme = require("../services/referralProgramme.service");
const User = require("../models/user.model");
const LedgerEntry = require("../models/ledgerEntry.model");

const globalHeadOffice = (req) => req.user?.role === "HEAD_OFFICE" &&
  req.staffAccess?.isHeadOffice === true && req.staffAccess?.scope?.type === "GLOBAL";
// Do not let Head Office's wildcard silently grant financial configuration.
const explicitPermissions = (req) => [
  ...(req.staffRole?.permissions || []), ...(req.staffAccess?.permissions || []),
];
const canManage = (req) => globalHeadOffice(req) &&
  explicitPermissions(req).some((permission) => ["settings.update", "settings.edit"].includes(permission));
const deny = (res) => res.status(403).json({ success: false, message: "Global Head Office referral access is required." });
const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const integer = (value, fallback, max) => Math.min(Math.max(Math.floor(Number(value)) || fallback, 1), max);
const customerMatch = async (q) => {
  if (!q) return null;
  const regex = new RegExp(escape(String(q).slice(0, 100)), "i");
  // Exact customer identity is available only to authorized Head Office, not
  // through the customer referral report.
  const rows = await User.find({ $or: [{ fullName: regex }, { phone: regex }, { referralCode: regex }] }).select("_id").lean();
  return rows.map((row) => row._id);
};
const queryFilter = async (query) => {
  const filter = { ...programme.baseFilter };
  const ids = await customerMatch(query.q);
  if (ids) filter.$or = [{ user: { $in: ids } }, { relatedUser: { $in: ids } }];
  if (query.rewardType) {
    if (!["REGISTRATION", "TRANSACTION"].includes(query.rewardType)) {
      const error = new Error("Invalid reward type"); error.status = 400; throw error;
    }
    filter["metadata.rewardType"] = query.rewardType;
  }
  return filter;
};
const populated = (query) => query.populate("user", "fullName phone referralCode")
  .populate("relatedUser", "fullName phone referralCode");

exports.getProgramme = async (req, res) => {
  if (!globalHeadOffice(req)) return deny(res);
  try {
    const [settings, checks] = await Promise.all([programme.policy(), programme.readiness()]);
    return res.json({ success: true, programme: settings, readiness: checks, canManage: canManage(req) });
  } catch (_) { return res.status(503).json({ success: false, message: "Referral configuration is unavailable." }); }
};
exports.updateProgramme = async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ success: false, message: "Explicit Head Office settings.update permission is required." });
  try {
    const settings = await programme.configure(req.body || {}, req.user);
    return res.json({ success: true, programme: settings });
  } catch (error) {
    return res.status(error.status || 400).json({ success: false, message: error.message });
  }
};
exports.commissions = async (req, res) => {
  if (!globalHeadOffice(req)) return deny(res);
  try {
    const page = integer(req.query.page, 1, 100000);
    const limit = integer(req.query.limit, 50, 200);
    const filter = await queryFilter(req.query);
    const [items, total, summary] = await Promise.all([
      populated(LedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)).lean(),
      LedgerEntry.countDocuments(filter), programme.totals(),
    ]);
    return res.json({ success: true, items: items.map((row) => programme.presentLedger(row, true)), page, total, pages: Math.ceil(total / limit), summary });
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Unable to load referral commission report." }); }
};
const cell = (value) => {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
exports.exportCommissions = async (req, res) => {
  if (!globalHeadOffice(req)) return deny(res);
  try {
    const filter = await queryFilter(req.query);
    // Fail explicitly rather than silently truncate a financial export.
    const total = await LedgerEntry.countDocuments(filter);
    if (total > 10000) return res.status(409).json({ success: false, message: "Report exceeds 10,000 entries. Narrow the search or reward type." });
    const rows = await populated(LedgerEntry.find(filter).sort({ createdAt: -1, _id: -1 }).limit(10000)).lean();
    const csv = [["Reference", "Date UTC", "Reward type", "Direction", "Amount NGN", "Referrer", "Referral code", "Referred customer", "Source reference"],
      ...rows.map((row) => [row.reference, row.createdAt.toISOString(), row.metadata.rewardType,
        row.direction, row.amount, row.user?.fullName, row.user?.referralCode,
        row.relatedUser?.fullName, row.metadata.sourceReference])].map((row) => row.map(cell).join(",")).join("\r\n");
    await require("../models/adminAuditLog.model").create({
      actorId: req.user._id, actorRole: req.user.role, action: "FINANCIAL_REPORT_EXPORTED",
      reason: "Authorized Head Office referral commission report export",
      metadata: { report: "REFERRAL_COMMISSIONS", count: rows.length },
    });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", 'attachment; filename="Servicepay-referral-commissions.csv"');
    res.set("Cache-Control", "no-store");
    return res.send(`\uFEFF${csv}`);
  } catch (error) { return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Unable to export referral commissions." }); }
};

exports.searchReferrals = async (req, res) => {
  const page = integer(req.query.page, 1, 100000);
  const limit = integer(req.query.limit, 50, 200);
  const ids = await customerMatch(req.query.q);
  const filter = { role: "CUSTOMER", referredBy: { $exists: true, $ne: null } };
  if (ids) filter.$or = [{ _id: { $in: ids } }, { referredBy: { $in: ids } }];
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit)
      .populate("referredBy", "fullName phone referralCode").lean(), User.countDocuments(filter),
  ]);
  const items = await Promise.all(users.map(async (user) => {
    const earnings = await programme.totals({ relatedUser: new mongoose.Types.ObjectId(String(user._id)) });
    const paid = earnings.registrationBonusesEarned > 0;
    return { id: user._id, customerId: user._id, firstName: user.fullName?.split(/\s+/)[0] || "",
      fullName: user.fullName, phone: user.phone, referralCode: user.referralCode,
      referrerId: user.referredBy?._id, referrer: user.referredBy, joinedAt: user.createdAt,
      status: user.status, verified: programme.verified(user), rewardStatus: paid ? "AWARDED" : "NOT_ISSUED",
      qualificationStatus: programme.verified(user) ? "QUALIFIED" : "PENDING",
      categoryProgress: {}, ...earnings };
  }));
  return res.json({ success: true, items, referrals: items, rows: items, page, limit, total, pages: Math.ceil(total / limit) });
};
exports.summary = async (req, res) => {
  const [summary, total, qualified, policy] = await Promise.all([
    programme.totals(), User.countDocuments({ role: "CUSTOMER", referredBy: { $exists: true, $ne: null } }),
    User.countDocuments({ role: "CUSTOMER", status: "ACTIVE", referredBy: { $exists: true, $ne: null },
      $or: [{ emailVerified: true }, { phoneVerified: true }] }), programme.policy(),
  ]);
  return res.json({ success: true, policy, summary: { ...summary, total, attributedReferrals: total,
    qualified, pending: total - qualified, value: summary.totalReferralEarnings + summary.legacyRewards,
    totalActiveRewardValue: summary.totalReferralEarnings + summary.legacyRewards, byCategory: {} } });
};
