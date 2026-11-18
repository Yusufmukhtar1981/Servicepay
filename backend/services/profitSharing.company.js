"use strict";
const crypto = require("node:crypto");
const Models = require("../models/profitSharing.models");
const Network = require("../models/businessNetwork.models");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const Ledger = require("../models/ledgerEntry.model");
const Policy = require("./profitSharing.policy");
const { createEngine, kobo } = require("./profitSharing.engine");
const ID = "company-profit-sharing";
const fail = (code, statusCode = 409) => {
  throw Object.assign(Error(code), { code, statusCode });
};
const sha = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Ownership is prospective and immutable through the saved activation windows.
// Pausing closes a window; it must not re-enable a second, legacy commission
// writer for transactions already owned by company profit sharing.
async function ownsTransaction(tx, session, settingsModel = Network.Settings) {
  if (!tx?._id) return false;
  // Some existing callers pass a partial in-memory transaction. Financial
  // ownership must use the saved creation time, not omit the guard in that case.
  const saved = await Transaction.findById(tx._id).session(session || null).select("createdAt").lean();
  if (!saved?.createdAt) return false;
  const doc = await settingsModel.findById(ID).session(session || null).lean();
  const at = +new Date(saved.createdAt);
  return (doc?.profitSharing?.windows || []).some(window =>
    +new Date(window.start) <= at && (!window.end || at < +new Date(window.end)));
}
function createCompany({
  M = Models, N = Network, transactionModel = Transaction, commissionModel = Commission,
  engine = createEngine(), now = () => new Date(),
  withdrawalReadiness = require("./withdrawalIndexReadiness.service").getWithdrawalIndexReadiness,
} = {}) {
  async function storageBlockers() {
    const blockers = await engine.storageBlockers();
    if (!(await withdrawalReadiness()).ready) blockers.push("COMMISSION_WITHDRAWAL_UNIQUE_SAFEGUARDS_REQUIRED");
    return blockers;
  }
  const dataOf = doc => doc?.profitSharing || { enabled: false, versions: [], windows: [] };
  const current = data => data.versions?.at(-1) || null;
  const publicVersion = ({ requestHash, ...version }) => version;
  async function read() {
    const doc = await N.Settings.findById(ID).lean(), data = dataOf(doc);
    const pending = await M.Event.aggregate([
      { $match: { kind: "BLOCKED", "data.scope": "COMPANY" } },
      { $lookup: { from: M.Event.collection.name, localField: "data.accrualId",
        foreignField: "_id", as: "settled" } },
      { $match: { "settled.0": { $exists: false } } },
      { $lookup: { from: M.Event.collection.name, localField: "data.noProfitId",
        foreignField: "_id", as: "zeroProfit" } },
      { $match: { "zeroProfit.0": { $exists: false } } },
      { $lookup: { from: transactionModel.collection.name, localField: "transaction",
        foreignField: "_id", as: "source" } },
      { $match: { "source.status": { $nin: ["REFUNDED", "FAILED", "REVERSED"] } } },
      { $count: "count" },
    ]).option({ maxTimeMS: 5000 });
    return { revision: doc?.revision || 0, enabled: data.enabled === true,
      currentRule: current(data) ? publicVersion(current(data)) : null,
      versions: [...(data.versions || [])].reverse().map(publicVersion),
      storageBlockers: await storageBlockers(), pendingVerificationCount: pending[0]?.count || 0,
      // Unknown profit is not zero. Reports must never invent a pending amount.
      pendingAmountKobo: null, settlementSource: "VERIFIED_COMPANY_PROFIT_ONLY" };
  }
  function validate(actor, body) {
    if (actor?.role !== "HEAD_OFFICE" || !actor._id) fail("HEAD_OFFICE_REQUIRED", 403);
    if (!body || body.confirmation !== true || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
        typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.trim().length > 500) {
      fail("INVALID_COMPANY_CONFIRMATION", 400);
    }
  }
  async function change(actor, body, saveRule = false) {
    validate(actor, body);
    const allowed = ["revision", "reason", "confirmation",
      ...(saveRule ? ["idempotencyKey", "percentages"] : ["enabled"])];
    if (Object.keys(body).some(key => !allowed.includes(key))) fail("INVALID_COMPANY_FIELDS", 400);
    let percentages, requestHash, versionId;
    if (saveRule) {
      const bps = Policy.percentageBasisPoints(body.percentages);
      percentages = Object.fromEntries(Policy.ROLES.map(role => [role, bps[role] / 100]));
      if (typeof body.idempotencyKey !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(body.idempotencyKey)) {
        fail("IDEMPOTENCY_KEY_REQUIRED", 400);
      }
      versionId = sha([String(actor._id), body.idempotencyKey]);
      requestHash = sha([percentages, body.reason.trim(), body.revision]);
    } else if (typeof body.enabled !== "boolean") fail("INVALID_COMPANY_ENABLED", 400);
    if ((saveRule || body.enabled) && (await storageBlockers()).length) fail("STORAGE_NOT_READY", 503);
    await engine.atomic(async session => {
      const doc = await N.Settings.findById(ID).session(session).lean(), prior = dataOf(doc);
      const previous = (prior.versions || []).find(version => version.id === versionId);
      if (saveRule && previous) {
        if (previous.requestHash !== requestHash) fail("IDEMPOTENCY_CONFLICT");
        return;
      }
      if ((doc?.revision || 0) !== body.revision) fail("COMPANY_CONFIGURATION_CHANGED");
      const at = now().toISOString();
      const next = { ...prior, versions: [...(prior.versions || [])],
        windows: (prior.windows || []).map(window => ({ ...window })) };
      if (saveRule) {
        if (next.versions.length >= 500) fail("COMPANY_RULE_HISTORY_LIMIT");
        next.versions.push({ id: versionId, percentages, createdAt: at,
          createdBy: String(actor._id), reason: body.reason.trim(), requestHash });
      } else {
        if (body.enabled) {
          Policy.percentageBasisPoints(current(next)?.percentages);
          if (!next.enabled) {
            if (next.windows.length >= 500) fail("COMPANY_ACTIVATION_HISTORY_LIMIT");
            next.windows.push({ id: crypto.randomUUID(), start: at, end: null });
          }
        } else if (next.enabled) {
          const window = next.windows.at(-1);
          if (!window || window.end) fail("COMPANY_ACTIVATION_HISTORY_INVALID");
          window.end = at;
        }
        next.enabled = body.enabled;
      }
      if (doc) {
        const changed = await N.Settings.updateOne({ _id: ID, revision: body.revision },
          { $set: { profitSharing: next }, $inc: { revision: 1 } }, { session });
        if (changed.modifiedCount !== 1) fail("COMPANY_CONFIGURATION_CHANGED");
      } else await N.Settings.create([{ _id: ID, revision: 1, profitSharing: next }], { session });
      await N.Audit.create([{ actor: actor._id, reason: body.reason.trim(),
        action: saveRule ? "COMPANY_PROFIT_RULE_SAVED" : "COMPANY_PROFIT_MODE_CHANGED",
        metadata: { revision: body.revision + 1, enabled: next.enabled,
          ruleId: current(next)?.id, percentages: current(next)?.percentages,
          previousRuleId: current(prior)?.id || null } }], { session });
    });
    return read();
  }
  async function blocked(tx, code, session) {
    const id = `company-pending:${tx._id}`;
    if (!await M.Event.exists({ _id: id }).session(session)) {
      await M.Event.create([{ _id: id, kind: "BLOCKED", transaction: tx._id,
        data: { scope: "COMPANY", code, accrualId: `accrual:${tx._id}`,
          noProfitId: `company-zero-profit:${tx._id}`,
          amountKobo: null, at: now() } }], { session });
    }
    return { status: "PENDING_VERIFICATION", code };
  }
  async function settle(transactionId) {
    return engine.atomic(async session => {
      const key = `accrual:${transactionId}`;
      if (await M.Event.exists({ _id: key }).session(session)) return { status: "ALREADY_SETTLED" };
      if (await M.Event.exists({ _id: `company-zero-profit:${transactionId}` }).session(session)) {
        return { status: "NO_POSITIVE_NET_PROFIT" };
      }
      const doc = await N.Settings.findById(ID).session(session).lean(), config = dataOf(doc);
      if (!config.enabled) return { status: "DISABLED" };
      const tx = await transactionModel.findById(transactionId).session(session).lean();
      if (!tx || tx.status !== "SUCCESSFUL") return { status: "NOT_SUCCESSFUL" };
      const date = +new Date(tx.createdAt);
      const window = config.windows.find(item => +new Date(item.start) <= date &&
        (!item.end || date < +new Date(item.end)));
      if (!window) return { status: "OUTSIDE_ACTIVATION_WINDOW" };
      // Freeze the rule that was in force at transaction creation, not today's
      // percentages. No scheduler, backdated rules or legacy policy conversion.
      const rule = [...config.versions].reverse().find(item => +new Date(item.createdAt) <= date);
      if (!rule) return blocked(tx, "COMPANY_ALLOCATION_RULE_REQUIRED", session);
      // Only a private append-only financial close record is eligible. There
      // is intentionally no HTTP endpoint accepting a customer's "verified"
      // flag or a provider callback as authority for this record.
      const evidence = await M.Event.findById(`verified-company-profit:${tx._id}`).session(session).lean();
      if (!evidence || evidence.kind !== "VERIFIED_COMPANY_PROFIT" ||
          String(evidence.transaction) !== String(tx._id)) {
        return blocked(tx, "VERIFIED_COMPANY_PROFIT_REQUIRED", session);
      }
      const proof = evidence.data;
      if (proof.reference !== tx.reference || proof.provider !== tx.provider ||
          proof.serviceType !== tx.serviceType || proof.settlementVerified !== true ||
          proof.revenueVerified !== true || proof.expensesVerified !== true ||
          typeof proof.revenueEvidenceReference !== "string" || !proof.revenueEvidenceReference.trim() ||
          typeof proof.expenseEvidenceReference !== "string" || !proof.expenseEvidenceReference.trim() ||
          proof.costs?.customerAmountKobo !== kobo(tx.amount)) {
        return blocked(tx, "COMPLETE_BOUND_PROFIT_EVIDENCE_REQUIRED", session);
      }
      // A private accounting assertion must still match real posted custody
      // and authenticated supplier evidence. Neither a SUCCESSFUL label nor
      // copied verification booleans establish revenue or supplier cost.
      if (!/^[a-f\d]{24}$/i.test(proof.revenueEvidenceReference)) {
        return blocked(tx, "POSTED_REVENUE_EVIDENCE_REQUIRED", session);
      }
      const revenue = await Ledger.findOne({ _id: proof.revenueEvidenceReference,
        user: tx.customerId, transactionId: tx._id, reference: tx.reference,
        direction: "DEBIT", status: "POSTED", reversalOf: null }).session(session).lean();
      if (!revenue || kobo(revenue.amount) !== kobo(tx.amount) ||
          proof.costs.revenueKobo !== kobo(revenue.amount)) {
        return blocked(tx, "POSTED_REVENUE_EVIDENCE_REQUIRED", session);
      }
      // Transfers and funding are custody movements, not sales. Their
      // principal cannot become revenue even if a financial-close flag exists.
      if (["TRANSFER", "SERVICEPAY_TRANSFER", "WALLET_FUNDING", "WITHDRAWAL",
        "FUNDING", "DEPOSIT"].includes(tx.serviceType)) {
        return blocked(tx, "INDEPENDENT_FEE_REVENUE_EVIDENCE_REQUIRED", session);
      }
      const supplier = await M.Event.findById(`provider-debit:${tx._id}`).session(session).lean();
      if (!supplier || supplier.kind !== "PROVIDER_DEBIT_EVIDENCE" ||
          String(supplier.transaction) !== String(tx._id) ||
          supplier.data.provider !== tx.provider || supplier.data.serviceType !== tx.serviceType ||
          !tx.providerRequestId || supplier.data.requestReference !== tx.providerRequestId ||
          supplier.data.source !== "AUTHENTICATED_PURCHASE_BALANCE_DELTA" ||
          supplier.data.supplierDebitKobo !== proof.costs.providerCostKobo ||
          proof.costs.evidenceReference !== supplier._id) {
        return blocked(tx, "AUTHENTICATED_SUPPLIER_DEBIT_REQUIRED", session);
      }
      let pool;
      try { pool = Policy.profitPool(proof.costs); }
      catch { return blocked(tx, "COMPLETE_BOUND_PROFIT_EVIDENCE_REQUIRED", session); }
      if (!pool) {
        await M.Event.create([{ _id: `company-zero-profit:${tx._id}`, kind: "COMPANY_ZERO_PROFIT",
          transaction: tx._id, data: { financialEvidenceId: evidence._id,
            evidenceDigest: sha(proof), at: now(), financialWrites: 0 } }], { session });
        return { status: "NO_POSITIVE_NET_PROFIT" };
      }
      if (tx.reversalLedgerEntryId || tx.reversalTransactionId || tx.reversalReference) {
        return blocked(tx, "TRANSACTION_REVERSED", session);
      }
      if (await M.Admission.exists({ _id: String(tx._id) }).session(session) ||
          await commissionModel.exists({ transactionId: tx._id }).session(session) ||
          await N.Ledger.exists({ transaction: tx._id }).session(session)) {
        return blocked(tx, "LEGACY_COMMISSION_CONFLICT", session);
      }
      if (!tx.hierarchyCapturedAt) return blocked(tx, "VERIFIED_HIERARCHY_REQUIRED", session);
      const hierarchy = await engine.beneficiaries(tx, session);
      const plan = { ...Policy.allocate(pool, rule.percentages, hierarchy),
        eligible: true, transactionId: String(tx._id), reference: tx.reference, ruleId: rule.id,
        netProfitKobo: pool, costEvidenceReference: proof.costs.evidenceReference, scope: "COMPANY" };
      const entries = plan.allocations.filter(row => row.amountKobo > 0 &&
        ["BENEFICIARY", "HEAD_OFFICE"].includes(row.custody)).map(row => ({
        accountId: row.custody === "HEAD_OFFICE" ? "head-office" : `beneficiary:${row.beneficiaryId}`,
        role: row.role, amountKobo: row.amountKobo }));
      if (plan.unallocatedKobo) entries.push({ accountId: "unallocated-commission",
        role: "UNALLOCATED_COMMISSION", amountKobo: plan.unallocatedKobo });
      if (plan.roundingKobo) entries.push({ accountId: "commission-rounding",
        role: "COMMISSION_ROUNDING", amountKobo: plan.roundingKobo });
      const fence = await N.Settings.updateOne({ _id: ID, revision: doc.revision },
        { $inc: { loyaltyFence: 1 } }, { session });
      if (fence.modifiedCount !== 1) fail("COMPANY_CONFIGURATION_CHANGED");
      if (tx.providerResponse == null) {
        await transactionModel.updateOne({ _id: tx._id, status: "SUCCESSFUL", providerResponse: null },
          { $set: { providerResponse: {} } }, { session });
      }
      const txFence = await transactionModel.updateOne({ _id: tx._id, status: "SUCCESSFUL",
        reversalLedgerEntryId: null, reversalTransactionId: null },
      { $inc: { "providerResponse.profitSharingFence": 1 } }, { session });
      if (txFence.modifiedCount !== 1) fail("TRANSACTION_CHANGED");
      for (const entry of entries.sort((a, b) => a.accountId.localeCompare(b.accountId))) {
        await engine.updateAccount(entry.accountId, entry.amountKobo, false, session);
      }
      await M.Event.create([{ _id: key, kind: "ACCRUAL", transaction: tx._id,
        data: { plan, entries, financialEvidenceId: evidence._id, evidenceDigest: sha(proof), at: now() } }], { session });
      await N.Audit.create([{ action: "COMPANY_PROFIT_SETTLED",
        metadata: { eventId: key, transaction: String(tx._id), ruleId: rule.id,
          evidenceId: evidence._id, amountKobo: pool } }], { session });
      return { status: "SETTLED", eventId: key, amountKobo: pool };
    });
  }
  return { read, save: (actor, body) => change(actor, body, true),
    activate: (actor, body) => change(actor, body, false), settle };
}
module.exports = { createCompany, ownsTransaction, ID };
