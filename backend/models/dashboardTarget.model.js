const mongoose = require("mongoose");

const dashboardTargetSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, validate: {
    validator: value => value === "executive" || /^hierarchy:[a-f0-9]{24}:(DAILY|WEEKLY|MONTHLY):\d{4}-\d{2}-\d{2}$/.test(value),
    message: "Invalid dashboard target namespace.",
  } },
  values: { type: Map, of: Number, default: {} },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  management: {
    type: new mongoose.Schema({
      subjectId: { type: mongoose.Schema.Types.ObjectId, required: true },
      period: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY"], required: true },
      startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
      revision: { type: Number, default: 0 },
      history: [{ actor: mongoose.Schema.Types.ObjectId, at: Date, reason: String, values: { type: Map, of: Number } }],
    }, { _id: false }),
    default: undefined,
  },
}, { timestamps: true });

module.exports = mongoose.model("DashboardTarget", dashboardTargetSchema);