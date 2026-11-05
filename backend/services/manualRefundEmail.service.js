const crypto = require("node:crypto");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const mail = require("./email.service");

// Outbox is created in the SAME transaction as the refund. The in-app
// notification never depends on email availability. No new collection.
const createEmailWorker = ({ sendEmail = mail.sendEmail, enabled = mail.emailEnabled } = {}) => {
  const run = async () => {
    if (!enabled()) return { status: "DISABLED" };
    const now = new Date(), lease = crypto.randomUUID();
    const row = await Transaction.findOneAndUpdate({
      serviceType: "REFUND", provider: "SERVICEPAY_MANUAL_REFUND", status: "SUCCESSFUL",
      "providerResponse.email.status": { $in: ["PENDING", "SENDING"] },
      "providerResponse.email.nextAttemptAt": { $lte: now },
    }, { $set: { "providerResponse.email.status": "SENDING", "providerResponse.email.lease": lease,
      "providerResponse.email.nextAttemptAt": new Date(Date.now() + 120000) },
      $inc: { "providerResponse.email.attempts": 1 } }, { new: true }).lean();
    if (!row) return { status: "EMPTY" };
    const filter = { _id: row._id, "providerResponse.email.lease": lease };
    // Provider idempotency is time-limited. Do not blindly retry an uncertain
    // email beyond that window; this never affects refund completion.
    if (row.providerResponse.email.attempts > 1 &&
        Date.now() - new Date(row.createdAt).getTime() > 23 * 60 * 60 * 1000) {
      await Transaction.updateOne(filter, { $set: { "providerResponse.email.status": "REVIEW_REQUIRED" } });
      return { status: "REVIEW_REQUIRED" };
    }
    const user = await User.findById(row.customerId).select("email").lean();
    if (!user?.email) {
      await Transaction.updateOne(filter, { $set: { "providerResponse.email.status": "NO_EMAIL" } });
      return { status: "NO_EMAIL" };
    }
    let result;
    try {
      result = await sendEmail({
        to: user.email, subject: "Servicepay wallet refund completed",
        text: `Your Servicepay wallet was credited with NGN ${Number(row.amount).toFixed(2)}. Refund reference: ${row.reference}.`,
        html: `<p>Your Servicepay wallet was credited with NGN ${Number(row.amount).toFixed(2)}.</p><p>Refund reference: ${row.reference}</p>`,
        idempotencyKey: `manual-refund:${row._id}`,
      });
    } catch (_) { result = { success: false }; }
    await Transaction.updateOne(filter, { $set: {
      "providerResponse.email.status": result?.success ? "SENT" : "PENDING",
      "providerResponse.email.nextAttemptAt": new Date(Date.now() + 15 * 60000),
    } });
    return { status: result?.success ? "SENT" : "PENDING" };
  };
  return { run };
};
let timer;
const startWorker = () => {
  if (timer) return;
  const worker = createEmailWorker();
  const tick = () => worker.run().catch(() => {
    console.warn("[MANUAL_REFUND_EMAIL] Delivery deferred; wallet settlement is unchanged.");
  });
  timer = setInterval(tick, 60000);
  timer.unref?.();
  void tick();
};
module.exports = { createEmailWorker, startWorker };
