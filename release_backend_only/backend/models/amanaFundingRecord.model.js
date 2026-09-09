const mongoose = require("mongoose");

/*
 * An immutable controlled-funding record. Both the external reference and
 * idempotency key are globally unique, so one reconciled source cannot fund
 * more than one protected request.
 */
const amanaFundingRecordSchema = new mongoose.Schema(
  {
    amanaOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AmanaOrder",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    sourceType: {
      type: String,
      enum: ["HEAD_OFFICE", "NGO", "COMPANY", "DONOR_RESERVED"],
      required: true,
    },
    reference: { type: String, required: true, trim: true, uppercase: true, unique: true },
    receiptReference: { type: String, default: "", trim: true, maxlength: 300 },
    idempotencyKey: { type: String, required: true, trim: true, unique: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

const denyMutation = function () {
  throw new Error("Amana funding records are immutable and cannot be modified or deleted.");
};

amanaFundingRecordSchema.pre("save", function () {
  if (!this.isNew) denyMutation();
});
[
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "bulkWrite",
].forEach((operation) => amanaFundingRecordSchema.pre(operation, { document: false, query: true }, denyMutation));

module.exports = mongoose.model("AmanaFundingRecord", amanaFundingRecordSchema);