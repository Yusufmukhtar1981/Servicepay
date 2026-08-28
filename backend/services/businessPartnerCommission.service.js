const Commission = require("../models/businessPartnerCommission.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const round = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

async function createCommission({ businessPartner, application, sourceType, amount, eventKey, createdBy, status = "PENDING", session }) {
  if (!businessPartner || !application || !["SOLAR", "PHONE"].includes(sourceType) || !eventKey || round(amount) <= 0 || !["PENDING", "EARNED"].includes(status)) {
    throw new Error("Valid partner, application, source, amount, and event key are required.");
  }
  try {
    const commission = (await Commission.create([{ businessPartner, application, sourceType, amount: round(amount), eventKey, createdBy, status, earnedAt: status === "EARNED" ? new Date() : null }], { session }))[0];
    return { commission, idempotent: false };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const commission = await Commission.findOne({ eventKey }).session(session || null);
    if (!commission) throw error;
    return { commission, idempotent: true };
  }
}
async function reverseCommission({ commissionId, eventKey, createdBy, reason, session }) {
  const original = await Commission.findById(commissionId).session(session || null);
  if (!original) throw Object.assign(new Error("Commission not found."), { statusCode: 404 });
  const existing = await Commission.findOne({ reversalOf: original._id }).session(session || null);
  if (existing) return { commission: existing, idempotent: true };
  try {
    const commission = (await Commission.create([{
      businessPartner: original.businessPartner, application: original.application,
      sourceType: original.sourceType, amount: -Math.abs(original.amount), eventKey, createdBy,
      status: "REVERSED", reversalOf: original._id, reversalReason: String(reason || "").slice(0, 500),
    }], { session }))[0];
    return { commission, idempotent: false };
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Either eventKey or reversalOf can win a concurrent race. reversalOf is
    // canonical, so repeats with a different key always resolve identically.
    const reversal = await Commission.findOne({ reversalOf: original._id }).session(session || null);
    if (reversal) return { commission: reversal, idempotent: true };
    throw error;
  }
}
async function createCommissionForEvent({ businessPartner, application, sourceType, sourceAmount, eventKey, createdBy, session }) {
  if (!businessPartner) return null; // Non-partner legacy lifecycle remains untouched.
  const ruleType = sourceType === "PHONE" ? "PHONE_FINANCING" : sourceType;
  const rule = await Rule.findOne({ sourceType: ruleType, status: "ACTIVE", effectiveFrom: { $lte: new Date() } }).sort({ version: -1 }).session(session || null);
  if (!rule) return null;
  const amount = rule.calculation === "PERCENT" ? round(Number(sourceAmount) * Number(rule.value) / 100) : round(rule.value);
  if (amount <= 0) return null;
  return createCommission({ businessPartner, application, sourceType: sourceType === "PHONE_FINANCING" ? "PHONE" : sourceType, amount, eventKey, createdBy, status: "EARNED", session });
}
module.exports = { createCommission, createCommissionForEvent, reverseCommission, round };