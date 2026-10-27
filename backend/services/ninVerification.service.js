const crypto = require("node:crypto");
const mongoose = require("mongoose");
const axios = require("axios");
const Verification = require("../models/idVerification.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const { postDebit } = require("./ledger.service");

// This lifecycle is deliberately NIN-only. It never retries a provider request
// whose outcome is unknown, and it never changes BVN or other payment services.
function createNinHandler({ extract, getConfig, post = (...args) => axios.post(...args) }) {
  let indexReady;
  const ensureIndex = () => {
    if (!indexReady) {
      indexReady = Verification.collection.createIndex({ activeNinKey: 1 }, {
        name: "nin_active_request_unique", unique: true,
        partialFilterExpression: { activeNinKey: { $type: "string" } },
      }).catch(error => { indexReady = null; throw error; });
    }
    return indexReady;
  };
  const respond = (res, record, balance) => {
    const successful = ["SUCCESSFUL", "SUCCESS"].includes(record.status);
    const paymentPending = record.status === "PENDING" && record.providerOutcome === "SUCCESSFUL";
    const data = record.verificationData?.toObject?.() || record.verificationData || {};
    if (!successful) return res.status(record.status === "FAILED" ? 400 : 202).json({
      success: false, status: record.status, reference: record.reference,
      verificationId: record._id, amountCharged: record.amountCharged || 0,
      awaitingPayment: paymentPending, retrySafe: paymentPending,
      message: record.status === "FAILED" ? "The provider could not verify this NIN. No wallet charge was made."
        : paymentPending ? "NIN verification is confirmed, but wallet payment is pending. Fund your wallet and retry the same NIN; the provider check will not be repeated."
        : "Verification is pending. Check Verification History; do not submit this NIN again.",
    });
    const result = { ...data, status: "Verified", reference: record.reference,
      verificationId: record._id, amountCharged: record.amountCharged,
      walletBalance: balance, createdAt: record.createdAt, maskedIdNumber: record.ninNumberMasked };
    return res.status(200).json({ success: true, message: "NIN verified successfully.",
      verification: result,
      data: { ...result, searchType: record.searchType, slipType: record.slipType, verificationData: data } });
  };
  const settle = async (recordId, userId) => {
    const session = await mongoose.startSession();
    let result, balance;
    try {
      await session.withTransaction(async () => {
        balance = undefined;
        result = await Verification.findOne({ _id: recordId, userId }).session(session);
        if (result.status !== "PENDING" || result.providerOutcome !== "SUCCESSFUL") return;
        // The provider result was saved before payment. Insufficient funds leave
        // it pending and reusable: a later retry settles only, never re-verifies.
        const opening = await User.findOneAndUpdate({
          _id: userId, walletBalance: { $gte: 250 },
        }, { $inc: { walletBalance: -250 } }, { session, returnDocument: "before" });
        if (!opening) return;
        balance = Math.round((opening.walletBalance - 250) * 100) / 100;
        const key = `nin-verification:${result._id}`;
        const [tx] = await Transaction.create([{
          userId, customerId: userId, amount: 250, type: "DEBIT",
          serviceType: "ID_VERIFICATION", status: "SUCCESSFUL",
          reference: result.reference, idempotencyKey: key,
          description: "NIN verification (PREMIUM)",
          meta: { verificationId: result._id, slipType: "PREMIUM", ninNumberMasked: result.ninNumberMasked },
        }], { session });
        await postDebit({ userId, amount: 250, openingBalance: opening.walletBalance,
          closingBalance: balance, service: "ID_VERIFICATION", reference: result.reference,
          idempotencyKey: key, transactionId: tx._id, narration: "NIN verification", session });
        result.status = "SUCCESSFUL";
        result.amountCharged = 250;
        await result.save({ session });
      });
      if (balance === undefined) balance = (await User.findById(userId).select("walletBalance").lean())?.walletBalance;
      return { record: result, balance };
    } finally { await session.endSession(); }
  };
  return async (req, res) => {
    try {
      const userId = req.user?._id || req.user?.id;
      if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });
      const input = req.body?.ninNumber ?? req.body?.idNumber;
      if (typeof input !== "string" || !/^\d{11}$/.test(input.trim()))
        return res.status(400).json({ success: false, message: "Please enter a valid 11-digit NIN." });
      if ((req.body?.consentAccepted ?? req.body?.consent) !== true)
        return res.status(400).json({ success: false, message: "Consent confirmation is required before verification." });
      const nin = input.trim();
      const user = await User.findById(userId).select("walletBalance").lean();
      if (!user) return res.status(404).json({ success: false, message: "User not found." });
      const existing = await Verification.findOne({ userId, idType: "NIN",
        status: { $in: ["SUCCESSFUL", "SUCCESS"] }, "verificationData.nin": nin });
      if (existing) return respond(res, existing, user.walletBalance);
      const legacyPending = await Verification.findOne({ userId, idType: "NIN", status: "PENDING",
        activeNinKey: { $exists: false }, providerOutcome: { $exists: false },
        ninNumberMasked: `*******${nin.slice(-4)}` });
      if (legacyPending) return respond(res, legacyPending, user.walletBalance);
      const key = crypto.createHash("sha256").update(`NIN:${userId}:${nin}`).digest("hex");
      let record = await Verification.findOne({ activeNinKey: key, userId });
      if (record) {
        if (record.providerOutcome === "SUCCESSFUL") {
          const paid = await settle(record._id, userId);
          return respond(res, paid.record, paid.balance);
        }
        return respond(res, record, user.walletBalance);
      }
      if (user.walletBalance < 250)
        return res.status(400).json({ success: false, message: "Insufficient wallet balance for NIN verification." });
      const config = getConfig();
      const base = new URL(config.baseUrl);
      if (!config.key || base.protocol !== "https:" || base.hostname !== "api.prembly.com" ||
          base.username || base.password || base.search || base.hash)
        return res.status(503).json({ success: false, message: "NIN verification is temporarily unavailable." });
      await ensureIndex(); // No provider dispatch before database uniqueness exists.
      try {
        record = await Verification.create({ userId, idType: "NIN", slipType: "PREMIUM",
          searchType: "NIN_NUMBER", reference: `NIN-${crypto.randomUUID()}`,
          amountCharged: 0, status: "PENDING", activeNinKey: key,
          ninNumberMasked: `*******${nin.slice(-4)}`, consentAccepted: true,
          providerOutcome: "UNKNOWN", providerAttemptedAt: new Date() });
      } catch (error) {
        if (error?.code !== 11000) throw error;
        record = await Verification.findOne({ activeNinKey: key, userId });
        if (!record) throw error;
        return respond(res, record, user.walletBalance);
      }
      let response;
      try {
        response = await post(`${config.baseUrl.replace(/\/+$/, "")}/verification/vnin-basic`,
          { number: nin }, { headers: { "Content-Type": "application/json", "x-api-key": config.key },
            timeout: 45000, maxRedirects: 0, maxContentLength: 5 * 1024 * 1024,
            maxBodyLength: 4096, validateStatus: () => true });
      } catch (_) {
        return respond(res, record, user.walletBalance); // Unknown, not a confirmed failure.
      }
      const body = response.data || {};
      const identity = extract(body);
      const responseCode = String(body.response_code ?? "");
      const definitiveSuccess = response.status === 200 && body.status === true &&
        responseCode === "00" && body.data?.nin_suspension_status !== true &&
        identity.fullName?.trim() && String(identity.nin) === nin;
      // Save only bounded status metadata, not raw identity payloads or errors.
      record.rawResponse = { status: typeof body.status === "boolean" ? body.status : null,
        response_code: /^[A-Za-z0-9_-]{1,24}$/.test(responseCode) ? responseCode : "",
        httpStatus: response.status };
      if (definitiveSuccess) {
        record.providerOutcome = "SUCCESSFUL";
        record.verificationData = identity;
        await record.save();
        const paid = await settle(record._id, userId);
        return respond(res, paid.record, paid.balance);
      }
      const definitiveFailure = [401, 403].includes(response.status) ||
        (response.status === 200 && body.status === true && responseCode === "00" &&
          body.data?.nin_suspension_status === true) ||
        (response.status === 200 && body.status === false &&
          /^\d{2}$/.test(responseCode) && responseCode !== "00" && !identity.fullName);
      if (definitiveFailure) {
        record.status = "FAILED";
        record.providerOutcome = "FAILED";
        record.failureReason = "Provider did not confirm NIN verification.";
        record.activeNinKey = undefined;
      }
      await record.save();
      return respond(res, record, user.walletBalance);
    } catch (_) {
      // Driver/provider exceptions may contain credentials and identity data.
      console.error(JSON.stringify({ event: "nin.verification.failed" }));
      return res.status(503).json({ success: false, message:
        "Unable to complete verification. Check Verification History before retrying." });
    }
  };
}
module.exports = { createNinHandler };
