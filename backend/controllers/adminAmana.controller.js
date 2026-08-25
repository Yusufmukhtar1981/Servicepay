const mongoose = require("mongoose");
const AmanaOrder = require("../models/amanaOrder.model");
const AmanaFundingRecord = require("../models/amanaFundingRecord.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { uploadMany, uploadOne, buildSignedUrl } = require("../services/amanaDocument.service");

const PROTECTED_STATUSES = [
  "SUBMITTED", "MORE_INFORMATION_REQUIRED", "UNDER_REVIEW", "APPROVED",
  "FUNDING_IN_PROGRESS", "FULLY_FUNDED", "PAID_TO_PROVIDER", "FULFILLED",
  "COMPLETED", "REJECTED", "CANCELLED",
];
const getAdminId = (req) => req.user?._id || req.user?.id;
const cleanText = (value) => (typeof value === "string" ? value.trim() : "");
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);
const amount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : null;
};
const adminActor = (req) => ({
  actorId: getAdminId(req),
  actorRole: String(req.user?.role || "HEAD_OFFICE").toUpperCase(),
  actorName: cleanText(req.user?.fullName || req.user?.name),
});
const addHistory = (order, { action, req, fromStatus = "", toStatus = "", message = "" }) => {
  const actor = adminActor(req);
  order.statusHistory.push({ action, actorId: actor.actorId || null, actorRole: actor.actorRole, fromStatus, toStatus, message, occurredAt: new Date() });
};
const documentWithUrl = (document) => {
  if (!document?.assetId) return null;
  let url = "";
  try { url = buildSignedUrl(document); } catch (_) {}
  return { assetId: document.assetId, originalName: document.originalName, mimeType: document.mimeType, uploadedAt: document.uploadedAt, url };
};
const adminOrder = (order) => {
  const result = order?.toObject ? order.toObject() : { ...order };
  result.supportingDocuments = (result.supportingDocuments || []).map(documentWithUrl).filter(Boolean);
  if (result.providerPayment?.receipt) result.providerPayment.receipt = documentWithUrl(result.providerPayment.receipt);
  if (result.fulfilmentProof) {
    result.fulfilmentProof = {
      ...result.fulfilmentProof,
      receipt: documentWithUrl(result.fulfilmentProof.receipt),
      documents: (result.fulfilmentProof.documents || []).map(documentWithUrl).filter(Boolean),
    };
  }
  return result;
};
const getFiles = (req) => Object.values(req.files || {}).flat();

const audit = async ({ req, action, order, reason, previousData = null, newData = null, metadata = null, session = null }) => {
  const actor = adminActor(req);
  const payload = {
    ...actor,
    targetUserId: order.customer,
    targetUserName: cleanText(order.beneficiary?.fullName),
    action,
    reason: cleanText(reason).slice(0, 500) || "Amana protected-support action.",
    previousData,
    newData,
    metadata: { ...(metadata || {}), amanaOrderId: String(order._id), amanaReference: order.reference },
    ipAddress: cleanText(req.ip),
    userAgent: cleanText(req.get?.("user-agent")),
    requestMethod: req.method,
    requestPath: req.originalUrl,
  };
  if (session) {
    await AdminAuditLog.create([payload], { session });
  } else {
    await AdminAuditLog.create(payload);
  }
};
const respondError = (res, error, fallback) => {
  if (error?.code === "STORAGE_UNAVAILABLE") return res.status(503).json({ success: false, message: "Secure document storage is temporarily unavailable. Please retry." });
  if (["UNSUPPORTED_DOCUMENT", "DOCUMENT_TOO_LARGE"].includes(error?.code)) return res.status(400).json({ success: false, message: error.message });
  console.error("Admin Amana error:", error);
  return res.status(500).json({ success: false, message: fallback });
};
const loadOrder = async (id) => (isObjectId(id) ? AmanaOrder.findById(id) : null);
const requireStatus = (order, statuses, message) => {
  if (!statuses.includes(order.status)) {
    const error = new Error(message);
    error.code = "INVALID_TRANSITION";
    throw error;
  }
};
const sendTransitionError = (res, error) => {
  if (error?.code === "INVALID_TRANSITION") return res.status(409).json({ success: false, message: error.message });
  return null;
};

