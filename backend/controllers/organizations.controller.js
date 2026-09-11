const mongoose = require("mongoose");
const { Organization, OrganizationMember, OrganizationRole, OrganizationBranch, OrganizationCustomField, OrganizationFee, OrganizationFeeAssignment, OrganizationPayment, OrganizationWallet, OrganizationLedger, OrganizationAuditLog, OrganizationAnnouncement, OrganizationMembershipCard } = require("../models/organizations.models");
const models = require("../models/organizations.models");
const svc = require("../services/organizations.service");
const Notification = require("../models/notification.model");
const { createInAppNotification } = require("../services/inAppNotification.service");
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const ok = (res, data = {}) => res.json({ success: true, ...data });
const id = (v) => mongoose.isValidObjectId(v);
const requireOrg = async (req, exactPermission, operational = true) => {
  const organizationId =
    req.params.organizationId || req.params.id || req.body?.organizationId;
  return svc.requireOrganizationAccess(
    req,
    organizationId,
    exactPermission,
    operational
  );
};
const adminScope = (req) => svc.platform(req) || Boolean(req.staffAccess?.isHeadOffice || req.staffAccess);
const publicProjection = "name slug code type description logo.url logo.mimeType status registrationFee annualFee";
const dashboardScope = (organizationId, branchScope, memberIds = null) => ({
  memberFilter: branchScope ? { organization: organizationId, branch: branchScope } : { organization: organizationId },
  memberIds: branchScope ? { $in: memberIds || [] } : undefined,
  walletRestricted: Boolean(branchScope),
});
const validateApplication = async (organization, input) => {
  const fields = await OrganizationCustomField.find({ organization, active: true }).lean();
  const allowed = new Set(["fullName", "phone", "email"]);
  for (const field of fields) allowed.add(field.key);
  for (const key of Object.keys(input || {})) if (!allowed.has(key)) throw Object.assign(new Error(`Unknown membership field: ${key}`), { status: 400 });
  for (const field of fields) {
    const value = input?.[field.key];
    if (field.required && (value === undefined || value === null || value === "")) throw Object.assign(new Error(`${field.label} is required.`), { status: 400 });
    if (value === undefined) continue;
    if (field.type === "FILE") throw Object.assign(new Error("File upload is not available."), { status: 409, code: "UPLOAD_NOT_AVAILABLE" });
    if (field.type === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))) throw Object.assign(new Error(`${field.label} must be a valid email.`), { status: 400 });
    if (["SELECT", "MULTISELECT"].includes(field.type) && (field.type === "SELECT" ? !field.options.includes(value) : !Array.isArray(value) || value.some((v) => !field.options.includes(v)))) throw Object.assign(new Error(`${field.label} has an invalid option.`), { status: 400 });
  }
  return input;
};

