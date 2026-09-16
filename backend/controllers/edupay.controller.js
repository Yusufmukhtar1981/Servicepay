const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { customer, school, headOffice } = require("../middleware/edupay.middleware");
const { EduPayAcademicSession, EduPayTerm, EduPayClass } = require("../models/edupayAcademic.model");
const SchoolUser = require("../models/edupaySchoolUser.model").EduPaySchoolUser;
const User = require("../models/user.model");
const { getSettings, audit, notify, round, reference, hash, ensureObjectId, calculateSettlement, availableSavings, contributeFromWallet, contributeSponsorFromWallet, repayFromWallet, confirmSettlement, reverseSettlement, createEduLedger, createSettlement, models } = require("../services/edupay.service");
const { School, Child, Plan, Contribution, EduLedger, Fee, Settlement, EduPayRepayment, EduPayRepaymentTransaction, EduPaySponsorInvite, EduPaySponsorContribution } = models;
const EduPaySettlementAccount = require("../models/edupaySettlementAccount.model");
const edupaySquad = require("../services/edupaySquad.service");
const AppSettings = require("../models/appSettings.model");
const { FEATURE_REGISTRY, currentFeature } = require("./featureControl.controller");

const safe = (doc) => doc?.toObject ? doc.toObject() : doc;
const errorResponse = (res, error) => res.status(error.statusCode || 500).json({ success: false, message: error.message || "EduPay request failed." });
const requireKey = (req) => String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim();
const enabledForInitiation = async (res) => {
  const feature = currentFeature(await AppSettings.findOne().lean(), FEATURE_REGISTRY.find((item) => item[0] === "edupay"));
  if (!feature.effectiveEnabled) { res.status(403).json({ success: false, code: "EDUPAY_DISABLED", message: "EduPay is temporarily unavailable for new plans and contributions." }); return null; }
  return getSettings();
};

exports.dashboard = async (req, res) => {
  try {
    const [children, plans, repayments, contributions] = await Promise.all([
      Child.countDocuments({ parent: req.user._id, status: "ACTIVE" }),
      Plan.find({ parent: req.user._id }).populate("child school").sort({ createdAt: -1 }).limit(50).lean(),
      EduPayRepayment.find({ parent: req.user._id, status: { $nin: ["PAID"] } }).lean(),
      Contribution.aggregate([{ $match: { parent: req.user._id, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    ]);
    const settings = await getSettings();
    const saved = round(contributions[0]?.total);
    const upcoming = plans.filter((plan) => !["SETTLED", "CANCELLED", "REVERSED"].includes(plan.status)).sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate))[0] || null;
    res.json({ success: true, settings: { enabled: settings.enabled, autosaveEnabled: settings.autosaveEnabled }, summary: { totalEducationSavings: saved, totalChildren: children, activePlans: plans.filter((p) => !["SETTLED", "CANCELLED", "REVERSED"].includes(p.status)).length, outstandingRepayment: round(repayments.reduce((sum, row) => sum + Number(row.amountRemaining || 0), 0)), upcomingSchoolFee: upcoming ? { amount: upcoming.officialFee, targetDate: upcoming.targetDate, saved: saved } : null }, plans });
  } catch (error) { errorResponse(res, error); }
};

exports.listSchools = async (req, res) => {
  try {
    const rows = await School.find({ status: "APPROVED", active: true }).select("-bankDetails -supportingDocuments").sort({ name: 1 }).lean();
    res.json({ success: true, schools: rows });
  } catch (error) { errorResponse(res, error); }
};
exports.listFees = async (req, res) => {
  try {
    ensureObjectId(req.params.schoolId, "School");
    const filter = { school: req.params.schoolId, status: "APPROVED" };
    if (req.query.session) filter.session = req.query.session;
    if (req.query.term) filter.term = req.query.term;
    if (req.query.classLevel) filter.classLevel = req.query.classLevel;
    const rows = await Fee.find(filter).populate("session term classLevel").sort({ createdAt: -1 }).lean();
    res.json({ success: true, fees: rows });
  } catch (error) { errorResponse(res, error); }
};

exports.createChild = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    ensureObjectId(req.body.school, "School");
    const school = await School.findOne({ _id: req.body.school, status: "APPROVED", active: true });
    if (!school) return res.status(400).json({ success: false, message: "Only approved active schools may be selected." });
    const child = await Child.create({ parent: req.user._id, createdBy: req.user._id, fullName: req.body.fullName, dateOfBirth: req.body.dateOfBirth, gender: req.body.gender, photo: req.body.photo || null, school: school._id });
    await audit({ actor: req.user._id, action: "EDUPAY_CHILD_CREATED", entityType: "EduPayChild", entityId: child._id, school: school._id, req });
    res.status(201).json({ success: true, child });
  } catch (error) { errorResponse(res, error); }
};
exports.listChildren = async (req, res) => {
  try { res.json({ success: true, children: await Child.find({ parent: req.user._id, status: "ACTIVE" }).populate("school").sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); }
};
exports.updateChild = async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.childId, parent: req.user._id, status: "ACTIVE" });
    if (!child) return res.status(404).json({ success: false, message: "Child not found." });
    ["fullName", "dateOfBirth", "gender", "photo"].forEach((key) => { if (req.body[key] !== undefined) child[key] = req.body[key]; });
    await child.save(); res.json({ success: true, child });
  } catch (error) { errorResponse(res, error); }
};

