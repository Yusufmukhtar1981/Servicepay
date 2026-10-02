const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Ledger = require("../models/ledgerEntry.model");
const { postLedgerEntry, reverseLedgerEntry } = require("./ledger.service");
const { getServiceConfig } = require("./providerManagement.service");
const { normalizeNigerianMsisdn } = require("./nigerianMsisdn.service");
const { createTelecomAbodeBillsProvider, buildElectricityPayload } = require("./telecomAbodeBillsProvider.service");
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const money = n => Math.round(Number(n) * 100) / 100;
const typeFor = value => ({ "01": "prepaid", "02": "postpaid", prepaid: "prepaid", postpaid: "postpaid" })[value];
const mode = () => process.env.TELECOM_ABODE_ELECTRICITY_ACTIVATION || "OFF";
const admitted = id => mode() === "LIVE" || mode() === "TEST" &&
  String(id) === process.env.TELECOM_ABODE_ELECTRICITY_TEST_CUSTOMER_ID;

function createTelecomAbodeElectricity({ bills = createTelecomAbodeBillsProvider(), transport = axios,
  readConfig = getServiceConfig, secret = () => process.env.JWT_SECRET,
  allowCustomer = admitted } = {}) {
  const fields = input => {
    const meterType = typeFor(input.meterType);
    const payload = buildElectricityPayload({ disco: input.electricCompany,
      meterNumber: input.meterNumber, meterType, phone: input.phoneNumber || "08000000000",
      amount: input.amount || 1000, requestId: "ELECTRICITY-VALIDATION" });
    return { disco: payload.disco, meter_number: payload.meter_number, meter_type: payload.meter_type };
  };
  const readIdentity = async body => {
    try {
      const r = await transport({ method: "POST",
        url: "https://telecomabode.com.ng/api/bill/bill-validation",
        headers: { Authorization: "Token " + process.env.TELECOM_ABODE_API_KEY, "Content-Type": "application/json" },
        data: body, timeout: 30000, maxRedirects: 0, validateStatus: () => true });
      const d = r.data;
      if (r.status !== 200 || d?.status !== "success" || typeof d.name !== "string" ||
          typeof d.customer_address !== "string" || !d.name.trim() || !d.customer_address.trim()) return null;
      return { name: d.name.trim(), address: d.customer_address.trim(), message: d.message };
    } catch (_) { return null; }
  };
  const quote = async amount => {
    const face = Number(amount), config = await readConfig("ELECTRICITY");
    const bps = config.electricityMarkupBps || 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(amount)) || !Number.isFinite(face) ||
        face < 1000 || face > 200000 || !Number.isInteger(bps) || bps < 0 || bps > 10000)
      throw fail("ELECTRICITY_PRICE_INVALID", "Enter an amount from ₦1,000 to ₦200,000.");
    const customerSellingPrice = Math.round(Math.round(face * 100) * (10000 + bps) / 10000) / 100;
    return { faceValue: face, customerSellingPrice, serviceFee: money(customerSellingPrice - face),
      markupBps: bps, providerCost: null };
  };
  const verify = async (customerId, input) => {
    const f = fields(input);
    const companies = await bills.getElectricityProviders();
    if (!companies.some(c => c.providerId === f.disco)) throw fail("INVALID_DISCO", "Select a current DISCO.");
    // Same-DISCO negative controls distinguish provider fallback identities.
    // No amount/phone/purchase is sent by these enquiries.
    const identity = await readIdentity(f);
    const zero = await readIdentity({ ...f, meter_number: "00000000000" });
    const repeated = await readIdentity({ ...f, meter_number: "11111111111" });
    if (!identity || !zero || !repeated ||
        identity.name !== identity.message ||
        JSON.stringify([identity.name, identity.address]) === JSON.stringify([zero.name, zero.address]) ||
        JSON.stringify([identity.name, identity.address]) === JSON.stringify([repeated.name, repeated.address]))
      throw fail("METER_IDENTITY_UNTRUSTED", "This DISCO did not return distinguishable meter identity evidence. No payment is permitted.", 503);
    if (!secret()) throw fail("VALIDATION_UNAVAILABLE", "Meter confirmation is unavailable.", 503);
    const validationToken = jwt.sign({ purpose: "ELECTRICITY_CONFIRMATION", customerId: String(customerId),
      ...f, name: identity.name, address: identity.address,
      companyName: companies.find(c => c.providerId === f.disco).displayName },
    secret(), { expiresIn: "10m", algorithm: "HS256" });
    return { success: true, verified: true, validationToken, customer: { name: identity.name,
      address: identity.address, meterNumber: f.meter_number, disco: f.disco,
      meterType: f.meter_type, meterTypeAuthority: "CUSTOMER_SELECTED_NOT_PROVIDER_VERIFIED" } };
  };
  const proofFor = (customerId, input) => {
    let p;
    try { p = jwt.verify(input.validationToken, secret(), { algorithms: ["HS256"] }); }
    catch (_) { throw fail("METER_CONFIRMATION_EXPIRED", "Verify the meter again before paying."); }
    const f = fields(input);
    if (p.purpose !== "ELECTRICITY_CONFIRMATION" || p.customerId !== String(customerId) ||
        p.disco !== f.disco || p.meter_number !== f.meter_number || p.meter_type !== f.meter_type ||
        input.customerConfirmed !== true)
      throw fail("METER_CONFIRMATION_MISMATCH", "Confirm the displayed account and your known meter type.");
    return p;
  };
  const result = tx => {
    const e = tx.providerResponse?.electricity || {};
    return { success: tx.status !== "FAILED", pending: tx.status === "PENDING",
      message: tx.status === "SUCCESSFUL" ? "Electricity payment completed." :
        tx.status === "FAILED" ? "Electricity payment rejected and wallet refunded." :
          "Electricity outcome is pending. Check status; do not submit another purchase.",
      data: { ...e, transactionId: String(tx._id), reference: tx.reference, orderId: tx.providerReference,
        status: tx.status, dispatchStatus: tx.dispatchStatus, amount: tx.amount,
        financialAccounting: tx.providerResponse?.financialAccounting } };
  };
  const responseFor = async tx => {
    const user = await User.findById(tx.customerId).select("walletBalance").lean();
    const response = result(tx);
    response.data.walletBalance = user?.walletBalance;
    return response;
  };
  const settle = async (id, evidence) => {
    if (!bills.isVerifiedEvidence(evidence)) throw fail("UNTRUSTED_EVIDENCE", "Untrusted settlement.", 409);
    const session = await mongoose.startSession();
    let settled;
    try {
      await session.withTransaction(async () => {
        const tx = await Transaction.findOne({ _id: id, provider: "TELECOM_ABODE", serviceType: "ELECTRICITY" }).session(session);
        if (!tx || tx.status !== "PENDING") { settled = tx; return; }
        if (evidence.requestId !== tx.providerRequestId) throw fail("REFERENCE_MISMATCH", "Settlement reference mismatch.", 409);
        const meta = tx.providerResponse;
        if (evidence.authoritative && evidence.outcome === "SUCCESS") {
          tx.status = "SUCCESSFUL"; tx.dispatchStatus = "SUCCEEDED"; tx.providerStatus = "SUCCESS";
          tx.providerReference = evidence.providerOrderId;
          meta.electricity.meterToken = evidence.receipt?.token || "";
          meta.electricity.units = evidence.receipt?.units || "";
          meta.electricity.providerReference = evidence.providerOrderId;
          meta.financialAccounting.status = "AWAITING_PROVIDER_COST";
        } else if (evidence.authoritative && evidence.outcome === "FAILED" &&
            evidence.source === "INITIAL_REQUEST" && evidence.httpStatus === 422) {
          const debit = await Ledger.findById(tx.debitLedgerEntryId).session(session);
          if (!debit || debit.status !== "POSTED" || debit.direction !== "DEBIT" ||
              String(debit.transactionId) !== String(tx._id) || String(debit.user) !== String(tx.customerId) ||
              debit.reference !== tx.reference || debit.amount !== tx.amount)
            throw fail("REFUND_CUSTODY_REQUIRED", "Refund debit evidence is unavailable.", 409);
          const user = await User.findById(tx.customerId).session(session);
          const openingBalance = user.walletBalance;
          user.walletBalance = money(openingBalance + tx.amount); await user.save({ session });
          const reversal = await reverseLedgerEntry({ originalEntryId: debit._id, openingBalance,
            closingBalance: user.walletBalance, idempotencyKey: `ELECTRICITY:${tx.reference}:REFUND`,
            narration: "Electricity initial validation rejection", session });
          if (!reversal?.entry?._id || reversal.duplicate) throw fail("REFUND_CONFLICT", "Refund conflict.", 409);
          tx.reversalLedgerEntryId = reversal.entry._id; tx.status = "FAILED";
          tx.dispatchStatus = "REFUNDED"; tx.providerStatus = "VALIDATION_REJECTED";
          meta.financialAccounting.status = "REFUNDED";
        } else { tx.dispatchStatus = "UNKNOWN"; tx.providerStatus = evidence.reasonCode || "UNKNOWN"; }
        tx.providerResponse = meta; tx.markModified("providerResponse");
        await tx.save({ session }); settled = tx;
      });
    } finally { await session.endSession(); }
    return settled;
  };
  const purchase = async (customerId, input) => {
    const key = String(input.idempotencyKey || "");
    if (key.length < 8 || key.length > 180) throw fail("REQUEST_KEY_REQUIRED", "A durable request key is required.");
    const requestKey = crypto.createHash("sha256").update(key).digest("hex");
    const f = fields(input), phone = normalizeNigerianMsisdn(input.phoneNumber), amount = Number(input.amount);
    if (!phone || !/^\d+(?:\.\d{1,2})?$/.test(String(input.amount)) || amount < 1000 || amount > 200000)
      throw fail("INVALID_ELECTRICITY_INPUT", "Enter a valid Nigerian phone and amount from ₦1,000 to ₦200,000.");
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ ...f, phone, amount })).digest("hex");
    const lookup = { customerId, serviceType: "ELECTRICITY", idempotencyKey: requestKey };
    const existing = await Transaction.findOne(lookup);
    if (existing) {
      if (existing.providerResponse?.electricity?.fingerprint !== fingerprint)
        throw fail("IDEMPOTENCY_CONFLICT", "This request key belongs to different payment details.", 409);
      return responseFor(existing); // Never resend READY/SENDING/UNKNOWN.
    }
    if (!allowCustomer(customerId)) throw fail("ELECTRICITY_NOT_LIVE", "Electricity activation is not complete.", 503);
    const proof = proofFor(customerId, input);
    const pricing = await quote(amount);
    if (input.customerSellingPrice !== undefined && Number(input.customerSellingPrice) !== pricing.customerSellingPrice ||
        input.customerSellingPrice === undefined && pricing.markupBps !== 0)
      throw fail("ELECTRICITY_PRICE_CHANGED", "Obtain and confirm a fresh Electricity quote.", 409);
    const reference = "ELC-" + crypto.randomBytes(14).toString("hex");
    const payload = buildElectricityPayload({ disco: f.disco, meterNumber: f.meter_number,
      meterType: f.meter_type, phone, amount, requestId: reference });
    const session = await mongoose.startSession();
    let tx;
    try {
      await session.withTransaction(async () => {
        const duplicate = await Transaction.findOne(lookup).session(session);
        if (duplicate) {
          if (duplicate.providerResponse?.electricity?.fingerprint !== fingerprint)
            throw fail("IDEMPOTENCY_CONFLICT", "Request details changed.", 409);
          tx = duplicate; return;
        }
        if (await Transaction.exists({ customerId, serviceType: "ELECTRICITY", provider: "TELECOM_ABODE",
          status: "PENDING", idempotencyKey: { $ne: requestKey } }).session(session))
          throw fail("ELECTRICITY_PENDING_RECOVERY", "An Electricity purchase is unresolved. Check its status; do not submit another request.", 409);
        const config = await readConfig("ELECTRICITY", session);
        if ((config.electricityMarkupBps || 0) !== pricing.markupBps)
          throw fail("ELECTRICITY_PRICE_CHANGED", "Electricity pricing changed before debit.", 409);
        if (config.primaryProvider !== "TELECOM_ABODE" ||
            !config.providerStates.some(p => p.provider === "TELECOM_ABODE" && p.enabled))
          throw fail("ELECTRICITY_PAUSED", "Electricity purchases are paused.", 503);
        const user = await User.findOne({ _id: customerId, role: "CUSTOMER", status: "ACTIVE" }).session(session);
        if (!user || user.walletBalance < pricing.customerSellingPrice) throw fail("INSUFFICIENT_BALANCE", "Insufficient spendable wallet balance.");
        const openingBalance = user.walletBalance;
        user.walletBalance = money(openingBalance - pricing.customerSellingPrice); await user.save({ session });
        [tx] = await Transaction.create([{ ...lookup, reference, provider: "TELECOM_ABODE",
          providerRequestId: reference, phone, amount: pricing.customerSellingPrice, status: "PENDING", dispatchStatus: "READY",
          agentId: user.agentId || null, stateManagerId: user.stateManagerId || null,
          zonalManagerId: user.zonalManagerId || null,
          providerResponse: { telecomAbodePurchaseIntent: payload,
            electricityValidation: { verified: true, ...f, name: proof.name, address: proof.address,
              meterTypeAuthority: "CUSTOMER_SELECTED_NOT_PROVIDER_VERIFIED" },
            electricity: { fingerprint, customerName: proof.name, customerAddress: proof.address,
              meterNumber: f.meter_number, meterType: f.meter_type, electricityCompany: proof.companyName,
              provider: "TELECOM_ABODE", faceValue: amount },
            financialAccounting: { customerAmount: pricing.customerSellingPrice, customerSellingPrice: pricing.customerSellingPrice,
              providerCost: null, serviceFee: pricing.serviceFee, commission: null, servicePayGrossProfit: null,
              netServicePayRevenue: null, accountingReconciliation: "PENDING", status: "AWAITING_FULFILLMENT" } } }], { session });
        const entry = await postLedgerEntry({ userId: user._id, direction: "DEBIT", amount: pricing.customerSellingPrice,
          openingBalance, closingBalance: user.walletBalance, service: "ELECTRICITY", reference,
          idempotencyKey: `ELECTRICITY:${reference}:DEBIT`, transactionId: tx._id, session });
        if (!entry?.entry?._id || entry.duplicate) throw fail("DEBIT_CONFLICT", "Canonical debit conflict.", 409);
        tx.debitLedgerEntryId = entry.entry._id; await tx.save({ session });
      });
    } catch (e) {
      if (e.code === 11000) {
        const duplicate = await Transaction.findOne(lookup);
        if (duplicate?.providerResponse?.electricity?.fingerprint === fingerprint) return responseFor(duplicate);
      }
      throw e;
    } finally { await session.endSession(); }
    const claimed = await Transaction.findOneAndUpdate({ _id: tx._id, dispatchStatus: "READY",
      status: "PENDING", debitLedgerEntryId: { $ne: null } },
    { $set: { dispatchStatus: "SENDING", dispatchStartedAt: new Date() } }, { new: true });
    if (!claimed) return responseFor(await Transaction.findById(tx._id));
    let evidence;
    try { evidence = await bills.purchaseElectricity({ disco: f.disco, meterNumber: f.meter_number,
      meterType: f.meter_type, phone, amount, requestId: reference }); }
    catch (_) {
      await Transaction.updateOne({ _id: tx._id, status: "PENDING" }, { $set: { dispatchStatus: "UNKNOWN" } });
      return responseFor(await Transaction.findById(tx._id));
    }
    return responseFor(await settle(tx._id, evidence));
  };
  const requery = async (customerId, id) => {
    const tx = await Transaction.findOne({ _id: id, customerId, serviceType: "ELECTRICITY", provider: "TELECOM_ABODE" });
    if (!tx) throw fail("TRANSACTION_NOT_FOUND", "Transaction not found.", 404);
    if (tx.status !== "PENDING") return responseFor(tx);
    const evidence = await bills.query({ service: "ELECTRICITY", requestId: tx.providerRequestId,
      meterType: tx.providerResponse.electricity.meterType });
    return responseFor(await settle(tx._id, evidence));
  };
  return { verify, quote, purchase, requery, result };
}
module.exports = { createTelecomAbodeElectricity, mode, admitted, typeFor };