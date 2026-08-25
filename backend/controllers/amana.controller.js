const crypto = require("crypto");
const mongoose = require("mongoose");
const AmanaOrder = require("../models/amanaOrder.model");
const { uploadMany, buildSignedUrl } = require("../services/amanaDocument.service");

const PROTECTED_CATEGORIES = ["FOOD_PACKAGE", "SCHOOL_FEES", "MEDICAL_SUPPORT"];
const CUSTOMER_CANCELLABLE = new Set(["SUBMITTED", "MORE_INFORMATION_REQUIRED", "UNDER_REVIEW"]);

const cleanText = (value) => (typeof value === "string" ? value.trim() : "");
const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : null;
};
const parseObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
};
const normalizePhone = (value) => {
  let phone = cleanText(value).replace(/[\s-]/g, "");
  if (phone.startsWith("+234")) phone = `0${phone.slice(4)}`;
  if (phone.startsWith("234") && phone.length === 13) phone = `0${phone.slice(3)}`;
  return phone;
};
const isPhone = (phone) => /^0[789][01]\d{8}$/.test(phone);
const getUserId = (req) => req.user?._id || req.user?.id;
const getFiles = (req) => Object.values(req.files || {}).flat();

const generateReference = () => `AMANA-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
const addHistory = (order, { action, actorId, actorRole = "CUSTOMER", fromStatus = "", toStatus = "", message = "" }) => {
  order.statusHistory.push({ action, actorId: actorId || null, actorRole, fromStatus, toStatus, message, occurredAt: new Date() });
};

const validateBeneficiary = (beneficiary) => {
  const result = {
    fullName: cleanText(beneficiary.fullName),
    phone: normalizePhone(beneficiary.phone),
    email: cleanText(beneficiary.email).toLowerCase(),
    relationship: cleanText(beneficiary.relationship),
    state: cleanText(beneficiary.state),
    lga: cleanText(beneficiary.lga),
    address: cleanText(beneficiary.address),
    landmark: cleanText(beneficiary.landmark),
  };
  if (result.fullName.length < 3) {
    const error = new Error("Please enter the beneficiary's full name.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (!isPhone(result.phone)) {
    const error = new Error("Please enter a valid Nigerian beneficiary phone number.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (!result.state || !result.lga || result.address.length < 5) {
    const error = new Error("Please enter the beneficiary's state, LGA, and complete address.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return result;
};

const validateCategoryDetails = (category, raw) => {
  const details = {
    householdSize: raw.householdSize ? Number(raw.householdSize) : null,
    foodItems: Array.isArray(raw.foodItems) ? raw.foodItems.map(cleanText).filter(Boolean).slice(0, 20) : cleanText(raw.foodItems).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 20),
    deliveryInstructions: cleanText(raw.deliveryInstructions),
    schoolName: cleanText(raw.schoolName),
    studentName: cleanText(raw.studentName),
    classLevel: cleanText(raw.classLevel),
    termSession: cleanText(raw.termSession),
    studentId: cleanText(raw.studentId),
    facilityName: cleanText(raw.facilityName || raw.hospitalName),
    patientName: cleanText(raw.patientName),
    treatmentDescription: cleanText(raw.treatmentDescription),
    invoiceNumber: cleanText(raw.invoiceNumber),
  };
  if (category === "FOOD_PACKAGE" && (!Number.isInteger(details.householdSize) || details.householdSize < 1 || !details.foodItems.length)) {
    const error = new Error("Food Package requests require household size and at least one food item.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (category === "SCHOOL_FEES" && (!details.schoolName || !details.studentName || !details.classLevel || !details.termSession)) {
    const error = new Error("School Fees requests require school, student, class level, and term or session.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  if (category === "MEDICAL_SUPPORT" && (!details.facilityName || !details.patientName || details.treatmentDescription.length < 8)) {
    const error = new Error("Medical Support requests require facility, patient, and treatment details.");
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return details;
};

const expectedProviderTypes = { FOOD_PACKAGE: "FOOD_VENDOR", SCHOOL_FEES: "SCHOOL", MEDICAL_SUPPORT: "HOSPITAL" };
const buildProvider = (category, raw) => ({
  type: cleanText(raw.type).toUpperCase() || expectedProviderTypes[category],
  name: cleanText(raw.name || raw.schoolName || raw.facilityName || raw.hospitalName),
  phone: normalizePhone(raw.phone),
  accountName: cleanText(raw.accountName),
  accountNumber: cleanText(raw.accountNumber),
  bankName: cleanText(raw.bankName),
  address: cleanText(raw.address),
  additionalInformation: cleanText(raw.additionalInformation),
  verificationStatus: "PENDING",
});

const documentWithUrl = (document) => {
  if (!document?.assetId) return null;
  let url = "";
  try { url = buildSignedUrl(document); } catch (_) {}
  return { assetId: document.assetId, originalName: document.originalName, mimeType: document.mimeType, uploadedAt: document.uploadedAt, url };
};

const customerOrder = (order) => {
  const safe = typeof order?.toSafeObject === "function" ? order.toSafeObject() : order.toObject ? order.toObject() : { ...order };
  safe.supportingDocuments = (safe.supportingDocuments || []).map(documentWithUrl).filter(Boolean);
  if (safe.fulfilmentProof) {
    safe.fulfilmentProof = {
      ...safe.fulfilmentProof,
      receipt: documentWithUrl(safe.fulfilmentProof.receipt),
      documents: (safe.fulfilmentProof.documents || []).map(documentWithUrl).filter(Boolean),
    };
  }
  return safe;
};

const createAmanaOrder = async (req, res) => {
  try {
    const customerId = getUserId(req);
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const category = cleanText(req.body.category).toUpperCase();
    if (!PROTECTED_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: "ServicePay Amana currently supports Food Package, School Fees, and Medical Support." });
    }
    const title = cleanText(req.body.title);
    const description = cleanText(req.body.description);
    const amount = parseAmount(req.body.amount);
    if (title.length < 3 || title.length > 150) return res.status(400).json({ success: false, message: "Request title must be between 3 and 150 characters." });
    if (description.length < 10 || description.length > 2000) return res.status(400).json({ success: false, message: "Please provide a clear description of the request." });
    if (amount === null || amount < 100) return res.status(400).json({ success: false, message: "The minimum protected Amana request amount is ₦100." });

    const beneficiary = validateBeneficiary(parseObject(req.body.beneficiary));
    const categoryDetails = validateCategoryDetails(category, {
      ...parseObject(req.body.categoryDetails),
      ...parseObject(req.body.schoolDetails),
      ...parseObject(req.body.medicalDetails),
    });
    const provider = buildProvider(category, parseObject(req.body.providerDetails));
    const files = getFiles(req);
    if (!files.length) return res.status(400).json({ success: false, message: "Attach at least one supporting document for this protected request." });
    if (files.length > 5) return res.status(400).json({ success: false, message: "You can attach up to five supporting documents." });

    let reference = generateReference();
    while (await AmanaOrder.exists({ reference })) reference = generateReference();
    const documents = await uploadMany(files, `servicepay/amana/${customerId}/${reference}`);
    const order = await AmanaOrder.create({
      customer: customerId,
      reference,
      category,
      title,
      description,
      beneficiary,
      categoryDetails,
      providerDetails: provider,
      supportingDocuments: documents,
      amount,
      serviceFee: 0,
      deliveryFee: 0,
      totalAmount: amount,
      fundingRequired: 0,
      fundedAmount: 0,
      status: "SUBMITTED",
      paymentMethod: "PROTECTED_PROVIDER_PAYMENT",
      paymentStatus: "NOT_APPLICABLE",
      preferredFulfilmentDate: req.body.preferredFulfilmentDate ? new Date(req.body.preferredFulfilmentDate) : null,
    });
    addHistory(order, { action: "REQUEST_SUBMITTED", actorId: customerId, toStatus: "SUBMITTED", message: "Protected support request submitted." });
    await order.save();
    return res.status(201).json({
      success: true,
      message: "Your protected Amana request has been submitted for Head Office review. Funds will only be paid to a verified provider.",
      data: { order: customerOrder(order) },
    });
  } catch (error) {
    const validationErrors = new Set([
      "UNSUPPORTED_DOCUMENT",
      "DOCUMENT_TOO_LARGE",
      "VALIDATION_ERROR",
    ]);
    const status = validationErrors.has(error?.code) ? 400 : error?.code === "STORAGE_UNAVAILABLE" ? 503 : 500;
    if (validationErrors.has(error?.code)) return res.status(400).json({ success: false, message: error.message });
    console.error("Create Amana request error:", error);
    return res.status(status).json({ success: false, message: status === 503 ? "Secure document storage is temporarily unavailable. Please retry." : "Unable to submit the Amana request." });
  }
};

const getMyAmanaOrders = async (req, res) => {
  try {
    const customerId = getUserId(req);
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized." });
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const filter = { customer: customerId };
    if (cleanText(req.query.status)) filter.status = cleanText(req.query.status).toUpperCase();
    if (PROTECTED_CATEGORIES.includes(cleanText(req.query.category).toUpperCase())) filter.category = cleanText(req.query.category).toUpperCase();
    const [orders, total] = await Promise.all([
      AmanaOrder.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      AmanaOrder.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data: { orders: orders.map(customerOrder), pagination: { page, limit, total, totalPages: Math.max(Math.ceil(total / limit), 1) } } });
  } catch (error) {
    console.error("Get Amana requests error:", error);
    return res.status(500).json({ success: false, message: "Unable to load your Amana requests." });
  }
};

const getMyAmanaOrderById = async (req, res) => {
  try {
    const customerId = getUserId(req);
    if (!customerId || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    const order = await AmanaOrder.findOne({ _id: req.params.id, customer: customerId });
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    return res.status(200).json({ success: true, data: { order: customerOrder(order) } });
  } catch (error) {
    console.error("Get Amana request error:", error);
    return res.status(500).json({ success: false, message: "Unable to load the Amana request." });
  }
};

const provideRequestedInformation = async (req, res) => {
  try {
    const customerId = getUserId(req);
    if (!customerId || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    const order = await AmanaOrder.findOne({ _id: req.params.id, customer: customerId });
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (order.status !== "MORE_INFORMATION_REQUIRED") return res.status(409).json({ success: false, message: "This request is not awaiting further information." });
    const note = cleanText(req.body.note);
    const files = getFiles(req);
    if (note.length < 3 && !files.length) return res.status(400).json({ success: false, message: "Provide a response or an additional supporting document." });
    if (files.length) order.supportingDocuments.push(...await uploadMany(files, `servicepay/amana/${customerId}/${order.reference}`));
    const previous = order.status;
    order.status = "SUBMITTED";
    order.moreInformationRequest = "";
    addHistory(order, { action: "INFORMATION_PROVIDED", actorId: customerId, fromStatus: previous, toStatus: "SUBMITTED", message: note || "Additional supporting documents provided." });
    await order.save();
    return res.status(200).json({ success: true, message: "Your additional information has been sent for review.", data: { order: customerOrder(order) } });
  } catch (error) {
    console.error("Provide Amana information error:", error);
    return res.status(error?.code === "STORAGE_UNAVAILABLE" ? 503 : 400).json({ success: false, message: error?.code === "STORAGE_UNAVAILABLE" ? "Secure document storage is temporarily unavailable. Please retry." : error.message || "Unable to send additional information." });
  }
};

const cancelMyAmanaOrder = async (req, res) => {
  try {
    const customerId = getUserId(req);
    const reason = cleanText(req.body.cancellationReason);
    if (!customerId || !mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (reason.length < 3) return res.status(400).json({ success: false, message: "Please provide a reason for cancelling the request." });
    const order = await AmanaOrder.findOne({ _id: req.params.id, customer: customerId });
    if (!order) return res.status(404).json({ success: false, message: "ServicePay Amana request not found." });
    if (!CUSTOMER_CANCELLABLE.has(order.status)) return res.status(409).json({ success: false, message: "This request can no longer be cancelled by the customer because it is being funded or fulfilled." });
    const previous = order.status;
    order.status = "CANCELLED";
    order.cancellationReason = reason;
    order.cancelledAt = new Date();
    addHistory(order, { action: "CUSTOMER_CANCELLED", actorId: customerId, fromStatus: previous, toStatus: "CANCELLED", message: reason });
    await order.save();
    return res.status(200).json({ success: true, message: "ServicePay Amana request cancelled.", data: { order: customerOrder(order) } });
  } catch (error) {
    console.error("Cancel Amana request error:", error);
    return res.status(500).json({ success: false, message: "Unable to cancel the Amana request." });
  }
};

module.exports = {
  createAmanaOrder,
  getMyAmanaOrders,
  getMyAmanaOrderById,
  provideRequestedInformation,
  cancelMyAmanaOrder,
  _internal: { parseAmount, validateCategoryDetails, buildProvider, PROTECTED_CATEGORIES },
};