/*
 * State changes and their audit records are one unit of work. A failed audit
 * must never leave a protected request in a new financial/operational state.
 */
const saveWithAudit = async ({
  req,
  order,
  action,
  reason,
  previousData = null,
  newData = null,
  metadata = null,
}) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      order.$session(session);
      await order.save({ session });
      await audit({ req, action, order, reason, previousData, newData, metadata, session });
    });
  } finally {
    await session.endSession();
  }
};

const getAllAmanaOrders = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = {};
    const status = cleanText(req.query.status).toUpperCase();
    const category = cleanText(req.query.category).toUpperCase();
    if (status && [...PROTECTED_STATUSES, "PENDING_PAYMENT", "PAID", "PROCESSING", "ASSIGNED", "REFUNDED"].includes(status)) filter.status = status;
    if (category) filter.category = category;
    const search = cleanText(req.query.search);
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(safe, "i");
      filter.$or = [{ reference: regex }, { title: regex }, { "beneficiary.fullName": regex }, { "providerDetails.name": regex }];
    }
    const [orders, total, summary] = await Promise.all([
      AmanaOrder.find(filter).populate("customer", "fullName phone email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AmanaOrder.countDocuments(filter),
      AmanaOrder.aggregate([{ $match: filter }, { $group: { _id: null, requestedAmount: { $sum: "$amount" }, fundedAmount: { $sum: "$fundedAmount" }, completed: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } } } }]),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        orders: orders.map(adminOrder),
        summary: summary[0] || { requestedAmount: 0, fundedAmount: 0, completed: 0 },
        pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) },
      },
    });
  } catch (error) {
    return respondError(res, error, "Unable to load Amana requests.");
  }
};

const getAmanaOrderById = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    return res.status(200).json({ success: true, data: { order: adminOrder(order) } });
  } catch (error) {
    return respondError(res, error, "Unable to load the Amana request.");
  }
};

const requestMoreInformation = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const message = cleanText(req.body.message || req.body.note);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (message.length < 3) return res.status(400).json({ success: false, message: "Explain what additional information is required." });
    requireStatus(order, ["SUBMITTED", "UNDER_REVIEW"], "Only an unapproved request can be sent back for more information.");
    const previous = order.status;
    order.status = "MORE_INFORMATION_REQUIRED";
    order.moreInformationRequest = message;
    addHistory(order, { action: "MORE_INFORMATION_REQUESTED", req, fromStatus: previous, toStatus: order.status, message });
    await saveWithAudit({
      req, order, action: "AMANA_INFORMATION_REQUESTED", reason: message,
      previousData: { status: previous }, newData: { status: order.status },
    });
    return res.status(200).json({ success: true, message: "Customer has been asked for more information.", data: { order: adminOrder(order) } });
  } catch (error) {
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to request more information.");
  }
};

const updateProvider = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (order.providerDetails?.verificationStatus === "VERIFIED" || ["PAID_TO_PROVIDER", "FULFILLED", "COMPLETED"].includes(order.status)) {
      return res.status(409).json({ success: false, message: "A verified or paid provider cannot be replaced. Reject the provider before changing details." });
    }
    const next = {
      type: cleanText(req.body.type).toUpperCase() || order.providerDetails.type || "OTHER",
      name: cleanText(req.body.name),
      phone: cleanText(req.body.phone),
      accountName: cleanText(req.body.accountName),
      accountNumber: cleanText(req.body.accountNumber),
      bankName: cleanText(req.body.bankName),
      address: cleanText(req.body.address),
      additionalInformation: cleanText(req.body.additionalInformation),
      verificationStatus: "PENDING",
      verifiedBy: null,
      verifiedAt: null,
      verificationNote: "",
    };
    if (next.name.length < 2) return res.status(400).json({ success: false, message: "Provider name is required." });
    const previous = order.providerDetails.toObject ? order.providerDetails.toObject() : order.providerDetails;
    order.providerDetails = next;
    addHistory(order, { action: "PROVIDER_UPDATED", req, message: "Provider details updated and returned to verification." });
    await saveWithAudit({
      req, order, action: "AMANA_PROVIDER_UPDATED", reason: "Provider details updated.",
      previousData: previous, newData: next,
    });
    return res.status(200).json({ success: true, message: "Provider details saved. Verification is required before payment.", data: { order: adminOrder(order) } });
  } catch (error) {
    return respondError(res, error, "Unable to update provider details.");
  }
};

