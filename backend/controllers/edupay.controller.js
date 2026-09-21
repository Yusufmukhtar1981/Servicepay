const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { customer, school, headOffice } = require("../middleware/edupay.middleware");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const SchoolHandoff = require("../models/edupaySchoolHandoff.model");
const User = require("../models/user.model");
const { getSettings, audit, notify, round, reference, hash, ensureObjectId, calculateSettlement, availableSavings, contributeFromWallet, contributeSponsorFromWallet, repayFromWallet, confirmSettlement, reverseSettlement, createEduLedger, createSettlement, models } = require("../services/edupay.service");
const { School, Child, Plan, Contribution, EduLedger, Fee, Settlement, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution } = models;
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const EDUPAY_READINESS_MODELS = { School, Child, Plan, Contribution, EduLedger, Fee, Settlement, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution, SchoolRequest };
const EduPaySettlementAccount = require("../models/edupaySettlementAccount.model");
const EduPayDutyAssignment = require("../models/edupayDutyAssignment.model");
const EduPaySettings = require("../models/edupaySettings.model");
const edupaySquad = require("../services/edupaySquad.service");
const { evaluateEduPayReadiness } = require("./featureControl.controller");
const edupaySquadService = require("../services/edupaySquad.service");
const { validateStrongPassword } = require("../utils/passwordPolicy");
const studentLink = require("../services/edupayStudentLink.service");

const SCHOOL_HANDOFF_COOKIE = "servicepay_school_handoff";
const SCHOOL_HANDOFF_TTL_MS = 2 * 60 * 1000;
const SCHOOL_MANAGEMENT_ROLES = new Set(["OWNER", "ADMIN", "SCHOOL_ADMIN"]);
const SCHOOL_PORTAL_ORIGIN = "https://admin.servicepay.ng";
const handoffCookieOptions = (req) => ({
  httpOnly: true,
  secure: req.secure || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https" || process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/edupay/school/handoff/consume",
});
const readCookie = (req, name) => String(req.headers.cookie || "")
  .split(";")
  .map((part) => part.trim().split("="))
  .find(([key]) => key === name)?.slice(1).join("=") || "";
const clearHandoffCookie = (req, res) => res.clearCookie(SCHOOL_HANDOFF_COOKIE, handoffCookieOptions(req));
const eligibleManagementMemberships = async (userId) => {
  const memberships = await SchoolUser.find({ user: userId, status: "ACTIVE", role: { $in: [...SCHOOL_MANAGEMENT_ROLES] } })
    .sort({ createdAt: 1 })
    .populate("school");
  return memberships.filter((row) => row.school && row.school.status === "APPROVED" && row.school.active);
};
const schoolSessionResponse = (user, membership) => {
  const schoolId = String(membership.school._id);
  const token = jwt.sign(
    { id: user._id, authTokenVersion: Number(user.authTokenVersion || 0), edupaySchool: membership.school._id },
    process.env.JWT_SECRET,
    { expiresIn: "12h" },
  );
  return {
    success: true,
    token,
    schoolId,
    school: publicSchool(membership.school),
    role: membership.role,
    schoolMembership: { schoolId, role: membership.role, status: membership.status, schoolStatus: membership.school.status },
    mustChangePassword: user.mustChangePassword === true,
    user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role },
  };
};

const safe = (doc) => doc?.toObject ? doc.toObject() : doc;
const publicSchool = (school) => { const row = safe(school) || {}; delete row.bankDetails; delete row.supportingDocuments; delete row.logo; delete row.portalUser; delete row.sourceRequest; delete row.normalizedSchoolName; delete row.normalizedLocation; delete row.normalizedAddress; delete row.sourceRequestNormalizedSchoolName; delete row.sourceRequestNormalizedLocation; return row; };
const schoolAdminDto = (school) => { const row = safe(school) || {}; if (row.bankDetails) row.bankDetails = { bankName: row.bankDetails.bankName, bankCode: row.bankDetails.bankCode, accountName: row.bankDetails.accountName, accountNumberLast4: row.bankDetails.accountNumberLast4 }; delete row.encryptedAccountNumber; delete row.logo; delete row.supportingDocuments; delete row.sourceRequest; delete row.normalizedSchoolName; delete row.normalizedLocation; delete row.normalizedAddress; delete row.sourceRequestNormalizedSchoolName; delete row.sourceRequestNormalizedLocation; return row; };
const schoolRequestDto = (request) => {
  const row = safe(request) || {};
  return {
    id: row._id,
    schoolName: row.schoolName,
    location: row.location,
    contactPhone: row.contactPhone || null,
    status: row.status,
    createdAt: row.createdAt,
    schoolId: row.school ? String(row.school) : null,
  };
};
const schoolRequestDetailDto = (request) => {
  const row = schoolRequestDto(request);
  return {
    ...row,
    type: "SCHOOL_REQUEST",
    approvedAt: safe(request)?.approvedAt || null,
    rejectedAt: safe(request)?.rejectedAt || null,
    rejectionReason: safe(request)?.rejectionReason || null,
    schoolId: safe(request)?.school ? String(safe(request).school) : null,
    requesterName: safe(request)?.parent?.fullName || null,
    requesterEmail: safe(request)?.parent?.email || null,
    requesterPhone: safe(request)?.parent?.phone || null,
  };
};
const normalizeRequestText = (value) =>
  String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
const schoolRequestIdentity = (request) => ({
  schoolName: normalizeRequestText(request.schoolName),
  location: normalizeRequestText(request.location),
});
const activeSchoolStatuses = ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "SUSPENDED"];
const escapedWhitespaceExact = (value) => String(value || "").trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
const findAuthoritativeSchoolIdentity = async ({ schoolName, location, session = null }) => {
  const normalizedSchoolName = normalizeRequestText(schoolName);
  const normalizedLocation = normalizeRequestText(location);
  let canonical = School.findOne({
    normalizedSchoolName,
    normalizedLocation,
    status: { $in: activeSchoolStatuses },
  }).select("_id");
  if (session) canonical = canonical.session(session);
  if (await canonical.lean()) return true;
  let legacy = School.findOne({
    name: { $regex: `^${escapedWhitespaceExact(schoolName)}$`, $options: "i" },
    address: { $regex: `^${escapedWhitespaceExact(location)}$`, $options: "i" },
    status: { $in: activeSchoolStatuses },
  }).select("_id");
  if (session) legacy = legacy.session(session);
  return Boolean(await legacy.lean());
};
const parsePrivateAsset = (value, allowed, maxBytes, label) => {
  const match = /^data:([a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(String(value || ""));
  if (!match || !allowed.has(match[1].toLowerCase())) throw Object.assign(new Error(`${label} must be an allowed base64 data URL.`), { statusCode: 400 });
  const encoded = match[2];
  if (encoded.length % 4 !== 0) throw Object.assign(new Error(`${label} contains invalid base64 data.`), { statusCode: 400 });
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== encoded) throw Object.assign(new Error(`${label} exceeds its decoded size limit or is invalid.`), { statusCode: 400 });
  const mime = match[1].toLowerCase();
  const validSignature = mime === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8
      : mime === "image/webp" ? bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP"
        : mime === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-";
  if (!validSignature) throw Object.assign(new Error(`${label} content does not match its MIME type.`), { statusCode: 400 });
  return String(value);
};
const PRIVATE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PRIVATE_DOCUMENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const validAssetBytes = (file) => file.mimetype === "image/png" ? file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  : file.mimetype === "image/jpeg" ? file.buffer[0] === 0xff && file.buffer[1] === 0xd8
    : file.mimetype === "image/webp" ? file.buffer.subarray(0, 4).toString() === "RIFF" && file.buffer.subarray(8, 12).toString() === "WEBP"
      : file.mimetype === "application/pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
const errorResponse = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.message || "EduPay request failed." });
const requireTemporaryPassword = (value) => {
  const check = validateStrongPassword(String(value || ""));
  if (!check.valid) {
    const error = new Error(check.message);
    error.statusCode = 400;
    throw error;
  }
  return String(value);
};
const publicSchoolCode = () => `EDU-${Date.now().toString(36).toUpperCase()}-${require("crypto").randomBytes(3).toString("hex").toUpperCase()}`;
const requireKey = (req) => String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim();
const enabledForInitiation = async (res) => {
  if (!(await evaluateEduPayReadiness())) {
    res.status(503).json({ success: false, code: "EDUPAY_NOT_READY", message: "EduPay is temporarily unavailable until payout configuration is ready." });
    return null;
  }
  return getSettings();
};

exports.dashboard = async (req, res) => {
  try {
    const [children, plans, repayments, contributions] = await Promise.all([
      Child.countDocuments({ parent: req.user._id, status: "ACTIVE" }),
      Plan.find({ parent: req.user._id }).populate("child school").sort({ createdAt: -1 }).limit(50).lean(),
      EduPayRepayment.find({ parent: req.user._id, status: { $in: ["ACTIVE", "PARTIALLY_PAID", "OVERDUE"] } }).lean(),
      Contribution.aggregate([{ $match: { parent: req.user._id, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    ]);
    const [settings, appSettings, financiallyReady] = await Promise.all([
      getSettings(),
      require("../models/appSettings.model").findOne({}).lean(),
      evaluateEduPayReadiness(),
    ]);
    const featureEnabled = appSettings?.fintechControl?.featureRegistry?.edupay?.enabled !== false;
    const feature = { effectiveEnabled: financiallyReady && featureEnabled };
    const saved = round(contributions[0]?.total);
    const upcoming = plans.filter((plan) => !["SETTLED", "CANCELLED", "REVERSED"].includes(plan.status)).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate))[0] || null;
    res.json({ success: true, settings: { enabled: feature.effectiveEnabled, autosaveEnabled: settings.autosaveEnabled }, summary: { totalEducationSavings: saved, totalChildren: children, activePlans: plans.filter((p) => !["SETTLED", "CANCELLED", "REVERSED"].includes(p.status)).length, outstandingRepayment: round(repayments.reduce((sum, row) => sum + Number(row.amountRemaining || 0), 0)), upcomingSchoolFee: upcoming ? { amount: upcoming.officialFee, targetDate: upcoming.targetDate, saved: saved } : null }, plans });
  } catch (error) { errorResponse(res, error); }
};

exports.listSchools = async (req, res) => {
  try {
    const rows = await School.find({ status: "APPROVED", active: true }).sort({ name: 1 }).lean();
    res.json({ success: true, schools: rows.map(publicSchool) });
  } catch (error) { errorResponse(res, error); }
};
exports.listFees = async (req, res) => {
  try {
    ensureObjectId(req.params.schoolId, "School");
    const school = await School.findOne({ _id: req.params.schoolId, status: "APPROVED", active: true }).select("_id").lean();
    if (!school) return res.status(404).json({ success: false, message: "Approved active school not found." });
    const filter = { school: school._id, status: "APPROVED" };
    if (req.query.session) filter.session = req.query.session;
    if (req.query.term) filter.term = req.query.term;
    if (req.query.classLevel) filter.classLevel = req.query.classLevel;
    const selectable = { $in: ["ACTIVE", "UPCOMING"] };
    const rows = await Fee.find(filter).populate({ path: "session", match: { status: selectable } }).populate({ path: "term", match: { status: selectable } }).populate({ path: "classLevel", match: { status: "ACTIVE" } }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, fees: rows.filter((row) => row.session && row.term && row.classLevel) });
  } catch (error) { errorResponse(res, error); }
};
// Customer-facing catalogue: only active academic contracts and approved fees
// are exposed. Draft/closed school configuration must never be selectable.
exports.schoolCatalogue = async (req, res) => {
  try {
    ensureObjectId(req.params.schoolId, "School");
    const school = await School.findOne({ _id: req.params.schoolId, status: "APPROVED", active: true }).select("name state").lean();
    if (!school) return res.status(404).json({ success: false, message: "Approved school not found." });
    const [sessions, terms, classes, fees] = await Promise.all([
      EduPayAcademicSession.find({ school: school._id, status: { $in: ["ACTIVE", "UPCOMING"] } }).sort({ isCurrent: -1, startsAt: -1, name: 1 }).lean(),
      EduPayTerm.find({ school: school._id, status: { $in: ["ACTIVE", "UPCOMING"] } }).sort({ isCurrent: -1, startsAt: 1, name: 1 }).lean(),
      EduPayClass.find({ school: school._id, status: "ACTIVE" }).sort({ name: 1 }).lean(),
      Fee.find({ school: school._id, status: "APPROVED" }).populate("session term classLevel").sort({ createdAt: -1 }).lean(),
    ]);
    const sessionIds = new Set(sessions.map((row) => String(row._id)));
    const availableTerms = terms.filter((row) => sessionIds.has(String(row.session)));
    const termIds = new Set(availableTerms.map((row) => String(row._id)));
    const classIds = new Set(classes.map((row) => String(row._id)));
    res.json({ success: true, school, sessions, terms: availableTerms, classes, fees: fees.filter((fee) => sessionIds.has(String(fee.session?._id || fee.session)) && termIds.has(String(fee.term?._id || fee.term)) && classIds.has(String(fee.classLevel?._id || fee.classLevel))) });
  } catch (error) { errorResponse(res, error); }
};

exports.createChild = async (req, res) => {
  try {
    ensureObjectId(req.body.school, "School");
    const school = await School.findOne({ _id: req.body.school, status: "APPROVED", active: true });
    if (!school) return res.status(400).json({ success: false, message: "Only approved active schools may be selected." });
    const child = await Child.create({ parent: req.user._id, createdBy: req.user._id, fullName: req.body.fullName, dateOfBirth: req.body.dateOfBirth, gender: req.body.gender, photo: req.body.photo || null, admissionNumber: req.body.admissionNumber || null, className: req.body.className || null, arm: req.body.arm || null, academicSession: req.body.academicSession || null, term: req.body.term || null, school: school._id });
    const academicStudent = await studentLink.academicStudentForChild(child);
    if (academicStudent) await studentLink.persistLink(child, academicStudent, "ADMISSION", req.user._id);
    await audit({ actor: req.user._id, action: "EDUPAY_CHILD_CREATED", entityType: "EduPayChild", entityId: child._id, school: school._id, req });
    res.status(201).json({ success: true, child });
  } catch (error) { errorResponse(res, error); }
};
exports.listChildren = async (req, res) => {
  try {
    const children = await Child.find({ parent: req.user._id, status: "ACTIVE" }).populate("school").sort({ createdAt: -1 }).lean();
    const enriched = await Promise.all(children.map(async (child) => {
      const student = await studentLink.academicStudentForChild(child);
      return { ...child, enrollment: student ? { student: student._id, school: student.school, classLevel: student.classLevel, session: student.session || null, term: student.term || null } : null };
    }));
    res.json({ success: true, children: enriched });
  } catch (error) { errorResponse(res, error); }
};
exports.updateChild = async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.childId, parent: req.user._id, status: "ACTIVE" });
    if (!child) return res.status(404).json({ success: false, message: "Child not found." });
    ["fullName", "dateOfBirth", "gender", "photo", "admissionNumber", "className", "arm", "academicSession", "term", "studentStatus"].forEach((key) => { if (req.body[key] !== undefined) child[key] = req.body[key]; });
    await child.save();
    const academicStudent = await studentLink.academicStudentForChild(child);
    if (academicStudent) await studentLink.persistLink(child, academicStudent, "ADMISSION", req.user._id);
    res.json({ success: true, child });
  } catch (error) { errorResponse(res, error); }
};

