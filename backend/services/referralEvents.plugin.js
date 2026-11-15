// Capture canonical changes, never webhook payloads. Lazy imports avoid model
// cycles. The existing durable referral worker is the only financial processor.
const transactionServices = new Set([
  "AIRTIME", "DATA", "ELECTRICITY", "CABLE", "EXAM_PIN", "ID_VERIFICATION",
  "EDUPAY", "INTERSTATE_LOGISTICS",
]);
const fields = {
  REGISTRATION: ["phoneVerified", "emailVerified", "status"],
  TRANSACTION: ["status", "reversalReference", "reversalTransactionId", "reversedTransactionId", "reversalLedgerEntryId", "dispatchStatus"],
  DELIVERY: ["status", "paymentStatus", "refundedAt"],
  MARKETPLACE: ["orderStatus", "paymentStatus", "fundsStatus", "refundedAt"],
};
const relevant = (update, type) => fields[type].some((key) =>
  Object.hasOwn(update || {}, key) || Object.hasOwn(update?.$set || {}, key) ||
  Object.hasOwn(update?.$unset || {}, key));

async function capture(row, type, session) {
  if (!row?._id) return;
  if (type === "TRANSACTION" && !transactionServices.has(row.serviceType)) return;
  if (type === "REGISTRATION" && (row.role !== "CUSTOMER" || !row.referredBy)) return;
  if (!(await require("./referralProgramme.service").policy(session)).activatedAt) return;
  const customer = type === "REGISTRATION" ? row._id :
    type === "MARKETPLACE" ? row.buyer : row.customerId;
  if (!customer) return;
  // This does not authorize an award. Worker re-reads all eligibility evidence.
  await require("./referralReward.service").enqueueReferralRewardEvent({
    referredCustomerId: customer, sourceType: type, sourceId: row._id, session,
  });
}

module.exports = function referralEvents(schema, { type }) {
  schema.pre("save", function () {
    this.$locals.referralSourceChanged = this.isNew || fields[type].some((field) => this.isModified(field));
  });
  schema.post("save", async function (doc) {
    if (this.$locals.referralSourceChanged) await capture(doc, type, doc.$session());
  });
  for (const operation of ["updateOne", "findOneAndUpdate", "updateMany", "replaceOne", "findOneAndReplace"]) {
    schema.pre(operation, async function () {
      if (!relevant(this.getUpdate(), type)) return;
      const session = this.getOptions().session;
      // Capture identities before an update can remove them from its filter.
      const query = this.model.find(this.getQuery()).select("_id role referredBy customerId buyer serviceType");
      if (session) query.session(session);
      if (!["updateMany"].includes(operation)) query.limit(1);
      this._referralSources = await query.lean();
    });
    schema.post(operation, async function () {
      for (const row of this._referralSources || []) {
        await capture(row, type, this.getOptions().session);
      }
    });
  }
};