const verifyProvider = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const decision = cleanText(req.body.decision || req.body.status).toUpperCase();
    const note = cleanText(req.body.note);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (!["VERIFIED", "REJECTED"].includes(decision)) return res.status(400).json({ success: false, message: "Provider decision must be VERIFIED or REJECTED." });
    if (order.status === "PAID_TO_PROVIDER" || order.status === "FULFILLED" || order.status === "COMPLETED") return res.status(409).json({ success: false, message: "Provider verification cannot change after payment." });
    if (decision === "VERIFIED") {
      const provider = order.providerDetails || {};
      if ([provider.name, provider.phone, provider.accountName, provider.accountNumber, provider.bankName].some((value) => cleanText(value).length < 2)) {
        return res.status(400).json({ success: false, message: "Provider name, phone, account name, account number, and bank are required before verification." });
      }
    }
    if (decision === "REJECTED" && note.length < 3) return res.status(400).json({ success: false, message: "Explain why this provider was rejected." });
    const previous = order.providerDetails.verificationStatus;
    order.providerDetails.verificationStatus = decision;
    order.providerDetails.verifiedBy = decision === "VERIFIED" ? getAdminId(req) : null;
    order.providerDetails.verifiedAt = decision === "VERIFIED" ? new Date() : null;
    order.providerDetails.verificationNote = note;
    addHistory(order, { action: `PROVIDER_${decision}`, req, message: note || "Provider verification completed." });
    await saveWithAudit({
      req, order, action: "AMANA_PROVIDER_VERIFIED",
      reason: note || `Provider ${decision.toLowerCase()}.`,
      previousData: { verificationStatus: previous },
      newData: { verificationStatus: decision },
    });
    return res.status(200).json({ success: true, message: `Provider ${decision.toLowerCase()}.`, data: { order: adminOrder(order) } });
  } catch (error) {
    return respondError(res, error, "Unable to verify provider.");
  }
};

const approveAmanaOrder = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const approvedAmount = amount(req.body.approvedAmount ?? req.body.amount);
    const note = cleanText(req.body.note);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    requireStatus(order, ["SUBMITTED", "UNDER_REVIEW"], "Only a submitted request can be approved.");
    if (approvedAmount === null || approvedAmount < 100 || approvedAmount > Number(order.amount)) return res.status(400).json({ success: false, message: "Approved amount must be at least ₦100 and cannot exceed the requested amount." });
    const previous = order.status;
    order.status = "APPROVED";
    order.approvedAmount = approvedAmount;
    order.fundingRequired = approvedAmount;
    order.fundedAmount = 0;
    order.approvedBy = getAdminId(req);
    order.approvedAt = new Date();
    order.approvalNote = note;
    addHistory(order, { action: "REQUEST_APPROVED", req, fromStatus: previous, toStatus: order.status, message: note || "Request approved for controlled funding." });
    await saveWithAudit({
      req, order, action: "AMANA_REQUEST_APPROVED", reason: note || "Request approved.",
      previousData: { status: previous }, newData: { status: order.status, approvedAmount },
    });
    return res.status(200).json({ success: true, message: "Request approved. It can now receive controlled funding.", data: { order: adminOrder(order) } });
  } catch (error) {
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to approve request.");
  }
};

const rejectAmanaOrder = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const reason = cleanText(req.body.reason || req.body.rejectionReason || req.body.note);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    requireStatus(order, ["SUBMITTED", "MORE_INFORMATION_REQUIRED", "UNDER_REVIEW", "APPROVED"], "This request can no longer be rejected.");
    if (reason.length < 3) return res.status(400).json({ success: false, message: "Provide a rejection reason." });
    const previous = order.status;
    order.status = "REJECTED";
    order.rejectionReason = reason;
    order.rejectedAt = new Date();
    addHistory(order, { action: "REQUEST_REJECTED", req, fromStatus: previous, toStatus: order.status, message: reason });
    await saveWithAudit({
      req, order, action: "AMANA_REQUEST_REJECTED", reason,
      previousData: { status: previous }, newData: { status: order.status },
    });
    return res.status(200).json({ success: true, message: "Request rejected.", data: { order: adminOrder(order) } });
  } catch (error) {
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to reject request.");
  }
};

