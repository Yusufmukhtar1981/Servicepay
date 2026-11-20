const mongoose = require("mongoose");
const settings = new mongoose.Schema({
  allowWallpaper: Boolean,
  allowLauncher: Boolean,
  approvedPackages: [String],
}, { _id: false, strict: "throw" });
const schema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  actor: { type: String, required: true, immutable: true },
  action: { type: String, required: true, immutable: true },
  reason: { type: String, immutable: true },
  metadata: { type: mongoose.Schema.Types.Mixed, immutable: true },
  settingsRevision: { type: Number, immutable: true },
  settings: { type: settings, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true },
}, { collection: "deviceauditlogs", autoCreate: false, autoIndex: false, strict: "throw" });
schema.index({ device: 1, createdAt: -1, _id: -1 }, { name: "enterprise_device_audit_history" });
schema.index({ settingsRevision: 1 }, { unique: true, name: "enterprise_settings_revision_uq",
  partialFilterExpression: { settingsRevision: { $type: "number" } } });
schema.pre("save", function () { if (!this.isNew) throw new Error("Device audit events are append-only."); });
for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
  schema.pre(operation, function () { throw new Error("Device audit events are append-only."); });
}
schema.pre("deleteOne", { document: true, query: false }, function () {
  throw new Error("Device audit events are append-only.");
});
schema.pre("bulkWrite", function () { throw new Error("Device audit events are append-only."); });
module.exports = (connection = mongoose.connection) =>
  connection.models.DeviceAuditLog || connection.model("DeviceAuditLog", schema);