exports.createPlan = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    ["child", "school", "session", "term", "classLevel", "feeStructure"].forEach((key) => ensureObjectId(req.body[key], key));
    const school = await School.findOne({ _id: req.body.school, status: "APPROVED", active: true }).select("_id").lean();
    const [child, session, term, requestedClassLevel] = await Promise.all([
      Child.findOne({ _id: req.body.child, parent: req.user._id, school: req.body.school, status: "ACTIVE" }),
      EduPayAcademicSession.findOne({ _id: req.body.session, school: req.body.school, status: { $in: ["ACTIVE", "UPCOMING"] } }),
      EduPayTerm.findOne({ _id: req.body.term, school: req.body.school, session: req.body.session, status: { $in: ["ACTIVE", "UPCOMING"] } }),
      EduPayClass.findOne({ _id: req.body.classLevel, school: req.body.school, status: "ACTIVE" }),
    ]);
    const academicStudent = child ? await studentLink.academicStudentForChild(child) : null;
    if (academicStudent?.classLevel && String(academicStudent.classLevel) !== String(requestedClassLevel?._id)) return res.status(400).json({ success: false, message: "The selected class does not match the child's canonical enrollment." });
    const classLevel = requestedClassLevel;
    const fee = await Fee.findOne({ _id: req.body.feeStructure, school: req.body.school, session: req.body.session, term: req.body.term, classLevel: classLevel?._id, status: "APPROVED" });
    if (!school || !child || !session || !term || !classLevel || !fee) return res.status(400).json({ success: false, message: "Your school has not published the school fee for this term yet. Please contact the school or try again later." });
    const targetDate = new Date(req.body.targetDate);
    if (Number.isNaN(targetDate.getTime()) || targetDate <= new Date()) return res.status(400).json({ success: false, message: "A future settlement date is required." });
    const days = Math.max(1, Math.ceil((targetDate - Date.now()) / 86400000));
    const requestedFrequency = String(req.body.savingFrequency || req.body.frequency || "MONTHLY").trim().toUpperCase();
    const frequency = requestedFrequency === "MANUAL" ? "FLEXIBLE" : requestedFrequency;
    if (!["DAILY", "WEEKLY", "MONTHLY", "FLEXIBLE", "CUSTOM"].includes(frequency)) return res.status(400).json({ success: false, message: "Choose a valid savings frequency." });
    const targetInput = req.body.targetAmount ?? req.body.savingsTarget;
    const targetAmount = targetInput === undefined ? round(fee.amount) : round(targetInput);
    if (!Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > Number(fee.amount)) return res.status(400).json({ success: false, message: "Savings target must be greater than zero and no more than the approved fee." });
    const preferredSupplied = req.body.preferredContributionAmount !== undefined || req.body.contributionAmount !== undefined;
    const preferred = req.body.preferredContributionAmount ?? req.body.contributionAmount;
    const preferredContributionAmount = preferredSupplied ? round(preferred) : 0;
    if (preferredSupplied && (!Number.isFinite(preferredContributionAmount) || preferredContributionAmount <= 0)) return res.status(400).json({ success: false, message: "Preferred contribution amount must be greater than zero." });
    const periods = frequency === "DAILY" ? days : frequency === "WEEKLY" ? Math.ceil(days / 7) : frequency === "MONTHLY" ? Math.max(1, Math.ceil(days / 30)) : 1;
    const plan = await Plan.create({ parent: req.user._id, child: child._id, school: req.body.school, session: req.body.session, term: req.body.term, classLevel: req.body.classLevel, feeStructure: fee._id, officialFee: fee.amount, targetAmount, savingFrequency: frequency, preferredContributionAmount, targetDate, recommendedContribution: preferredContributionAmount || round(targetAmount / periods), autosave: { enabled: false } });
    await audit({ actor: req.user._id, action: "EDUPAY_PLAN_CREATED", entityType: "EduPayPlan", entityId: plan._id, school: plan.school, req });
    await notify(req.user._id, "EduPay plan created", "Your school-fee savings plan is ready.");
    res.status(201).json({ success: true, plan });
  } catch (error) { errorResponse(res, error); }
};
exports.listPlans = async (req, res) => {
  try { const plans = await Plan.find({ parent: req.user._id }).populate("child school session term classLevel feeStructure").sort({ createdAt: -1 }).lean(); res.json({ success: true, plans: await reconcilePlans(plans) }); } catch (error) { errorResponse(res, error); }
};
const reconcilePlans = async (plans) => {
  const ids = plans.map((row) => row._id);
  const entries = await EduLedger.find({ plan: { $in: ids } }).sort({ createdAt: 1 }).lean();
  const grouped = new Map();
  entries.forEach((entry) => { const key = String(entry.plan); const row = grouped.get(key) || { saved: 0, history: [] }; row.saved = round(row.saved + (entry.direction === "CREDIT" ? entry.amount : -entry.amount)); row.history.push(entry); grouped.set(key, row); });
  return plans.map((plan) => { const row = grouped.get(String(plan._id)) || { saved: 0, history: [] }; const target = Number(plan.targetAmount || plan.officialFee); const next = Number(plan.preferredContributionAmount || plan.recommendedContribution || 0); return { ...plan, targetAmount: target, amountSaved: row.saved, remaining: round(Math.max(0, target - row.saved)), progressPercent: target ? round(Math.min(100, row.saved / target * 100)) : 0, nextContribution: next, history: row.history.map((entry) => ({ ...entry, child: plan.child, school: plan.school, status: "SUCCESS" })) }; });
};
exports.getPlan = async (req, res) => {
  try {
    const plan = await Plan.findOne({ _id: req.params.planId, parent: req.user._id }).populate("child school session term classLevel feeStructure");
    if (!plan) return res.status(404).json({ success: false, message: "EduPay plan not found." });
    const [contributions, ledger, repayment, sponsors] = await Promise.all([Contribution.find({ plan: plan._id }).sort({ createdAt: -1 }).lean(), EduLedger.find({ plan: plan._id }).sort({ createdAt: 1 }).lean(), EduPayRepayment.findOne({ plan: plan._id }).lean(), EduPaySponsorContribution.find({ plan: plan._id }).sort({ createdAt: -1 }).lean()]);
    const [reconciled] = await reconcilePlans([plan.toObject()]);
    const savingHistory = contributions.filter((row) => row.status === "SUCCESS").map((row) => {
      const matching = ledger.find((entry) => String(entry.reference || "").includes(String(row.reference)));
      return { childName: plan.child?.fullName || null, schoolName: plan.school?.name || null, date: row.createdAt, amount: row.amount, businessReference: row.reference, status: row.status, source: matching?.source || row.type, type: matching?.type || row.type, openingBalance: matching?.openingBalance ?? null, closingBalance: matching?.closingBalance ?? null, receiptIdentifier: row.reference };
    });
    res.json({ success: true, plan: reconciled, contributions, ledger, history: reconciled.history, savingHistory, repayment, sponsors });
  } catch (error) { errorResponse(res, error); }
};
exports.contribute = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    const result = await require("../services/edupay.service").contributeFromWallet({ userId: req.user._id, planId: req.params.planId, amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req), body: req.body });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, contribution: result.contribution });
  } catch (error) { errorResponse(res, error); }
};
exports.autosave = async (req, res) => {
  try {
    const plan = await Plan.findOne({ _id: req.params.planId, parent: req.user._id });
    if (!plan) return res.status(404).json({ success: false, message: "EduPay plan not found." });
    const enabled = Boolean(req.body.enabled);
    if (enabled && !["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"].includes(String(req.body.frequency).toUpperCase())) return res.status(400).json({ success: false, message: "A valid autosave frequency is required." });
    plan.autosave = { enabled, amount: enabled ? round(req.body.amount) : 0, frequency: enabled ? String(req.body.frequency).toUpperCase() : null, nextContributionAt: enabled ? (req.body.nextContributionAt || new Date()) : null, pausedAt: enabled ? null : new Date() };
    await plan.save(); await audit({ actor: req.user._id, action: enabled ? "EDUPAY_AUTOSAVE_RESUMED" : "EDUPAY_AUTOSAVE_PAUSED", entityType: "EduPayPlan", entityId: plan._id, school: plan.school, req });
    res.json({ success: true, autosave: plan.autosave });
  } catch (error) { errorResponse(res, error); }
};
exports.history = async (req, res) => {
  try {
    const plans = await Plan.find({ parent: req.user._id }).populate("child school").lean();
    const planById = new Map(plans.map((plan) => [String(plan._id), plan]));
    const ids = plans.map((plan) => plan._id);
    const [contributions, ledger, repayments] = await Promise.all([
      Contribution.find({ plan: { $in: ids }, status: "SUCCESS" }).sort({ createdAt: -1 }).limit(200).lean(),
      EduLedger.find({ plan: { $in: ids } }).sort({ createdAt: -1 }).limit(200).lean(),
      EduPayRepayment.find({ parent: req.user._id }).sort({ createdAt: -1 }).lean(),
    ]);
    const savingHistory = contributions.map((contribution) => {
      const plan = planById.get(String(contribution.plan));
      const entry = ledger.find((candidate) => String(candidate.reference || "").includes(String(contribution.reference)));
      return {
        date: contribution.createdAt,
        amount: contribution.amount,
        childName: plan?.child?.fullName || "Student",
        schoolName: plan?.school?.name || "School",
        businessReference: contribution.reference,
        receiptIdentifier: contribution.reference,
        status: contribution.status,
        source: entry?.source || "WALLET",
        type: entry?.type || contribution.type,
      };
    });
    res.json({ success: true, savingHistory, repayments });
  } catch (error) { errorResponse(res, error); }
};

