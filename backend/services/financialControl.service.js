const mongoose = require("mongoose");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const Audit = require("../models/adminAuditLog.model");
const r = require("./financialControl.rules");
const MAX = 10000;
const EXPENSE = "FINANCIAL_EXPENSE_RECORDED";
const CLAIM = "FINANCIAL_EXPENSE_DEDUP";
const COVERAGE = [
  ["Wallet", "ledgerEntry", "Wallet movements are custody, not company revenue. Match debit/reversal ledger evidence separately."],
  ["SP Transfers", "bankTransfer", "Principal and customer debit are not earned fees. Fee, provider payout and reversal evidence must be correlated."],
  ["Delivery and Logistics", "delivery", "Paid/completed delivery and immutable rider/branch splits must reconcile with canonical payment references."],
  ["Interstate Logistics", "interstateShipment", "Separate interstate pricing; shipment lifecycle is non-additive with its payment transaction."],
  ["Marketplace", "marketplaceOrder", "Order value and held customer funds are not platform commission. Merchant settlement remains a separate obligation."],
  ["Solar", "solarFinance", "Financing principal and outstanding schedules are not revenue."],
  ["Solar Repayments", "solarPayment", "Repayments are not automatically earned interest or platform fees."],
  ["Empowerment Funding", "empowermentFunding", "Funding is an obligation/pass-through, not platform revenue."],
  ["Empowerment Disbursements", "empowermentDisbursement", "Disbursement principal is not revenue. Only separately authorized fees may qualify."],
  ["Amana", "amanaOrder", "Customer funds/vendor costs need request-level funding, payment and fulfillment reconciliation."],
  ["Amana Funding", "amanaFundingRecord", "Funding records are non-additive with customer transactions and do not establish platform fees."],
  ["EduPay", "edupayContribution", "Contributions are school/customer custody, not company revenue."],
  ["EduPay Settlement", "edupaySettlement", "Settlement lifecycle and provider evidence must be matched to earned commission."],
  ["EduPay Commission", "edupayCommission", "Receivable, withheld and reversed commissions require settlement linkage; never sum all three as earnings."],
  ["Organization", "organizationPayment", "Membership/organization money is tenant custody; no platform fee inferred from payment value."],
  ["Organization Ledger", "organizationLedger", "Ledger custody is non-additive with organization payments and wallet balances."],
  ["Referral Commissions", "commission", "Actual beneficiary commissions are direct costs only once; reversed/cancelled commissions are excluded."],
  ["Withdrawals and Settlements", "withdrawalRequest", "Pending withdrawal status is not proof of provider settlement or a company expense."],
];
const COLLECTIONS = ["ledgerentries", "banktransfers", "deliveries", "interstateshipments", "marketplaceorders",
  "solarfinances", "solarpayments", "empowermentfundings", "empowermentdisbursements", "amanaorders",
  "amanafundingrecords", "edupaycontributions", "edupaysettlements", "edupaycommissions",
  "organizationpayments", "organizationledgers", "commissions", "withdrawalrequests"];
const projection = ["reference", "customerId", "serviceType", "provider", "amount", "status", "createdAt", "branchId",
  "providerRequestId", "providerEvidenceCorrelated", "providerEvidenceOutcome", "providerResponse", "hierarchyCapturedAt",
  "agentCommission", "stateManagerCommission", "zonalManagerCommission",
  "reversalReference", "reversalTransactionId", "reversedTransactionId", "debitLedgerEntryId", "reversalLedgerEntryId"].join(" ");