exports.create = async (req, res) => { try { return res.status(201).json({ success: true, organization: await svc.makeOrganization(req) }); } catch (e) { return fail(res, e.status || 500, e.message); } };
exports.mine = async (req, res) => { const [owned, memberships] = await Promise.all([Organization.find({ createdBy: req.user._id }).sort({ createdAt: -1 }).lean(), OrganizationMember.find({ user: req.user._id }).populate("organization", "name slug code type status contact.name contact.address").sort({ createdAt: -1 }).lean()]); return ok(res, { organizations: owned.map((organization) => ({ ...organization, canManage: true, allowedToManage: true })), memberships }); };
exports.explore = async (req, res) => { const q = String(req.query.search || "").trim(); const filter = { status: "VERIFIED", ...(q ? { $or: [{ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }, { code: q.toUpperCase() }] } : {}) }; return ok(res, { organizations: (await Organization.find(filter).select(publicProjection).limit(50).lean()).map((o) => ({ ...o, _id: o._id, id: String(o._id), verified: true })) }); };
exports.getCustomerOrganization = async (req, res) => { const org = await Organization.findOne({ _id: req.params.id, status: "VERIFIED" }).select("name slug code type description logo registrationFee annualFee renewalCycle status").lean(); if (!org) return fail(res, 404, "Organization not found."); const membership = await OrganizationMember.findOne({ organization: org._id, user: req.user._id }).select("membershipNumber year status joinedAt").lean(); const fields = await OrganizationCustomField.find({ organization: org._id, active: true }).select("key label type required options").lean(); const logo = org.logo?.mimeType && /^https:\/\//.test(org.logo?.url || "") ? org.logo.url : null; return ok(res, { organization: { _id: org._id, id: String(org._id), name: org.name, slug: org.slug, code: org.code, type: org.type, description: org.description, logo, verified: true, registrationFee: org.registrationFee, annualFee: org.annualFee, renewalCycle: org.renewalCycle, customFields: fields }, membership }); };
exports.submit = async (req, res) => { const org = await requireOrg(req, "settings.manage", false); if (!org) return fail(res, 403, "Organization access denied."); if (!["DRAFT", "REJECTED"].includes(org.status)) return fail(res, 409, "Organization cannot be submitted."); org.status = "PENDING_VERIFICATION"; await org.save(); return ok(res, { organization: org }); };
exports.platformStatus = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); const org = await Organization.findById(req.params.id); if (!org) return fail(res, 404, "Organization not found."); const status = String(req.body.status || "").toUpperCase(); const graph = { DRAFT: ["PENDING_VERIFICATION"], PENDING_VERIFICATION: ["VERIFIED", "REJECTED"], VERIFIED: ["SUSPENDED"], REJECTED: ["PENDING_VERIFICATION"], SUSPENDED: ["VERIFIED"] }; if (!graph[org.status]?.includes(status)) return fail(res, 409, "Invalid organization status transition."); const before = org.status; org.status = status; org.approvedAt = status === "VERIFIED" ? new Date() : null; org.approvedBy = status === "VERIFIED" ? req.user._id : null; org.rejectionReason = String(req.body.rejectionReason || "").slice(0, 500); await org.save(); await svc.audit(req, org, status === "SUSPENDED" ? "ORGANIZATION_FROZEN" : "ORGANIZATION_STATUS_UPDATED", "Organization", org._id, { before, status }); return ok(res, { organization: org }); };
exports.publicSearch = async (req, res) => { const q = String(req.query.q || req.query.search || "").trim(); const filter = { status: "VERIFIED", ...(q ? { $or: [{ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }, { code: q.toUpperCase() }, { slug: q.toLowerCase() }] } : {}) }; const rows = await Organization.find(filter).select(publicProjection).limit(30).lean(); return ok(res, { organizations: rows.map((o) => ({ ...o, _id: o._id, id: String(o._id), verified: true })) }); };
exports.publicView = async (req, res) => { const org = await Organization.findOne({ $or: [{ slug: req.params.slug }, { code: req.params.slug }], status: "VERIFIED" }).select(publicProjection).lean(); return org ? ok(res, { organization: { ...org, _id: org._id, id: String(org._id), verified: true } }) : fail(res, 404, "Organization not found."); };
exports.verifyCard = async (req, res) => { const card = await OrganizationMembershipCard.findOne({ cardNumber: req.params.cardNumber, active: true }).populate({ path: "organization", select: "name slug code status" }).populate({ path: "member", select: "membershipNumber year status" }).lean(); if (!card || card.organization?.status !== "VERIFIED" || card.member?.status !== "ACTIVE") return fail(res, 404, "Membership card could not be verified."); return ok(res, { card: { cardNumber: card.cardNumber, issuedAt: card.issuedAt, organization: card.organization, member: card.member } }); };
exports.apply = async (req, res) => { try { const org = await Organization.findOne({ _id: req.params.organizationId, status: "VERIFIED" }); if (!org) return fail(res, 404, "Verified organization not found."); const existing = await OrganizationMember.findOne({ organization: org._id, user: req.user._id }); if (existing) { const validActive = existing.status === "ACTIVE" && typeof existing.membershipNumber === "string" && existing.membershipNumber.trim(); if (org.membershipMode === "AUTO" && org.registrationFee <= 0 && (validActive || existing.status === "PENDING")) { const membership = validActive ? existing : await svc.approveMember(req, existing); return res.status(200).json({ success: true, idempotent: true, membership }); } return fail(res, 409, "Membership application already exists."); } const applicationData = req.body.applicationData || req.body.fields || req.body; await validateApplication(org._id, applicationData); const session = await mongoose.startSession(); let member; let registrationDue = null; await session.withTransaction(async () => { member = (await OrganizationMember.create([{ organization: org._id, user: req.user._id, applicationData, status: "PENDING" }], { session }))[0]; if (org.registrationFee > 0) { const fee = await OrganizationFee.findOneAndUpdate({ organization: org._id, type: "REGISTRATION", active: true }, { $setOnInsert: { organization: org._id, name: "Registration fee", type: "REGISTRATION", amount: org.registrationFee, frequency: "ONCE", active: true } }, { upsert: true, new: true, session }); registrationDue = (await OrganizationFeeAssignment.create([{ organization: org._id, fee: fee._id, member: member._id, amount: fee.amount, billingPeriod: "LIFETIME", status: "ASSIGNED", assignedBy: org.createdBy }], { session }))[0]; } await svc.audit(req, org, "MEMBERSHIP_APPLIED", "OrganizationMember", member._id, {}, session); }); await session.endSession(); const approved = org.membershipMode === "AUTO" && !registrationDue ? await svc.approveMember(req, member) : member; return res.status(201).json({ success: true, membership: approved || member, registrationDue }); } catch (e) { const safe = svc.publicError(e, "Membership application already exists."); return fail(res, safe.status, safe.message); } };
exports.dues = async (req, res) => { const org = await Organization.findOne({ _id: req.params.id, status: "VERIFIED" }); if (!org) return fail(res, 404, "Organization not found."); const member = await OrganizationMember.findOne({ organization: org._id, user: req.user._id }); if (!member) return fail(res, 403, "Membership required."); return ok(res, { dues: await OrganizationFeeAssignment.find({ organization: org._id, member: member._id }).populate("fee", "name description frequency").lean() }); };
exports.payments = async (req, res) => { const org = await Organization.findOne({ _id: req.params.id, status: "VERIFIED" }); if (!org) return fail(res, 404, "Organization not found."); const member = await OrganizationMember.findOne({ organization: org._id, user: req.user._id }); if (!member) return fail(res, 403, "Membership required."); return ok(res, { payments: await OrganizationPayment.find({ organization: org._id, member: member._id, payer: req.user._id }).sort({ createdAt: -1 }).lean() }); };
exports.adminList = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); const filter = {}; if (req.query.status) filter.status = String(req.query.status).toUpperCase(); if (req.query.search) { const search = String(req.query.search).trim().slice(0, 100); const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); filter.$or = [{ name: new RegExp(escaped, "i") }, { code: search.toUpperCase() }]; } return ok(res, { organizations: await Organization.find(filter).sort({ createdAt: -1 }).limit(200).lean() }); };
exports.adminSummary = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); const [counts, members, collections] = await Promise.all([Organization.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]), OrganizationMember.countDocuments({}), OrganizationPayment.aggregate([{ $match: { status: "SUCCESS" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }])]); const byStatus = Object.fromEntries(counts.map((x) => [x._id, x.count])); return ok(res, { summary: { total: counts.reduce((n, x) => n + x.count, 0), verified: byStatus.VERIFIED || 0, pending: byStatus.PENDING_VERIFICATION || 0, suspended: byStatus.SUSPENDED || 0, members, collections: collections[0] || { total: 0, count: 0 } } }); };
exports.adminDetail = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); const org = await Organization.findById(req.params.id).lean(); return org ? ok(res, { organization: org }) : fail(res, 404, "Organization not found."); };
exports.adminMembers = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); return ok(res, { members: await OrganizationMember.find({ organization: req.params.id }).select("-applicationData").lean() }); };
exports.adminPayments = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); return ok(res, { payments: await OrganizationPayment.find({ organization: req.params.id }).sort({ createdAt: -1 }).lean() }); };
exports.adminAudit = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); return ok(res, { audit: await require("../models/organizations.models").OrganizationAuditLog.find({ organization: req.params.id }).sort({ createdAt: -1 }).limit(200).lean() }); };
exports.adminWallet = async (req, res) => { if (!adminScope(req)) return fail(res, 403, "Platform administrator access is required."); if (req.method === "PATCH") { const status = req.body.frozen === true ? "FROZEN" : String(req.body.status || "").toUpperCase(); if (!["ACTIVE", "FROZEN"].includes(status)) return fail(res, 400, "Invalid wallet status."); const wallet = await OrganizationWallet.findOneAndUpdate({ organization: req.params.id }, { $set: { status } }, { new: true }); if (!wallet) return fail(res, 404, "Organization wallet not found."); await svc.audit(req, { _id: req.params.id }, "ORGANIZATION_WALLET_STATUS", "OrganizationWallet", wallet._id, { status }); return ok(res, { wallet }); } return ok(res, { wallet: await OrganizationWallet.findOne({ organization: req.params.id }).lean() }); };
exports.staff = async (req, res) => { const org = await requireOrg(req, "staff.manage"); if (!org) return fail(res, 403, "Organization access denied."); return ok(res, { staff: await OrganizationRole.find({ organization: org._id, active: true }).populate("user", "fullName email phone").lean() }); };
exports.addStaff = async (req, res) => { const org = await requireOrg(req, "staff.manage"); if (!org) return fail(res, 403, "Organization access denied."); const allowed = ["ADMIN", "TREASURER", "SECRETARY", "MEMBERSHIP_OFFICER", "AUDITOR", "BRANCH_ADMIN"]; const role = String(req.body.role || "").toUpperCase(); if (!allowed.includes(role) || !id(req.body.userId)) return fail(res, 400, "Valid staff user and role are required."); const defaults = svc.ORGANIZATION_ROLE_CAPABILITIES[role] || []; const permissions = req.body.permissions === undefined ? defaults : req.body.permissions; if (!Array.isArray(permissions) || permissions.some((p) => !svc.ORGANIZATION_PERMISSIONS.includes(p) || !defaults.includes(p) || (req.organizationAccess?.role?.role !== "OWNER" && !req.organizationAccess.permissions.includes(p)))) return fail(res, 400, "Permissions exceed the assigner's capabilities."); if (role === "BRANCH_ADMIN" && !id(req.body.branchId)) return fail(res, 400, "Branch admin must have a branch."); const branch = req.body.branchId && await OrganizationBranch.findOne({ _id: req.body.branchId, organization: org._id, active: true }); if (role === "BRANCH_ADMIN" && !branch) return fail(res, 400, "Branch does not belong to this organization."); return res.status(201).json({ success: true, staff: await OrganizationRole.findOneAndUpdate({ organization: org._id, user: req.body.userId }, { $set: { role, active: true, assignedBy: req.user._id, branch: branch?._id || null, permissions } }, { upsert: true, new: true, runValidators: true }) }); };
exports.removeStaff = async (req, res) => { const org = await requireOrg(req, "staff.manage"); if (!org) return fail(res, 403, "Organization access denied."); const row = await OrganizationRole.findOneAndUpdate({ _id: req.params.staffId, organization: org._id, role: { $ne: "OWNER" } }, { $set: { active: false } }, { new: true }); return row ? ok(res, { staff: row }) : fail(res, 404, "Staff assignment not found."); };
exports.members = async (req, res) => { const org = await requireOrg(req, "members.view"); if (!org) return fail(res, 403, "Organization access denied."); const filter = { organization: org._id }; if (req.organizationAccess?.branchScope) filter.branch = req.organizationAccess.branchScope; return ok(res, { members: await OrganizationMember.find(filter).select("-applicationData").populate("user", "fullName name firstName lastName email phone").sort({ createdAt: -1 }).lean() }); };
exports.approveMember = async (req, res) => { const org = await requireOrg(req, "members.approve"); if (!org || !id(req.params.memberId)) return fail(res, 403, "Organization access denied."); const member = await OrganizationMember.findOne({ _id: req.params.memberId, organization: org._id }); if (!member) return fail(res, 404, "Membership not found."); try { const result = await svc.approveMember(req, member); return ok(res, { membership: result }); } catch (e) { const safe = svc.publicError(e, "Membership approval conflicts with an existing membership number."); return fail(res, safe.status, safe.message); } };
exports.createBranch = async (req, res) => { const org = await requireOrg(req, "branches.manage"); if (!org) return fail(res, 403, "Organization access denied."); return res.status(201).json({ success: true, branch: await OrganizationBranch.create({ organization: org._id, name: req.body.name, code: req.body.code, address: req.body.address }) }); };
exports.createField = async (req, res) => { const org = await requireOrg(req, "settings.manage"); if (!org) return fail(res, 403, "Organization access denied."); if (String(req.body.type).toUpperCase() === "FILE" && (req.body.required === true || String(req.body.required).toLowerCase() === "true")) return fail(res, 409, "UPLOAD_NOT_AVAILABLE"); if (["SELECT", "MULTISELECT"].includes(String(req.body.type).toUpperCase()) && (!Array.isArray(req.body.options) || !req.body.options.length)) return fail(res, 400, "Options are required."); return res.status(201).json({ success: true, field: await OrganizationCustomField.create({ ...req.body, type: String(req.body.type).toUpperCase(), organization: org._id }) }); };
exports.createFee = async (req, res) => { const org = await requireOrg(req, "fees.create"); if (!org) return fail(res, 403, "Organization access denied."); let amount; try { amount = svc.normalizeMoney(req.body.amount); } catch (e) { return fail(res, e.status || 400, e.message); } try { return res.status(201).json({ success: true, fee: await OrganizationFee.create({ ...req.body, amount, organization: org._id }) }); } catch (e) { return fail(res, 400, e.name === "ValidationError" ? "Invalid fee." : e.message); } };
exports.assignFee = async (req, res) => { const org = await requireOrg(req, "fees.create"); if (!org) return fail(res, 403, "Organization access denied."); if (!id(req.body.feeId) || (req.body.memberId && !id(req.body.memberId)) || (req.body.branchId && !id(req.body.branchId)) || (req.body.memberIds && (!Array.isArray(req.body.memberIds) || req.body.memberIds.some((v) => !id(v)))) ) return fail(res, 400, "Invalid fee assignment id."); if (req.body.branchId && !(await OrganizationBranch.exists({ _id: req.body.branchId, organization: org._id, active: true }))) return fail(res, 400, "Branch does not belong to this organization."); const fee = await OrganizationFee.findOne({ _id: req.body.feeId, organization: org._id, active: true }); if (!fee) return fail(res, 404, "Fee not found."); const period = req.body.billingPeriod || (fee.frequency === "ANNUAL" ? String(new Date().getFullYear()) : "LIFETIME"); const selector = req.body.memberIds || (req.body.memberId ? [req.body.memberId] : null); const filter = { organization: org._id, status: "ACTIVE", ...(scopedId(req) ? { branch: scopedId(req) } : {}) }; if (selector) filter._id = { $in: selector }; else if (req.body.branchId) filter.branch = req.body.branchId; else if (req.body.category) filter.category = String(req.body.category); const members = await OrganizationMember.find(filter).select("_id"); if (!members.length) return fail(res, 404, "No active members match the assignment target."); const assignments = []; for (const member of members) { const row = await OrganizationFeeAssignment.findOneAndUpdate({ organization: org._id, fee: fee._id, member: member._id, billingPeriod: period }, { $setOnInsert: { organization: org._id, fee: fee._id, member: member._id, amount: fee.amount, billingPeriod: period, assignedBy: req.user._id, status: "ASSIGNED" } }, { upsert: true, new: true }); assignments.push(row); } return res.status(201).json({ success: true, assignments, assignmentCount: assignments.length }); };
exports.pay = async (req, res) => { const key = String(req.get("X-Idempotency-Key") || req.get("Idempotency-Key") || "").trim(); if (!key) return fail(res, 400, "Idempotency-Key is required."); const orgId = req.params.id || req.params.organizationId; let assignment = await OrganizationFeeAssignment.findOne({ _id: req.params.assignmentId || req.body.dueId, organization: orgId }).populate("fee"); if (!assignment && req.path.endsWith("annual-payment")) { const memberForAnnual = await OrganizationMember.findOne({ organization: orgId, user: req.user._id, status: "ACTIVE" }); assignment = memberForAnnual && await OrganizationFeeAssignment.findOne({ organization: orgId, member: memberForAnnual._id, status: { $in: ["ASSIGNED", "PARTIAL"] } }).populate({ path: "fee", match: { frequency: "ANNUAL" } }); if (assignment && !assignment.fee) assignment = null; } const member = assignment && await OrganizationMember.findOne({ _id: assignment.member, user: req.user._id, organization: assignment.organization, status: { $in: ["ACTIVE", "PENDING"] } }); if (!assignment || !member || !["ASSIGNED", "PARTIAL"].includes(assignment.status) || (member.status === "PENDING" && assignment.fee?.type !== "REGISTRATION")) return fail(res, 404, "Fee assignment is not payable."); if (req.body.amount !== undefined && Number(req.body.amount) !== Number(assignment.amount)) return fail(res, 400, "Payment amount does not match the assigned fee."); const amount = Number(assignment.amount); if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, "Invalid assigned payment amount."); try { const result = await svc.pay(req, assignment, member, amount, key); return res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, payment: result.payment }); } catch (e) { const safe = svc.publicError(e, "This payment was already submitted."); return fail(res, safe.status, safe.message); } };
exports.wallet = async (req, res) => { const org = await requireOrg(req, "wallet.view"); if (!org) return fail(res, 403, "Organization access denied."); return ok(res, { wallet: await OrganizationWallet.findOne({ organization: org._id }).lean() }); };
exports.dashboard = async (req, res) => { const org = await requireOrg(req, "reports.view"); if (!org) return fail(res, 403, "Organization access denied."); const branchScope = req.organizationAccess?.branchScope || null; const scopedMembers = branchScope ? await OrganizationMember.find({ organization: org._id, branch: branchScope }).select("_id").lean() : null; const memberIds = scopedMembers ? scopedMembers.map((m) => m._id) : null; const memberMatch = { organization: org._id, ...(memberIds ? { _id: { $in: memberIds } } : {}) }; const paymentMatch = { organization: org._id, status: "SUCCESS", ...(memberIds ? { member: { $in: memberIds } } : {}) }; const assignmentMatch = { organization: org._id, status: { $in: ["ASSIGNED", "PARTIAL"] }, ...(memberIds ? { member: { $in: memberIds } } : {}) }; const [members, payments, wallet, dues] = await Promise.all([OrganizationMember.aggregate([{ $match: memberMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }]), OrganizationPayment.aggregate([{ $match: paymentMatch }, { $lookup: { from: "organizationfeeassignments", localField: "assignment", foreignField: "_id", as: "assignment" } }, { $unwind: "$assignment" }, { $lookup: { from: "organizationfees", localField: "assignment.fee", foreignField: "_id", as: "fee" } }, { $unwind: { path: "$fee", preserveNullAndEmptyArrays: true } }, { $group: { _id: "$fee.type", total: { $sum: "$amount" }, count: { $sum: 1 } } }]), branchScope ? null : OrganizationWallet.findOne({ organization: org._id }).lean(), OrganizationFeeAssignment.aggregate([{ $match: assignmentMatch }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }])]); const counts = Object.fromEntries(members.map((x) => [String(x._id).toLowerCase(), x.count])); const revenue = Object.fromEntries(payments.map((x) => [String(x._id || "OTHER").toLowerCase(), x.total])); revenue.total = Object.values(revenue).reduce((a, b) => a + (Number(b) || 0), 0); return ok(res, { summary: { total: members.reduce((a, x) => a + x.count, 0), active: counts.active || 0, pending: counts.pending || 0, expired: counts.expired || 0, suspended: counts.suspended || 0, counts, revenue, outstandingDues: dues[0]?.total || 0, walletBalance: branchScope ? null : wallet?.balance || 0, walletRestricted: Boolean(branchScope) } }); };
exports.withdraw = async (req, res) => fail(res, 501, "Organization bank withdrawals are not available.");
exports.announcements = async (req, res) => {
  const org = await requireOrg(req, "messages.send"); if (!org) return fail(res, 403, "Organization access denied.");
  const audience = String(req.body.audience || "ALL").toUpperCase();
  if (!["ALL", "MEMBERS", "STAFF", "BRANCH"].includes(audience)) return fail(res, 400, "Unsupported announcement audience.");
  if (audience === "BRANCH" && (!id(req.body.branch) || !(await OrganizationBranch.exists({ _id: req.body.branch, organization: org._id, active: true })))) return fail(res, 400, "Branch does not belong to this organization.");
  const announcement = await OrganizationAnnouncement.create({ title: req.body.title, body: req.body.body, audience, branch: audience === "BRANCH" ? req.body.branch : undefined, published: req.body.published === true, publishedAt: req.body.published === true ? new Date() : undefined, organization: org._id, createdBy: req.user._id });
  let delivery = { requested: 0, delivered: 0, failed: 0, channels: { inApp: true, email: false, push: false } };
  if (announcement.published) {
    const memberUsers = audience === "STAFF" ? [] : await OrganizationMember.find({ organization: org._id, status: "ACTIVE", ...(audience === "BRANCH" ? { branch: req.body.branch } : {}) }).distinct("user");
    const staffUsers = audience === "MEMBERS" || audience === "BRANCH" ? [] : await OrganizationRole.find({ organization: org._id, active: true }).distinct("user");
    const userIds = [...new Set([...memberUsers, ...staffUsers].map(String))];
    const users = await require("../models/user.model").find({ _id: { $in: userIds } }).select("_id").lean();
    const results = await Promise.allSettled(users.map((u) => createInAppNotification({ userId: u._id, title: announcement.title, message: announcement.body, type: "GENERAL", referenceId: announcement._id, referenceType: "COMMUNICATION_CAMPAIGN", dedupeKey: `organization-announcement:${announcement._id}:${u._id}` })));
    delivery.requested = results.length; delivery.delivered = results.filter((r) => r.status === "fulfilled" && r.value).length; delivery.failed = results.length - delivery.delivered;
  }
  await svc.audit(req, org, "ANNOUNCEMENT_CREATED", "OrganizationAnnouncement", announcement._id, { audience, published: announcement.published });
  return res.status(201).json({ success: true, announcement, delivery });
};
exports.card = async (req, res) => { try { const org = await requireOrg(req, "cards.manage"); if (!org) return fail(res, 403, "Organization access denied."); if (!id(req.body.memberId)) return fail(res, 400, "Invalid member id."); const member = await OrganizationMember.findOne({ _id: req.body.memberId, organization: org._id, status: "ACTIVE" }); if (!member) return fail(res, 404, "Active member not found."); if (typeof member.membershipNumber !== "string" || !member.membershipNumber.trim()) return fail(res, 409, "An active membership number is required before issuing a card."); const card = await OrganizationMembershipCard.create({ organization: org._id, member: member._id, cardNumber: `${org.code}-${member.membershipNumber.replace(/\//g, "-")}` }); return res.status(201).json({ success: true, card }); } catch (e) { const safe = svc.publicError(e, "A membership card already exists."); return fail(res, safe.status, safe.message); } };
exports.dashboardScope = dashboardScope;
exports.myCard = async (req, res) => { const membership = await OrganizationMember.findOne({ organization: req.params.id, user: req.user._id, status: "ACTIVE" }).select("_id membershipNumber year status").lean(); if (!membership) return fail(res, 404, "Active membership card not found."); const card = await OrganizationMembershipCard.findOne({ organization: req.params.id, member: membership._id, active: true }).populate("organization", "name slug code status").lean(); if (!card || card.organization?.status !== "VERIFIED") return fail(res, 404, "Active membership card not found."); return ok(res, { card: { ...card, member: membership } }); };