exports.inviteSponsor = async (req, res) => {
  try {
    const plan = await Plan.findOne({ _id: req.params.planId, parent: req.user._id });
    if (!plan) return res.status(404).json({ success: false, message: "EduPay plan not found." });
    const token = cryptoToken(); const invite = await EduPaySponsorInvite.create({ parent: req.user._id, child: plan.child, plan: plan._id, tokenHash: hash(token), sponsorName: req.body.sponsorName, expiresAt: new Date(Date.now() + 30 * 86400000) });
    res.status(201).json({ success: true, invite: { id: invite._id, expiresAt: invite.expiresAt, code: token, link: `/api/edupay/sponsor/${token}` } });
  } catch (error) { errorResponse(res, error); }
};
function cryptoToken() { return require("crypto").randomBytes(24).toString("base64url"); }
exports.sponsorView = async (req, res) => {
  try { const invite = await EduPaySponsorInvite.findOne({ tokenHash: hash(req.params.token), status: "ACTIVE", expiresAt: { $gt: new Date() } }).populate({ path: "plan", populate: { path: "school", select: "name state" } }); if (!invite) return res.status(404).json({ success: false, message: "Sponsor link is invalid or expired." }); res.json({ success: true, sponsor: { school: invite.plan.school, expiresAt: invite.expiresAt } }); } catch (error) { errorResponse(res, error); }
};
exports.sponsorContribute = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    const result = await contributeSponsorFromWallet({ sponsorId: req.user._id, tokenHash: hash(req.params.token), amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req), body: req.body });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, contribution: result.contribution });
  } catch (error) { errorResponse(res, error); }
};
exports.repayments = async (req, res) => { try { res.json({ success: true, repayments: await EduPayRepayment.find({ parent: req.user._id }).sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.repay = async (req, res) => { try { const result = await repayFromWallet({ userId: req.user._id, repaymentId: req.params.repaymentId, amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req), body: req.body }); res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, transaction: result.transaction }); } catch (error) { errorResponse(res, error); } };
exports.receipt = async (req, res) => { try { const [contribution, repayment, settlement] = await Promise.all([Contribution.findOne({ _id: req.params.reference, parent: req.user._id }).populate("plan child"), EduPayRepaymentTransaction.findOne({ _id: req.params.reference, parent: req.user._id }), Settlement.findOne({ _id: req.params.reference, parent: req.user._id }).populate("school child")]); const result = contribution || repayment || settlement; if (!result) return res.status(404).json({ success: false, message: "EduPay receipt not found." }); res.json({ success: true, receipt: result }); } catch (error) { errorResponse(res, error); } };

exports.applySchool = async (req, res) => { try { const b = req.body || {}; const email = String(b.email || "").trim().toLowerCase(); const registration = String(b.registrationNumber || "").trim().toUpperCase(); const phone = String(b.phone || "").trim(); const documents = Array.isArray(b.supportingDocuments) ? b.supportingDocuments.filter(Boolean) : []; if (!b.name || !b.schoolType || !b.address || !b.state || !b.lga || !b.contactPerson || !phone || !email || !b.password || !registration || !b.logo || !documents.length || !b.bankName || !b.bankCode || !b.accountNumber || !b.accountName || !b.authorizedRepresentative) return res.status(400).json({ success: false, message: "Complete school, portal, representative, logo, documents, and onboarding bank details are required." }); if (documents.length > 10) return res.status(400).json({ success: false, message: "A maximum of 10 supporting documents is allowed." }); const logo = parsePrivateAsset(b.logo, PRIVATE_IMAGE_TYPES, 2 * 1024 * 1024, "Logo"); const validatedDocuments = documents.map((doc, index) => parsePrivateAsset(doc, PRIVATE_DOCUMENT_TYPES, 10 * 1024 * 1024, `Supporting document ${index + 1}`)); const totalBytes = [logo, ...validatedDocuments].reduce((sum, value) => sum + Buffer.from(String(value).split(",")[1], "base64").length, 0); if (totalBytes > 25 * 1024 * 1024) return res.status(400).json({ success: false, message: "Private assets exceed the 25 MB total decoded size limit." }); if (String(b.password).length < 6) return res.status(400).json({ success: false, message: "Password must be at least 6 characters." }); if (!/^\d{10}$/.test(String(b.accountNumber))) return res.status(400).json({ success: false, message: "A valid ten-digit bank account number is required." }); const duplicate = await School.findOne({ $or: [{ normalizedRegistrationNumber: registration }, { normalizedEmail: email }, { normalizedPhone: phone }], status: { $in: ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "SUSPENDED"] } }).select("_id"); if (duplicate) return res.status(409).json({ success: false, code: "ACTIVE_APPLICATION_EXISTS", message: "An active school application already exists." }); const session = await mongoose.startSession(); let school; try { await session.withTransaction(async () => { const user = await User.create([{ fullName: b.contactPerson, email, phone, password: b.password, role: "CUSTOMER", status: "INACTIVE" }], { session }); [school] = await School.create([{ name: b.name, schoolType: b.schoolType, registrationNumber: registration, normalizedRegistrationNumber: registration, address: b.address, state: b.state, lga: b.lga, contactPerson: b.contactPerson, phone, email, normalizedEmail: email, normalizedPhone: phone, bankDetails: { bankName: b.bankName, bankCode: b.bankCode, accountNumberLast4: String(b.accountNumber).slice(-4), encryptedAccountNumber: edupaySquadService.encryptAccount(String(b.accountNumber)), accountName: b.accountName }, logo, supportingDocuments: validatedDocuments, authorizedRepresentative: b.authorizedRepresentative, status: "PENDING_REVIEW", active: false, portalUser: user[0]._id }], { session }); }); } finally { await session.endSession(); } res.status(201).json({ success: true, application: publicSchool(school) }); } catch (error) { if (error.code === 11000) return res.status(409).json({ success: false, code: "ACTIVE_APPLICATION_EXISTS", message: "An active school application already exists." }); errorResponse(res, error); } };
// The former JSON/base64 endpoint is intentionally unreachable. Applications
// must enter through the multipart GridFS route below.
exports.applySchool = (req, res) => res.status(410).json({ success: false, code: "MULTIPART_REQUIRED", message: "School applications require multipart uploads." });
// Multipart adapter: GridFS owns the bytes; the legacy validator is reused only
// for field validation, then its temporary data-URL projections are replaced.
exports.applySchoolMultipart = async (req, res) => {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "edupaySchoolAssets" });
  const files = [...(req.files?.logo || []), ...(req.files?.supportingDocuments || [])];
  const ids = [];
  try {
    if (!files.length || files.some((file) => !validAssetBytes(file))) return res.status(400).json({ success: false, message: "Uploaded content does not match its declared MIME type." });
    for (const file of files) {
      const id = new mongoose.Types.ObjectId();
      await new Promise((resolve, reject) => {
        const stream = bucket.openUploadStreamWithId(id, file.originalname, { contentType: file.mimetype, metadata: { product: "edupay-school-private" } });
        stream.once("error", reject); stream.once("finish", resolve); stream.end(file.buffer);
      });
      ids.push(id);
    }
    const originalBody = req.body;
    req.body = { ...originalBody, logo: `data:${files[0].mimetype};base64,${files[0].buffer.toString("base64")}`, supportingDocuments: files.slice(1).map((file) => `data:${file.mimetype};base64,${file.buffer.toString("base64")}`) };
    let responsePayload; const originalJson = res.json.bind(res);
    res.json = (payload) => { responsePayload = payload; return res; };
    await exports.applySchool(req, res);
    if (responsePayload?.success && responsePayload.application?._id) {
      await School.updateOne({ _id: responsePayload.application._id }, { $set: { logo: { fileId: ids[0], mimeType: files[0].mimetype, size: files[0].size, originalName: files[0].originalname }, supportingDocuments: ids.slice(1).map((fileId, index) => ({ fileId, mimeType: files[index + 1].mimetype, size: files[index + 1].size, originalName: files[index + 1].originalname })) } });
      return originalJson({ ...responsePayload, application: publicSchool({ ...responsePayload.application, logo: undefined, supportingDocuments: undefined }) });
    }
    for (const id of ids) await bucket.delete(id).catch(() => {});
    return originalJson(responsePayload || { success: false, message: "School application failed." });
  } catch (error) {
    for (const id of ids) await bucket.delete(id).catch(() => {});
    return errorResponse(res, error);
  }
};
const stagedAssetReferences = async (ids) => School.exists({ $or: [{ "logo.fileId": { $in: ids } }, { "supportingDocuments.fileId": { $in: ids } }] });
const cleanupStagedAssets = async (bucket, ids) => { if (!ids.length || await stagedAssetReferences(ids)) return; await Promise.all(ids.map((id) => bucket.delete(id).catch(() => {}))); };
const cleanupStaleStagedAssets = async (bucket) => { const cutoff = new Date(Date.now() - 60 * 60 * 1000); const rows = await mongoose.connection.db.collection("edupaySchoolAssets.files").find({ "metadata.stage": "STAGED", uploadDate: { $lt: cutoff } }).limit(50).toArray(); for (const row of rows) await cleanupStagedAssets(bucket, [row._id]); };
exports.reconcileEduPaySchoolAssets = async ({ limit = 50 } = {}) => { const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "edupaySchoolAssets" }); const rows = await mongoose.connection.db.collection("edupaySchoolAssets.files").find({ "metadata.stage": "STAGED" }).limit(limit).toArray(); let finalized = 0; let deleted = 0; for (const row of rows) { const school = await School.findOne({ $or: [{ "logo.fileId": row._id }, { "supportingDocuments.fileId": row._id }] }).select("_id").lean(); if (school) { await mongoose.connection.db.collection("edupaySchoolAssets.files").updateOne({ _id: row._id, "metadata.stage": "STAGED" }, { $set: { "metadata.stage": "FINAL", "metadata.schoolId": school._id } }); finalized++; } else if (row.uploadDate < new Date(Date.now() - 60 * 60 * 1000)) { await bucket.delete(row._id).catch(() => {}); deleted++; } } return { finalized, deleted }; };
const markAssetsFinal = async (ids, schoolId, batchId) => mongoose.connection.db.collection("edupaySchoolAssets.files").updateMany({ _id: { $in: ids }, "metadata.uploadBatchId": batchId }, { $set: { "metadata.stage": "FINAL", "metadata.schoolId": schoolId } });
exports.applySchoolMultipartDirect = async (req, res) => {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "edupaySchoolAssets" });
  const files = [...(req.files?.logo || []), ...(req.files?.supportingDocuments || [])];
  const ids = [];
  const batchId = require("crypto").randomUUID();
  try {
    await cleanupStaleStagedAssets(bucket);
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    const registration = String(b.registrationNumber || "").trim().toUpperCase();
    const phone = String(b.phone || "").trim();
    if ((req.files?.logo || []).length !== 1 || (req.files?.supportingDocuments || []).length < 1) return res.status(400).json({ success: false, message: "Exactly one logo and at least one supporting document are required." });
    if (!b.name || !b.schoolType || !b.address || !b.state || !b.lga || !b.contactPerson || !phone || !email || !b.password || !registration || files.length < 2 || !b.bankName || !b.bankCode || !b.accountNumber || !b.accountName || !b.authorizedRepresentative) return res.status(400).json({ success: false, message: "Complete school application fields and files are required." });
    if (files.length > 11 || !PRIVATE_IMAGE_TYPES.has(files[0].mimetype) || files[0].size > 2 * 1024 * 1024 || !validAssetBytes(files[0]) || files.slice(1).some((f) => !PRIVATE_DOCUMENT_TYPES.has(f.mimetype) || f.size > 10 * 1024 * 1024 || !validAssetBytes(f)) || files.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024) return res.status(400).json({ success: false, message: "Invalid or oversized private school files." });
    if (String(b.password).length < 6 || !/^\d{10}$/.test(String(b.accountNumber))) return res.status(400).json({ success: false, message: "Invalid password or bank account number." });
    const duplicate = await School.findOne({ $or: [{ normalizedRegistrationNumber: registration }, { normalizedEmail: email }, { normalizedPhone: phone }], status: { $in: activeSchoolStatuses } }).select("_id").lean();
    const canonicalDuplicate = await findAuthoritativeSchoolIdentity({ schoolName: b.name, location: b.address });
    if (duplicate || canonicalDuplicate) return res.status(409).json({ success: false, code: "ACTIVE_APPLICATION_EXISTS", message: "An active school application already exists." });
    for (const file of files) { const id = new mongoose.Types.ObjectId(); await new Promise((resolve, reject) => { const stream = bucket.openUploadStreamWithId(id, file.originalname, { contentType: file.mimetype, metadata: { product: "edupay-school-private", stage: "STAGED", uploadBatchId: batchId } }); stream.once("error", reject).once("finish", resolve).end(file.buffer); }); ids.push(id); }
    const session = await mongoose.startSession();
    let school;
    try {
      await session.withTransaction(async () => {
        const user = await User.create([{ fullName: b.contactPerson, email, phone, password: b.password, role: "CUSTOMER", status: "INACTIVE" }], { session });
        [school] = await School.create([{
          name: b.name,
          normalizedSchoolName: normalizeRequestText(b.name),
          schoolType: b.schoolType,
          registrationNumber: registration,
          normalizedRegistrationNumber: registration,
          address: b.address,
          normalizedLocation: normalizeRequestText(b.address),
          normalizedAddress: normalizeRequestText(b.address),
          state: b.state,
          lga: b.lga,
          contactPerson: b.contactPerson,
          phone,
          email,
          normalizedEmail: email,
          normalizedPhone: phone,
          bankDetails: { bankName: b.bankName, bankCode: b.bankCode, accountNumberLast4: String(b.accountNumber).slice(-4), encryptedAccountNumber: edupaySquadService.encryptAccount(String(b.accountNumber)), accountName: b.accountName },
          logo: { fileId: ids[0], mimeType: files[0].mimetype, size: files[0].size, originalName: files[0].originalname },
          supportingDocuments: ids.slice(1).map((fileId, i) => ({ fileId, mimeType: files[i + 1].mimetype, size: files[i + 1].size, originalName: files[i + 1].originalname })),
          authorizedRepresentative: b.authorizedRepresentative,
          status: "PENDING_REVIEW",
          active: false,
          portalUser: user[0]._id,
        }], { session });
      });
    } finally {
      await session.endSession();
    }
    await markAssetsFinal(ids, school._id, batchId).catch(() => {}); return res.status(201).json({ success: true, application: publicSchool(school) });
  } catch (error) { await cleanupStagedAssets(bucket, ids); if (error.code === 11000) return res.status(409).json({ success: false, code: "ACTIVE_APPLICATION_EXISTS", message: "An active school application already exists." }); return errorResponse(res, error); }
};