exports.createPlan = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    ["child", "school", "session", "term", "classLevel", "feeStructure"].forEach((key) => ensureObjectId(req.body[key], key));
    const child = await Child.findOne({ _id: req.body.child, parent: req.user._id, school: req.body.school, status: "ACTIVE" });
    const fee = await Fee.findOne({ _id: req.body.feeStructure, school: req.body.school, session: req.body.session, term: req.body.term, classLevel: req.body.classLevel, status: "APPROVED" });
    if (!child || !fee) return res.status(400).json({ success: false, message: "Child or approved official fee not found." });
    const targetDate = new Date(req.body.targetDate);
    if (Number.isNaN(targetDate.getTime()) || targetDate <= new Date()) return res.status(400).json({ success: false, message: "A future settlement date is required." });
    const days = Math.max(1, Math.ceil((targetDate - Date.now()) / 86400000));
    const frequency = String(req.body.savingFrequency || "MONTHLY").toUpperCase();
    const periods = frequency === "DAILY" ? days : frequency === "WEEKLY" ? Math.ceil(days / 7) : Math.max(1, Math.ceil(days / 30));
    const plan = await Plan.create({ parent: req.user._id, child: child._id, school: req.body.school, session: req.body.session, term: req.body.term, classLevel: req.body.classLevel, feeStructure: fee._id, officialFee: fee.amount, savingFrequency: frequency, targetDate, recommendedContribution: round(fee.amount / periods), autosave: { enabled: false } });
    await audit({ actor: req.user._id, action: "EDUPAY_PLAN_CREATED", entityType: "EduPayPlan", entityId: plan._id, school: plan.school, req });
    await notify(req.user._id, "EduPay plan created", "Your school-fee savings plan is ready.");
    res.status(201).json({ success: true, plan });
  } catch (error) { errorResponse(res, error); }
};
exports.listPlans = async (req, res) => {
  try { res.json({ success: true, plans: await Plan.find({ parent: req.user._id }).populate("child school session term classLevel feeStructure").sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); }
};
exports.getPlan = async (req, res) => {
  try {
    const plan = await Plan.findOne({ _id: req.params.planId, parent: req.user._id }).populate("child school session term classLevel feeStructure");
    if (!plan) return res.status(404).json({ success: false, message: "EduPay plan not found." });
    const [contributions, ledger, repayment, sponsors] = await Promise.all([Contribution.find({ plan: plan._id }).sort({ createdAt: -1 }).lean(), EduLedger.find({ plan: plan._id }).sort({ createdAt: 1 }).lean(), EduPayRepayment.findOne({ plan: plan._id }).lean(), EduPaySponsorContribution.find({ plan: plan._id }).sort({ createdAt: -1 }).lean()]);
    res.json({ success: true, plan, contributions, ledger, repayment, sponsors });
  } catch (error) { errorResponse(res, error); }
};
exports.contribute = async (req, res) => {
  try {
    const settings = await enabledForInitiation(res); if (!settings) return;
    const result = await require("../services/edupay.service").contributeFromWallet({ userId: req.user._id, planId: req.params.planId, amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req) });
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
  try { const plans = await Plan.find({ parent: req.user._id }).select("_id"); const ids = plans.map((p) => p._id); res.json({ success: true, contributions: await Contribution.find({ plan: { $in: ids } }).sort({ createdAt: -1 }).limit(200).lean(), ledger: await EduLedger.find({ plan: { $in: ids } }).sort({ createdAt: -1 }).limit(200).lean(), repayments: await EduPayRepayment.find({ parent: req.user._id }).sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); }
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
    const result = await contributeSponsorFromWallet({ sponsorId: req.user._id, tokenHash: hash(req.params.token), amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req) });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, contribution: result.contribution });
  } catch (error) { errorResponse(res, error); }
};
exports.repayments = async (req, res) => { try { res.json({ success: true, repayments: await EduPayRepayment.find({ parent: req.user._id }).sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.repay = async (req, res) => { try { const result = await repayFromWallet({ userId: req.user._id, repaymentId: req.params.repaymentId, amount: req.body.amount, transactionPin: req.body.transactionPin || req.body.pin, idempotencyKey: requireKey(req) }); res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, transaction: result.transaction }); } catch (error) { errorResponse(res, error); } };
exports.receipt = async (req, res) => { try { const [contribution, repayment, settlement] = await Promise.all([Contribution.findOne({ _id: req.params.reference, parent: req.user._id }).populate("plan child"), EduPayRepaymentTransaction.findOne({ _id: req.params.reference, parent: req.user._id }), Settlement.findOne({ _id: req.params.reference, parent: req.user._id }).populate("school child")]); const result = contribution || repayment || settlement; if (!result) return res.status(404).json({ success: false, message: "EduPay receipt not found." }); res.json({ success: true, receipt: result }); } catch (error) { errorResponse(res, error); } };

exports.applySchool = async (req, res) => { try { const settings = await enabledForInitiation(res); if (!settings) return; const allowed = ["name", "schoolType", "registrationNumber", "address", "state", "lga", "contactPerson", "phone", "email", "supportingDocuments", "authorizedRepresentative"]; const input = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(req.body || {}, key)).map((key) => [key, req.body[key]])); input.status = "PENDING"; input.active = false; const school = await School.create(input); res.status(201).json({ success: true, school }); } catch (error) { errorResponse(res, error); } };
exports.schoolLogin = async (req, res) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || "").trim().toLowerCase() }).select("+password +authTokenVersion");
    if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password || ""))) return res.status(401).json({ success: false, message: "Invalid school credentials." });
    const membership = await SchoolUser.findOne({ user: user._id, status: "ACTIVE" }).populate("school");
    if (!membership || membership.school.status !== "APPROVED" || !membership.school.active) return res.status(403).json({ success: false, message: "Approved school access required." });
    const token = jwt.sign({ id: user._id, authTokenVersion: Number(user.authTokenVersion || 0), edupaySchool: membership.school._id }, process.env.JWT_SECRET, { expiresIn: "12h" });
    res.json({ success: true, token, school: membership.school, role: membership.role });
  } catch (error) { errorResponse(res, error); }
};
exports.schoolDashboard = async (req, res) => { try { const school = req.eduPaySchool._id; const [students, plans, settlements] = await Promise.all([Child.countDocuments({ school }), Plan.find({ school }).lean(), Settlement.find({ school }).lean()]); res.json({ success: true, school: req.eduPaySchool, summary: { totalRegisteredStudents: students, activeEduPayStudents: plans.length, totalExpectedFees: round(plans.reduce((s, p) => s + p.officialFee, 0)), parentSavings: round((await Contribution.aggregate([{ $match: { plan: { $in: plans.map((p) => p._id) }, status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]))[0]?.total), upcomingSettlements: settlements.filter((s) => !["SETTLED", "REVERSED"].includes(s.status)).length, completedSettlements: settlements.filter((s) => s.status === "SETTLED").length }, settlements }); } catch (error) { errorResponse(res, error); } };
exports.schoolProfile = async (req, res) => { try { res.json({ success: true, school: req.eduPaySchool }); } catch (error) { errorResponse(res, error); } };
exports.schoolSessions = async (req, res) => { try { const rows = await EduPayAcademicSession.find({ school: req.eduPaySchool._id }).sort({ createdAt: -1 }); res.json({ success: true, sessions: rows }); } catch (error) { errorResponse(res, error); } };
exports.schoolCreateSession = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const row = await EduPayAcademicSession.create({ school: req.eduPaySchool._id, name: req.body.name, startsAt: req.body.startsAt, endsAt: req.body.endsAt, status: "DRAFT" }); res.status(201).json({ success: true, session: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolCreateTerm = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const session = await EduPayAcademicSession.findOne({ _id: req.body.session, school: req.eduPaySchool._id }); if (!session) return res.status(400).json({ success: false, message: "Academic session does not belong to this school." }); const row = await EduPayTerm.create({ school: req.eduPaySchool._id, session: session._id, name: req.body.name, startsAt: req.body.startsAt, endsAt: req.body.endsAt, status: "DRAFT" }); res.status(201).json({ success: true, term: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolCreateClass = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const row = await EduPayClass.create({ school: req.eduPaySchool._id, name: req.body.name }); res.status(201).json({ success: true, classLevel: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolCreateFee = async (req, res) => { try { if (!(await enabledForInitiation(res))) return; const [session, term, classLevel] = await Promise.all([EduPayAcademicSession.findOne({ _id: req.body.session, school: req.eduPaySchool._id }), EduPayTerm.findOne({ _id: req.body.term, school: req.eduPaySchool._id, session: req.body.session }), EduPayClass.findOne({ _id: req.body.classLevel, school: req.eduPaySchool._id })]); if (!session || !term || !classLevel) return res.status(400).json({ success: false, message: "Academic references must belong to this school." }); const row = await Fee.create({ school: req.eduPaySchool._id, session: session._id, term: term._id, classLevel: classLevel._id, amount: round(req.body.amount), submittedBy: req.user._id, status: "PENDING_APPROVAL" }); res.status(201).json({ success: true, fee: row }); } catch (error) { errorResponse(res, error); } };
exports.schoolStudents = async (req, res) => { try { res.json({ success: true, students: await Child.find({ school: req.eduPaySchool._id }).select("fullName school status createdAt").lean() }); } catch (error) { errorResponse(res, error); } };
exports.schoolSettlements = async (req, res) => { try { res.json({ success: true, settlements: await Settlement.find({ school: req.eduPaySchool._id }).populate("child plan").sort({ settlementDate: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.schoolReconciliation = async (req, res) => { try { const settlements = await Settlement.find({ school: req.eduPaySchool._id }).lean(); res.json({ success: true, reconciliation: { settled: settlements.filter((row) => row.status === "SETTLED").length, pending: settlements.filter((row) => !["SETTLED", "REVERSED"].includes(row.status)).length, gross: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolGrossSettlement, 0)), net: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolNetSettlement, 0)), commission: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolCommissionAmount, 0)) } }); } catch (error) { errorResponse(res, error); } };
exports.schoolReport = async (req, res) => { try { const [plans, settlements] = await Promise.all([Plan.find({ school: req.eduPaySchool._id }).lean(), Settlement.find({ school: req.eduPaySchool._id }).lean()]); res.json({ success: true, report: { plans: plans.length, settlements: settlements.length, totalOfficialFees: round(plans.reduce((sum, row) => sum + row.officialFee, 0)), totalSettledNet: round(settlements.filter((row) => row.status === "SETTLED").reduce((sum, row) => sum + row.schoolNetSettlement, 0)) } }); } catch (error) { errorResponse(res, error); } };

exports.adminOverview = async (req, res) => { try { const [settings, parents, children, schools, plans, settlements, repayments, ledger] = await Promise.all([getSettings(), Plan.distinct("parent"), Child.countDocuments(), School.countDocuments(), Plan.countDocuments({ status: { $nin: ["CANCELLED"] } }), Settlement.find().lean(), EduPayRepayment.find().lean(), EduLedger.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])]); res.json({ success: true, settings, summary: { totalEduPayParents: parents.length, totalChildren: children, partnerSchools: schools, activePlans: plans, educationSavings: round(ledger[0]?.total), upcomingSettlements: settlements.filter((s) => !["SETTLED", "REVERSED"].includes(s.status)).length, completedSettlements: settlements.filter((s) => s.status === "SETTLED").length, outstandingRepayments: round(repayments.reduce((sum, r) => sum + r.amountRemaining, 0)), overdueRepayments: repayments.filter((r) => r.status === "OVERDUE").length, schoolCommissionRevenue: round(settlements.filter((s) => s.status === "SETTLED").reduce((sum, s) => sum + s.schoolCommissionAmount, 0)), parentChargeRevenue: round(settlements.filter((s) => s.status === "SETTLED").reduce((sum, s) => sum + s.parentChargeAmount, 0)) } }); } catch (error) { errorResponse(res, error); } };
exports.adminReadiness = async (req, res) => { try { const modelEntries = Object.entries(models); await Promise.all(modelEntries.filter(([, model]) => model?.init).map(([, model]) => model.init())); const indexes = {}; await Promise.all(modelEntries.filter(([, model]) => model?.collection?.listIndexes).map(async ([name, model]) => { indexes[name] = await model.collection.listIndexes().toArray(); })); res.json({ success: true, ready: true, checkedAt: new Date(), indexes }); } catch (error) { errorResponse(res, error); } };
exports.adminSettings = async (req, res) => { try { const settings = await getSettings(); const feature = currentFeature(await AppSettings.findOne().lean(), FEATURE_REGISTRY.find((item) => item[0] === "edupay")); if (req.method === "GET") return res.json({ success: true, settings: { ...settings.toObject(), enabled: feature.effectiveEnabled } }); const allowed = ["schoolCommissionRate", "parentShortfallChargeRate", "minimumSavingsRequirement", "maximumEduPayCover", "maximumCoverPercentage", "defaultRepaymentPeriodDays", "settlementMethod", "settlementLeadDays", "gracePeriodDays", "autosaveEnabled"]; allowed.forEach((key) => { if (req.body[key] !== undefined) settings[key] = req.body[key]; }); settings.updatedBy = req.user._id; await settings.save(); await audit({ actor: req.user._id, action: "EDUPAY_SETTINGS_UPDATED", entityType: "EduPaySettings", entityId: settings._id, metadata: req.body, req }); res.json({ success: true, settings: { ...settings.toObject(), enabled: feature.effectiveEnabled } }); } catch (error) { errorResponse(res, error); } };
exports.adminSchools = async (req, res) => { try { res.json({ success: true, schools: await School.find({}).select("-bankDetails").sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminSchoolAction = async (req, res) => { try { const school = await School.findById(req.params.schoolId); if (!school) return res.status(404).json({ success: false, message: "School not found." }); const action = String(req.body.action || "").toUpperCase(); const map = { APPROVE: ["APPROVED", true], REJECT: ["REJECTED", false], SUSPEND: ["SUSPENDED", false], REACTIVATE: ["APPROVED", true], REVIEW: ["UNDER_REVIEW", false] }; if (!map[action]) return res.status(400).json({ success: false, message: "Unsupported school action." }); school.status = map[action][0]; school.active = map[action][1]; school.reviewedBy = req.user._id; school.reviewedAt = new Date(); school.reviewNote = req.body.note; await school.save(); await audit({ actor: req.user._id, action: `EDUPAY_SCHOOL_${action}`, entityType: "EduPaySchool", entityId: school._id, school: school._id, metadata: { note: req.body.note }, req }); res.json({ success: true, school }); } catch (error) { errorResponse(res, error); } };
exports.adminCreateSchoolUser = async (req, res) => { try { const school = await School.findById(req.params.schoolId); if (!school) return res.status(404).json({ success: false, message: "School not found." }); if (school.status !== "APPROVED" || !school.active) return res.status(409).json({ success: false, message: "School must be approved before staff can be provisioned." }); const user = await User.create({ fullName: req.body.fullName, phone: req.body.phone, email: String(req.body.email || "").trim().toLowerCase(), password: req.body.password, role: "CUSTOMER", status: "ACTIVE" }); const membership = await SchoolUser.create({ school: school._id, user: user._id, role: req.body.role || "STAFF", status: "ACTIVE", invitedBy: req.user._id }); await audit({ actor: req.user._id, action: "EDUPAY_SCHOOL_USER_CREATED", entityType: "EduPaySchoolUser", entityId: membership._id, school: school._id, req }); res.status(201).json({ success: true, schoolUser: { id: membership._id, userId: user._id, email: user.email, role: membership.role, status: membership.status } }); } catch (error) { errorResponse(res, error); } };

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
exports.adminVerifySettlementAccount = async (req, res) => { try { const account = await EduPaySettlementAccount.findOneAndUpdate({ school: req.params.schoolId }, { $set: { verified: true, active: true, verifiedBy: req.user._id, verifiedAt: new Date(), updatedBy: req.user._id } }, { new: true, runValidators: true }); if (!account) return res.status(404).json({ success: false, message: "Settlement account not found." }); res.json({ success: true, account: { id: account._id, school: account.school, accountNumberLast4: account.accountNumberLast4, verified: account.verified, active: account.active } }); } catch (error) { errorResponse(res, error); } };
exports.adminFees = async (req, res) => { try { const filter = req.params.feeId ? { _id: req.params.feeId } : {}; res.json({ success: true, fees: req.params.feeId ? await Fee.findOne(filter).lean() : await Fee.find({}).populate("school session term classLevel").sort({ createdAt: -1 }).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminFeeAction = async (req, res) => { try { const fee = await Fee.findById(req.params.feeId); if (!fee) return res.status(404).json({ success: false, message: "Fee structure not found." }); const action = String(req.body.action || "").toUpperCase(); if (!["APPROVE", "REJECT"].includes(action)) return res.status(400).json({ success: false, message: "Unsupported fee action." }); fee.status = action === "APPROVE" ? "APPROVED" : "REJECTED"; fee.reviewedBy = req.user._id; fee.reviewedAt = new Date(); fee.reviewNote = req.body.note; await fee.save(); await audit({ actor: req.user._id, action: `EDUPAY_FEE_${action}`, entityType: "EduPayFeeStructure", entityId: fee._id, school: fee.school, req }); res.json({ success: true, fee }); } catch (error) { errorResponse(res, error); } };
exports.adminPlans = async (req, res) => { try { res.json({ success: true, plans: await Plan.find({}).populate("parent child school").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminRepayments = async (req, res) => { try { res.json({ success: true, repayments: await EduPayRepayment.find({}).populate("parent child plan").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminSettlements = async (req, res) => { try { res.json({ success: true, settlements: await Settlement.find({}).populate("parent child school plan").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminSponsors = async (req, res) => { try { res.json({ success: true, invites: await EduPaySponsorInvite.find({}).sort({ createdAt: -1 }).limit(500).lean(), contributions: await EduPaySponsorContribution.find({}).sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminTransactions = async (req, res) => { try { res.json({ success: true, contributions: await Contribution.find({}).sort({ createdAt: -1 }).limit(500).lean(), ledger: await EduLedger.find({}).sort({ createdAt: -1 }).limit(500).lean(), repaymentTransactions: await EduPayRepaymentTransaction.find({}).sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminAudit = async (req, res) => { try { res.json({ success: true, audit: await require("../models/edupayAuditLog.model").find({}).populate("actor school").sort({ createdAt: -1 }).limit(500).lean() }); } catch (error) { errorResponse(res, error); } };
exports.adminCreateSettlement = async (req, res) => { try { const settings = await getSettings(); const plan = await Plan.findById(req.params.planId); if (!plan) return res.status(404).json({ success: false, message: "Plan not found." }); if (!["SAVING", "READY_FOR_SETTLEMENT"].includes(plan.status)) return res.status(409).json({ success: false, message: "Plan is not ready for settlement initiation." }); if (await Settlement.findOne({ plan: plan._id })) return res.status(409).json({ success: false, message: "Settlement already exists for this plan." }); const saved = await availableSavings(plan._id); if (saved < Number(settings.minimumSavingsRequirement || 0)) return res.status(409).json({ success: false, message: "Plan has not met the minimum savings requirement." }); const settlementDate = req.body.settlementDate ? new Date(req.body.settlementDate) : new Date(); if (Number.isNaN(settlementDate.getTime()) || settlementDate < new Date() || settlementDate < new Date(plan.targetDate)) return res.status(400).json({ success: false, message: "Settlement date must be valid and no earlier than the plan target date." }); const snapshot = calculateSettlement({ officialFee: plan.officialFee, saved, settings, settlementDate }); const key = requireKey(req); if (!key) return res.status(400).json({ success: false, message: "Idempotency-Key is required." }); const intentHash = hash(JSON.stringify({ operation: "SETTLEMENT_CREATE", actor: String(req.user._id), resource: String(plan._id), settlementDate: settlementDate.toISOString(), saved })); const settlement = await Settlement.create({ ...snapshot, parent: plan.parent, child: plan.child, school: plan.school, plan: plan._id, reference: reference("EDU-SET"), idempotencyKey: key, intentHash, status: "ADMIN_REVIEW" }); await Plan.updateOne({ _id: plan._id }, { $set: { status: "ADMIN_REVIEW" } }); await audit({ actor: req.user._id, action: "EDUPAY_SETTLEMENT_CREATED", entityType: "EduPaySettlement", entityId: settlement._id, school: settlement.school, req }); res.status(201).json({ success: true, settlement }); } catch (error) { errorResponse(res, error); } };
exports.adminCreateSettlement = async (req, res) => {
  try {
    const key = requireKey(req); if (!key) return res.status(400).json({ success: false, message: "Idempotency-Key is required." });
    const result = await createSettlement({ planId: req.params.planId, actor: req.user._id, settlementDate: req.body.settlementDate || new Date(), idempotencyKey: key, req });
    res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, settlement: result.settlement });
  } catch (error) { errorResponse(res, error); }
};
