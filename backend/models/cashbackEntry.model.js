const mongoose = require("mongoose");

// The immutable entry IS the balance change and its audit record. There is no
// mutable balance cache that can diverge, and no Main Wallet write.
const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  actorRole: { type: String, required: true },
  reference: { type: String, required: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ["POSTED"], default: "POSTED" },
}, { timestamps: true, versionKey: false, autoCreate: false, autoIndex: false });
schema.index({ user: 1, createdAt: -1 });
schema.pre("save", function () {
  if (!this.isNew) throw new Error("Cashback audit entries are immutable.");
});
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne",
  "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete", "bulkWrite"]) {
  schema.pre(op, { query: true, document: false }, function () {
    throw new Error("Cashback audit entries are immutable.");
  });
}
schema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("Cashback audit entries are immutable.");
});
module.exports = mongoose.model("CashbackEntry", schema);
