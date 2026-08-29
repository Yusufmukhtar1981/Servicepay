const mongoose = require("mongoose");
const AdminAuditLog = require("../models/adminAuditLog.model");
const {
  inspectTransactionPinStatus,
  setTransactionPin,
  verifyTransactionPin: verifyPin,
  changeTransactionPin: changePin,
  resetTransactionPin: resetPin,
  loadTransactionPinUser,
} = require("../services/transactionPin.service");

const userIdFor = (req) => req.user?._id || req.user?.id || req.userId;
const bcryptHash = (value) =>
  typeof value === "string" && /^\$2[aby]\$\d{2}\$/.test(value);

const sendError = (res, error, fallback) =>
  res.status(error.statusCode || 500).json({
    success: false,
    code: error.code,
    message: error.statusCode ? error.message : fallback,
  });

exports.getTransactionPinStatus = async (req, res) => {
  const userId = userIdFor(req);
  if (!userId) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized." });
  }
  try {
    const { transactionPinSet } = await inspectTransactionPinStatus(userId);
    return res.status(200).json({ success: true, transactionPinSet });
  } catch (error) {
    return sendError(res, error, "Unable to check transaction PIN status.");
  }
};

exports.createTransactionPin = async (req, res) => {
  const userId = userIdFor(req);
  if (!userId) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized." });
  }
  const pin = String(req.body?.pin || "").trim();
  const confirmPin = String(req.body?.confirmPin || "").trim();
  if (pin !== confirmPin) {
    return res.status(400).json({ success: false, code: "TRANSACTION_PIN_MISMATCH", message: "Transaction PINs do not match." });
  }
  try {
    await setTransactionPin(userId, pin, { allowExisting: false });
    return res.status(201).json({ success: true, message: "Transaction PIN created successfully.", transactionPinSet: true });
  } catch (error) {
    return sendError(res, error, "Unable to create transaction PIN.");
  }
};

exports.verifyTransactionPin = async (req, res) => {
  const userId = userIdFor(req);
  if (!userId) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized." });
  }
  try {
    await verifyPin(userId, req.body?.pin);
    return res.status(200).json({ success: true, message: "Transaction PIN verified successfully." });
  } catch (error) {
    return sendError(res, error, "Unable to verify transaction PIN.");
  }
};

exports.changeTransactionPin = async (req, res) => {
  const userId = userIdFor(req);
  if (!userId) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized." });
  }
  const { currentPin, newPin, confirmNewPin } = req.body || {};
  if (String(newPin || "").trim() !== String(confirmNewPin || "").trim()) {
    return res.status(400).json({ success: false, code: "TRANSACTION_PIN_MISMATCH", message: "New transaction PINs do not match." });
  }
  try {
    await changePin(userId, currentPin, newPin);
    return res.status(200).json({ success: true, message: "Transaction PIN changed successfully.", transactionPinSet: true });
  } catch (error) {
    return sendError(res, error, "Unable to change transaction PIN.");
  }
};

exports.resetTransactionPin = async (req, res) => {
  const userId = userIdFor(req);
  if (!userId) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", message: "Unauthorized." });
  }
  const currentPassword = String(req.body?.currentPassword || "");
  const newPin = String(req.body?.newPin || "").trim();
  const confirmPin = String(req.body?.confirmPin || "").trim();
  if (!currentPassword.trim()) {
    return res.status(400).json({ success: false, code: "PASSWORD_REQUIRED", message: "Enter your current password." });
  }
  if (newPin !== confirmPin) {
    return res.status(400).json({ success: false, code: "TRANSACTION_PIN_MISMATCH", message: "Transaction PINs do not match." });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await loadTransactionPinUser(userId, session);
      if (String(user.role || "").trim().toUpperCase() !== "CUSTOMER") {
        throw Object.assign(new Error("This feature is available to customer accounts only."), { code: "CUSTOMER_ONLY", statusCode: 403 });
      }
      const password = await user.constructor.findById(userId)
        .select("+password").session(session);
      const saved = String(password?.password || "");
      const correct = bcryptHash(saved)
        ? await password.comparePassword(currentPassword)
        : saved === currentPassword;
      if (!correct) {
        throw Object.assign(new Error("Current password is incorrect."), { code: "INCORRECT_PASSWORD", statusCode: 401 });
      }
      // A truly new customer should use the create flow. A stale "set" flag
      // (or a corrupt stored value) is recoverable here after authentication.
      if (!user.transactionPinSet && !user.transactionPin) {
        throw Object.assign(
          new Error("Please create your transaction PIN first."),
          { code: "TRANSACTION_PIN_NOT_SET", statusCode: 409 }
        );
      }
      if (!bcryptHash(saved)) {
        password.password = currentPassword;
        password.passwordChangedAt = new Date();
        await password.save({ session });
      }
      const result = await resetPin(userId, newPin, { session });
      await AdminAuditLog.create([{
        actorId: result.user._id, actorRole: "CUSTOMER", actorName: result.user.fullName || "",
        targetUserId: result.user._id, targetUserName: result.user.fullName || "",
        action: "TRANSACTION_PIN_RESET",
        reason: "Customer reset transaction PIN after password verification.",
        newData: { transactionPinSet: true, transactionPinUpdatedAt: result.user.transactionPinUpdatedAt },
        metadata: { source: "CUSTOMER_SELF_SERVICE" }, ipAddress: req.ip || "",
        userAgent: req.get?.("user-agent") || "", requestMethod: req.method || "POST",
        requestPath: req.originalUrl || req.path || "/api/transaction-pin/reset", status: "SUCCESSFUL",
      }], { session });
    });
    return res.status(200).json({ success: true, message: "Transaction PIN reset successfully.", transactionPinSet: true });
  } catch (error) {
    return sendError(res, error, "Unable to reset transaction PIN.");
  } finally {
    await session.endSession();
  }
};