const publicExpense = doc => {
  const e = doc.metadata.financialExpense;
  return { id: String(doc._id), ...e, recordedBy: String(doc.actorId),
    supportingDocument: e.supportingDocument ? {
      name: e.supportingDocument.name, type: e.supportingDocument.type, size: e.supportingDocument.size } : null };
};
async function expenses(query) {
  const f = r.filters(query);
  const docs = await Audit.find({ action: EXPENSE, "metadata.financialExpense.date": { $gte: f.from, $lte: f.to } })
    .select("actorId metadata.financialExpense createdAt").sort({ createdAt: -1 }).limit(MAX + 1).maxTimeMS(10000).lean();
  if (docs.length > MAX) throw r.fail("Too many expenses; narrow the date range.", 422);
  const items = docs.map(publicExpense);
  return { items, totalRecorded: r.sum(items, "amount"), status: "PARTIALLY_RECONCILED",
    coverage: "Expense entries are recorded costs, not an attestation that all period expenses have been supplied." };
}
async function recordExpense(input, actor) {
  const normalized = r.expense(input);
  const existing = await Audit.findOne({ _id: normalized.id }).lean();
  if (existing) {
    if (existing.action !== EXPENSE || existing.metadata?.payloadHash !== normalized.payloadHash) {
      throw r.fail("This expense reference already exists with different details.", 409);
    }
    return { item: publicExpense(existing), idempotent: true };
  }
  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const base = { actorId: actor._id, actorRole: actor.role, reason: "Independent operating expense recorded; no payment initiated.",
        status: "SUCCESSFUL" };
      // Both deduplication keys use the EXISTING audit collection's _id index.
      // The two immutable events commit together; no collection/index migration.
      await Audit.create([{ ...base, _id: normalized.claimId, action: CLAIM,
        metadata: { financialExpenseClaim: true, fingerprint: normalized.fingerprint, expenseId: normalized.id } }], { session });
      [created] = await Audit.create([{ ...base, _id: normalized.id, action: EXPENSE,
        metadata: { financialExpense: normalized.value, payloadHash: normalized.payloadHash } }], { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      const prior = await Audit.findOne({ _id: normalized.id }).lean();
      if (prior?.action === EXPENSE && prior.metadata?.payloadHash === normalized.payloadHash) {
        return { item: publicExpense(prior), idempotent: true };
      }
      throw r.fail("A matching expense has already been recorded. No duplicate was created.", 409);
    }
    throw error;
  } finally { await session.endSession(); }
  return { item: publicExpense(created.toObject()), idempotent: false };
}
async function document(id) {
  if (!/^[a-f0-9]{24}$/i.test(id)) throw r.fail("Invalid expense ID.");
  const row = await Audit.findOne({ _id: id, action: EXPENSE }).lean();
  const doc = row?.metadata?.financialExpense?.supportingDocument;
  if (!doc) throw r.fail("No supporting document is recorded.", 404);
  return doc;
}
async function sources(f) {
  const result = [];
  let namespaces;
  try {
    namespaces = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name));
  } catch (_) { namespaces = null; }
  for (let i = 0; i < COVERAGE.length; i += 4) {
    result.push(...await Promise.all(COVERAGE.slice(i, i + 4).map(async ([service, file, note], offset) => {
      const collection = COLLECTIONS[i + offset];
      if (!namespaces?.has(collection)) return { service, source: collection, status: "DATA UNAVAILABLE",
        count: null, note: note + " Source namespace existence could not be verified; this is not a zero balance." };
      const filter = { createdAt: r.dateMatch(f) };
      if (f.branch) {
        return { service, source: collection, status: "NOT RECONCILED", count: null,
          note: note + " Cross-source historical branch attribution has not been reconciled." };
      }
      try {
        // Native reads never import/initialize models or create namespaces/indexes.
        const count = await mongoose.connection.db.collection(collection).countDocuments(filter, { maxTimeMS: 5000 });
        return { service, source: collection, count,
          status: count ? "NOT RECONCILED" : "NO_RECORDS", note };
      } catch (_) {
        return { service, source: collection, count: null, status: "DATA UNAVAILABLE", note };
      }
    })));
  }
  return result;
}
async function load(query) {
  const f = r.filters(query);
  const match = { createdAt: r.dateMatch(f) };
  if (f.service) match.serviceType = f.service;
  if (f.branch) match.branchId = f.branch;
  if (f.branch) match.hierarchyCapturedAt = { $type: "date" };
  const docs = await Transaction.find(match).select(projection).sort({ createdAt: -1, _id: -1 })
    .limit(MAX + 1).maxTimeMS(10000).lean();
  if (docs.length > MAX) throw r.fail("Report exceeds 10,000 transactions. Narrow the period or filters.", 422);
  const ids = docs.map(d => d._id);
  const commissions = await Commission.find({ transactionId: { $in: ids },
    beneficiaryRole: { $ne: "HEAD_OFFICE" }, status: { $nin: ["FAILED", "REVERSED", "CANCELLED"] } })
    .select("transactionId commissionAmount").limit(MAX * 10 + 1).maxTimeMS(10000).lean();
  if (commissions.length > MAX * 10) throw r.fail("Commission coverage exceeds the report bound.", 422);
  const bill = require("./revenueAccountingRules");
  const commissionMap = new Map();
  for (const c of commissions) {
    const amount = bill.positive(c.commissionAmount);
    if (amount === null) throw r.fail("Invalid recorded commission. Financial review is required.", 422);
    const id = String(c.transactionId);
    commissionMap.set(id, (commissionMap.get(id) || 0) + amount);
  }
  const refs = new Map(), requestIds = new Map();
  for (const t of docs) {
    if (t.reference) refs.set(t.reference, (refs.get(t.reference) || 0) + 1);
    if (t.providerRequestId) {
      const key = [t.provider, t.serviceType, t.providerRequestId].join(":");
      requestIds.set(key, (requestIds.get(key) || 0) + 1);
    }
  }
  const all = docs.map(t => {
    const row = r.transaction(t, commissionMap.get(String(t._id)) ?? null);
    const duplicated = refs.get(t.reference) > 1 ||
      (t.providerRequestId && requestIds.get([t.provider, t.serviceType, t.providerRequestId].join(":")) > 1);
    if (duplicated) Object.assign(row, { reason: "DUPLICATE_FINANCIAL_REFERENCE", transactionValue: 0,
      recordedRevenue: null, providerCosts: null, grossProfit: null });
    return row;
  });
  const selected = f.network ? all.filter(row => row.network.toUpperCase() === r.reportNetwork(f.network).toUpperCase()) : all;
  const selectedIds = new Set(selected.map(row => row.id));
  const selectedDocs = docs.filter(doc => selectedIds.has(String(doc._id)));
  const docMap = new Map(selectedDocs.map(doc => [String(doc._id), doc]));
  const ledgerIds = selectedDocs.flatMap(t => [t.debitLedgerEntryId, t.reversalLedgerEntryId])
    .filter(id => mongoose.isValidObjectId(id)).map(id => new mongoose.Types.ObjectId(String(id)));
  const ledgers = ledgerIds.length ? await mongoose.connection.db.collection("ledgerentries").find(
    { _id: { $in: ledgerIds } }, { projection: { amount: 1, direction: 1 }, maxTimeMS: 5000 }).toArray() : [];
  const ledgerMap = new Map(ledgers.map(entry => [String(entry._id), entry]));
  for (const row of selected) {
    const t = docMap.get(row.id);
    row.diagnostics = [];
    if (t.debitLedgerEntryId && !ledgerMap.has(String(t.debitLedgerEntryId))) row.diagnostics.push("MISSING_DEBIT_LEDGER_LINK");
    if (row.refunded) {
      const reversal = ledgerMap.get(String(t.reversalLedgerEntryId));
      if (!reversal) row.diagnostics.push("REFUND_EVIDENCE_UNAVAILABLE");
      else {
        const debit = ledgerMap.get(String(t.debitLedgerEntryId));
        if (debit && bill.money(debit.amount) !== bill.money(reversal.amount)) row.diagnostics.push("REFUND_AMOUNT_REQUIRES_REVIEW");
      }
      if (r.SUCCESS.has(row.status)) row.diagnostics.push("SUCCESS_WITH_REVERSAL_LINK");
    }
    const p = t.providerResponse || {};
    if (row.pending && ((p.telecomAbodeSettlement?.outcome === "SUCCESS" && p.telecomAbodeSettlement?.requestIdMatches === true) ||
      (t.providerEvidenceCorrelated === true && t.providerEvidenceOutcome === "SUCCESS"))) {
      row.diagnostics.push("PROVIDER_SUCCESS_WITH_NON_SUCCESS_TRANSACTION");
    }
  }
  return { f, rows: selected };
}
const methodology = [
  "Transaction value uses eligible successful canonical Transaction records only. Funding, principal, referral payouts and ambiguous paired SP transfers are excluded, not treated as sales.",
  "Recorded revenue is the KNOWN earned fee/margin subtotal. Missing-source earnings are not invented; coverage and unreconciled counts must accompany it.",
  "For confirmed bill purchases, recorded revenue is customer price minus the immutable historical provider cost. Provider cost is shown separately and is NOT deducted again.",
  "Gross profit deducts recorded non-company commissions and separately evidenced provider/processing/other direct costs from earned margins. Missing direct-cost evidence makes profit unavailable.",
  "Other service lifecycles and payment/settlement/commission records are non-additive. They remain unrecognized until stable payment joins and earning/reversal evidence are reconciled.",
  "No catalogue price, current manager assignment, wallet deposit, financing principal or order value is substituted for historical earnings or cost.",
  "Branch financial attribution uses explicit captured branch custody only. Legacy unverified attribution is excluded from branch-filtered summaries.",
  "Expense totals are independently recorded expenses only; no complete-period expense attestation exists. Net profit and total outstanding settlement obligations remain DATA UNAVAILABLE.",
  "All dates use Africa/Lagos calendar days. No report mutates wallet balances, provider outcomes, settlements or transaction statuses.",
];
function trend(rows, mode) {
  const key = row => {
    if (mode === "monthly") return row.date.slice(0, 7);
    if (mode === "daily") return row.date;
    const date = new Date(row.date + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
  };
  return [...new Set(rows.map(key))].sort().map(date => {
    const selected = rows.filter(row => key(row) === date);
    return { date, revenue: selected.some(row => row.recordedRevenue !== null) ? r.totals(selected).recordedRevenue : null,
      partial: selected.some(row => row.recordedRevenue === null) };
  });
}
async function summary(query) {
  const { f, rows } = await load(query);
  const span = new Date(f.to + "T12:00:00Z") - new Date(f.from + "T12:00:00Z") + 86400000;
  const priorFrom = new Date(new Date(f.from + "T12:00:00Z").getTime() - span).toISOString().slice(0, 10);
  const priorTo = new Date(new Date(f.from + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const [expenseData, coverage, prior] = await Promise.all([expenses({ from: f.from, to: f.to }), sources(f),
    load({ ...f, from: priorFrom, to: priorTo })]);
  const reasons = [...new Set(rows.map(row => row.reason))].filter(x => !["RECORDED", "NOT_EARNED"].includes(x));
  const issues = reasons.map(code => ({ code, count: rows.filter(row => row.reason === code).length,
    note: "Review source evidence; this report does not alter records or settle transactions." }));
  for (const code of new Set(rows.flatMap(row => row.diagnostics))) {
    issues.push({ code, count: rows.filter(row => row.diagnostics.includes(code)).length,
      note: "Read-only discrepancy detection. Missing legacy links do not prove that funds remain held or that a refund is owed." });
  }
  issues.push({ code: "EXPENSE_COVERAGE_UNATTESTED", count: null, note: "Recorded expenses are not proof that all period expenses are supplied." },
    { code: "SETTLEMENT_LINKAGE_UNRECONCILED", count: null, note: "Outstanding obligations require source-specific custody evidence; no aggregate is fabricated." },
    { code: "LIFECYCLE_SOURCES_NON_ADDITIVE", count: coverage.filter(c => c.count > 0).length,
      note: "Lifecycle counts below are coverage diagnostics, not additional revenue." });
  const totals = r.totals(rows, f.service || f.network || f.branch ? null : expenseData.totalRecorded);
  const previousRevenue = r.totals(prior.rows).recordedRevenue;
  const types = [...new Set([...Transaction.schema.path("serviceType").enumValues, ...rows.map(x => x.service)])];
  const services = types.map(service => ({ service, count: rows.filter(row => row.service === service).length,
    ...r.totals(rows.filter(row => row.service === service)) }));
  const unavailable = rows.length && !rows.some(row => row.recordedRevenue !== null && row.confirmed);
  return { period: { from: f.from, to: f.to, timezone: "Africa/Lagos" }, generatedAt: new Date().toISOString(), currency: "NGN",
    totals, reconciliation: { status: unavailable ? "NOT RECONCILED" : "PARTIALLY RECONCILED", issues },
    services, networks: r.grouped(rows, "network"), branches: r.grouped(rows, "branch"), plans: r.planRows(rows),
    trends: { daily: trend(rows, "daily"), weekly: trend(rows, "weekly"), monthly: trend(rows, "monthly") },
    growth: { percent: previousRevenue > 0 ? Math.round((totals.recordedRevenue - previousRevenue) / previousRevenue * 10000) / 100 : null,
      note: "Known recorded margins/fees only, compared with the immediately preceding equal-length period. This is not complete company-wide revenue growth. A zero/missing prior baseline has no percentage." },
    sourceCoverage: coverage, filters: { services: types, networks: [...new Set(rows.map(x => x.network))],
      branches: [...new Set(rows.map(x => x.branch))].filter(x => x !== "UNATTRIBUTED") },
    methodology, transactionRows: rows };
}
module.exports = { summary, load, expenses, recordExpense, document, sources, methodology, COVERAGE, EXPENSE, CLAIM };
