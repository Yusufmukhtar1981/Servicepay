"use strict";

const crypto = require("node:crypto");
// Only the authenticated transport can attach evidence to its result object.
// JSON, object spreading, callbacks and customer input cannot forge this tag.
const receipts = new WeakMap();
const SCALE = 10n ** 18n;
function decimal(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  // Fractional JSON numbers may already have lost provider-side precision.
  // Exact fractional balances must arrive as decimal strings; never round.
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  const match = /^(0|[1-9]\d{0,18})(?:\.(\d{1,18}))?$/.exec(String(value));
  if (!match) return null;
  return BigInt(match[1]) * SCALE + BigInt((match[2] || "").padEnd(18, "0"));
}
function minor(value) {
  if (value === null || value < 0n || value % (SCALE / 100n) !== 0n) return null;
  const result = value / (SCALE / 100n);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : null;
}
function attachAuthenticatedPurchase(result, { body, requestId, httpStatus }) {
  if (!result || typeof result !== "object" || !body || typeof body !== "object" ||
      httpStatus !== 200 || result.status !== "SUCCESS" ||
      result.documentedDataStatus !== true || result.contradictory === true ||
      result.service !== "data" || typeof requestId !== "string" ||
      body["request-id"] !== requestId || result.requestId !== requestId) return result;
  const opening = decimal(body.old_balance), closing = decimal(body.new_balance);
  if (opening === null || closing === null || opening <= closing) return result;
  const supplierDebitKobo = minor(opening - closing);
  if (supplierDebitKobo === null || supplierDebitKobo <= 0) return result;
  const reportedAmountKobo = minor(decimal(body.amount));
  const receipt = {
    provider: "TELECOM_ABODE", serviceType: "DATA", requestReference: requestId,
    supplierDebitKobo, reportedAmountKobo,
    source: "AUTHENTICATED_PURCHASE_BALANCE_DELTA",
    // The debit is observed, not inferred from a catalogue or today's balance.
    // It is not by itself proof that every other company expense is known.
    otherDirectCostsKobo: null, expensesVerified: false,
  };
  receipt.fingerprint = crypto.createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
  receipts.set(result, Object.freeze(receipt));
  return result;
}
function evidenceFor(result) {
  return result && typeof result === "object" ? receipts.get(result) || null : null;
}
function createStore({ eventModel, now = () => new Date() } = {}) {
  async function record(transaction, result) {
    const receipt = evidenceFor(result);
    if (!receipt) return { status: "NO_AUTHENTICATED_DEBIT_EVIDENCE", financialWrites: 0 };
    if (!transaction?._id || transaction.provider !== receipt.provider ||
        transaction.serviceType !== receipt.serviceType ||
        transaction.providerRequestId !== receipt.requestReference) {
      throw Object.assign(Error("PROVIDER_DEBIT_REFERENCE_MISMATCH"), { code: "PROVIDER_DEBIT_REFERENCE_MISMATCH" });
    }
    const Event = eventModel || require("../models/profitSharing.models").Event;
    const id = `provider-debit:${transaction._id}`;
    try {
      await Event.create({ _id: id, kind: "PROVIDER_DEBIT_EVIDENCE",
        transaction: transaction._id, data: { ...receipt, observedAt: now() } });
    } catch (error) {
      if (error.code !== 11000) throw error;
      const previous = await Event.findById(id).lean();
      if (previous?.kind !== "PROVIDER_DEBIT_EVIDENCE" ||
          String(previous.transaction) !== String(transaction._id) ||
          previous.data?.fingerprint !== receipt.fingerprint) {
        throw Object.assign(Error("PROVIDER_DEBIT_EVIDENCE_CONFLICT"), { code: "PROVIDER_DEBIT_EVIDENCE_CONFLICT" });
      }
      return { status: "ALREADY_RECORDED", financialWrites: 0 };
    }
    return { status: "RECORDED", financialWrites: 0 };
  }
  return { record };
}
module.exports = { attachAuthenticatedPurchase, evidenceFor, createStore };
