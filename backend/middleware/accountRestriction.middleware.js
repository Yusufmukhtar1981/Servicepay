const AccountRestriction = require("../models/accountRestriction.model");
const FintechWatchlist = require("../models/fintechWatchlist.model");
const User = require("../models/user.model");

const clean = (value) => String(value || "").trim();
const normalizeRole = (value) => clean(value).toUpperCase().replace(/[\s-]+/g, "_");

const activeRestriction = (user, types) => AccountRestriction.findOne({
  user: user._id,
  type: { $in: types },
  status: "ACTIVE",
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
}).lean();

const activeBlacklist = (user) => {
  const values = [String(user._id).toLowerCase(), clean(user.phone).toLowerCase(), clean(user.email).toLowerCase()].filter(Boolean);
  return FintechWatchlist.findOne({
    status: "BLACKLISTED",
    identifierValue: { $in: values },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean();
};

const blockRestrictedAccess = async (req, res, next) => {
  try {
    if (!req.user || normalizeRole(req.user.role) === "HEAD_OFFICE") return next();
    const [restriction, blacklist] = await Promise.all([
      activeRestriction(req.user, ["FULL_FREEZE", "BLOCK_LOGIN"]),
      activeBlacklist(req.user),
    ]);
    if (restriction || blacklist) {
      return res.status(403).json({
        success: false,
        code: blacklist ? "BLACKLISTED_IDENTIFIER" : "ACCOUNT_RESTRICTED",
        message: "This account cannot access this service. Contact ServicePay support.",
      });
    }
    return next();
  } catch (error) {
    console.error("ACCOUNT RESTRICTION ACCESS CHECK ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to confirm account access." });
  }
};

const requireNoRestriction = (...types) => async (req, res, next) => {
  try {
    if (!req.user || normalizeRole(req.user.role) === "HEAD_OFFICE") return next();
    const restriction = await activeRestriction(req.user, ["FULL_FREEZE", ...types]);
    if (restriction) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_RESTRICTED",
        message: "This account is restricted from this operation.",
      });
    }
    return next();
  } catch (error) {
    console.error("ACCOUNT RESTRICTION OPERATION CHECK ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to confirm account restrictions." });
  }
};

const requireSpendableBalance = async (req, res, next) => {
  try {
    const amount = Number(req.body?.amount || req.body?.totalAmount || 0);
    if (!req.user || !Number.isFinite(amount) || amount <= 0) return next();
    const user = await User.findById(req.user._id).select("walletBalance walletHeldBalance").lean();
    if (!user || Number(user.walletBalance || 0) - Number(user.walletHeldBalance || 0) < amount) {
      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_SPENDABLE_BALANCE",
        message: "Wallet funds are held or insufficient for this operation.",
      });
    }
    return next();
  } catch (error) {
    console.error("SPENDABLE BALANCE CHECK ERROR:", error);
    return res.status(500).json({ success: false, message: "Unable to confirm spendable wallet balance." });
  }
};

module.exports = { blockRestrictedAccess, requireNoRestriction, requireSpendableBalance };