// Owner dashboard API.  Keep every query rooted in the organization obtained
// from requireOrg; callers must never be able to turn these into platform APIs.
const scopedMemberFilter = (org, req, extra = {}) => ({
  organization: org._id,
  ...(req.organizationAccess?.branchScope ? { branch: req.organizationAccess.branchScope } : {}),
  ...extra,
});
const page = (req) => {
  const rawPage = req.query.page === undefined ? 1 : Number(req.query.page);
  const rawLimit = req.query.limit === undefined ? 25 : Number(req.query.limit);
  if (!Number.isInteger(rawPage) || rawPage < 1 || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) return null;
  return { page: rawPage, limit: rawLimit };
};
const pagination = (p, limit, total) => ({ page: p, limit, total, pages: Math.ceil(total / limit) });
const scopedId = (req) => req.organizationAccess?.branchScope;
const runAccess = async (req, permission) => requireOrg(req, permission);

exports.dashboardOverview = async (req, res) => {
  const org = await runAccess(req, "reports.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const filter = scopedMemberFilter(org, req);
  const visibleMembers = scopedId(req) ? await OrganizationMember.find(filter).distinct("_id") : null;
  const [counts, payments, pending, recent] = await Promise.all([
    OrganizationMember.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    OrganizationPayment.aggregate([{ $match: { organization: org._id, status: "SUCCESS", ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    OrganizationMember.countDocuments({ ...filter, status: "PENDING" }),
    OrganizationPayment.find({ organization: org._id, status: "SUCCESS", ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);
  const byStatus = Object.fromEntries(counts.map((x) => [String(x._id).toLowerCase(), x.count]));
  return ok(res, { overview: { members: byStatus, totalMembers: counts.reduce((n, x) => n + x.count, 0), pendingApplications: pending, collections: payments[0] || { total: 0, count: 0 }, recent } });
};
// Stable Flutter contract: one request contains the headline cards and the
// first page of the two activity feeds.  Trend arrays contain persisted rows
// only; no forecast or fabricated values are returned.
exports.dashboardCanonical = async (req, res) => {
  const org = await runAccess(req, "reports.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const filter = scopedMemberFilter(org, req);
  const visibleMembers = scopedId(req) ? await OrganizationMember.find(filter).distinct("_id") : null;
  const [counts, recentMembers, recentPayments, revenueRows, dues, wallet] = await Promise.all([
    OrganizationMember.aggregate([{ $match: filter }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    OrganizationMember.find(filter).sort({ createdAt: -1 }).limit(10).select("-applicationData").populate("user", "fullName").lean(),
    OrganizationPayment.find({ organization: org._id, status: "SUCCESS", ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) }).sort({ createdAt: -1 }).limit(10).lean(),
    OrganizationPayment.aggregate([{ $match: { organization: org._id, status: "SUCCESS", ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) } }, { $lookup: { from: "organizationfeeassignments", localField: "assignment", foreignField: "_id", as: "assignment" } }, { $unwind: { path: "$assignment", preserveNullAndEmptyArrays: true } }, { $lookup: { from: "organizationfees", localField: "assignment.fee", foreignField: "_id", as: "fee" } }, { $unwind: { path: "$fee", preserveNullAndEmptyArrays: true } }, { $group: { _id: "$fee.type", total: { $sum: "$amount" } } }]),
    OrganizationFeeAssignment.aggregate([{ $match: { organization: org._id, status: { $in: ["ASSIGNED", "PARTIAL"] }, ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    scopedId(req) ? null : OrganizationWallet.findOne({ organization: org._id }).lean(),
  ]);
  const byStatus = Object.fromEntries(counts.map((x) => [String(x._id).toLowerCase(), x.count]));
  const membershipGrowth = recentMembers.map((m) => ({ date: m.createdAt, count: 1 }));
  const revenueTrend = recentPayments.map((p) => ({ date: p.createdAt, amount: p.amount }));
  const revenue = Object.fromEntries(revenueRows.map((x) => [String(x._id || "OTHER").toLowerCase(), x.total])); revenue.total = Object.values(revenue).reduce((n, x) => n + (Number(x) || 0), 0);
  return ok(res, { summary: { total: counts.reduce((n, x) => n + x.count, 0), active: byStatus.active || 0, pending: byStatus.pending || 0, suspended: byStatus.suspended || 0, expired: byStatus.expired || 0, counts: byStatus, revenue, outstandingDues: dues[0]?.total || 0, walletBalance: wallet?.balance || 0, walletRestricted: Boolean(scopedId(req)) }, recentMembers, recentPayments, membershipGrowth, revenueTrend });
};
exports.dashboardTrends = async (req, res) => {
  const org = await runAccess(req, "reports.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const days = Math.min(366, Math.max(1, Number(req.query.days) || 30)); const since = new Date(Date.now() - days * 86400000);
  const members = await OrganizationMember.find(scopedMemberFilter(org, req, { createdAt: { $gte: since } })).select("createdAt status").lean();
  const visibleMembers = scopedId(req) ? await OrganizationMember.find(scopedMemberFilter(org, req)).distinct("_id") : null;
  const payments = await OrganizationPayment.find({ organization: org._id, status: "SUCCESS", createdAt: { $gte: since }, ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) }).select("createdAt amount").lean();
  const trends = {}; for (let i = 0; i < days; i++) { const d = new Date(Date.now() - (days - i - 1) * 86400000).toISOString().slice(0, 10); trends[d] = { members: 0, collections: 0 }; }
  members.forEach((m) => { const d = new Date(m.createdAt).toISOString().slice(0, 10); if (trends[d]) trends[d].members++; });
  payments.forEach((p) => { const d = new Date(p.createdAt).toISOString().slice(0, 10); if (trends[d]) trends[d].collections += Number(p.amount) || 0; });
  return ok(res, { trends: Object.entries(trends).map(([date, values]) => ({ date, ...values })) });
};
exports.dashboardRecent = async (req, res) => {
  const org = await runAccess(req, "reports.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const visibleMembers = scopedId(req) ? await OrganizationMember.find(scopedMemberFilter(org, req)).distinct("_id") : null;
  const [members, payments, announcements] = await Promise.all([
    OrganizationMember.find(scopedMemberFilter(org, req)).sort({ createdAt: -1 }).limit(10).select("-applicationData").populate("user", "fullName").lean(),
    OrganizationPayment.find({ organization: org._id, ...(visibleMembers ? { member: { $in: visibleMembers } } : {}) }).sort({ createdAt: -1 }).limit(10).lean(),
    OrganizationAnnouncement.find({ organization: org._id, published: true, ...(scopedId(req) ? { $or: [{ audience: "ALL" }, { audience: "BRANCH", branch: scopedId(req) }] } : {}) }).sort({ publishedAt: -1, createdAt: -1 }).limit(10).lean(),
  ]);
  return ok(res, { recent: { members, payments, announcements } });
};
exports.memberList = async (req, res) => {
  const org = await runAccess(req, "members.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const { page: p, limit } = paging; const q = String(req.query.search || "").trim(); const filter = scopedMemberFilter(org, req);
  if (req.query.branchId) { if (!id(req.query.branchId)) return fail(res, 400, "Invalid branch id."); if (!(await OrganizationBranch.exists({ _id: req.query.branchId, organization: org._id, active: true }))) return fail(res, 404, "Branch not found."); if (scopedId(req) && String(scopedId(req)) !== String(req.query.branchId)) return fail(res, 404, "Branch not found."); filter.branch = req.query.branchId; }
  if (req.query.status) { filter.status = String(req.query.status).toUpperCase(); if (!["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "EXPIRED"].includes(filter.status)) return fail(res, 400, "Invalid member status."); }
  if (q) { const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); filter.$or = [{ membershipNumber: new RegExp(safe, "i") }, { "applicationData.fullName": new RegExp(safe, "i") }, { "applicationData.email": new RegExp(safe, "i") }]; }
  const [members, total] = await Promise.all([OrganizationMember.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).select("-applicationData").populate("user", "fullName email phone").lean(), OrganizationMember.countDocuments(filter)]);
  members.forEach((member) => { member.annualFeeStatus = null; });
  return ok(res, { members, pagination: pagination(p, limit, total) });
};
exports.memberDetail = async (req, res) => {
  const org = await runAccess(req, "members.view"); if (!org) return fail(res, 403, "Organization access denied.");
  if (!id(req.params.memberId)) return fail(res, 400, "Invalid member id.");
  const member = await OrganizationMember.findOne(scopedMemberFilter(org, req, { _id: req.params.memberId })).populate("user", "fullName email phone").lean();
  if (!member) return fail(res, 404, "Member not found.");
  const [card, paymentSummary] = await Promise.all([OrganizationMembershipCard.findOne({ organization: org._id, member: member._id, active: true }).select("_id cardNumber issuedAt active").lean(), OrganizationPayment.aggregate([{ $match: { organization: org._id, member: member._id, status: "SUCCESS" } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } }])]);
  return ok(res, { member, card: card || null, paymentSummary: paymentSummary[0] || { count: 0, amount: 0 } });
};
exports.memberDetailPatch = async (req, res) => {
  if (!id(req.params.memberId)) return fail(res, 400, "Invalid member id.");
  const org = await runAccess(req, "members.edit"); if (!org) return fail(res, 403, "Organization access denied.");
  const keys = Object.keys(req.body || {}); if (keys.some((key) => !["category", "branch"].includes(key))) return fail(res, 400, "Only category and branch may be edited.");
  const update = {};
  if (req.body.category !== undefined) { if (typeof req.body.category !== "string" || req.body.category.length > 120) return fail(res, 400, "Invalid category."); update.category = req.body.category.trim(); }
  if (req.body.branch !== undefined) {
    if (req.body.branch !== null && !id(req.body.branch)) return fail(res, 400, "Invalid branch id.");
    if (req.body.branch !== null && !(await OrganizationBranch.exists({ _id: req.body.branch, organization: org._id, active: true }))) return fail(res, 404, "Branch not found.");
    if (scopedId(req) && String(req.body.branch) !== String(scopedId(req))) return fail(res, 404, "Branch not found.");
    update.branch = req.body.branch;
  }
  const member = await OrganizationMember.findOneAndUpdate(scopedMemberFilter(org, req, { _id: req.params.memberId }), { $set: update }, { new: true }).select("-applicationData").lean();
  if (!member) return fail(res, 404, "Member not found.");
  await svc.audit(req, org, "MEMBER_DETAILS_UPDATED", "OrganizationMember", member._id, { fields: keys });
  return ok(res, { member });
};
exports.memberStatus = async (req, res) => {
  const status = String(req.body.status || "").toUpperCase();
  if (!id(req.params.memberId) || !["ACTIVE", "SUSPENDED"].includes(status)) return fail(res, 400, "Invalid member status.");
  const org = await runAccess(req, "members.suspend"); if (!org) return fail(res, 403, "Organization access denied.");
  const member = await OrganizationMember.findOne(scopedMemberFilter(org, req, { _id: req.params.memberId }));
  if (!member) return fail(res, 404, "Member not found.");
  if (member.status === "PENDING") return fail(res, 409, "Pending applications must be approved through the approval workflow.");
  if (member.status === status || !["ACTIVE", "SUSPENDED"].includes(member.status)) return fail(res, 409, "Invalid membership status transition.");
  if (!member.membershipNumber) return fail(res, 409, "Membership identity is unavailable.");
  const card = await OrganizationMembershipCard.findOne({ organization: org._id, member: member._id, active: true });
  if (!card) return fail(res, 409, "Membership card identity is unavailable.");
  member.status = status; await member.save(); await svc.audit(req, org, "MEMBERSHIP_STATUS_UPDATED", "OrganizationMember", member._id, { status }); return ok(res, { member });
};
exports.applicationList = async (req, res) => {
  const org = await runAccess(req, "members.approve"); if (!org) return fail(res, 403, "Organization access denied.");
  const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = scopedMemberFilter(org, req, { status: String(req.query.status || "PENDING").toUpperCase() });
  if (req.query.status && !["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "EXPIRED"].includes(filter.status)) return fail(res, 400, "Invalid application status.");
  const [applications, total] = await Promise.all([OrganizationMember.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("user", "fullName email phone").lean(), OrganizationMember.countDocuments(filter)]);
  return ok(res, { applications, pagination: pagination(paging.page, paging.limit, total) });
};
exports.applicationDetail = async (req, res) => { if (!id(req.params.applicationId)) return fail(res, 400, "Invalid application id."); const org = await runAccess(req, "members.approve"); if (!org) return fail(res, 403, "Organization access denied."); const application = await OrganizationMember.findOne(scopedMemberFilter(org, req, { _id: req.params.applicationId })).populate("user", "fullName email phone").lean(); return application ? ok(res, { application }) : fail(res, 404, "Application not found."); };
exports.approveApplication = async (req, res) => { req.params.memberId = req.params.applicationId; return exports.approveMember(req, res); };
exports.rejectApplication = async (req, res) => { if (!id(req.params.applicationId)) return fail(res, 400, "Invalid application id."); const org = await runAccess(req, "members.approve"); if (!org) return fail(res, 403, "Organization access denied."); const application = await OrganizationMember.findOneAndUpdate(scopedMemberFilter(org, req, { _id: req.params.applicationId, status: "PENDING" }), { $set: { status: "REJECTED" } }, { new: true }); if (!application) return fail(res, 404, "Application not found."); await svc.audit(req, org, "MEMBERSHIP_REJECTED", "OrganizationMember", application._id); return ok(res, { application }); };
exports.paymentHistory = async (req, res) => {
  const org = await runAccess(req, "payments.view"); if (!org) return fail(res, 403, "Organization access denied.");
  const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const { page: p, limit } = paging; const filter = { organization: org._id }; if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (filter.status && !["SUCCESS", "PENDING", "FAILED"].includes(filter.status)) return fail(res, 400, "Invalid payment status.");
  if (req.query.memberId) { if (!id(req.query.memberId)) return fail(res, 400, "Invalid member id."); const scopedMember = await OrganizationMember.findOne(scopedMemberFilter(org, req, { _id: req.query.memberId })).select("_id"); if (!scopedMember) return fail(res, 404, "Member not found."); filter.member = scopedMember._id; }
  if (req.query.branchId) { if (!id(req.query.branchId)) return fail(res, 400, "Invalid branch id."); if (!(await OrganizationBranch.exists({ _id: req.query.branchId, organization: org._id, active: true }))) return fail(res, 404, "Branch not found."); if (scopedId(req) && String(scopedId(req)) !== String(req.query.branchId)) return fail(res, 404, "Branch not found."); const branchMembers = await OrganizationMember.find({ organization: org._id, branch: req.query.branchId }).distinct("_id"); filter.member = filter.member ? (String(filter.member) && { $in: [filter.member].filter((m) => branchMembers.some((b) => String(b) === String(m))) }) : { $in: branchMembers }; }
  if (req.query.feeType) { const fees = await OrganizationFee.find({ organization: org._id, type: String(req.query.feeType).toUpperCase() }).distinct("_id"); const assignments = await OrganizationFeeAssignment.find({ organization: org._id, fee: { $in: fees } }).distinct("_id"); filter.assignment = { $in: assignments }; }
  if (scopedId(req) && !filter.member) filter.member = { $in: await OrganizationMember.find(scopedMemberFilter(org, req)).distinct("_id") };
  if (req.query.from || req.query.to) {
    const from = req.query.from && new Date(req.query.from); const to = req.query.to && new Date(req.query.to);
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return fail(res, 400, "Invalid payment date filter.");
    filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  }
  const [payments, total, summaryRows] = await Promise.all([OrganizationPayment.find(filter).sort({ createdAt: -1 }).skip((p - 1) * limit).limit(limit).populate({ path: "member", select: "membershipNumber year user", populate: { path: "user", select: "fullName" } }).populate({ path: "assignment", select: "billingPeriod status fee", populate: { path: "fee", select: "type name" } }).lean(), OrganizationPayment.countDocuments(filter), OrganizationPayment.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }])]);
  payments.forEach((payment) => { payment.memberName = payment.member?.user?.fullName || null; payment.membershipNumber = payment.member?.membershipNumber || null; payment.fee = payment.assignment?.fee || null; payment.method = null; payment.date = payment.createdAt || null; payment.channelAvailability = { inApp: false }; payment.fieldAvailability = { method: false }; });
  return ok(res, { payments, summary: summaryRows[0] ? { amount: summaryRows[0].amount, count: summaryRows[0].count } : { amount: 0, count: 0 }, pagination: pagination(p, limit, total) });
};
exports.messageMember = async (req, res) => {
  const org = await runAccess(req, "messages.send"); if (!org) return fail(res, 403, "Organization access denied.");
  if (!id(req.params.memberId)) return fail(res, 400, "Invalid member id.");
  const title = String(req.body.title || "").trim().slice(0, 180); const body = String(req.body.body || req.body.message || "").trim().slice(0, 1200);
  if (!title || !body) return fail(res, 400, "Message title and body are required.");
  const member = await OrganizationMember.findOne(scopedMemberFilter(org, req, { _id: req.params.memberId })).select("user membershipNumber");
  if (!member) return fail(res, 404, "Member not found.");
  let notification;
  try {
    notification = await createInAppNotification({ userId: member.user, title, message: body, type: "GENERAL", referenceType: "ORGANIZATION_MEMBER_MESSAGE", reference: String(member._id), dedupeKey: `organization-member-message:${org._id}:${member._id}:${req.get("X-Idempotency-Key") || Date.now()}` });
    if (!notification) return fail(res, 400, "Unable to create in-app notification.");
    await svc.audit(req, org, "MEMBER_MESSAGE_SENT", "OrganizationMember", member._id, { channel: "inApp" });
  } catch (e) { return fail(res, 400, "Unable to send member message."); }
  return ok(res, { message: { id: notification._id, memberId: member._id, channel: "inApp" }, channelAvailability: { inApp: true } });
};
exports.feeList = async (req, res) => { const org = await runAccess(req, "fees.create"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = { organization: org._id }; if (req.query.status !== undefined) { if (!["ACTIVE", "INACTIVE"].includes(String(req.query.status).toUpperCase())) return fail(res, 400, "Invalid fee status."); filter.active = String(req.query.status).toUpperCase() === "ACTIVE"; } const [fees, total] = await Promise.all([OrganizationFee.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(), OrganizationFee.countDocuments(filter)]); return ok(res, { fees, pagination: pagination(paging.page, paging.limit, total) }); };
exports.feeUpdate = async (req, res) => { const org = await runAccess(req, "fees.edit"); if (!org) return fail(res, 403, "Organization access denied."); if (!id(req.params.feeId)) return fail(res, 400, "Invalid fee id."); const update = {}; try { for (const key of ["name", "description", "amount", "frequency", "active", "type", "dueDate"]) if (req.body[key] !== undefined) update[key] = key === "amount" ? svc.normalizeMoney(req.body[key]) : req.body[key]; if (update.type !== undefined && !["REGISTRATION", "ANNUAL", "OTHER"].includes(String(update.type).toUpperCase())) return fail(res, 400, "Invalid fee type."); if (update.dueDate !== undefined && Number.isNaN(new Date(update.dueDate).getTime())) return fail(res, 400, "Invalid fee due date."); } catch (e) { return fail(res, e.status || 400, e.message); } const fee = await OrganizationFee.findOneAndUpdate({ _id: req.params.feeId, organization: org._id }, { $set: update }, { new: true, runValidators: true }); return fee ? ok(res, { fee }) : fail(res, 404, "Fee not found."); };
exports.feeAssignments = async (req, res) => {
  const org = await runAccess(req, "fees.create"); if (!org) return fail(res, 403, "Organization access denied.");
  const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination.");
  if (req.query.feeId && !id(req.query.feeId)) return fail(res, 400, "Invalid fee id.");
  const match = { organization: org._id, ...(req.query.feeId ? { fee: new mongoose.Types.ObjectId(req.query.feeId) } : {}), ...(req.query.status ? { status: String(req.query.status).toUpperCase() } : {}), ...(scopedId(req) ? { member: { $in: await OrganizationMember.find(scopedMemberFilter(org, req)).distinct("_id") } } : {}) };
  if (match.status && !["ASSIGNED", "PARTIAL", "PAID", "CANCELLED"].includes(match.status)) return fail(res, 400, "Invalid assignment status.");
  const [assignments, total, totals] = await Promise.all([
    OrganizationFeeAssignment.find(match).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("fee", "name type amount").populate({ path: "member", select: "membershipNumber branch" }).lean(),
    OrganizationFeeAssignment.countDocuments(match),
    OrganizationFeeAssignment.aggregate([{ $match: { ...match } }, { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
  ]);
  const aggregate = { paid: { count: 0, amount: 0 }, due: { count: 0, amount: 0 }, partial: { count: 0, amount: 0 }, outstanding: { count: 0, amount: 0 } };
  totals.forEach((row) => { const key = String(row._id).toLowerCase(); if (aggregate[key]) aggregate[key] = { count: row.count, amount: row.amount, amountBasis: key === "partial" ? "assigned" : "persisted" }; if (key === "assigned") { aggregate.due = { count: row.count, amount: row.amount }; aggregate.outstanding = { count: row.count, amount: row.amount, amountBasis: "persisted-assigned" }; } });
  return ok(res, { assignments, summary: aggregate, pagination: pagination(paging.page, paging.limit, total) });
};
exports.walletDetails = async (req, res) => { const org = await runAccess(req, "wallet.view"); if (!org) return fail(res, 403, "Organization access denied."); if (scopedId(req)) return fail(res, 403, "Wallet is available only at organization scope."); const wallet = await OrganizationWallet.findOne({ organization: org._id }).lean(); const ledger = await models.OrganizationLedger.find({ organization: org._id }).sort({ createdAt: -1 }).limit(100).lean(); const totals = await models.OrganizationLedger.aggregate([{ $match: { organization: org._id } }, { $group: { _id: "$type", total: { $sum: "$amount" } } }]); return ok(res, { wallet, ledger, totals, withdrawals: { available: false, reason: "Bank settlement is not enabled for organizations." } }); };
exports.branchList = async (req, res) => { const org = await runAccess(req, "branches.manage"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = { organization: org._id }; if (req.query.status !== undefined) { if (!["ACTIVE", "INACTIVE"].includes(String(req.query.status).toUpperCase())) return fail(res, 400, "Invalid branch status."); filter.active = String(req.query.status).toUpperCase() === "ACTIVE"; } const [branches, total] = await Promise.all([OrganizationBranch.find(filter).sort({ name: 1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(), OrganizationBranch.countDocuments(filter)]); const enriched = await Promise.all(branches.map(async (branch) => { const memberIds = await OrganizationMember.find({ organization: org._id, branch: branch._id }).distinct("_id"); const collections = await OrganizationPayment.aggregate([{ $match: { organization: org._id, status: "SUCCESS", member: { $in: memberIds } } }, { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }]); const admins = await OrganizationRole.find({ organization: org._id, branch: branch._id, active: true, role: "BRANCH_ADMIN" }).populate("user", "fullName email").select("role user").lean(); return { ...branch, membersCount: memberIds.length, successfulCollections: collections[0] || { amount: 0, count: 0 }, branchAdmins: admins }; })); return ok(res, { branches: enriched, pagination: pagination(paging.page, paging.limit, total) }); };
exports.branchUpdate = async (req, res) => { const org = await runAccess(req, "branches.manage"); if (!org) return fail(res, 403, "Organization access denied."); if (!id(req.params.branchId)) return fail(res, 400, "Invalid branch id."); const update = {}; for (const key of ["name", "code", "address", "active"]) if (req.body[key] !== undefined) update[key] = req.body[key]; const branch = await OrganizationBranch.findOneAndUpdate({ _id: req.params.branchId, organization: org._id }, { $set: update }, { new: true, runValidators: true }); return branch ? ok(res, { branch }) : fail(res, 404, "Branch not found."); };
exports.staffList = async (req, res) => { const org = await runAccess(req, "staff.manage"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = { organization: org._id }; if (req.query.status !== undefined) { if (!["ACTIVE", "INACTIVE"].includes(String(req.query.status).toUpperCase())) return fail(res, 400, "Invalid staff status."); filter.active = String(req.query.status).toUpperCase() === "ACTIVE"; } if (req.query.role) filter.role = String(req.query.role).toUpperCase(); const [staff, total] = await Promise.all([OrganizationRole.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("user", "fullName email phone").populate("branch", "name code").lean(), OrganizationRole.countDocuments(filter)]); return ok(res, { staff, pagination: pagination(paging.page, paging.limit, total) }); };
exports.staffUpdate = async (req, res) => {
  const org = await runAccess(req, "staff.manage"); if (!org) return fail(res, 403, "Organization access denied.");
  if (!id(req.params.staffId)) return fail(res, 400, "Invalid staff assignment id.");
  const current = await OrganizationRole.findOne({ _id: req.params.staffId, organization: org._id });
  if (!current || current.role === "OWNER") return fail(res, 404, "Staff assignment not found.");
  const role = String(req.body.role || current.role).toUpperCase();
  const allowedRoles = ["ADMIN", "TREASURER", "SECRETARY", "MEMBERSHIP_OFFICER", "AUDITOR", "BRANCH_ADMIN"];
  if (!allowedRoles.includes(role)) return fail(res, 400, "Invalid staff role.");
  const permissions = req.body.permissions === undefined ? (current.permissions?.length ? current.permissions : svc.ORGANIZATION_ROLE_CAPABILITIES[role]) : req.body.permissions;
  if (!Array.isArray(permissions) || permissions.some((p) => !svc.ORGANIZATION_PERMISSIONS.includes(p) || !svc.ORGANIZATION_ROLE_CAPABILITIES[role].includes(p))) return fail(res, 400, "Permissions exceed the selected role capabilities.");
  const actorPermissions = req.organizationAccess?.permissions || [];
  if (req.organizationAccess?.role?.role !== "OWNER" && permissions.some((p) => !actorPermissions.includes(p))) return fail(res, 403, "Cannot grant a permission you do not hold.");
  const update = { role, permissions };
  if (req.body.active !== undefined) update.active = Boolean(req.body.active);
  if (role === "BRANCH_ADMIN") {
    if (!id(req.body.branch || current.branch)) return fail(res, 400, "Branch admin must have a branch.");
    const branch = await OrganizationBranch.findOne({ _id: req.body.branch || current.branch, organization: org._id, active: true });
    if (!branch) return fail(res, 400, "Branch does not belong to this organization.");
    update.branch = branch._id;
  } else {
    if (req.body.branch !== undefined && req.body.branch !== null) return fail(res, 400, "Only branch admins may have a branch.");
    update.branch = null;
  }
  const staff = await OrganizationRole.findOneAndUpdate({ _id: current._id, organization: org._id, role: { $ne: "OWNER" } }, { $set: update }, { new: true, runValidators: true });
  return ok(res, { staff });
};
exports.announcementList = async (req, res) => { const org = await runAccess(req, "messages.send"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = { organization: org._id, ...(scopedId(req) ? { $or: [{ audience: "ALL" }, { audience: "BRANCH", branch: scopedId(req) }] } : {}) }; if (req.query.audience) { if (!["ALL", "MEMBERS", "STAFF", "BRANCH"].includes(String(req.query.audience).toUpperCase())) return fail(res, 400, "Invalid announcement audience."); filter.audience = String(req.query.audience).toUpperCase(); } const [announcements, total] = await Promise.all([OrganizationAnnouncement.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(), OrganizationAnnouncement.countDocuments(filter)]); return ok(res, { announcements, pagination: pagination(paging.page, paging.limit, total) }); };
exports.auditList = async (req, res) => { const org = await runAccess(req, "audit.view"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const filter = { organization: org._id }; if (req.query.action) filter.action = String(req.query.action); if (req.query.entityType) filter.entityType = String(req.query.entityType); if (req.query.actor) { if (!id(req.query.actor)) return fail(res, 400, "Invalid actor id."); filter.actor = req.query.actor; } if (req.query.from || req.query.to) { const from = req.query.from && new Date(req.query.from); const to = req.query.to && new Date(req.query.to); if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return fail(res, 400, "Invalid audit date."); filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) }; } const [audit, total] = await Promise.all([models.OrganizationAuditLog.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate("actor", "fullName email").lean(), models.OrganizationAuditLog.countDocuments(filter)]); return ok(res, { audit, pagination: pagination(paging.page, paging.limit, total) }); };
exports.cardList = async (req, res) => { const org = await runAccess(req, "cards.manage"); if (!org) return fail(res, 403, "Organization access denied."); const paging = page(req); if (!paging) return fail(res, 400, "Invalid pagination."); const memberIds = scopedId(req) ? await OrganizationMember.find(scopedMemberFilter(org, req)).distinct("_id") : undefined; const filter = { organization: org._id, ...(memberIds ? { member: { $in: memberIds } } : {}) }; const [cards, total] = await Promise.all([OrganizationMembershipCard.find(filter).sort({ createdAt: -1 }).skip((paging.page - 1) * paging.limit).limit(paging.limit).populate({ path: "member", select: "membershipNumber year status user", populate: { path: "user", select: "fullName" } }).lean(), OrganizationMembershipCard.countDocuments(filter)]); return ok(res, { cards, pagination: pagination(paging.page, paging.limit, total) }); };
exports.cardDetail = async (req, res) => { const org = await runAccess(req, "cards.manage"); if (!org) return fail(res, 403, "Organization access denied."); if (!id(req.params.cardId)) return fail(res, 400, "Invalid card id."); const card = await OrganizationMembershipCard.findOne({ _id: req.params.cardId, organization: org._id }).populate("member", "membershipNumber year status branch").lean(); if (!card || (scopedId(req) && String(card.member?.branch) !== String(scopedId(req)))) return fail(res, 404, "Card not found."); return ok(res, { card }); };
exports.report = async (req, res) => {
  const org = await runAccess(req, "reports.view");
  if (!org) return fail(res, 403, "Organization access denied.");
  const kind = String(req.query.kind || "overview").toLowerCase();
  const period = String(req.query.period || "all").toLowerCase();
  if (!["overview", "membership", "payments", "fees", "branches"].includes(kind)) return fail(res, 400, "Invalid report kind.");
  if (!["all", "month", "year"].includes(period)) return fail(res, 400, "Invalid report period.");

  const since = period === "month"
    ? new Date(Date.now() - 31 * 86400000)
    : period === "year"
      ? new Date(Date.now() - 366 * 86400000)
      : null;
  const scopedMembers = await OrganizationMember.find(scopedMemberFilter(org, req))
    .select("_id status category branch createdAt")
    .lean();
  const memberIds = scopedMembers.map((member) => member._id);
  const periodMembers = since
    ? scopedMembers.filter((member) => new Date(member.createdAt) >= since)
    : scopedMembers;
  const paymentMatch = {
    organization: org._id,
    ...(since ? { createdAt: { $gte: since } } : {}),
    ...(scopedId(req) ? { member: { $in: memberIds } } : {})
  };
  const assignmentMatch = {
    organization: org._id,
    ...(since ? { createdAt: { $gte: since } } : {}),
    ...(scopedId(req) ? { member: { $in: memberIds } } : {})
  };

  const byStatus = periodMembers.reduce((totals, member) => {
    totals[member.status] = (totals[member.status] || 0) + 1;
    return totals;
  }, {});
  if (kind === "membership") {
    const byCategory = periodMembers.reduce((totals, member) => {
      const category = member.category || "Uncategorized";
      totals[category] = (totals[category] || 0) + 1;
      return totals;
    }, {});
    const byBranch = periodMembers.reduce((totals, member) => {
      const branch = String(member.branch || "Unassigned");
      totals[branch] = (totals[branch] || 0) + 1;
      return totals;
    }, {});
    return ok(res, { report: { kind, period, memberCount: periodMembers.length, byStatus, byCategory, byBranch } });
  }

  const paymentTotals = await OrganizationPayment.aggregate([
    { $match: paymentMatch },
    { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }
  ]);
  if (kind === "payments") {
    return ok(res, {
      report: {
        kind,
        period,
        byStatus: Object.fromEntries(paymentTotals.map((row) => [row._id, { amount: row.amount, count: row.count }])),
        successful: paymentTotals.find((row) => row._id === "SUCCESS") || { amount: 0, count: 0 }
      }
    });
  }

  const assignmentTotals = await OrganizationFeeAssignment.aggregate([
    { $match: assignmentMatch },
    { $group: { _id: "$status", assignedAmount: { $sum: "$amount" }, count: { $sum: 1 } } }
  ]);
  if (kind === "fees") {
    const fees = await OrganizationFee.find({ organization: org._id })
      .select("name type amount frequency dueDate active")
      .sort({ createdAt: -1 })
      .lean();
    return ok(res, {
      report: {
        kind,
        period,
        fees,
        assignmentsByStatus: Object.fromEntries(assignmentTotals.map((row) => [row._id, { assignedAmount: row.assignedAmount, count: row.count }])),
        amountBasis: "persisted-assigned",
        nonAdditive: ["PARTIAL assignments do not expose remaining balances"]
      }
    });
  }

  if (kind === "branches") {
    const branches = await OrganizationBranch.find({
      organization: org._id,
      ...(scopedId(req) ? { _id: scopedId(req) } : {})
    }).select("name code active").lean();
    const rows = await Promise.all(branches.map(async (branch) => {
      const ids = scopedMembers.filter((member) => String(member.branch) === String(branch._id)).map((member) => member._id);
      const successful = await OrganizationPayment.aggregate([
        { $match: { ...paymentMatch, status: "SUCCESS", member: { $in: ids } } },
        { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } }
      ]);
      return { ...branch, membersCount: ids.length, successfulCollections: successful[0] || { amount: 0, count: 0 } };
    }));
    return ok(res, { report: { kind, period, branches: rows } });
  }

  return ok(res, {
    report: {
      kind,
      period,
      memberCount: periodMembers.length,
      byStatus,
      paymentsByStatus: Object.fromEntries(paymentTotals.map((row) => [row._id, { amount: row.amount, count: row.count }])),
      assignmentsByStatus: Object.fromEntries(assignmentTotals.map((row) => [row._id, { assignedAmount: row.assignedAmount, count: row.count }])),
      nonAdditive: ["Membership, payment, and assignment lifecycle totals are separate measures"]
    }
  });
};
exports.settingsGet = async (req, res) => { const org = await runAccess(req, "settings.manage"); if (!org) return fail(res, 403, "Organization access denied."); return ok(res, { settings: { name: org.name, description: org.description, contact: org.contact, state: org.state || "", lga: org.lga || "", type: org.type, annualFee: org.annualFee, registrationFee: org.registrationFee, renewalCycle: org.renewalCycle, membershipMode: org.membershipMode } }); };
exports.settingsPatch = async (req, res) => {
  const org = await runAccess(req, "settings.manage");
  if (!org) return fail(res, 403, "Organization access denied.");
  const update = {};
  for (const key of ["name", "description", "contact", "state", "lga", "annualFee", "registrationFee", "renewalCycle", "membershipMode"]) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  for (const key of ["annualFee", "registrationFee"]) {
    if (update[key] === undefined) continue;
    const amount = Number(update[key]);
    if (!Number.isFinite(amount) || amount < 0) return fail(res, 400, `${key} must be a non-negative amount.`);
    update[key] = Math.round((amount + Number.EPSILON) * 100) / 100;
  }
  if (update.contact !== undefined) {
    if (!update.contact || typeof update.contact !== "object" || Array.isArray(update.contact)) return fail(res, 400, "Contact must be an object.");
    if (Object.keys(update.contact).some((key) => !["phone", "email", "address"].includes(key))) return fail(res, 400, "Invalid contact field.");
    if (update.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(update.contact.email))) return fail(res, 400, "Invalid contact email.");
  }
  if (update.state !== undefined) update.state = svc.clean(update.state, 100);
  if (update.lga !== undefined) update.lga = svc.clean(update.lga, 100);
  if (update.renewalCycle !== undefined && !["ANNUAL", "MONTHLY", "NONE"].includes(update.renewalCycle)) return fail(res, 400, "Invalid renewal cycle.");
  if (update.membershipMode !== undefined && !["MANUAL", "AUTO"].includes(update.membershipMode)) return fail(res, 400, "Invalid membership mode.");
  Object.assign(org, update);
  try {
    await org.save();
  } catch (e) {
    return fail(res, 400, e.name === "ValidationError" ? "Invalid organization settings." : e.message);
  }
  await svc.audit(req, org, "ORGANIZATION_SETTINGS_UPDATED", "Organization", org._id, { fields: Object.keys(update) });
  return ok(res, { settings: update });
};