exports.schoolLogin = async (req, res) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || "").trim().toLowerCase() }).select("+password +authTokenVersion");
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password || ""))) return res.status(401).json({ success: false, message: "Invalid school credentials." });
    const linkedSchool = await School.findOne({ portalUser: user._id }).select("status active").lean();
    if (linkedSchool?.status === "PENDING_REVIEW" || linkedSchool?.status === "UNDER_REVIEW") return res.status(403).json({ success: false, code: "SCHOOL_APPROVAL_PENDING", message: "School registration is awaiting approval." });
    if (linkedSchool?.status === "REJECTED") return res.status(403).json({ success: false, code: "SCHOOL_REGISTRATION_REJECTED", message: "School registration was rejected. Contact ServicePay support for assistance." });
    if (user.status !== "ACTIVE") return res.status(403).json({ success: false, code: "SCHOOL_ACCOUNT_INACTIVE", message: "This school account is inactive or suspended." });
    const memberships = await SchoolUser.find({ user: user._id, status: "ACTIVE" })
      .sort({ createdAt: 1 })
      .populate("school");
    const eligible = memberships.filter((row) => row.school && row.school.status === "APPROVED" && row.school.active);
    if (!eligible.length) return res.status(403).json({ success: false, code: "SCHOOL_ACCESS_REQUIRED", message: "Approved school access required." });
    const requestedSchoolId = String(req.body.schoolId || "").trim();
    if (!requestedSchoolId && eligible.length > 1) {
      return res.status(409).json({
        success: false,
        code: "EDUPAY_SCHOOL_CONTEXT_REQUIRED",
        message: "Select the school you want to open.",
        schools: eligible.map((row) => ({
          schoolId: String(row.school._id),
          schoolName: row.school.name,
          role: row.role,
          status: row.status,
          schoolStatus: row.school.status,
        })),
      });
    }
    const membership = requestedSchoolId
      ? eligible.find((row) => String(row.school._id) === requestedSchoolId)
      : eligible[0];
    if (!membership) return res.status(403).json({ success: false, code: "SCHOOL_CONTEXT_FORBIDDEN", message: "The selected school is not an active membership." });
    res.json(schoolSessionResponse(user, membership));
  } catch (error) { errorResponse(res, error); }
};

exports.schoolHandoffOptions = async (req, res) => {
  try {
    const eligible = await eligibleManagementMemberships(req.user._id);
    return res.json({
      success: true,
      schools: eligible.map((row) => ({
        schoolId: String(row.school._id),
        schoolName: row.school.name,
        role: row.role,
        status: row.status,
        schoolStatus: row.school.status,
      })),
    });
  } catch (error) { return errorResponse(res, error); }
};

exports.createSchoolHandoff = async (req, res) => {
  try {
    const requestedSchoolId = String(req.body?.schoolId || "").trim();
    if (!mongoose.isValidObjectId(requestedSchoolId)) {
      return res.status(400).json({ success: false, code: "SCHOOL_CONTEXT_REQUIRED", message: "Select an approved school." });
    }
    const eligible = await eligibleManagementMemberships(req.user._id);
    const membership = eligible.find((row) => String(row.school._id) === requestedSchoolId);
    if (!membership) {
      return res.status(403).json({ success: false, code: "SCHOOL_CONTEXT_FORBIDDEN", message: "The selected school is not an active management membership." });
    }
    const code = crypto.randomBytes(32).toString("base64url");
    await SchoolHandoff.create({
      codeHash: crypto.createHash("sha256").update(code).digest("hex"),
      user: req.user._id,
      school: membership.school._id,
      expiresAt: new Date(Date.now() + SCHOOL_HANDOFF_TTL_MS),
    });
    res.cookie(SCHOOL_HANDOFF_COOKIE, code, { ...handoffCookieOptions(req), maxAge: SCHOOL_HANDOFF_TTL_MS });
    return res.status(201).json({ success: true, portalUrl: "https://admin.servicepay.ng/school/" });
  } catch (error) { return errorResponse(res, error); }
};

