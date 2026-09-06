const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const RiderWalletLedger = require("../models/riderWalletLedger.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const text = (value = "") => String(value).trim();
const amountOf = (value) => Number(Number(value).toFixed(2));
const actor = (req) => ({
  id: req.user?._id || req.user?.id,
  name: req.user?.fullName || req.user?.name || "",
  role: text(req.user?.role).toUpperCase(),
});
const isHeadOffice = (req) => ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "SUPER_ADMIN", "ADMIN"].includes(actor(req).role);
const audit = (req, action, reason, previousData, newData, metadata, session) => {
  const current = actor(req);
  return AdminAuditLog.create([{
    actorId: current.id, actorRole: current.role, actorName: current.name,
    targetUserId: metadata?.riderId || null, action, reason, previousData, newData, metadata,
    requestMethod: req.method || "", requestPath: req.originalUrl || "", status: "SUCCESSFUL",
  }], { session });
};

exports.getWithdrawalControl = async (req, res) => {
  try {
    const settings = await AppSettings.getGlobalSettings();
    const control = settings.riderWithdrawalControl || {};
    return res.json({ success: true, data: {
      enabled: control.enabled !== false, updatedAt: control.updatedAt || settings.updatedAt,
      updatedBy: control.updatedBy || null, updatedByName: control.updatedByName || "",
    }});
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to load Rider withdrawal availability." });
  }
};

exports.updateWithdrawalControl = async (req, res) => {
  if (!isHeadOffice(req)) return res.status(403).json({ success: false, message: "Only Head Office can change Rider withdrawal availability." });
  if (typeof req.body.enabled !== "boolean") return res.status(400).json({ success: false, message: "enabled must be a boolean." });
  const session = await mongoose.startSession();
  try {
    let control;
    await session.withTransaction(async () => {
      const settings = await AppSettings.findOne({ key: "GLOBAL_SETTINGS" }).session(session) || await AppSettings.create([{ key: "GLOBAL_SETTINGS" }], { session }).then((items) => items[0]);
      const previous = settings.riderWithdrawalControl?.enabled !== false;
      const current = actor(req);
      settings.riderWithdrawalControl = { enabled: req.body.enabled, updatedAt: new Date(), updatedBy: current.id, updatedByName: current.name };
      await settings.save({ session });
      control = settings.riderWithdrawalControl;
      await audit(req, "RIDER_WITHDRAWAL_TOGGLE_UPDATED", text(req.body.reason) || "Updated Rider withdrawal availability.", { enabled: previous }, { enabled: control.enabled }, { enabled: control.enabled }, session);
    });
    return res.json({ success: true, message: `Rider withdrawal ${control.enabled ? "enabled" : "disabled"} successfully.`, data: control });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to update Rider withdrawal availability.", error: error.message });
  } finally { await session.endSession(); }
};

exports.adjustRiderWallet = async (req, res) => {
  if (!isHeadOffice(req)) return res.status(403).json({ success: false, message: "Only Head Office can adjust Rider wallets." });
  const riderId = text(req.params.id);
  const action = text(req.body.action).toUpperCase();
  const amount = amountOf(req.body.amount);
  const reason = text(req.body.reason);
  const note = text(req.body.note || req.body.reference);
  if (!mongoose.Types.ObjectId.isValid(riderId)) return res.status(400).json({ success: false, message: "Invalid rider ID." });
  if (!["CREDIT", "DEBIT"].includes(action) || !Number.isFinite(amount) || amount <= 0 || !reason) return res.status(400).json({ success: false, message: "Action, positive amount, and reason are required." });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const rider = await User.findOne({ _id: riderId, role: "DELIVERY_RIDER" }).session(session);
      if (!rider) throw Object.assign(new Error("Delivery Rider was not found."), { statusCode: 404 });
      const oldBalance = amountOf(rider.pendingRiderSettlement);
      const filter = { _id: rider._id, role: "DELIVERY_RIDER", ...(action === "DEBIT" ? { pendingRiderSettlement: { $gte: amount } } : {}) };
      const updated = await User.findOneAndUpdate(filter, { $inc: { pendingRiderSettlement: action === "CREDIT" ? amount : -amount } }, { new: true, session });
      if (!updated) throw Object.assign(new Error("Rider available balance is insufficient for this debit."), { statusCode: 422 });
      const reference = `RIDER-ADJ-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const current = actor(req);
      await RiderWalletLedger.create([{
        riderId: rider._id, type: action === "CREDIT" ? "ADMIN_CREDIT" : "ADMIN_DEBIT", direction: action,
        amount, oldBalance, newBalance: amountOf(updated.pendingRiderSettlement), reference, reason,
        adminId: current.id, adminName: current.name, metadata: { note },
      }], { session });
      await audit(req, action === "CREDIT" ? "RIDER_WALLET_CREDITED" : "RIDER_WALLET_DEBITED", reason,
        { pendingRiderSettlement: oldBalance }, { pendingRiderSettlement: amountOf(updated.pendingRiderSettlement) },
        { riderId: String(rider._id), amount, reference, note }, session);
      result = { rider: updated, oldBalance, reference };
    });
    return res.json({ success: true, message: action === "CREDIT" ? "Rider wallet credited successfully" : "Rider wallet debited successfully", data: { reference: result.reference, availableBalance: amountOf(result.rider.pendingRiderSettlement) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message || "Unable to adjust Rider wallet." });
  } finally { await session.endSession(); }
};