"use strict";
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const Models = require("../models/profitSharing.models");
const Network = require("../models/businessNetwork.models");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Commission = require("../models/commission.model");
const Policy = require("./profitSharing.policy");
const Adapters = require("./profitSharing.adapters");
const { SERVICES } = require("./profitSharing.settings");
const CONTROL_ID = "profit-sharing-engine";
const fail = (code, statusCode = 409) => { throw Object.assign(new Error(code), { code, statusCode }); };
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const kobo = amount => {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 ||
      !Number.isSafeInteger(Math.round(amount * 100))) fail("EXACT_KOBO_AMOUNT_REQUIRED");
  return Math.round(amount * 100);
};
const ruleAt = (doc, service, at) => {
  const versions = doc?.profitSharing?.services?.[service]?.versions || [];
  return versions.filter(v => new Date(v.effectiveAt) <= at)
    .sort((a, b) => new Date(b.effectiveAt) - new Date(a.effectiveAt) ||
      new Date(b.createdAt) - new Date(a.createdAt))[0];
};
const immutableId = tx => String(tx._id);
function createEngine({
  M = Models, N = Network, transactionModel = Transaction, userModel = User,
  commissionModel = Commission, adapters = Adapters.adapters,
  startSession = () => mongoose.startSession(), now = () => new Date(),
  withdrawalReadiness = require("./withdrawalIndexReadiness.service").getWithdrawalIndexReadiness,
} = {}) {
  async function atomic(fn, existingSession) {
    if (existingSession) {
      if (!existingSession.inTransaction()) fail("ACTIVE_DATABASE_TRANSACTION_REQUIRED");
      return fn(existingSession);
    }
    // New accounts and deterministic event keys may race on their _id index.
    // Retry the whole aborted transaction, never just an individual credit.
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = await startSession();
      try { let result; await session.withTransaction(async () => { result = await fn(session); }); return result; }
      catch (error) { if (error.code !== 11000 || attempt === 4) throw error; }
      finally { await session.endSession(); }
    }
  }
  async function storageBlockers() {
    const result = [];
    for (const model of [M.Admission, M.Event, M.Account, N.Settings, N.Audit]) {
      if (!await model.db.db.listCollections({ name: model.collection.name }, { nameOnly: true }).hasNext()) {
        result.push(`STORAGE_REQUIRED:${model.collection.name}`); continue;
      }
      const indexes = await model.collection.indexes();
      if (!indexes.some(i => i.name === "_id_" && i.key?._id === 1 && !i.partialFilterExpression)) {
        result.push(`ID_SAFEGUARD_REQUIRED:${model.collection.name}`);
      }
    }
    return result;
  }
  async function readiness(services = SERVICES) {
    if (!Array.isArray(services) || !services.length || services.some(s => !SERVICES.includes(s)) ||
        new Set(services).size !== services.length) fail("INVALID_SERVICES", 400);
    const settings = await N.Settings.findById("profit-sharing").lean();
    const storage = await storageBlockers();
    try {
      if (!(await withdrawalReadiness()).ready) storage.push("COMMISSION_WITHDRAWAL_UNIQUE_SAFEGUARDS_REQUIRED");
    } catch (_) { storage.push("COMMISSION_WITHDRAWAL_UNIQUE_SAFEGUARDS_REQUIRED"); }
    return {
      ready: storage.length === 0 && services.every(service => {
        const rule = ruleAt(settings, service, now());
        try { Policy.validateDistributionRule(rule); } catch { return false; }
        return rule.enabled && Adapters.blockers(adapters[service]).length === 0;
      }),
      storageBlockers: storage,
      services: services.map(service => {
        const rule = ruleAt(settings, service, now());
        const blockers = [...Adapters.blockers(adapters[service])];
        try { Policy.percentageBasisPoints(rule?.percentages); }
        catch { blockers.push("VALID_100_PERCENT_RULE_REQUIRED"); }
        try { Policy.validateDistributionRule(rule); }
        catch (error) { blockers.push(error.code); }
        if (rule?.enabled !== true) blockers.push("EFFECTIVE_ENABLED_RULE_REQUIRED");
        return { serviceType: service, ruleId: rule?.id || null,
          ready: storage.length === 0 && blockers.length === 0, blockers };
      }),
    };
  }
  async function status() {
    const control = await N.Settings.findById(CONTROL_ID).lean();
    const selected = control?.profitSharing?.services;
    // Always expose every service's blockers so a Head Office administrator can
    // prepare another service without hiding or implicitly activating it.
    const ready = await readiness(SERVICES);
    if (control?.profitSharing?.mode === "LIVE") {
      for (const service of ready.services) {
        if (selected?.includes(service.serviceType) &&
            service.ruleId !== control.profitSharing.ruleIds?.[service.serviceType]) {
          service.blockers.push("ACTIVATION_RULE_CHANGED"); ready.ready = false;
        }
      }
    }
    const configuredLive = control?.profitSharing?.mode === "LIVE";
    const services = ready.services.map(service => {
      const enabled = configuredLive && selected?.includes(service.serviceType) === true;
      const serviceReady = ready.storageBlockers.length === 0 && service.blockers.length === 0;
      return { ...service, ready: serviceReady, enabled, live: enabled && serviceReady };
    });
    // A blocked service must not hide or stop another independently ready one.
    // LIVE means at least one activated service is actually ready, not that all
    // supported services (including those never configured) are enabled.
    const activeServices = services.filter(service => service.live).map(service => service.serviceType);
    const activeReady = activeServices.length > 0;
    return { ...ready, mode: configuredLive && activeReady ? "LIVE" : configuredLive ? "BLOCKED" :
      control?.profitSharing?.mode || "PAUSED", distributionLive: configuredLive && activeReady,
    services, activeServices, configuredServices: configuredLive ? selected || [] : [],
    revision: control?.revision || 0 };
  }
  async function beneficiaries(tx, session) {
    // Transaction snapshots, not today's customer assignment, are authority.
    if (!tx.hierarchyCapturedAt) fail("VERIFIED_ADMISSION_HIERARCHY_REQUIRED");
    const result = { HEAD_OFFICE: { kind: "COMPANY", eligible: true } };
    const ids = { AGGREGATOR: tx.agentId, STATE_MANAGER: tx.stateManagerId, ZONAL_MANAGER: tx.zonalManagerId };
    for (const [role, value] of Object.entries(ids)) {
      const user = value && await userModel.findById(value).session(session).lean();
      result[role] = { id: value ? String(value) : null, eligible: !!user &&
        user.status === "ACTIVE" && user.isDeleted !== true && user.role === (role === "AGGREGATOR" ? "AGENT" : role) };
    }
    return result;
  }
  async function inspect(tx, rule, hierarchy, session) {
    const adapter = adapters[tx.serviceType];
    if (Adapters.blockers(adapter).length) fail("VERIFIED_SERVICE_ADAPTER_REQUIRED", 503);
    const proof = await adapter.inspect(tx, { session });
    if (!proof || proof.transactionId !== String(tx._id) || proof.reference !== tx.reference ||
        proof.provider !== tx.provider || proof.serviceType !== tx.serviceType) fail("UNBOUND_SETTLEMENT_EVIDENCE");
    const plan = Policy.plan({ transaction: { id: String(tx._id), reference: tx.reference,
      serviceType: tx.serviceType, createdAt: tx.createdAt, amountKobo: kobo(tx.amount),
      status: tx.status, settlementVerified: proof.settlementVerified === true,
      reversed: tx.status === "REFUNDED" || !!(tx.reversalLedgerEntryId ||
        tx.reversalTransactionId || tx.reversalReference) }, rule, costs: proof.costs, beneficiaries: hierarchy });
    return { ...plan, ...(plan.eligible ? { costs: {
      customerAmountKobo: proof.costs.customerAmountKobo,
      revenueKobo: proof.costs.revenueKobo,
      providerCostKobo: proof.costs.providerCostKobo,
      directCostsKobo: proof.costs.directCostsKobo,
      otherApprovedCostsKobo: proof.costs.otherApprovedCostsKobo,
      evidenceReference: proof.costs.evidenceReference,
      otherCostsApprovalReference: proof.costs.otherCostsApprovalReference || null,
    } } : {}) };
  }
  async function dryRun(actor, transactionId) {
    if (!actor?._id) fail("ADMIN_REQUIRED", 403);
    if ((await storageBlockers()).length) fail("STORAGE_NOT_READY", 503);
    return atomic(async session => {
      const tx = await transactionModel.findById(transactionId).session(session).lean();
      if (!tx) fail("TRANSACTION_NOT_FOUND", 404);
      const settings = await N.Settings.findById("profit-sharing").session(session).lean();
      const rule = ruleAt(settings, tx.serviceType, new Date(tx.createdAt));
      const hierarchy = await beneficiaries(tx, session);
      const plan = await inspect(tx, rule, hierarchy, session);
      const id = `dry-run:${crypto.randomUUID()}`;
      const data = { plan, serviceType: tx.serviceType, ruleId: rule?.id,
        adapterVersion: adapters[tx.serviceType].version, actorId: String(actor._id), at: now().toISOString() };
      await M.Event.create([{ _id: id, kind: "DRY_RUN", transaction: tx._id, data }], { session });
      await N.Audit.create([{ actor: actor._id, action: "PROFIT_SHARING_DRY_RUN",
        metadata: { eventId: id, transaction: String(tx._id), eligible: plan.eligible } }], { session });
      return { id, ...data, financialWrites: 0 };
    });
  }
  async function changeMode(actor, body) {
    if (!actor?._id) fail("ADMIN_REQUIRED", 403);
    if (!["LIVE", "PAUSED"].includes(body?.mode) || body.confirmation !== true ||
        typeof body.reason !== "string" || body.reason.trim().length < 10 || body.reason.length > 500 ||
        !Number.isSafeInteger(body.revision) || body.revision < 0) fail("INVALID_ACTIVATION_CONFIRMATION", 400);
    const scoped = body.serviceAction !== undefined;
    if (scoped && (!["ENABLE", "DISABLE"].includes(body.serviceAction) ||
        !Array.isArray(body.services) || body.services.length !== 1 ||
        !SERVICES.includes(body.services[0]) ||
        body.mode !== (body.serviceAction === "ENABLE" ? "LIVE" : "PAUSED"))) {
      fail("INVALID_SERVICE_ACTIVATION", 400);
    }
    // An emergency pause must remain possible when optional custody storage
    // fails. Its settings and audit writes still commit atomically or not at all.
    if (body.mode === "LIVE" && (await storageBlockers()).length) fail("STORAGE_NOT_READY", 503);
    return atomic(async session => {
      const control = await N.Settings.findById(CONTROL_ID).session(session).lean();
      if ((control?.revision || 0) !== body.revision) fail("ACTIVATION_REVISION_CHANGED");
      const oldControl = control?.profitSharing;
      const previousServices = oldControl?.mode === "LIVE" ? oldControl.services || [] : [];
      let services = [...previousServices];
      let ruleIds = { ...(oldControl?.ruleIds || {}) };
      // Preserve admission cutoffs for already enabled services when another
      // service is enabled or disabled. Never reset their future-only boundary.
      let serviceActivations = Object.fromEntries(previousServices.map(service => [
        service, oldControl?.serviceActivations?.[service] || {
          activatedAt: oldControl.activatedAt, activationId: oldControl.activationId,
          actorId: oldControl.actorId,
        },
      ]));
      const activatedAt = now(), activationId = crypto.randomUUID();
      if (body.mode === "LIVE") {
        const check = await readiness(body.services);
        if (!check.ready) fail("ACTIVATION_PREREQUISITES_INCOMPLETE");
        services = scoped ? [...new Set([...previousServices, ...body.services])] : [...body.services];
        if (body.confirmationText !== "ACTIVATE FUTURE PROFIT SHARING") fail("ACTIVATION_PHRASE_REQUIRED", 400);
        const selectedRuleIds = Object.fromEntries(check.services.map(s => [s.serviceType, s.ruleId]));
        ruleIds = scoped ? { ...ruleIds, ...selectedRuleIds } : selectedRuleIds;
        if (!scoped) serviceActivations = {};
        // Fence percentage edits and concurrent activation/admission operations.
        const settings = await N.Settings.findById("profit-sharing").session(session).lean();
        for (const service of body.services) {
          const rule = ruleAt(settings, service, now());
          if (!rule?.enabled || rule.id !== ruleIds[service]) fail("RULE_CHANGED_DURING_ACTIVATION");
          Policy.validateDistributionRule(rule);
          const receipt = await M.Event.findOne({ _id: body.dryRunIds?.[service], kind: "DRY_RUN" }).session(session).lean();
          if (!receipt?.data.plan?.eligible || receipt.data.serviceType !== service ||
              receipt.data.ruleId !== rule.id || receipt.data.adapterVersion !== adapters[service].version ||
              receipt.data.actorId !== String(actor._id) || new Date(receipt.data.at) < new Date(now().getTime() - 86400000)) {
            fail("FRESH_MATCHING_DRY_RUN_REQUIRED");
          }
          serviceActivations[service] = { activatedAt, activationId, actorId: String(actor._id) };
        }
        const fenced = await N.Settings.updateOne({ _id: "profit-sharing", revision: settings.revision },
          { $inc: { loyaltyFence: 1 } }, { session });
        if (fenced.modifiedCount !== 1) fail("RULE_CHANGED_DURING_ACTIVATION");
      } else if (scoped) {
        const selected = body.services[0];
        services = services.filter(service => service !== selected);
        delete ruleIds[selected];
        delete serviceActivations[selected];
      } else {
        services = [];
        ruleIds = {};
        serviceActivations = {};
      }
      const mode = body.mode === "LIVE" || (scoped && services.length) ? "LIVE" : "PAUSED";
      const value = { mode, services, ruleIds, serviceActivations, activatedAt,
        activationId, actorId: String(actor._id) };
      if (control) {
        const changed = await N.Settings.updateOne({ _id: CONTROL_ID, revision: body.revision },
          { $set: { profitSharing: value }, $inc: { revision: 1 } }, { session });
        if (changed.modifiedCount !== 1) fail("ACTIVATION_REVISION_CHANGED");
      } else await N.Settings.create([{ _id: CONTROL_ID, revision: 1, profitSharing: value }], { session });
      await N.Audit.create([{ actor: actor._id, action: "PROFIT_SHARING_MODE_CHANGED",
        reason: body.reason.trim(), metadata: { ...value, revision: body.revision + 1 } }], { session });
      return { mode, activeServices: services, revision: body.revision + 1,
        ...(scoped ? { serviceAction: body.serviceAction, serviceType: body.services[0] } : {}),
        productionPayoutsTriggered: false };
    });
  }
  async function admit(transactionId, session) {
    // Must be called inside each service's reviewed wallet-admission transaction,
    // before dispatch and before any legacy commission writer. No HTTP endpoint.
    if (!session?.inTransaction()) fail("ACTIVE_DATABASE_TRANSACTION_REQUIRED");
    const existing = await M.Admission.findById(String(transactionId)).session(session).lean();
    if (existing) return existing;
    const control = await N.Settings.findById(CONTROL_ID).session(session).lean();
    if (control?.profitSharing?.mode !== "LIVE") return null;
    const tx = await transactionModel.findById(transactionId).session(session).lean();
    if (!tx || !control.profitSharing.services.includes(tx.serviceType)) return null;
    const activation = control.profitSharing.serviceActivations?.[tx.serviceType] || control.profitSharing;
    if (!activation.activatedAt || !activation.activationId) fail("SERVICE_ACTIVATION_EVIDENCE_REQUIRED");
    if (new Date(tx.createdAt) < new Date(activation.activatedAt)) return null;
    if (tx.status !== "PENDING") fail("ADMISSION_REQUIRES_NEW_PENDING_TRANSACTION");
    if (Adapters.blockers(adapters[tx.serviceType]).length) fail("VERIFIED_SERVICE_ADAPTER_REQUIRED", 503);
    const settings = await N.Settings.findById("profit-sharing").session(session).lean();
    const rule = ruleAt(settings, tx.serviceType, new Date(tx.createdAt));
    if (!rule?.enabled || rule.id !== control.profitSharing.ruleIds[tx.serviceType]) fail("ACTIVATION_RULE_CHANGED");
    Policy.validateDistributionRule(rule);
    const hierarchy = await beneficiaries(tx, session);
    const data = { _id: String(tx._id), transaction: tx._id, reference: tx.reference,
      serviceType: tx.serviceType, amountKobo: kobo(tx.amount), rule, beneficiaries: hierarchy,
      adapterVersion: adapters[tx.serviceType].version, admittedAt: now(),
      activationId: activation.activationId };
    const controlFence = await N.Settings.updateOne({ _id: CONTROL_ID, revision: control.revision },
      { $inc: { loyaltyFence: 1 } }, { session });
    const ruleFence = await N.Settings.updateOne({ _id: "profit-sharing", revision: settings.revision },
      { $inc: { loyaltyFence: 1 } }, { session });
    if (controlFence.modifiedCount !== 1 || ruleFence.modifiedCount !== 1) fail("ADMISSION_CONFIGURATION_CHANGED");
    await M.Admission.create([data], { session });
    const marked = await transactionModel.updateOne({ _id: tx._id, status: "PENDING" },
      { $set: { "providerResponse.profitSharingAdmissionId": data._id } }, { session });
    if (marked.modifiedCount !== 1) fail("ADMISSION_TRANSACTION_CHANGED");
    await N.Audit.create([{ action: "PROFIT_SHARING_ADMITTED",
      metadata: { transaction: String(tx._id), ruleId: rule.id, activationId: data.activationId } }], { session });
    return data;
  }
  async function updateAccount(id, delta, reversal, session) {
    if (!delta) return;
    const old = await M.Account.findById(id).session(session).lean();
    const available = old?.availableKobo || 0, debt = old?.recoveryDebtKobo || 0;
    const offset = Math.min(delta, reversal ? available : debt);
    const next = {
      availableKobo: reversal ? available - offset : available + delta - offset,
      recoveryDebtKobo: reversal ? debt + delta - offset : debt - offset,
      earnedKobo: (old?.earnedKobo || 0) + (reversal ? 0 : delta),
      reversedKobo: (old?.reversedKobo || 0) + (reversal ? delta : 0),
      revision: (old?.revision || 0) + 1,
    };
    if (Object.values(next).some(v => !Number.isSafeInteger(v) || v < 0)) fail("ACCOUNT_PRECISION_OVERFLOW");
    if (old) {
      const result = await M.Account.updateOne({ _id: id, revision: old.revision }, { $set: next }, { session, runValidators: true });
      if (result.modifiedCount !== 1) fail("COMMISSION_ACCOUNT_CHANGED");
    } else await M.Account.create([{ _id: id, ...next }], { session });
  }
  async function settle(transactionId) {
    return atomic(async session => {
      const admission = await M.Admission.findById(String(transactionId)).session(session).lean();
      if (!admission) return { status: "NOT_ADMITTED" };
      const key = `accrual:${transactionId}`;
      const previous = await M.Event.findById(key).session(session).lean();
      if (previous) return { status: "ALREADY_SETTLED", eventId: key };
      const tx = await transactionModel.findById(transactionId).session(session).lean();
      if (!tx || tx.status !== "SUCCESSFUL") return { status: "NOT_SUCCESSFUL" };
      if (tx.reference !== admission.reference || kobo(tx.amount) !== admission.amountKobo ||
          tx.serviceType !== admission.serviceType || adapters[tx.serviceType]?.version !== admission.adapterVersion) {
        fail("ADMISSION_SOURCE_CHANGED");
      }
      // An existing earning in either previous system blocks, never offsets or
      // deletes legacy commissions. All reviewed adapters must exclude them.
      if (await commissionModel.exists({ transactionId: tx._id }).session(session) ||
          await N.Ledger.exists({ transaction: tx._id }).session(session)) fail("LEGACY_COMMISSION_CONFLICT");
      const plan = await inspect(tx, admission.rule, admission.beneficiaries, session);
      if (!plan.eligible) return { status: "NOT_ELIGIBLE", reason: plan.reason };
      // Write fence shares the payment/refund document: concurrent refunds
      // cannot race a successful credit into an orphaned commission.
      if (tx.providerResponse?.profitSharingAdmissionId !== admission._id) fail("ADMISSION_MARKER_MISSING");
      const fenced = await transactionModel.updateOne({ _id: tx._id, status: "SUCCESSFUL",
        reversalLedgerEntryId: tx.reversalLedgerEntryId ?? null,
        reversalTransactionId: tx.reversalTransactionId ?? null },
      { $inc: { "providerResponse.profitSharingFence": 1 } }, { session });
      if (fenced.modifiedCount !== 1) fail("TRANSACTION_CHANGED");
      const entries = plan.allocations.filter(a => a.custody === "BENEFICIARY" && a.amountKobo > 0)
        .map(a => ({ accountId: `beneficiary:${a.beneficiaryId}`, role: a.role, amountKobo: a.amountKobo }));
      if (plan.headOfficeKobo) entries.push({ accountId: "head-office",
        role: "HEAD_OFFICE", amountKobo: plan.headOfficeKobo });
      // Missing hierarchy shares and rounding are not additional Head Office
      // earnings and must never be redistributed to another beneficiary.
      if (plan.unallocatedKobo) entries.push({ accountId: "unallocated-commission",
        role: "UNALLOCATED_COMMISSION", amountKobo: plan.unallocatedKobo });
      if (plan.roundingKobo) entries.push({ accountId: "commission-rounding",
        role: "COMMISSION_ROUNDING", amountKobo: plan.roundingKobo });
      for (const row of [...entries].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
        await updateAccount(row.accountId, row.amountKobo, false, session);
      }
      await M.Event.create([{ _id: key, kind: "ACCRUAL", transaction: tx._id,
        admissionId: admission._id, data: { plan, entries, evidenceDigest: digest(plan), at: now() } }], { session });
      await N.Audit.create([{ action: "PROFIT_SHARING_SETTLED",
        metadata: { eventId: key, transaction: String(tx._id), ruleId: admission.rule.id,
          amountKobo: plan.poolKobo, evidenceDigest: digest(plan) } }], { session });
      return { status: "SETTLED", eventId: key, amountKobo: plan.poolKobo };
    });
  }
  async function reverse(transactionId, session) {
    return atomic(async active => {
      const key = `reversal:${transactionId}`;
      if (await M.Event.exists({ _id: key }).session(active)) return { status: "ALREADY_REVERSED" };
      const original = await M.Event.findById(`accrual:${transactionId}`).session(active).lean();
      if (!original) return { status: "NO_ACCRUAL" };
      const tx = await transactionModel.findById(transactionId).session(active).lean();
      // Full canonical refunds only. Partial refunds require an explicit
      // allocation policy and are not inferred from a negative provider hint.
      if (tx?.status !== "REFUNDED" || !tx.reversalLedgerEntryId) fail("CANONICAL_FULL_REFUND_REQUIRED");
      const Ledger = require("../models/ledgerEntry.model");
      const debit = await Ledger.findOne({ _id: tx.debitLedgerEntryId, direction: "DEBIT",
        amount: tx.amount, user: tx.customerId, status: "POSTED", transactionId: tx._id,
        reference: tx.reference, reversalOf: null }).session(active).lean();
      const refund = await Ledger.findOne({ _id: tx.reversalLedgerEntryId, direction: "CREDIT",
        amount: tx.amount, user: tx.customerId, status: "POSTED",
        reversalOf: tx.debitLedgerEntryId }).session(active).lean();
      if (!debit || !refund || !tx.debitLedgerEntryId) fail("CANONICAL_REFUND_EVIDENCE_REQUIRED");
      // Mixed provider metadata is nullable. Normalize only a genuinely empty
      // envelope inside this same transaction; never replace a saved response.
      // Otherwise MongoDB cannot increment the nested settlement fence.
      if (tx.providerResponse == null) {
        await transactionModel.updateOne({ _id: tx._id, status: "REFUNDED", providerResponse: null },
          { $set: { providerResponse: {} } }, { session: active });
      }
      // Serialize with settlement and subsequent refund handlers.
      await transactionModel.updateOne({ _id: tx._id, status: "REFUNDED" },
        { $inc: { "providerResponse.profitSharingFence": 1 } }, { session: active });
      for (const row of [...original.data.entries].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
        await updateAccount(row.accountId, row.amountKobo, true, active);
      }
      await M.Event.create([{ _id: key, kind: "REVERSAL", transaction: tx._id,
        admissionId: original.admissionId, originalEventId: original._id,
        data: { entries: original.data.entries, refundLedgerId: String(refund._id), at: now() } }], { session: active });
      await N.Audit.create([{ action: "PROFIT_SHARING_REVERSED",
        metadata: { eventId: key, originalEventId: original._id, transaction: String(tx._id) } }], { session: active });
      return { status: "REVERSED", eventId: key };
    }, session);
  }
  async function recordBlocked(transactionId, errorCode) {
    const code = typeof errorCode === "string" && /^[A-Z0-9_]{1,80}$/.test(errorCode)
      ? errorCode : "SETTLEMENT_RETRY_REQUIRED";
    return atomic(async session => {
      const admission = await M.Admission.findById(String(transactionId)).session(session).lean();
      if (!admission) return;
      const id = `blocked:${transactionId}:${digest(code)}`;
      if (await M.Event.exists({ _id: id }).session(session)) return;
      await M.Event.create([{ _id: id, kind: "BLOCKED", admissionId: admission._id,
        transaction: admission.transaction, data: { code, at: now(), financialWrites: 0 } }], { session });
      await N.Audit.create([{ action: "PROFIT_SHARING_BLOCKED",
        metadata: { eventId: id, transaction: String(transactionId), code } }], { session });
    });
  }
  // Internal company settlement reuses the same transactional custody writer.
  // These functions are not exposed by any HTTP route.
  return { readiness, status, dryRun, changeMode, admit, settle, reverse, recordBlocked,
    atomic, storageBlockers, beneficiaries, updateAccount };
}
module.exports = { createEngine, kobo, ruleAt, CONTROL_ID };