const recordFunding = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const funded = amount(req.body.amount);
    const sourceType = cleanText(req.body.sourceType).toUpperCase();
    const reference = cleanText(req.body.reference).toUpperCase();
    const idempotencyKey = cleanText(req.body.idempotencyKey || reference);
    const receiptReference = cleanText(req.body.receiptReference);
    const order = await loadOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (funded === null || funded <= 0 || !["HEAD_OFFICE", "NGO", "COMPANY", "DONOR_RESERVED"].includes(sourceType) || !reference || !idempotencyKey || receiptReference.length < 3) {
      return res.status(400).json({ success: false, message: "Amount, controlled funding source, reference, and idempotency key are required." });
    }
    let responseOrder;
    let duplicate = false;
    await session.withTransaction(async () => {
      const existingRecords = await AmanaFundingRecord.find({
        $or: [{ idempotencyKey }, { reference }],
      }).session(session);
      if (existingRecords.length) {
        const exactMatch = existingRecords.find((existing) =>
          String(existing.amanaOrder) === String(order._id) &&
          existing.idempotencyKey === idempotencyKey &&
          existing.reference === reference &&
          Number(existing.amount) === funded &&
          existing.sourceType === sourceType &&
          existing.receiptReference === receiptReference
        );
        if (!exactMatch || existingRecords.length !== 1) {
          const error = new Error("This reconciled funding reference is already attached to another Amana request.");
          error.code = "GLOBAL_FUNDING_DUPLICATE";
          throw error;
        }
        duplicate = true;
        responseOrder = await AmanaOrder.findById(order._id).session(session);
        return;
      }

      const fresh = await AmanaOrder.findById(order._id).session(session);
      requireStatus(fresh, ["APPROVED", "FUNDING_IN_PROGRESS"], "Funding can only be recorded after approval.");
      const remaining = Math.round((Number(fresh.fundingRequired) - Number(fresh.fundedAmount) + Number.EPSILON) * 100) / 100;
      if (funded > remaining) {
        const error = new Error(`Funding exceeds the remaining approved amount of ₦${remaining.toFixed(2)}.`);
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      const nextFunded = Math.round((Number(fresh.fundedAmount) + funded + Number.EPSILON) * 100) / 100;
      const nextStatus = nextFunded === Number(fresh.fundingRequired) ? "FULLY_FUNDED" : "FUNDING_IN_PROGRESS";
      const previous = { status: fresh.status, fundedAmount: fresh.fundedAmount };
      const history = {
        action: "FUNDING_RECORDED",
        actorId: getAdminId(req),
        actorRole: String(req.user?.role || "HEAD_OFFICE").toUpperCase(),
        fromStatus: fresh.status,
        toStatus: nextStatus,
        message: `₦${funded.toFixed(2)} funding reconciled from ${sourceType}.`,
        occurredAt: new Date(),
      };
      const updated = await AmanaOrder.findOneAndUpdate(
        { _id: fresh._id, status: fresh.status, fundedAmount: fresh.fundedAmount },
        {
          $set: { fundedAmount: nextFunded, status: nextStatus },
          $push: {
            fundingEvents: { amount: funded, sourceType, reference, receiptReference, idempotencyKey, recordedBy: getAdminId(req), recordedAt: new Date() },
            statusHistory: history,
          },
        },
        { new: true, session }
      );
      if (!updated) {
        const error = new Error("Funding changed while this record was being processed. Please refresh and retry.");
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      await AmanaFundingRecord.create([{
        amanaOrder: updated._id,
        amount: funded,
        sourceType,
        reference,
        receiptReference,
        idempotencyKey,
        recordedBy: getAdminId(req),
      }], { session });
      await audit({
        req,
        action: "AMANA_FUNDING_RECORDED",
        order: updated,
        reason: `Controlled funding ${reference}.`,
        previousData: previous,
        newData: { status: updated.status, fundedAmount: updated.fundedAmount },
        metadata: { sourceType, reference, idempotencyKey, receiptReference },
        session,
      });
      responseOrder = updated;
    });
    return res.status(200).json({
      success: true,
      duplicate,
      message: duplicate
        ? "This funding record was already applied."
        : responseOrder.status === "FULLY_FUNDED"
          ? "Request is fully funded and awaiting verified-provider payment."
          : "Funding recorded.",
      data: { order: adminOrder(responseOrder) },
    });
  } catch (error) {
    if (error?.code === "GLOBAL_FUNDING_DUPLICATE" || error?.code === 11000) {
      return res.status(409).json({ success: false, message: error.message || "This funding reference has already been reconciled." });
    }
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to record funding.");
  } finally {
    await session.endSession();
  }
};

