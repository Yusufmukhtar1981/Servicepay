const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const RiskAlert = require("../models/riskAlert.model");
const RiskRule = require("../models/riskRule.model");
const { evaluate } = require("./riskEvaluator.service");
const RULES = [
  ["VELOCITY", "Transaction velocity", 60], ["AMOUNT_ANOMALY", "Amount anomaly", 55],
  ["FAILED_TRANSACTIONS", "Repeated failed transactions", 45], ["FAILED_AUTH", "Failed authentication", 50],
  ["NEW_ACCOUNT_ACTIVITY", "New-account high activity", 45], ["DORMANT_ACTIVATION", "Dormant-account activation", 50],
  ["RAPID_WALLET_IN_OUT", "Rapid wallet in/out", 70], ["INCOMPLETE_KYC_ACTIVITY", "Incomplete KYC high activity", 45],
];
const ensureDefaultRules = async (session = null) => {
  // Transactions must not run parallel operations on the same session.
  for (const [code, name, score] of RULES) {
    await RiskRule.updateOne({ code }, { $setOnInsert: { code, name, score, version: 1, description: "Observed-evidence monitoring rule." } }, { upsert: true, ...(session ? { session } : {}) });
  }
};
const evaluateTransaction = async (transactionId, { session = null } = {}) => {
  await ensureDefaultRules(session);
  const tx = await Transaction.findById(transactionId).session(session).lean();
  if (!tx) return { evaluated: 0, alerts: [] };
  // Historical re-evaluation must use only information available at target time.
  const evaluatedAt = new Date(tx.createdAt), customer = await User.findById(tx.customerId).select("createdAt kycVerified zone state businessPartnerProfile businessPartnerId").session(session).lean();
  if (!customer) return { evaluated: 0, alerts: [] };
  const tenMinutes = new Date(evaluatedAt - 10 * 60000), thirtyMinutes = new Date(evaluatedAt - 30 * 60000), thirtyDays = new Date(evaluatedAt - 30 * 86400000);
  // MongoDB transactions do not support parallel operations on one session.
  const recent = await Transaction.countDocuments({ customerId: tx.customerId, createdAt: { $gte: tenMinutes, $lte: evaluatedAt } }).session(session);
  const history = await Transaction.aggregate([{ $match: { customerId: tx.customerId, createdAt: { $lt: evaluatedAt }, status: "SUCCESSFUL" } }, { $sort: { createdAt: -1 } }, { $limit: 50 }, { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$amount" } } }]).session(session);
  const failed = await Transaction.countDocuments({ customerId: tx.customerId, status: "FAILED", createdAt: { $gte: thirtyDays, $lte: evaluatedAt } }).session(session);
  const failedAuth = await LoginSecurityEvent.countDocuments({ user: tx.customerId, outcome: "FAILED", createdAt: { $gte: thirtyDays, $lte: evaluatedAt } }).session(session);
  const walletRows = await Transaction.aggregate([{ $match: { customerId: tx.customerId, status: "SUCCESSFUL", createdAt: { $gte: thirtyMinutes, $lte: evaluatedAt } } }, { $group: { _id: "$serviceType", amount: { $sum: "$amount" } } }]).session(session);
  const kyc = await KycProfile.findOne({ user: tx.customerId }).select("status").session(session).lean();
  const prior = await Transaction.findOne({ customerId: tx.customerId, createdAt: { $lt: evaluatedAt } }).select("createdAt").sort({ createdAt: -1 }).session(session).lean();
  const walletInAmount = walletRows.find((r) => r._id === "WALLET_FUNDING")?.amount || 0;
  const walletOutAmount = walletRows.filter((r) => r._id !== "WALLET_FUNDING").reduce((n, r) => n + r.amount, 0);
  const evidence = { recentTransactionCount: recent, amount: tx.amount, historyCount: history[0]?.count || 0, historyAverage: history[0]?.average || 0, failedTransactionCount: failed, failedAuthCount: failedAuth, accountAgeDays: Math.floor((evaluatedAt - new Date(customer.createdAt)) / 86400000), priorDormancyDays: prior ? Math.floor((evaluatedAt - new Date(prior.createdAt)) / 86400000) : 0, walletInAmount, walletOutAmount, kycIncomplete: customer.kycVerified !== true && kyc?.status !== "VERIFIED" };
  const rules = await RiskRule.find({ enabled: true }).session(session).lean(), alerts = [];
  for (const rule of rules) {
    const result = evaluate(rule, evidence);
    if (!result.triggered) continue;
    const identity = `${tx._id}:${rule.code}:${rule.version}`;
    const update = { $setOnInsert: { identity, transaction: tx._id, customer: tx.customerId, customerZone: customer.zone || null, customerState: customer.state || null, customerBusinessPartner: customer.businessPartnerProfile || customer.businessPartnerId || null, rule: rule._id, ruleCode: rule.code, ruleVersion: rule.version, status: "NEW", score: result.score, severity: result.severity, reasons: result.reasons, lastEvaluatedAt: evaluatedAt } };
    try { const item = await RiskAlert.findOneAndUpdate({ identity }, update, { upsert: true, new: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) }); alerts.push(item); } catch (error) { if (error.code !== 11000) throw error; alerts.push(await RiskAlert.findOne({ identity }).session(session)); }
  }
  return { evaluated: rules.length, alerts };
};
module.exports = { ensureDefaultRules, evaluateTransaction };