exports.consumeSchoolHandoff = async (req, res) => {
  try {
    const origin = String(req.headers.origin || "").trim().replace(/\/$/, "");
    const previewOrigins = String(process.env.REPLIT_DOMAINS || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
      .map((host) => `https://${host}`);
    if (origin && origin !== SCHOOL_PORTAL_ORIGIN && !previewOrigins.includes(origin)) {
      clearHandoffCookie(req, res);
      return res.status(403).json({ success: false, code: "SCHOOL_HANDOFF_ORIGIN_FORBIDDEN", message: "School Portal handoff origin is not allowed." });
    }
    const code = decodeURIComponent(readCookie(req, SCHOOL_HANDOFF_COOKIE));
    clearHandoffCookie(req, res);
    if (!code) return res.status(401).json({ success: false, code: "SCHOOL_HANDOFF_REQUIRED", message: "School Portal handoff required." });
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const handoff = await SchoolHandoff.findOneAndUpdate(
      { codeHash, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    ).lean();
    if (!handoff) return res.status(401).json({ success: false, code: "SCHOOL_HANDOFF_INVALID", message: "This School Portal handoff is invalid or has expired." });
    const user = await User.findOne({ _id: handoff.user, status: "ACTIVE" }).select("+authTokenVersion");
    const membership = await SchoolUser.findOne({
      user: handoff.user,
      school: handoff.school,
      status: "ACTIVE",
      role: { $in: [...SCHOOL_MANAGEMENT_ROLES] },
    }).populate("school");
    if (!user || !membership || !membership.school || membership.school.status !== "APPROVED" || !membership.school.active) {
      return res.status(403).json({ success: false, code: "SCHOOL_HANDOFF_FORBIDDEN", message: "Approved active school management access is required." });
    }
    return res.json(schoolSessionResponse(user, membership));
  } catch (error) {
    clearHandoffCookie(req, res);
    return errorResponse(res, error);
  }
};
exports.createSchoolRequest = async (req, res) => {
  let normalizedSchoolName;
  let normalizedLocation;
  try {
    const schoolName = String(req.body?.schoolName || "").trim();
    const location = String(req.body?.location || "").trim();
    const contactPhone = String(req.body?.contactPhone || "").trim();
    if (!schoolName || !location) {
      return res.status(400).json({
        success: false,
        code: "SCHOOL_REQUEST_FIELDS_REQUIRED",
        message: "School name and location are required.",
      });
    }
    const oversized = [
      ["schoolName", schoolName, 180],
      ["location", location, 240],
      ["contactPhone", contactPhone, 40],
    ].find(([, value, max]) => value.length > max);
    if (oversized) {
      return res.status(400).json({
        success: false,
        code: "SCHOOL_REQUEST_FIELD_TOO_LONG",
        field: oversized[0],
        maxLength: oversized[2],
        message: `${oversized[0]} must be ${oversized[2]} characters or fewer.`,
      });
    }
    normalizedSchoolName = normalizeRequestText(schoolName);
    normalizedLocation = normalizeRequestText(location);
    const existing = await SchoolRequest.findOne({
      parent: req.user._id,
      normalizedSchoolName,
      normalizedLocation,
      status: { $in: ["PENDING_REVIEW", "CONTACTED"] },
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        code: "ACTIVE_SCHOOL_REQUEST_EXISTS",
        message: "You already have an active request for this school.",
        request: schoolRequestDto(existing),
      });
    }
    const session = await mongoose.startSession();
    let request;
    try {
      await session.withTransaction(async () => {
        [request] = await SchoolRequest.create([{
          parent: req.user._id,
          schoolName,
          normalizedSchoolName,
          location,
          normalizedLocation,
          contactPhone: contactPhone || null,
        }], { session });
        await audit({
          actor: req.user._id,
          action: "EDUPAY_SCHOOL_REQUEST_CREATED",
          entityType: "EduPaySchoolRequest",
          entityId: request._id,
          metadata: { schoolName, location },
          req,
          session,
        });
      });
    } finally {
      await session.endSession();
    }
    return res.status(201).json({
      success: true,
      request: schoolRequestDto(request),
    });
  } catch (error) {
    if (error?.statusCode && typeof error.code === "string") {
      return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    if (error?.code === 11000) {
      const existing = await SchoolRequest.findOne({
        parent: req.user._id,
        normalizedSchoolName,
        normalizedLocation,
        status: { $in: ["PENDING_REVIEW", "CONTACTED"] },
      }).sort({ createdAt: -1 });
      return res.status(409).json({
        success: false,
        code: "ACTIVE_SCHOOL_REQUEST_EXISTS",
        message: "You already have an active request for this school.",
        request: existing ? schoolRequestDto(existing) : undefined,
      });
    }
    return errorResponse(res, error);
  }
};
exports.adminSchoolRequests = async (req, res) => {
  try {
    const status = String(req.query.status || "").toUpperCase();
    const supported = ["PENDING_REVIEW", "CONTACTED", "CLOSED", "APPROVED", "REJECTED"];
    if (status && status !== "ALL" && !supported.includes(status)) {
      return res.status(400).json({ success: false, message: "Unsupported school request status." });
    }
    const filter = status && status !== "ALL" ? { status } : {};
    const requests = await SchoolRequest.find(filter)
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();
    return res.json({
      success: true,
      requests: requests.map(schoolRequestDto),
    });
  } catch (error) {
    return errorResponse(res, error);
  }
};
exports.adminSchoolRequestDetail = async (req, res) => {
  try {
    ensureObjectId(req.params.requestId, "School request");
    const request = await SchoolRequest.findById(req.params.requestId)
      .populate("parent", "fullName email phone")
      .lean();
    if (!request) return res.status(404).json({ success: false, message: "School request not found." });
    return res.json({ success: true, request: schoolRequestDetailDto(request) });
  } catch (error) {
    return errorResponse(res, error);
  }
};
exports.adminSchoolRequestAction = async (req, res) => {
  const action = String(req.body?.action || "").trim().toUpperCase();
  if (!["APPROVE", "REJECT"].includes(action)) {
    return res.status(400).json({ success: false, message: "Unsupported school request action." });
  }
  const rejectionReason = String(req.body?.rejectionReason || req.body?.reason || "").trim();
  if (action === "REJECT" && !rejectionReason) {
    return res.status(400).json({ success: false, code: "REJECTION_REASON_REQUIRED", message: "A rejection reason is required." });
  }
  if (rejectionReason.length > 1000) {
    return res.status(400).json({ success: false, message: "Rejection reason is too long." });
  }
  if (action === "APPROVE" && req.body?.representativeAuthorityConfirmed !== true) {
    return res.status(400).json({
      success: false,
      code: "REPRESENTATIVE_AUTHORITY_CONFIRMATION_REQUIRED",
      message: "Head Office must confirm the requester's representative authority before approval.",
    });
  }
  let session;
  try {
    ensureObjectId(req.params.requestId, "School request");
    session = await mongoose.startSession();
    let request;
    await session.withTransaction(async () => {
      request = await SchoolRequest.findOne({ _id: req.params.requestId, status: "PENDING_REVIEW" }).session(session);
      if (!request) {
        const existing = await SchoolRequest.findById(req.params.requestId).select("status").lean();
        const error = new Error(existing ? `School request cannot transition from ${existing.status}.` : "School request not found.");
        error.statusCode = existing ? 409 : 404;
        throw error;
      }
      const previousStatus = request.status;
      if (action === "REJECT") {
        request.status = "REJECTED";
        request.rejectedAt = new Date();
        request.rejectedBy = req.user._id;
        request.rejectionReason = rejectionReason;
      } else {
        const requester = await User.findById(request.parent)
          .select("_id status email phone")
          .session(session)
          .lean();
        if (!requester || requester.status !== "ACTIVE" || (!String(requester.email || "").trim() && !String(requester.phone || "").trim())) {
          const error = new Error("The school requester's active identity could not be verified.");
          error.statusCode = 409;
          error.code = "REQUESTER_IDENTITY_UNVERIFIED";
          throw error;
        }
        const identity = schoolRequestIdentity(request);
        let admittedSchool = null;
        if (!request.school && await findAuthoritativeSchoolIdentity({
          schoolName: request.schoolName,
          location: request.location,
          session,
        })) {
          const error = new Error("An authoritative school already exists for this name and location.");
          error.statusCode = 409;
          error.code = "SCHOOL_ALREADY_EXISTS";
          throw error;
        }
        if (request.school) {
          admittedSchool = await School.findById(request.school).session(session);
          if (!admittedSchool
            || String(admittedSchool.sourceRequest || "") !== String(request._id)
            || admittedSchool.sourceRequestNormalizedSchoolName !== identity.schoolName
            || admittedSchool.sourceRequestNormalizedLocation !== identity.location
            || String(admittedSchool.portalUser || "") !== String(requester._id)) {
            const error = new Error("School request is linked to a mismatched school.");
            error.statusCode = 409;
            error.code = "SCHOOL_REQUEST_LINK_MISMATCH";
            throw error;
          }
        } else {
        }
        if (!admittedSchool) {
          admittedSchool = new School({
            name: request.schoolName,
            address: request.location,
            state: "Not specified",
            phone: request.contactPhone || null,
            status: "APPROVED",
            active: true,
            portalUser: requester._id,
            normalizedSchoolName: identity.schoolName,
            normalizedLocation: identity.location,
            normalizedAddress: identity.location,
            sourceRequest: request._id,
            sourceRequestNormalizedSchoolName: identity.schoolName,
            sourceRequestNormalizedLocation: identity.location,
          });
        } else {
          admittedSchool.status = "APPROVED";
          admittedSchool.active = true;
        }
        admittedSchool.reviewedBy = req.user._id;
        admittedSchool.reviewedAt = new Date();
        await admittedSchool.save({ session });
        await SchoolUser.updateOne(
          { school: admittedSchool._id, user: requester._id },
          { $set: { role: "ADMIN", status: "ACTIVE", invitedBy: req.user._id }, $setOnInsert: { school: admittedSchool._id, user: requester._id } },
          { upsert: true, session }
        );
        request.status = "APPROVED";
        request.approvedAt = new Date();
        request.approvedBy = req.user._id;
        request.school = admittedSchool._id;
      }
      await request.save({ session });
      await audit({
        actor: req.user._id,
        action: action === "APPROVE" ? "EDUPAY_SCHOOL_REQUEST_APPROVED" : "EDUPAY_SCHOOL_REQUEST_REJECTED",
        entityType: "EduPaySchoolRequest",
        entityId: request._id,
        school: request.school || null,
        metadata: {
          from: previousStatus,
          to: request.status,
          rejectionReason: action === "REJECT" ? rejectionReason : undefined,
          representativeAuthorityConfirmed: action === "APPROVE" ? true : undefined,
          requesterIdentityRef: action === "APPROVE" ? String(request.parent) : undefined,
        },
        req,
        session,
      });
    });
    return res.json({ success: true, request: schoolRequestDetailDto(request) });
  } catch (error) {
    if (error?.statusCode && typeof error.code === "string") {
      return res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "SCHOOL_REQUEST_IDENTITY_CONFLICT",
        message: "Another approved request already registered this school identity.",
      });
    }
    return errorResponse(res, error);
  } finally {
    if (session) await session.endSession();
  }
};
exports.schoolDashboard = async (req, res) => { try { const school = req.eduPaySchool._id; const [students, plans, settlements] = await Promise.all([Child.countDocuments({ school }), Plan.find({ school }).lean(), Settlement.find({ school }).lean()]); res.json({ success: true, school: publicSchool(req.eduPaySchool), summary: { totalRegisteredStudents: students, activeEduPayStudents: plans.length, totalExpectedFees: round(plans.reduce((s, p) => s + p.officialFee, 0)), parentSavings: round((await Contribution.aggregate([{ $match: { plan: { $in: plans.map((p) => p._id) }, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]))[0]?.total), upcomingSettlements: settlements.filter((s) => !["SETTLED", "REVERSED"].includes(s.status)).length, completedSettlements: settlements.filter((s) => s.status === "SETTLED").length }, settlements }); } catch (error) { errorResponse(res, error); } };
exports.schoolProfile = async (req, res) => { try { res.json({ success: true, school: publicSchool(req.eduPaySchool) }); } catch (error) { errorResponse(res, error); } };
exports.schoolSessions = async (req, res) => { try { const rows = await EduPayAcademicSession.find({ school: req.eduPaySchool._id }).sort({ createdAt: -1 }); res.json({ success: true, sessions: rows }); } catch (error) { errorResponse(res, error); } };
exports.schoolTerms = async (req, res) => { try { const rows = await EduPayTerm.find({ school: req.eduPaySchool._id }).populate({ path: "session", select: "_id name status startsAt endsAt", match: { school: req.eduPaySchool._id } }).sort({ createdAt: -1 }).lean(); res.json({ success: true, terms: rows.filter((row) => row.session) }); } catch (error) { errorResponse(res, error); } };
exports.schoolClasses = async (req, res) => { try { const rows = await EduPayClass.find({ school: req.eduPaySchool._id }).sort({ name: 1 }).lean(); res.json({ success: true, classes: rows }); } catch (error) { errorResponse(res, error); } };
exports.schoolFees = async (req, res) => { try { const rows = await Fee.find({ school: req.eduPaySchool._id }).populate({ path: "session", select: "_id name status startsAt endsAt", match: { school: req.eduPaySchool._id } }).populate({ path: "term", select: "_id name status session startsAt endsAt", match: { school: req.eduPaySchool._id } }).populate({ path: "classLevel", select: "_id name status", match: { school: req.eduPaySchool._id } }).sort({ createdAt: -1 }).lean(); res.json({ success: true, fees: rows.filter((row) => row.session && row.term && row.classLevel) }); } catch (error) { errorResponse(res, error); } };
const schoolAcademicStatus = (value) => {
  const status = String(value || "DRAFT").trim().toUpperCase();
  if (!["DRAFT", "ACTIVE", "UPCOMING", "CLOSED"].includes(status)) {
    const error = new Error("Academic status must be ACTIVE, UPCOMING, CLOSED, or legacy DRAFT.");
    error.statusCode = 400; throw error;
  }
  return status;
};
const schoolAcademicDates = (startsAt, endsAt) => {
  const start = startsAt ? new Date(startsAt) : null; const end = endsAt ? new Date(endsAt) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())) || (start && end && end < start)) {
    const error = new Error("Academic dates are invalid."); error.statusCode = 400; throw error;
  }
  return { startsAt: start || undefined, endsAt: end || undefined };
};
const standardTermNames = ["First Term", "Second Term", "Third Term"];
const createStandardTerms = async (school, session, actor, dbSession = null) => {
  const rows = [];
  for (const name of standardTermNames) {
    const active = session.status === "ACTIVE" && name === "First Term";
    const query = EduPayTerm.findOneAndUpdate({ session: session._id, name }, { $setOnInsert: { school, session: session._id, name, status: active ? "ACTIVE" : "UPCOMING", isCurrent: active, updatedBy: actor } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (dbSession) query.session(dbSession);
    rows.push(await query);
  }
  return rows;
};
exports.schoolCreateSession = async (req, res) => {
  let dbSession;
  try {
    if (!(await enabledForInitiation(res))) return;
    const school = req.eduPaySchool._id; const status = schoolAcademicStatus(req.body.status);
    const requestedCurrent = req.body.isCurrent === true || req.body.current === true || req.body.isDefault === true;
    const isCurrent = requestedCurrent || (status === "ACTIVE" && !(await EduPayAcademicSession.exists({ school, isCurrent: true })));
    if (isCurrent && status !== "ACTIVE") return res.status(400).json({ success: false, message: "Only an ACTIVE session can be current." });
    dbSession = await mongoose.startSession(); let row; let terms = [];
    await dbSession.withTransaction(async () => {
      if (isCurrent) await EduPayAcademicSession.updateMany({ school, isCurrent: true }, { $set: { isCurrent: false } }).session(dbSession);
      row = await EduPayAcademicSession.findOneAndUpdate({ school, name: req.body.name }, { $setOnInsert: { school, name: req.body.name, ...schoolAcademicDates(req.body.startsAt, req.body.endsAt), status, isCurrent } }, { upsert: true, new: true, setDefaultsOnInsert: true }).session(dbSession);
      if (req.body.createStandardTerms === true) terms = await createStandardTerms(school, row, req.user._id, dbSession);
    });
    res.status(201).json({ success: true, session: row, terms });
  } catch (error) { errorResponse(res, error); } finally { if (dbSession) await dbSession.endSession(); }
};
exports.schoolCreateTerm = async (req, res) => {
  let dbSession;
  try {
    if (!(await enabledForInitiation(res))) return;
    const school = req.eduPaySchool._id; const session = await EduPayAcademicSession.findOne({ _id: req.body.session, school });
    if (!session) return res.status(400).json({ success: false, message: "Academic session does not belong to this school." });
    const status = schoolAcademicStatus(req.body.status);
    const requestedCurrent = req.body.isCurrent === true || req.body.current === true || req.body.isDefault === true;
    const isCurrent = requestedCurrent || (status === "ACTIVE" && !(await EduPayTerm.exists({ school, session: session._id, isCurrent: true })));
    if (isCurrent && status !== "ACTIVE") return res.status(400).json({ success: false, message: "Only an ACTIVE term can be current." });
    dbSession = await mongoose.startSession(); let row;
    await dbSession.withTransaction(async () => {
      const parent = await EduPayAcademicSession.findOne({ _id: session._id, school, status: "ACTIVE", isCurrent: true }).select("_id").session(dbSession);
      if ((status === "ACTIVE" || isCurrent) && !parent) { const error = new Error("ACTIVE/current terms require the current ACTIVE academic session."); error.statusCode = 400; throw error; }
      if (isCurrent) await EduPayTerm.updateMany({ school, session: session._id, isCurrent: true }, { $set: { isCurrent: false } }).session(dbSession);
      [row] = await EduPayTerm.create([{ school, session: session._id, name: req.body.name, ...schoolAcademicDates(req.body.startsAt, req.body.endsAt), status, isCurrent }], { session: dbSession });
    });
    res.status(201).json({ success: true, term: row });
  } catch (error) { errorResponse(res, error); } finally { if (dbSession) await dbSession.endSession(); }
};
exports.schoolCreateClass = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const row = await EduPayClass.create({ school: req.eduPaySchool._id, name: req.body.name }); res.status(201).json({ success: true, classLevel: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolCreateFee = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const amount = round(req.body.amount); if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "A valid official fee amount is required." }); const [session, term, classLevel] = await Promise.all([EduPayAcademicSession.findOne({ _id: req.body.session, school: req.eduPaySchool._id }), EduPayTerm.findOne({ _id: req.body.term, school: req.eduPaySchool._id, session: req.body.session }), EduPayClass.findOne({ _id: req.body.classLevel, school: req.eduPaySchool._id })]); if (!session || !term || !classLevel) return res.status(400).json({ success: false, message: "Academic references must belong to this school." }); if (!["ACTIVE", "UPCOMING"].includes(session.status) || !["ACTIVE", "UPCOMING"].includes(term.status)) return res.status(400).json({ success: false, message: "Fees can only be configured for active or upcoming academic entries." }); const row = await Fee.create({ school: req.eduPaySchool._id, session: session._id, term: term._id, classLevel: classLevel._id, amount, submittedBy: req.user._id, status: "PENDING_APPROVAL" }); res.status(201).json({ success: true, fee: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolUpdateFee = async (req, res) => {
  try {
    if (!(await enabledForInitiation(res))) return;
    const row = await Fee.findOne({ _id: req.params.feeId, school: req.eduPaySchool._id });
    if (!row) return res.status(404).json({ success: false, message: "Fee structure not found for this school." });
    const [session, term] = await Promise.all([
      EduPayAcademicSession.findOne({ _id: row.session, school: req.eduPaySchool._id }),
      EduPayTerm.findOne({ _id: row.term, school: req.eduPaySchool._id, session: row.session }),
    ]);
    if (!session || !term || !["ACTIVE", "UPCOMING"].includes(session.status) || !["ACTIVE", "UPCOMING"].includes(term.status)) {
      return res.status(400).json({ success: false, message: "Fees can only be updated for active or upcoming academic entries." });
    }
    if (req.body.status !== undefined) {
      const status = String(req.body.status).toUpperCase();
      if (!["DRAFT", "PENDING_APPROVAL", "RETIRED"].includes(status)) return res.status(400).json({ success: false, message: "School users may submit or retire fees; approval remains an administrative action." });
      row.status = status;
    }
    if (req.body.amount !== undefined) {
      const amount = round(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, message: "A valid official fee amount is required." });
      row.amount = amount;
      row.status = "PENDING_APPROVAL";
    }
    if (row.status === "PENDING_APPROVAL") {
      row.reviewedBy = null;
      row.reviewedAt = null;
      row.reviewNote = "";
    }
    row.submittedBy = row.submittedBy || req.user._id;
    await row.save();
    res.json({ success: true, fee: row });
  } catch (error) { errorResponse(res, error); }
};
exports.schoolStudents = async (req, res) => { try { res.json({ success: true, students: await Child.find({ school: req.eduPaySchool._id }).select("fullName school status createdAt").lean() }); } catch (error) { errorResponse(res, error); } };
exports.schoolSettlements = async (req, res) => { try { res.json({ success: true, settlements: await Settlement.find({ school: req.eduPaySchool._id }).populate("child plan").sort({ settlementDate: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.schoolReconciliation = async (req, res) => { try { const settlements = await Settlement.find({ school: req.eduPaySchool._id }).lean(); res.json({ success: true, reconciliation: { settled: settlements.filter((row) => row.status === "SETTLED").length, pending: settlements.filter((row) => !["SETTLED", "REVERSED"].includes(row.status)).length, gross: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolGrossSettlement, 0)), net: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolNetSettlement, 0)), commission: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolCommissionAmount, 0)) } }); } catch (error) { errorResponse(res, error); } };
exports.schoolReport = async (req, res) => { try { const [plans, settlements] = await Promise.all([Plan.find({ school: req.eduPaySchool._id }).lean(), Settlement.find({ school: req.eduPaySchool._id }).lean()]); res.json({ success: true, report: { plans: plans.length, settlements: settlements.length, totalOfficialFees: round(plans.reduce((sum, row) => sum + row.officialFee, 0)), totalSettledNet: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolNetSettlement, 0)) } }); } catch (error) { errorResponse(res, error); } };
exports.schoolSavings = async (req, res) => {
  try {
    const school = req.eduPaySchool._id;
    const plans = await Plan.find({ school }).populate("child classLevel session term").sort({ createdAt: -1 }).lean();
    const ids = plans.map((row) => row._id);
    const ledger = await EduLedger.find({ plan: { $in: ids } }).sort({ createdAt: 1 }).lean();
    const byPlan = new Map();
    for (const entry of ledger) {
      const key = String(entry.plan);
      const row = byPlan.get(key) || { saved: 0, history: [] };
      row.saved = round(row.saved + (entry.direction === "CREDIT" ? entry.amount : -entry.amount));
      row.history.push({ amount: entry.amount, direction: entry.direction, type: entry.type, reference: entry.reference, status: "SUCCESS", source: entry.source, createdAt: entry.createdAt, openingBalance: entry.openingBalance, closingBalance: entry.closingBalance });
      byPlan.set(key, row);
    }
    const rows = plans.map((plan) => { const value = byPlan.get(String(plan._id)) || { saved: 0, history: [] }; const target = Number(plan.targetAmount || plan.officialFee); return { planId: plan._id, student: plan.child?.fullName || null, child: plan.child?._id || null, className: plan.classLevel?.name || plan.child?.className || null, target, targetAmount: target, saved: value.saved, remaining: round(Math.max(0, target - value.saved)), progressPercent: target ? round(Math.min(100, value.saved / target * 100)) : 0, status: plan.status, targetDate: plan.targetDate, history: value.history }; });
    res.json({ success: true, summary: { plans: rows.length, activePlans: rows.filter((row) => !["CANCELLED", "SETTLED", "COMPLETED"].includes(row.status)).length, totalTarget: round(rows.reduce((sum, row) => sum + row.target, 0)), totalSaved: round(rows.reduce((sum, row) => sum + row.saved, 0)), totalRemaining: round(rows.reduce((sum, row) => sum + row.remaining, 0)) }, plans: rows });
  } catch (error) { errorResponse(res, error); }
};

exports.adminOverview = async (req, res) => { try { const [settings, parents, children, schools, plans, settlements, repayments, ledger] = await Promise.all([getSettings(), Plan.distinct("parent"), Child.countDocuments(), School.countDocuments(), Plan.countDocuments({ status: { $nin: ["CANCELLED"] } }), Settlement.find().lean(), EduPayRepayment.find({ status: { $in: ["ACTIVE", "PARTIALLY_PAID", "OVERDUE"] } }).lean(), EduLedger.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])]); res.json({ success: true, settings, summary: { totalEduPayParents: parents.length, totalChildren: children, partnerSchools: schools, activePlans: plans, educationSavings: round(ledger[0]?.total), upcomingSettlements: settlements.filter((s) => !["SETTLED", "REVERSED"].includes(s.status)).length, completedSettlements: settlements.filter((s) => s.status === "SETTLED").length, outstandingRepayments: round(repayments.reduce((sum, r) => sum + r.amountRemaining, 0)), overdueRepayments: repayments.filter((r) => r.status === "OVERDUE").length, schoolCommissionRevenue: round(settlements.filter((s) => s.status === "SETTLED").reduce((sum, s) => sum + s.schoolCommissionAmount, 0)), parentChargeRevenue: round(settlements.filter((s) => s.status === "SETTLED").reduce((sum, s) => sum + s.parentChargeAmount, 0)) } }); } catch (error) { errorResponse(res, error); } };
exports.adminReadiness = async (req, res) => { try { const modelEntries = Object.entries(EDUPAY_READINESS_MODELS); await EduPayDutyAssignment.init(); await Promise.all(modelEntries.filter(([, model]) => model?.init).map(([, model]) => model.init())); const indexes = {}; await Promise.all(modelEntries.filter(([, model]) => model?.collection?.listIndexes).map(async ([name, model]) => { indexes[name] = await model.collection.listIndexes().toArray(); })); const all = await EduPayDutyAssignment.find({}).sort({ user: 1, version: -1 }).lean(); const latest = new Map(); all.forEach((row) => { if (!latest.has(String(row.user))) latest.set(String(row.user), row); }); const eligible = new Set((await User.find({ _id: { $in: [...latest.keys()] }, status: "ACTIVE", role: "HEAD_OFFICE" }).select("_id").lean()).map((row) => String(row._id))); const current = [...latest.values()].filter((row) => row.active && eligible.has(String(row.user))); const holders = (permission) => new Set(current.filter((row) => row.permissions.includes(permission)).map((row) => String(row.user))); const manageUsers = holders("account.manage"); const verifyUsers = holders("account.verify"); const processUsers = holders("settlement.process"); const viableDutySeparation = [...manageUsers].some((manager) => [...verifyUsers].some((verifier) => verifier !== manager && [...processUsers].some((processor) => processor !== manager && processor !== verifier))); const settings = await getSettings(); const infrastructure = edupaySquad.payoutReadiness(); const payoutConfig = { provider: infrastructure.providerReady, accountEncryption: infrastructure.accountEncryptionReady, settlementMethod: ["DEDUCT_COMMISSION", "GROSS_AND_RECEIVABLE"].includes(settings.settlementMethod), rates: Number(settings.schoolCommissionRate) >= 0 && Number(settings.parentShortfallChargeRate) >= 0 }; payoutConfig.ready = payoutConfig.provider && payoutConfig.accountEncryption && payoutConfig.settlementMethod && payoutConfig.rates; const dutyCoverage = { manage: manageUsers.size, verify: verifyUsers.size, process: processUsers.size, viableDutySeparation, ready: viableDutySeparation }; const ready = payoutConfig.ready; res.json({ success: true, ready, eduPayActive: ready, customerInitiationEnabled: ready, dutyCoverage, payoutConfig: { ...infrastructure, ...payoutConfig }, checkedAt: new Date(), indexes }); } catch (error) { errorResponse(res, error); } };
exports.adminSettings = async (req, res) => {
  try {
    const allowed = {
      schoolCommissionRate: { type: "percentage", min: 0, max: 100 },
      parentShortfallChargeRate: { type: "percentage", min: 0, max: 100 },
      minimumSavingsRequirement: { type: "number", min: 0 },
      maximumEduPayCover: { type: "number", min: 0 },
      maximumCoverPercentage: { type: "percentage", min: 0, max: 100 },
      defaultRepaymentPeriodDays: { type: "integer", min: 1, max: 3650 },
      settlementMethod: { type: "enum", values: ["DEDUCT_COMMISSION", "GROSS_AND_RECEIVABLE"] },
      settlementLeadDays: { type: "integer", min: 0, max: 365 },
      gracePeriodDays: { type: "integer", min: 0, max: 365 },
      autosaveEnabled: { type: "boolean" },
    };
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (req.method !== "GET") {
      const unknown = Object.keys(body).filter((key) => !Object.prototype.hasOwnProperty.call(allowed, key));
      if (unknown.length) {
        const error = new Error(`Unknown EduPay setting(s): ${unknown.join(", ")}.`);
        error.statusCode = 400;
        error.code = "EDUPAY_SETTINGS_UNKNOWN_FIELD";
        throw error;
      }
      const applied = {};
      for (const [key, value] of Object.entries(body)) {
        const rule = allowed[key];
        const validNumber = typeof value === "number" && Number.isFinite(value);
        const valid = rule.type === "boolean" ? typeof value === "boolean"
          : rule.type === "enum" ? rule.values.includes(value)
            : validNumber && (rule.type !== "integer" || Number.isInteger(value))
              && value >= rule.min && value <= (rule.max ?? Infinity);
        if (!valid) {
          const error = new Error(`Invalid EduPay setting: ${key}.`);
          error.statusCode = 400;
          error.code = "EDUPAY_SETTINGS_INVALID_VALUE";
          throw error;
        }
        applied[key] = value;
      }
      const settings = await getSettings();
      Object.assign(settings, applied);
      settings.updatedBy = req.user._id;
      await settings.save();
      await audit({ actor: req.user._id, action: "EDUPAY_SETTINGS_UPDATED", entityType: "EduPaySettings", entityId: settings._id, metadata: applied, req });
      return res.json({ success: true, settings: { ...settings.toObject(), enabled: await evaluateEduPayReadiness() } });
    }
    const settings = await getSettings();
    return res.json({ success: true, settings: { ...settings.toObject(), enabled: await evaluateEduPayReadiness() } });
  } catch (error) { errorResponse(res, error); }
};
exports.adminSchools = async (req, res) => { try { const status = String(req.query.status || "").toUpperCase(); const filter = status && ["PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"].includes(status) ? { status } : {}; if (req.query.state) filter.state = String(req.query.state).trim(); if (req.query.search) { const search = String(req.query.search).trim(); filter.$or = [{ name: new RegExp(search, "i") }, { email: new RegExp(search, "i") }, { registrationNumber: new RegExp(search, "i") }]; } const schools = await School.find(filter).sort({ createdAt: -1 }).lean(); res.json({ success: true, filter: { status: status || "ALL", state: req.query.state || null, search: req.query.search || null }, schools: schools.map(schoolAdminDto) }); } catch (error) { errorResponse(res, error); } };
exports.adminSchoolDetail = async (req, res) => { try { const school = await School.findById(req.params.schoolId).populate("reviewedBy", "fullName email").lean(); if (!school) return res.status(404).json({ success: false, message: "School not found." }); res.json({ success: true, school: schoolAdminDto(school) }); } catch (error) { errorResponse(res, error); } };
exports.adminSchoolPrivateAssets = async (req, res) => { try { const school = await School.findById(req.params.schoolId).select("logo supportingDocuments").lean(); if (!school) return res.status(404).json({ success: false, message: "School not found." }); res.json({ success: true, assets: { logo: school.logo, supportingDocuments: school.supportingDocuments } }); } catch (error) { errorResponse(res, error); } };
exports.adminSchoolPrivateAssetDownload = async (req, res) => { try { const school = await School.findById(req.params.schoolId).select("logo supportingDocuments").lean(); const assets = [school?.logo, ...(school?.supportingDocuments || [])].filter(Boolean); const asset = assets.find((row) => String(row.fileId) === String(req.params.fileId)); if (!asset) return res.status(404).json({ success: false, message: "Private school asset not found." }); const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "edupaySchoolAssets" }); res.set("Content-Type", asset.mimeType); res.set("Content-Length", String(asset.size)); return bucket.openDownloadStream(asset.fileId).on("error", () => { if (!res.headersSent) res.status(404).end(); }).pipe(res); } catch (error) { errorResponse(res, error); } };
exports.adminCreateSchool = async (req, res) => {
  let session;
  try {
    const b = req.body || {};
    const name = String(b.schoolName || "").trim();
    const schoolType = String(b.schoolType || "").trim().toUpperCase();
    const email = String(b.email || "").trim().toLowerCase();
    const phone = String(b.phone || "").trim();
    const address = String(b.address || "").trim();
    const state = String(b.state || "").trim();
    const lga = String(b.lga || "").trim();
    const proprietorName = String(b.proprietorName || "").trim();
    if (!name || !["NURSERY", "PRIMARY", "SECONDARY", "COMBINED", "OTHER"].includes(schoolType) || !proprietorName || !email || !phone || !address || !state || !lga) {
      return res.status(400).json({ success: false, message: "School name, type, proprietor, email, phone, address, state, and LGA are required." });
    }
    const temporaryPassword = requireTemporaryPassword(b.temporaryPassword);
    if (await User.exists({ $or: [{ email }, { phone }] })) return res.status(409).json({ success: false, message: "An account already exists with this email or phone." });
    const normalizedSchoolName = normalizeRequestText(name);
    const normalizedLocation = normalizeRequestText(`${state} ${lga}`);
    if (await School.exists({ normalizedSchoolName, normalizedLocation, status: { $in: activeSchoolStatuses } })) return res.status(409).json({ success: false, message: "An active school with this identity already exists." });
    session = await mongoose.startSession();
    let school;
    await session.withTransaction(async () => {
      const [user] = await User.create([{ fullName: proprietorName, email, phone, password: temporaryPassword, role: "CUSTOMER", status: "ACTIVE", mustChangePassword: true }], { session });
      [school] = await School.create([{
        schoolCode: publicSchoolCode(), name, schoolType, proprietorName, contactPerson: proprietorName, email, phone, address, state, lga,
        normalizedSchoolName, normalizedLocation, normalizedAddress: normalizeRequestText(address), normalizedEmail: email, normalizedPhone: phone,
        status: "APPROVED", active: true, portalUser: user._id, reviewedBy: req.user._id, reviewedAt: new Date(),
      }], { session });
      await SchoolUser.create([{ school: school._id, user: user._id, role: "SCHOOL_ADMIN", status: "ACTIVE", invitedBy: req.user._id }], { session });
      await audit({ actor: req.user._id, action: "EDUPAY_SCHOOL_MANUALLY_CREATED", entityType: "EduPaySchool", entityId: school._id, school: school._id, metadata: { schoolCode: school.schoolCode, adminUserId: user._id }, req, session });
    });
    return res.status(201).json({ success: true, school: schoolAdminDto(school), schoolAdmin: { email, role: "SCHOOL_ADMIN", mustChangePassword: true } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A school or account with these details already exists." });
    return errorResponse(res, error);
  } finally { if (session) await session.endSession(); }
};
exports.adminSchoolUpdate = async (req, res) => {
  if (req.body?.action) return exports.adminSchoolAction(req, res);
  try {
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: "School not found." });
    const requestedName = req.body.schoolName !== undefined ? req.body.schoolName : req.body.name;
    if (req.body.email !== undefined || req.body.phone !== undefined) {
      const duplicate = await School.findOne({
        _id: { $ne: school._id },
        $or: [
          ...(req.body.email !== undefined ? [{ normalizedEmail: String(req.body.email).trim().toLowerCase() }] : []),
          ...(req.body.phone !== undefined ? [{ normalizedPhone: String(req.body.phone).trim() }] : []),
        ],
        status: { $in: activeSchoolStatuses },
      }).select("_id");
      if (duplicate) return res.status(409).json({ success: false, message: "Another active school uses this email or phone." });
    }
    const fields = ["name", "schoolType", "proprietorName", "contactPerson", "email", "phone", "address", "state", "lga"];
    for (const key of fields) if (req.body[key] !== undefined) school[key] = String(req.body[key]).trim();
    if (requestedName !== undefined) school.name = String(requestedName).trim();
    if (req.body.schoolType !== undefined && !["NURSERY", "PRIMARY", "SECONDARY", "COMBINED", "OTHER"].includes(String(req.body.schoolType).toUpperCase())) return res.status(400).json({ success: false, message: "Unsupported school type." });
    if (requestedName !== undefined) school.normalizedSchoolName = normalizeRequestText(requestedName);
    if (req.body.address !== undefined) school.normalizedAddress = normalizeRequestText(req.body.address);
    if (req.body.email !== undefined) school.normalizedEmail = String(req.body.email).trim().toLowerCase();
    if (req.body.phone !== undefined) school.normalizedPhone = String(req.body.phone).trim();
    school.updatedBy = req.user._id;
    await school.save();
    if (school.portalUser) {
      const portalUser = await User.findById(school.portalUser);
      if (portalUser) {
        if (req.body.email !== undefined) portalUser.email = String(req.body.email).trim().toLowerCase();
        if (req.body.phone !== undefined) portalUser.phone = String(req.body.phone).trim();
        if (req.body.proprietorName !== undefined) portalUser.fullName = String(req.body.proprietorName).trim();
        await portalUser.save();
      }
    }
    await audit({ actor: req.user._id, action: "EDUPAY_SCHOOL_UPDATED", entityType: "EduPaySchool", entityId: school._id, school: school._id, metadata: { fields: [...fields.filter((key) => req.body[key] !== undefined), ...(req.body.schoolName !== undefined ? ["schoolName"] : [])] }, req });
    return res.json({ success: true, school: schoolAdminDto(school) });
  } catch (error) { return errorResponse(res, error); }
};
exports.adminResetSchoolPassword = async (req, res) => {
  try {
    const temporaryPassword = requireTemporaryPassword(req.body.temporaryPassword);
    const school = await School.findById(req.params.schoolId);
    if (!school) return res.status(404).json({ success: false, message: "School not found." });
    const membership = await SchoolUser.findOne({ school: school._id, role: { $in: ["OWNER", "ADMIN", "SCHOOL_ADMIN"] }, status: { $in: ["ACTIVE", "SUSPENDED"] } }).sort({ role: 1 });
    if (!membership) return res.status(404).json({ success: false, message: "School administrator account not found." });
    const user = await User.findById(membership.user).select("+password +authTokenVersion");
    if (!user) return res.status(404).json({ success: false, message: "School administrator account not found." });
    user.password = temporaryPassword; user.passwordResetToken = undefined; user.passwordResetExpires = undefined; user.mustChangePassword = true; user.passwordChangedAt = new Date(); user.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
    await user.save();
    await audit({ actor: req.user._id, action: "EDUPAY_SCHOOL_ADMIN_PASSWORD_RESET", entityType: "User", entityId: user._id, school: school._id, metadata: { membershipId: membership._id }, req });
    return res.json({ success: true, message: "Temporary school administrator password set.", schoolAdmin: { userId: user._id, email: user.email, mustChangePassword: true } });
  } catch (error) { return errorResponse(res, error); }
};
exports.adminSchoolAction = async (req, res) => {
  let session;
  try {
    const action = String(req.body.action || "").toUpperCase();
    const allowed = new Set(["APPROVE", "REJECT", "SUSPEND", "REACTIVATE", "REQUEST_UPDATE", "REVIEW"]);
    if (!allowed.has(action)) return res.status(400).json({ success: false, message: "Unsupported school action." });
    session = await mongoose.startSession();
    let school;
    await session.withTransaction(async () => {
      school = await School.findById(req.params.schoolId).session(session);
      if (!school) { const error = new Error("School not found."); error.statusCode = 404; throw error; }
      const previousStatus = school.status;
      const valid = action === "APPROVE" ? ["PENDING_REVIEW", "UNDER_REVIEW"].includes(previousStatus)
        : action === "REQUEST_UPDATE" || action === "REVIEW" ? ["PENDING_REVIEW", "UNDER_REVIEW"].includes(previousStatus)
          : action === "REJECT" ? ["PENDING_REVIEW", "UNDER_REVIEW"].includes(previousStatus)
            : action === "SUSPEND" ? previousStatus === "APPROVED"
              : action === "REACTIVATE" ? previousStatus === "SUSPENDED" : false;
      if (!valid) { const error = new Error(`School cannot transition via ${action} from ${previousStatus}.`); error.statusCode = 409; throw error; }
      const next = { APPROVE: ["APPROVED", true], REJECT: ["REJECTED", false], SUSPEND: ["SUSPENDED", false], REACTIVATE: ["APPROVED", true], REQUEST_UPDATE: ["UNDER_REVIEW", false], REVIEW: ["UNDER_REVIEW", false] }[action];
      school.status = next[0]; school.active = next[1]; school.reviewedBy = req.user._id; school.reviewedAt = new Date(); school.reviewNote = req.body.note;
      await school.save({ session });
      let memberships = await SchoolUser.find({ school: school._id }).session(session);
      if (action === "APPROVE" && school.portalUser && !memberships.some((membership) => String(membership.user) === String(school.portalUser))) {
        const [membership] = await SchoolUser.create([{ school: school._id, user: school.portalUser, role: "SCHOOL_ADMIN", status: "ACTIVE", invitedBy: req.user._id }], { session });
        memberships.push(membership);
      }
      for (const membership of memberships) {
        const user = await User.findById(membership.user).select("+authTokenVersion").session(session);
        if (!user) continue;
        const wasLifecycleSuspended = membership.suspendedBySchoolLifecycle === true;
        if (action === "SUSPEND") {
          if (membership.status === "ACTIVE") { membership.status = "SUSPENDED"; membership.suspendedBySchoolLifecycle = true; await membership.save({ session }); }
          if (user.status === "ACTIVE") user.status = "SUSPENDED";
          user.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
          await user.save({ session });
        } else if (action === "REACTIVATE") {
          if (wasLifecycleSuspended) {
            membership.status = "ACTIVE"; membership.suspendedBySchoolLifecycle = false; await membership.save({ session });
          }
          user.authTokenVersion = Number(user.authTokenVersion || 0) + 1;
          if (wasLifecycleSuspended && user.status === "SUSPENDED") user.status = "ACTIVE";
          await user.save({ session });
        } else if (action === "APPROVE") {
          if (String(user._id) === String(school.portalUser)) { user.status = "ACTIVE"; user.authTokenVersion = Number(user.authTokenVersion || 0) + 1; await user.save({ session }); }
          if (membership.status !== "ACTIVE") { membership.status = "ACTIVE"; await membership.save({ session }); }
        }
      }
      await audit({ actor: req.user._id, action: `EDUPAY_SCHOOL_${action}`, entityType: "EduPaySchool", entityId: school._id, school: school._id, metadata: { note: req.body.note, from: previousStatus, to: next[0] }, req, session });
    });
    res.json({ success: true, school: schoolAdminDto(school) });
  } catch (error) { errorResponse(res, error); }
  finally { if (session) await session.endSession(); }
};
exports.adminCreateSchoolUser = async (req, res) => {
  let session;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      const school = await School.findById(req.params.schoolId).session(session);
      if (!school) { const e = new Error("School not found."); e.statusCode = 404; throw e; }
      if (school.status !== "APPROVED" || !school.active) { const e = new Error("School must be approved before staff can be provisioned."); e.statusCode = 409; throw e; }
      const [user] = await User.create([{ fullName: req.body.fullName, phone: req.body.phone, email: String(req.body.email || "").trim().toLowerCase(), password: req.body.password, role: "CUSTOMER", status: "ACTIVE" }], { session });
      const [membership] = await SchoolUser.create([{ school: school._id, user: user._id, role: req.body.role || "STAFF", status: "ACTIVE", invitedBy: req.user._id }], { session });
      await audit({ actor: req.user._id, action: "EDUPAY_SCHOOL_USER_CREATED", entityType: "EduPaySchoolUser", entityId: membership._id, school: school._id, req, session });
      result = { schoolUser: { id: membership._id, userId: user._id, email: user.email, role: membership.role, status: membership.status } };
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) { errorResponse(res, error); }
  finally { if (session) await session.endSession(); }
};