const recordProviderPayment = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const order = await loadOrder(req.params.id);
    const paidAmount = amount(req.body.amount);
    const reference = cleanText(req.body.paymentReference || req.body.reference);
    const idempotencyKey = cleanText(req.body.idempotencyKey || reference);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (order.providerPayment?.idempotencyKey === idempotencyKey && idempotencyKey) {
      return res.status(200).json({ success: true, duplicate: true, message: "This provider payment was already recorded.", data: { order: adminOrder(order) } });
    }
    if (paidAmount === null || paidAmount !== Number(order.fundingRequired) || !reference || !idempotencyKey) return res.status(400).json({ success: false, message: "Manual provider payment must include an idempotency key, reference, and the exact approved amount." });
    const receiptFile = getFiles(req)[0];
    if (!receiptFile) return res.status(400).json({ success: false, message: "Attach the external-payment receipt before recording provider payment." });
    const receipt = await uploadOne(receiptFile, `servicepay/amana/${order.customer}/${order.reference}/provider-payment`);
    let paidOrder;
    let duplicate = false;
    await session.withTransaction(async () => {
      const current = await AmanaOrder.findById(order._id).session(session);
      if (!current) {
        const error = new Error("ServicePay Amana request not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      if (current.providerPayment?.idempotencyKey === idempotencyKey) {
        duplicate = true;
        paidOrder = current;
        return;
      }
      if (current.status !== "FULLY_FUNDED" || current.providerDetails?.verificationStatus !== "VERIFIED" || current.providerPayment?.status !== "NOT_STARTED") {
        const error = new Error(
          current.providerDetails?.verificationStatus !== "VERIFIED"
            ? "Provider payment requires a verified provider."
            : "Provider payment requires a fully funded request with no prior provider payment."
        );
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      const history = {
        action: "PROVIDER_PAYMENT_RECORDED",
        actorId: getAdminId(req),
        actorRole: String(req.user?.role || "HEAD_OFFICE").toUpperCase(),
        fromStatus: "FULLY_FUNDED",
        toStatus: "PAID_TO_PROVIDER",
        message: `Manual external provider payment recorded: ${reference}.`,
        occurredAt: new Date(),
      };
      const updated = await AmanaOrder.findOneAndUpdate(
        {
          _id: current._id,
          status: "FULLY_FUNDED",
          "providerDetails.verificationStatus": "VERIFIED",
          "providerPayment.status": "NOT_STARTED",
        },
        {
          $set: {
            providerPayment: {
              status: "RECORDED",
              method: "MANUAL_EXTERNAL",
              amount: paidAmount,
              reference,
              idempotencyKey,
              receipt,
              recordedBy: getAdminId(req),
              recordedAt: new Date(),
              note: cleanText(req.body.note),
            },
            status: "PAID_TO_PROVIDER",
            paymentStatus: "PAID_TO_PROVIDER",
          },
          $push: { statusHistory: history },
        },
        { new: true, session }
      );
      if (!updated) {
        const error = new Error("Provider payment is already being processed or this request no longer meets payment controls.");
        error.code = "INVALID_TRANSITION";
        throw error;
      }
      await audit({
        req,
        action: "AMANA_PROVIDER_PAYMENT_RECORDED",
        order: updated,
        reason: `Manual external payment ${reference}.`,
        previousData: { status: "FULLY_FUNDED" },
        newData: { status: updated.status, amount: paidAmount },
        metadata: { reference, idempotencyKey, method: "MANUAL_EXTERNAL" },
        session,
      });
      paidOrder = updated;
    });
    return res.status(200).json({
      success: true,
      duplicate,
      message: duplicate ? "This provider payment was already recorded." : "Protected provider payment recorded. The beneficiary wallet was not credited.",
      data: { order: adminOrder(paidOrder) },
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "This provider payment has already been recorded." });
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to record provider payment.");
  } finally {
    await session.endSession();
  }
};

const addAmanaFulfilmentProof = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const files = getFiles(req);
    const notes = cleanText(req.body.notes);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    requireStatus(order, ["PAID_TO_PROVIDER"], "Fulfilment proof can only be recorded after verified provider payment.");
    if (!files.length && notes.length < 3) return res.status(400).json({ success: false, message: "Attach fulfilment proof or provide a clear fulfilment note." });
    const documents = files.length ? await uploadMany(files, `servicepay/amana/${order.customer}/${order.reference}/fulfilment`) : [];
    const previous = order.status;
    order.fulfilmentProof = { receipt: documents[0] || null, documents, notes, uploadedBy: getAdminId(req), uploadedAt: new Date() };
    order.status = "FULFILLED";
    addHistory(order, { action: "FULFILMENT_PROOF_ADDED", req, fromStatus: previous, toStatus: order.status, message: notes || "Fulfilment proof uploaded." });
    await saveWithAudit({
      req, order, action: "AMANA_FULFILMENT_PROOF_ADDED",
      reason: notes || "Fulfilment proof uploaded.",
      previousData: { status: previous }, newData: { status: order.status },
    });
    return res.status(200).json({ success: true, message: "Fulfilment proof recorded.", data: { order: adminOrder(order) } });
  } catch (error) {
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to add fulfilment proof.");
  }
};

const completeAmanaOrder = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    requireStatus(order, ["FULFILLED"], "Only a fulfilled request with proof can be completed.");
    if (!order.fulfilmentProof?.receipt && !(order.fulfilmentProof?.documents || []).length && cleanText(order.fulfilmentProof?.notes).length < 3) return res.status(409).json({ success: false, message: "Fulfilment proof is required before completion." });
    const previous = order.status;
    order.status = "COMPLETED";
    order.completedAt = new Date();
    addHistory(order, { action: "REQUEST_COMPLETED", req, fromStatus: previous, toStatus: order.status, message: cleanText(req.body.note) || "Protected support request completed." });
    await saveWithAudit({
      req, order, action: "AMANA_REQUEST_COMPLETED",
      reason: cleanText(req.body.note) || "Request completed with fulfilment proof.",
      previousData: { status: previous }, newData: { status: order.status },
    });
    return res.status(200).json({ success: true, message: "Amana request completed.", data: { order: adminOrder(order) } });
  } catch (error) {
    if (sendTransitionError(res, error)) return;
    return respondError(res, error, "Unable to complete request.");
  }
};

const cancelAmanaOrder = async (req, res) => {
  try {
    const order = await loadOrder(req.params.id);
    const reason = cleanText(req.body.reason || req.body.cancellationReason || req.body.note);
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (["PAID_TO_PROVIDER", "FULFILLED", "COMPLETED", "CANCELLED"].includes(order.status)) return res.status(409).json({ success: false, message: "A paid or completed request cannot be cancelled. Escalate it for support review." });
    if (reason.length < 3) return res.status(400).json({ success: false, message: "Provide a cancellation reason." });
    const previous = order.status;
    order.status = "CANCELLED";
    order.cancellationReason = reason;
    order.cancelledAt = new Date();
    addHistory(order, { action: "ADMIN_CANCELLED", req, fromStatus: previous, toStatus: order.status, message: reason });
    await saveWithAudit({
      req, order, action: "AMANA_REQUEST_CANCELLED", reason,
      previousData: { status: previous }, newData: { status: order.status },
    });
    return res.status(200).json({ success: true, message: "Amana request cancelled.", data: { order: adminOrder(order) } });
  } catch (error) {
    return respondError(res, error, "Unable to cancel request.");
  }
};

module.exports = {
  getAllAmanaOrders,
  getAmanaOrderById,
  requestMoreInformation,
  updateProvider,
  verifyProvider,
  approveAmanaOrder,
  rejectAmanaOrder,
  recordFunding,
  recordProviderPayment,
  addAmanaFulfilmentProof,
  completeAmanaOrder,
  cancelAmanaOrder,
  _internal: { amount, PROTECTED_STATUSES },
};