exports.adminSettlementActionSecure = async (req, res) => {
  try {
    const action = String(req.body.action || "").toUpperCase();
    if (["PROCESS", "CONFIRM", "REVERSE", "FAIL"].includes(action)) return res.status(410).json({ success: false, message: "Legacy settlement lifecycle action is disabled; use the dedicated Squad process, requery, or verified webhook flow." });
    const settlement = await Settlement.findById(req.params.settlementId);
    if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found." });
    if (["APPROVE", "PROCESS", "FAIL"].includes(action)) {
      const expected = action === "APPROVE" ? "ADMIN_REVIEW" : action === "PROCESS" ? "APPROVED" : null;
      if (expected && settlement.status !== expected) return res.status(409).json({ success: false, message: `Settlement must be ${expected}.` });
      if (action === "APPROVE") { settlement.status = "APPROVED"; settlement.approvedBy = req.user._id; settlement.approvedAt = new Date(); }
      if (action === "PROCESS") settlement.status = "PROCESSING";
      if (action === "FAIL") { if (!["APPROVED", "PROCESSING"].includes(settlement.status)) return res.status(409).json({ success: false, message: "Settlement cannot be failed in its current state." }); settlement.status = "FAILED"; settlement.failureReason = req.body.reason || "Settlement failed"; }
      await settlement.save(); await audit({ actor: req.user._id, action: `EDUPAY_SETTLEMENT_${action}`, entityType: "EduPaySettlement", entityId: settlement._id, school: settlement.school, req }); return res.json({ success: true, settlement });
    }
    if (!requireKey(req)) return res.status(400).json({ success: false, message: "Idempotency-Key is required." });
    if (action === "CONFIRM") {
      return res.status(410).json({ success: false, message: "Manual settlement confirmation is disabled; use the Squad payout process/requery flow." });
    }
    if (action === "REVERSE") {
      const result = await reverseSettlement({ settlementId: settlement._id, actor: req.user._id, transactionId: req.body.transactionId, providerReference: req.body.providerReference, idempotencyKey: requireKey(req), reason: req.body.reason, req });
      return res.json({ success: true, duplicate: result.duplicate, reversal: result.reversal });
    }
    return res.status(400).json({ success: false, message: "Unsupported settlement action." });
  } catch (error) { errorResponse(res, error); }
};
// Keep the historical export harmless for callers that still import it.
exports.adminSettlementAction = (req, res) => res.status(410).json({ success: false, message: "Legacy settlement lifecycle actions are disabled." });
exports.adminSettlementProcess = async (req, res) => { try { const settlement = await edupaySquad.processSettlement({ settlementId: req.params.settlementId, actor: req.user._id, req }); res.json({ success: true, settlement }); } catch (error) { errorResponse(res, error); } };
exports.adminSettlementRequery = async (req, res) => { try { const settlement = await edupaySquad.requerySettlement({ settlementId: req.params.settlementId, actor: req.user._id, req }); res.json({ success: true, settlement }); } catch (error) { errorResponse(res, error); } };
exports.adminSettlementAccount = async (req, res) => { try { const account = await edupaySquad.saveAccount({ schoolId: req.params.schoolId, accountName: req.body.accountName, bankName: req.body.bankName, bankCode: req.body.bankCode, accountNumber: req.body.accountNumber, actor: req.user._id, verified: false }); res.json({ success: true, account: { id: account._id, school: account.school, accountName: account.accountName, bankName: account.bankName, bankCode: account.bankCode, accountNumberLast4: account.accountNumberLast4, verified: account.verified, active: account.active } }); } catch (error) { errorResponse(res, error); } };
exports.adminVerifySettlementAccount = async (req, res) => { try { const result = await edupaySquad.verifyAccount({ schoolId: req.params.schoolId, actor: req.user._id, accountId: req.body.accountId || req.query.accountId, version: req.body.version || req.query.version }); res.json({ success: true, account: { id: result.account._id, school: result.account.school, accountName: result.account.accountName, accountNumberLast4: result.account.accountNumberLast4, version: result.account.version, verified: result.account.verified, active: result.account.active }, evidence: result.evidence }); } catch (error) { errorResponse(res, error); } };
exports.adminEduPayDuty = async (req, res) => { try { const target = await User.findById(req.params.userId).select("_id status role"); if (!target) return res.status(404).json({ success: false, message: "Duty target user not found." }); if (target.status !== "ACTIVE" || target.role !== "HEAD_OFFICE") return res.status(422).json({ success: false, code: "EDUPAY_DUTY_TARGET_INELIGIBLE", message: "Duty targets must be active HEAD_OFFICE users." }); const permissions = [...new Set((Array.isArray(req.body.permissions) ? req.body.permissions : []).map(String))]; const allowed = new Set(["account.manage", "account.verify", "settlement.process"]); if (!permissions.length || permissions.some((permission) => !allowed.has(permission))) return res.status(400).json({ success: false, message: "Invalid EduPay duty permissions." }); const session = await mongoose.startSession(); let assignment; try { await session.withTransaction(async () => { const previous = await EduPayDutyAssignment.findOne({ user: req.params.userId }).sort({ version: -1 }).session(session); const version = Number(previous?.version || 0) + 1; [assignment] = await EduPayDutyAssignment.create([{ user: req.params.userId, permissions, active: req.body.active !== false, assignedBy: req.user._id, version, previousAssignment: previous?._id || null }], { session }); await audit({ actor: req.user._id, action: "EDUPAY_DUTY_ASSIGNED", entityType: "EduPayDutyAssignment", entityId: assignment._id, metadata: { user: req.params.userId, permissions, active: assignment.active, version }, req, session }); }); } finally { await session.endSession(); } res.json({ success: true, assignment }); } catch (error) { errorResponse(res, error); } };
exports.adminConfigureEduPayDuties = async (req, res) => {
  try {
    const required = ["account.manage", "account.verify", "settlement.process"];
    const assignments = req.body?.assignments;
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) {
      return res.status(400).json({ success: false, message: "All three EduPay duty assignments are required." });
    }
    const selected = required.map((permission) => String(assignments[permission] || "").trim());
    if (selected.some((userId) => !mongoose.Types.ObjectId.isValid(userId)) || new Set(selected).size !== required.length) {
      return res.status(400).json({ success: false, code: "EDUPAY_DISTINCT_DUTIES_REQUIRED", message: "Select three distinct active Head Office officers." });
    }
    const eligible = await User.find({ _id: { $in: selected }, status: "ACTIVE", role: "HEAD_OFFICE" }).select("_id").lean();
    if (eligible.length !== required.length) {
      return res.status(422).json({ success: false, code: "EDUPAY_DUTY_TARGET_INELIGIBLE", message: "Duty targets must be active HEAD_OFFICE users." });
    }

    const desired = new Map(selected.map((userId, index) => [userId, [required[index]]]));
    const session = await mongoose.startSession();
    const configured = [];
    try {
      await session.withTransaction(async () => {
        configured.length = 0;
        await EduPaySettings.findOneAndUpdate(
          { key: "GLOBAL" },
          { $inc: { dutyConfigurationVersion: 1 } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session }
        );
        const existing = await EduPayDutyAssignment.find({}).sort({ user: 1, version: -1 }).session(session).lean();
        const latest = new Map();
        existing.forEach((row) => {
          if (!latest.has(String(row.user))) latest.set(String(row.user), row);
        });
        const currentlyActive = [...latest.values()].filter((row) => row.active);
        const affected = new Set([...currentlyActive.map((row) => String(row.user)), ...selected]);
        for (const userId of affected) {
          const previous = await EduPayDutyAssignment.findOne({ user: userId }).sort({ version: -1 }).session(session);
          const permissions = desired.get(userId) || previous?.permissions || [];
          const active = desired.has(userId);
          if (previous && previous.active === active && JSON.stringify(previous.permissions) === JSON.stringify(permissions)) {
            if (active) configured.push(previous);
            continue;
          }
          const [assignment] = await EduPayDutyAssignment.create([{
            user: userId,
            permissions,
            active,
            assignedBy: req.user._id,
            version: Number(previous?.version || 0) + 1,
            previousAssignment: previous?._id || null,
          }], { session });
          if (active) configured.push(assignment);
        }
        await audit({
          actor: req.user._id,
          action: "EDUPAY_DUTIES_CONFIGURED",
          entityType: "EduPayDutyAssignment",
          metadata: { assignments: Object.fromEntries(required.map((permission, index) => [permission, selected[index]])) },
          req,
          session,
        });
      });
    } finally {
      await session.endSession();
    }
    res.json({ success: true, assignments: configured });
  } catch (error) {
    errorResponse(res, error);
  }
};
exports.adminEligibleDutyUsers = async (req, res) => { try { const users = await User.find({ status: "ACTIVE", role: "HEAD_OFFICE" }).select("_id fullName role status").sort({ fullName: 1 }).lean(); res.json({ success: true, users: users.map((user) => ({ id: user._id, name: user.fullName, role: user.role, status: user.status })) }); } catch (error) { errorResponse(res, error); } };
exports.adminRevokeEduPayDuty = async (req, res) => { try { const target = await User.findById(req.params.userId).select("_id status role"); if (!target) return res.status(404).json({ success: false, message: "Duty target user not found." }); if (target.status !== "ACTIVE" || target.role !== "HEAD_OFFICE") return res.status(422).json({ success: false, code: "EDUPAY_DUTY_TARGET_INELIGIBLE", message: "Duty targets must be active HEAD_OFFICE users." }); const session = await mongoose.startSession(); let assignment; try { await session.withTransaction(async () => { const previous = await EduPayDutyAssignment.findOne({ user: req.params.userId }).sort({ version: -1 }).session(session); if (!previous) { const error = new Error("EduPay duty assignment not found."); error.statusCode = 404; throw error; } [assignment] = await EduPayDutyAssignment.create([{ user: req.params.userId, permissions: previous.permissions, active: false, assignedBy: req.user._id, version: previous.version + 1, previousAssignment: previous._id }], { session }); await audit({ actor: req.user._id, action: "EDUPAY_DUTY_REVOKED", entityType: "EduPayDutyAssignment", entityId: assignment._id, metadata: { user: req.params.userId, version: assignment.version }, req, session }); }); } finally { await session.endSession(); } res.json({ success: true, assignment }); } catch (error) { errorResponse(res, error); } };
exports.adminFees = async (req, res) => { try { const filter = req.params.feeId ? { _id: req.params.feeId } : { status: String(req.query.status || "PENDING_APPROVAL").toUpperCase() }; res.json({ success: true, fees: req.params.feeId ? await Fee.findOne(filter).populate("school session term classLevel").lean() : await Fee.find(filter).populate("school session term classLevel").sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminFeeAction = async (req, res) => {
  let dbSession;
  try {
    const action = String(req.body.action || "").toUpperCase();
    if (!["APPROVE", "REJECT"].includes(action)) return res.status(400).json({ success: false, message: "Unsupported fee action." });
    const note = String(req.body.note || "").trim();
    if (action === "REJECT" && !note) return res.status(400).json({ success: false, message: "A rejection note is required." });
    dbSession = await mongoose.startSession(); let fee;
    await dbSession.withTransaction(async () => {
      fee = await Fee.findById(req.params.feeId).session(dbSession);
      if (!fee) { const e = new Error("Fee structure not found."); e.statusCode = 404; throw e; }
      if (fee.status !== "PENDING_APPROVAL") { const e = new Error("Only pending fees can be approved or rejected."); e.statusCode = 409; throw e; }
      if (action === "APPROVE") {
        const [school, session, term, classLevel] = await Promise.all([
          School.findOne({ _id: fee.school, status: "APPROVED", active: true }).select("_id").session(dbSession),
          EduPayAcademicSession.findOne({ _id: fee.session, school: fee.school, status: { $in: ["ACTIVE", "UPCOMING"] } }).select("_id").session(dbSession),
          EduPayTerm.findOne({ _id: fee.term, school: fee.school, session: fee.session, status: { $in: ["ACTIVE", "UPCOMING"] } }).select("_id").session(dbSession),
          EduPayClass.findOne({ _id: fee.classLevel, school: fee.school, status: "ACTIVE" }).select("_id").session(dbSession),
        ]);
        if (!school || !session || !term || !classLevel) { const e = new Error("Fee academic references are no longer valid for this school."); e.statusCode = 409; throw e; }
      }
      fee.status = action === "APPROVE" ? "APPROVED" : "REJECTED"; fee.reviewedBy = req.user._id; fee.reviewedAt = new Date(); fee.reviewNote = note || "Approved for parent EduPay selection.";
      await fee.save({ session: dbSession });
      await audit({ actor: req.user._id, action: `EDUPAY_FEE_${action}`, entityType: "EduPayFeeStructure", entityId: fee._id, school: fee.school, req, session: dbSession });
    });
    res.json({ success: true, fee });
  } catch (error) { errorResponse(res, error); } finally { if (dbSession) await dbSession.endSession(); }
};
const adminDate = (value) => { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date : null; };
const adminObjectId = (value) => mongoose.isValidObjectId(value) ? value : null;
exports.adminPlans = async (req, res) => { try {
  const filter = {}; for (const [key, field] of [["parent", "parent"], ["student", "child"], ["school", "school"]]) { if (req.query[key] && !adminObjectId(req.query[key])) return res.status(400).json({ success: false, message: `${key} filter is invalid.` }); if (adminObjectId(req.query[key])) filter[field] = req.query[key]; }
  if (req.query.status) filter.status = String(req.query.status).trim().toUpperCase();
  const from = adminDate(req.query.from || req.query.dateFrom); const to = adminDate(req.query.to || req.query.dateTo); if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  let plans = await Plan.find(filter).populate("parent child school").sort({ createdAt: -1 }).limit(500).lean();
  if (req.query.search) { const term = String(req.query.search).trim().toLowerCase(); plans = plans.filter((row) => [row.parent?.fullName, row.parent?.email, row.child?.fullName, row.school?.name].some((value) => String(value || "").toLowerCase().includes(term))); }
  const saved = await EduLedger.aggregate([{ $match: { plan: { $in: plans.map((row) => row._id) } } }, { $group: { _id: "$plan", amount: { $sum: { $cond: [{ $eq: ["$direction", "CREDIT"] }, "$amount", { $multiply: ["$amount", -1] }] } } } }]);
  const savedByPlan = new Map(saved.map((row) => [String(row._id), round(row.amount)]));
  plans = plans.map((row) => { const target = Number(row.targetAmount || row.officialFee); const amountSaved = savedByPlan.get(String(row._id)) || 0; return { ...row, targetAmount: target, amountSaved, remaining: round(Math.max(0, target - amountSaved)), progressPercent: target ? round(Math.min(100, amountSaved / target * 100)) : 0 }; });
  res.json({ success: true, plans, summary: { total: plans.length, active: plans.filter((row) => !["CANCELLED", "SETTLED", "COMPLETED"].includes(row.status)).length, completed: plans.filter((row) => ["SETTLED", "COMPLETED"].includes(row.status)).length, totalSaved: round(plans.reduce((sum, row) => sum + row.amountSaved, 0)) } });
} catch (error) { errorResponse(res, error); } };
exports.adminPlanHistory = async (req, res) => { try { const plan = await Plan.findById(req.params.planId).populate("parent child school").lean(); if (!plan) return res.status(404).json({ success: false, message: "Plan not found." }); const history = (await EduLedger.find({ plan: plan._id }).sort({ createdAt: 1 }).lean()).map((entry) => ({ ...entry, child: plan.child, school: plan.school, status: "SUCCESS" })); const target = Number(plan.targetAmount || plan.officialFee); const saved = round(history.reduce((sum, entry) => sum + (entry.direction === "CREDIT" ? entry.amount : -entry.amount), 0)); res.json({ success: true, plan: { ...plan, targetAmount: target, amountSaved: saved, remaining: round(Math.max(0, target - saved)), progressPercent: target ? round(Math.min(100, saved / target * 100)) : 0 }, history, contributions: await Contribution.find({ plan: plan._id }).sort({ createdAt: 1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminRepayments = async (req, res) => { try { res.json({ success: true, repayments: await EduPayRepayment.find({}).populate("parent child plan").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminSettlements = async (req, res) => { try { res.json({ success: true, settlements: await Settlement.find({}).populate("parent child school plan").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminSponsors = async (req, res) => { try { res.json({ success: true, invites: await EduPaySponsorInvite.find({}).sort({ createdAt: -1 }).limit(500).lean(), contributions: await EduPaySponsorContribution.find({}).sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminTransactions = async (req, res) => { try {
  for (const key of ["plan", "school", "parent", "student"]) if (req.query[key] && !adminObjectId(req.query[key])) return res.status(400).json({ success: false, message: `${key} filter is invalid.` });
  const from = adminDate(req.query.from || req.query.dateFrom); const to = adminDate(req.query.to || req.query.dateTo);
  const dateFilter = from || to ? { createdAt: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } } : {};
  const planRows = await Plan.find({ ...(adminObjectId(req.query.plan) ? { _id: req.query.plan } : {}), ...(adminObjectId(req.query.school) ? { school: req.query.school } : {}), ...(adminObjectId(req.query.parent) ? { parent: req.query.parent } : {}), ...(adminObjectId(req.query.student) ? { child: req.query.student } : {}) }).select("_id").lean();
  const planIds = planRows.map((row) => row._id);
  if ((req.query.plan || req.query.school || req.query.parent || req.query.student) && !planIds.length) return res.json({ success: true, contributions: [], ledger: [], repaymentTransactions: [], summary: { contributions: 0, ledger: 0, total: 0 } });
  const contributionFilter = { ...dateFilter, ...(planIds.length ? { plan: { $in: planIds } } : {}) }; if (req.query.status) contributionFilter.status = String(req.query.status).toUpperCase();
  let contributions = await Contribution.find(contributionFilter).sort({ createdAt: -1 }).limit(500).lean();
  let ledger = await EduLedger.find({ ...dateFilter, ...(planIds.length ? { plan: { $in: planIds } } : {}) }).sort({ createdAt: -1 }).limit(500).lean();
  if (req.query.search) { const term = String(req.query.search).toLowerCase(); contributions = contributions.filter((row) => String(row.reference || row.idempotencyKey || "").toLowerCase().includes(term)); ledger = ledger.filter((row) => String(row.reference || row.idempotencyKey || "").toLowerCase().includes(term)); }
  const repaymentFilter = planIds.length ? { plan: { $in: planIds } } : ((req.query.plan || req.query.school || req.query.parent || req.query.student) ? { plan: { $in: [] } } : {});
  const repayments = await EduPayRepayment.find(repaymentFilter).select("_id plan status principal amountRemaining amountPaid totalAmount dueDate").lean();
  const repaymentTransactions = repayments.length ? await EduPayRepaymentTransaction.find({ repayment: { $in: repayments.map((row) => row._id) } }).sort({ createdAt: -1 }).limit(500).lean() : [];
  res.json({ success: true, contributions, ledger, repaymentTransactions, repayments, summary: { contributions: contributions.length, ledger: ledger.length, repayments: repayments.length, repaymentTransactions: repaymentTransactions.length, total: round(ledger.reduce((sum, row) => sum + (row.direction === "CREDIT" ? row.amount : -row.amount), 0)) } });
} catch (error) { errorResponse(res, error); } };
exports.adminAudit = async (req, res) => { try { res.json({ success: true, audit: await require("../models/edupayAuditLog.model").find({}).populate("actor school").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminCreateSettlement = async (req, res) => {
  try {
    const key = requireKey(req); if (!key) return res.status(400).json({ success: false, message: "Idempotency-Key is required." });
    const result = await createSettlement({ planId: req.params.planId, actor: req.user._id, settlementDate: req.body.settlementDate || new Date(), idempotencyKey: key, req });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, settlement: result.settlement });
  } catch (error) { errorResponse(res, error); }
};
