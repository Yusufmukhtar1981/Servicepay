const mongoose = require("mongoose");
const BusinessPartnerProfile = require("../models/businessPartnerProfile.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarOfficer = require("../models/solarOfficer.model");
const PhoneApplication = require("../models/phoneApplication.model");
// Register referenced models before using populate. This route is also mounted
// independently in integration consumers, so registration cannot rely on an
// unrelated feature controller having been loaded first.
require("../models/solarPackage.model");
require("../models/phoneProduct.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");

const text = (value, max = 500) => String(value || "").trim().slice(0, max);
const isId = (value) => mongoose.Types.ObjectId.isValid(value);
const problem = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const activeStatuses = ["SUBMITTED", "UNDER_REVIEW"];

const service = (value) => {
  const result = text(value, 20).toUpperCase();
  if (!["SOLAR", "PHONE"].includes(result)) throw problem("service must be SOLAR or PHONE.", 400);
  return result;
};
const resourceId = (body = {}) => text(body.resourceId || body.applicationId, 80);
const assignmentId = (type, id) => `${type}-${id}`;
const parseAssignmentId = (value) => {
  const match = /^(SOLAR|PHONE)-([a-f\d]{24})$/i.exec(text(value, 40));
  if (!match) throw problem("Invalid assignment ID.", 400);
  return { service: match[1].toUpperCase(), id: match[2] };
};
const approved = (partner, type) =>
  partner.status === "ACTIVE" &&
  partner.services?.includes(type) &&
  partner.permissions?.includes(type === "SOLAR" ? "SOLAR_ASSIGNMENT" : "PHONE_ASSIGNMENT");

async function partnerFor(partnerId, type, session) {
  if (!isId(partnerId)) throw problem("Valid partnerId is required.", 400);
  const partner = await BusinessPartnerProfile.findById(partnerId).session(session || null);
  if (!partner) throw problem("Business Partner not found.", 404);
  if (!approved(partner, type)) throw problem("Business Partner is not active and approved for this service.", 403);
  return partner;
}
async function audit(req, action, reason, newData, session) {
  return Audit.create([{
    actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName || "",
    action, reason, newData, requestMethod: req.method, requestPath: req.originalUrl,
  }], { session });
}
const solarOfficerDto = (officer) => ({
  id: String(officer._id), service: "SOLAR", officerCode: officer.officerId,
  fullName: officer.user?.fullName || "", phone: officer.user?.phone || "",
  email: officer.user?.email || "", status: officer.status,
});
const phoneOfficerDto = (officer) => ({
  id: String(officer._id), service: "PHONE", officerCode: officer.staffId || "",
  fullName: officer.fullName, phone: officer.phone, email: officer.email, status: officer.status,
});
const appDto = (type, app) => ({
  id: String(app._id), resourceId: String(app._id), service: type, reference: app.reference || String(app._id),
  status: app.status, customer: app.customer ? {
    id: String(app.customer._id || app.customer), fullName: app.customer.fullName || "", phone: app.customer.phone || "",
  } : null,
  item: type === "SOLAR"
    ? { name: app.package?.name || app.packageSnapshot?.name || "" }
    : { name: app.product?.name || app.productSnapshot?.name || "", sku: app.product?.sku || app.productSnapshot?.sku || "" },
  createdAt: app.createdAt,
});
const assignmentDto = (type, app, current, officer) => ({
  id: assignmentId(type, String(current._id || app._id)),
  service: type, resource: appDto(type, app), officer: type === "SOLAR" ? solarOfficerDto(officer) : phoneOfficerDto(officer),
  assignedAt: current.assignedAt || app.assignmentSnapshot?.assignedAt || app.updatedAt,
});

async function activeOfficer(partner, type, officerId, session) {
  if (!isId(officerId)) throw problem("Valid officerId is required.", 400);
  if (type === "SOLAR") {
    const officer = await SolarOfficer.findById(officerId).populate("user", "fullName phone email status").session(session);
    if (!officer) throw problem("Solar Officer not found.", 404);
    if (String(officer.businessPartner || "") !== String(partner._id)) throw problem("Officer belongs to another Business Partner.", 403);
    if (officer.status !== "ACTIVE" || officer.user?.status !== "ACTIVE") throw problem("Officer is not active.", 409);
    // A write provides transaction conflict protection against deactivation.
    return SolarOfficer.findOneAndUpdate({ _id: officer._id, businessPartner: partner._id, status: "ACTIVE" }, { $set: { updatedAt: new Date() } }, { new: true, session }).populate("user", "fullName phone email status");
  }
  const officer = await User.findById(officerId).session(session);
  if (!officer || officer.role !== "PHONE_FINANCING_OFFICER") throw problem("Phone Financing Officer not found.", 404);
  if (String(officer.businessPartnerId || "") !== String(partner._id)) throw problem("Officer belongs to another Business Partner.", 403);
  if (officer.status !== "ACTIVE") throw problem("Officer is not active.", 409);
  return User.findOneAndUpdate({ _id: officer._id, role: "PHONE_FINANCING_OFFICER", businessPartnerId: partner._id, status: "ACTIVE" }, { $set: { updatedAt: new Date() } }, { new: true, session });
}

async function ownedApplication(partner, type, id, session) {
  if (!isId(id)) throw problem("Valid resourceId is required.", 400);
  const Model = type === "SOLAR" ? SolarApplication : PhoneApplication;
  const app = await Model.findById(id).session(session);
  if (!app) throw problem(`${type === "SOLAR" ? "Solar" : "Phone"} application not found.`, 404);
  if (app.businessPartner && String(app.businessPartner) !== String(partner._id)) throw problem("Application belongs to another Business Partner.", 403);
  if (!app.businessPartner) app.businessPartner = partner._id;
  if (!activeStatuses.includes(app.status)) throw problem("This application is not eligible for officer assignment.", 409);
  return app;
}

exports.getPartnerAssignments = async (req, res) => {
  try {
    if (!isId(req.params.partnerId)) throw problem("Valid partnerId is required.", 400);
    const partner = await BusinessPartnerProfile.findById(req.params.partnerId).lean();
    if (!partner) throw problem("Business Partner not found.", 404);
    const [solarOfficers, phoneOfficers, solarAssignments, phoneApps] = await Promise.all([
      SolarOfficer.find({ businessPartner: partner._id, status: "ACTIVE" }).populate("user", "fullName phone email status").lean(),
      User.find({ businessPartnerId: partner._id, role: "PHONE_FINANCING_OFFICER", status: "ACTIVE" }).select("fullName phone email staffId status").lean(),
      SolarAssignment.find({ status: "ACTIVE" }).populate("application").populate({ path: "officer", populate: { path: "user", select: "fullName phone email status" } }).lean(),
      PhoneApplication.find({ businessPartner: partner._id, assignmentState: "ACTIVE" }).populate("customer", "fullName phone").populate("product", "name sku").populate("assignedOfficer", "fullName phone email staffId status businessPartnerId").lean(),
    ]);
    const solar = solarAssignments.filter((row) => String(row.officer?.businessPartner || "") === String(partner._id) && row.application)
      .map((row) => assignmentDto("SOLAR", row.application, row, row.officer));
    const phone = phoneApps.filter((app) => app.assignedOfficer && String(app.assignedOfficer.businessPartnerId || "") === String(partner._id))
      .map((app) => assignmentDto("PHONE", app, app, app.assignedOfficer));
    res.json({ success: true, partner: { id: String(partner._id), partnerId: partner.partnerId, businessName: partner.businessName }, officers: { solar: solarOfficers.map(solarOfficerDto), phone: phoneOfficers.map(phoneOfficerDto) }, assignments: { solar, phone } });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
};

exports.getCatalog = async (req, res) => {
  try {
    const type = service(req.query.service);
    const partner = await partnerFor(req.query.partnerId, type);
    const Model = type === "SOLAR" ? SolarApplication : PhoneApplication;
    const filter = { status: { $in: activeStatuses }, $or: [{ businessPartner: null }, { businessPartner: partner._id }] };
    if (type === "PHONE") filter.assignmentState = "UNASSIGNED";
    const applications = await Model.find(filter).populate("customer", "fullName phone").populate(type === "SOLAR" ? "package" : "product", "name sku").sort({ createdAt: -1 }).lean();
    if (type === "SOLAR") {
      const assigned = await SolarAssignment.distinct("application", { status: "ACTIVE", application: { $in: applications.map((x) => x._id) } });
      const set = new Set(assigned.map(String));
      return res.json({ success: true, service: type, resources: applications.filter((app) => !set.has(String(app._id))).map((app) => appDto(type, app)) });
    }
    return res.json({ success: true, service: type, resources: applications.map((app) => appDto(type, app)) });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); }
};

exports.assign = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      const type = service(req.body?.service);
      const partner = await partnerFor(req.body?.partnerId, type, session);
      const app = await ownedApplication(partner, type, resourceId(req.body), session);
      const officer = await activeOfficer(partner, type, req.body?.officerId, session);
      if (type === "SOLAR") {
        if (await SolarAssignment.exists({ application: app._id, status: "ACTIVE" }).session(session)) throw problem("Application already has an active assignment.", 409);
        const current = (await SolarAssignment.create([{ application: app._id, customer: app.customer, officer: officer._id, assignedBy: req.user._id, note: text(req.body?.note) }], { session }))[0];
        await app.save({ session }); output = assignmentDto(type, app, current, officer);
        await Notification.create([{ userId: officer.user, title: "Solar application assigned", message: "You have a new solar application assignment.", type: "BUSINESS_PARTNER", referenceId: app._id, referenceType: "AdminAssignment" }], { session });
      } else {
        if (app.assignmentState === "ACTIVE") throw problem("Application already has an active assignment.", 409);
        app.assignedOfficer = officer._id; app.assignmentState = "ACTIVE"; app.assignmentVersion = (app.assignmentVersion || 0) + 1;
        app.assignmentSnapshot = { officerId: String(officer._id), staffId: officer.staffId || "", fullName: officer.fullName, assignedBy: String(req.user._id), assignedAt: new Date(), assignmentVersion: app.assignmentVersion };
        app.assignmentTimeline.push({ action: "ASSIGNED", officer: officer._id, officerSnapshot: app.assignmentSnapshot, assignedBy: req.user._id, note: text(req.body?.note), assignmentVersion: app.assignmentVersion });
        await app.save({ session }); output = assignmentDto(type, app, app, officer);
        await Notification.create([{ userId: officer._id, title: "Phone application assigned", message: `You have been assigned ${app.reference}.`, type: "PHONE", referenceId: app._id, referenceType: "AdminAssignment" }], { session });
      }
      await audit(req, "ADMIN_PARTNER_ASSIGNMENT_CREATED", "Assigned application through Head Office workbench", { partnerId: String(partner._id), applicationId: String(app._id), service: type, officerId: String(officer._id) }, session);
    });
    res.status(201).json({ success: true, assignment: output });
  } catch (error) { res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({ success: false, message: error.message }); } finally { await session.endSession(); }
};

async function activeAssignmentForMutation(encodedId, session) {
  const parsed = parseAssignmentId(encodedId);
  if (parsed.service === "SOLAR") {
    const current = await SolarAssignment.findOne({ _id: parsed.id, status: "ACTIVE" })
      .populate("application").session(session);
    if (!current || !current.application) throw problem("Active Solar assignment not found.", 404);
    return { ...parsed, current, app: current.application };
  }
  const app = await PhoneApplication.findOne({ _id: parsed.id, assignmentState: "ACTIVE" }).session(session);
  if (!app) throw problem("Active Phone assignment not found.", 404);
  return { ...parsed, current: app, app };
}

exports.reassign = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let output;
    await session.withTransaction(async () => {
      const item = await activeAssignmentForMutation(req.params.assignmentId, session);
      if (!item.app.businessPartner) throw problem("Assignment does not belong to a Business Partner.", 403);
      const partner = await partnerFor(item.app.businessPartner, item.service, session);
      const officer = await activeOfficer(partner, item.service, req.body?.officerId, session);
      if (String(item.current.officer || item.app.assignedOfficer) === String(officer._id)) {
        throw problem("Application is already assigned to this officer.", 409);
      }
      if (item.service === "SOLAR") {
        item.current.status = "REASSIGNED"; item.current.endedAt = new Date();
        await item.current.save({ session });
        const current = (await SolarAssignment.create([{ application: item.app._id, customer: item.app.customer, officer: officer._id, assignedBy: req.user._id, note: text(req.body?.note) }], { session }))[0];
        output = assignmentDto("SOLAR", item.app, current, officer);
        await Notification.create([{ userId: officer.user, title: "Solar application reassigned", message: "A solar application was reassigned to you.", type: "BUSINESS_PARTNER", referenceId: item.app._id, referenceType: "AdminAssignment" }], { session });
      } else {
        const previous = item.app.assignedOfficer;
        item.app.assignedOfficer = officer._id; item.app.assignmentVersion = (item.app.assignmentVersion || 0) + 1;
        const snapshot = { officerId: String(officer._id), staffId: officer.staffId || "", fullName: officer.fullName, assignedBy: String(req.user._id), assignedAt: new Date(), assignmentVersion: item.app.assignmentVersion };
        item.app.assignmentSnapshot = snapshot;
        item.app.assignmentTimeline.push({ action: "REASSIGNED", officer: officer._id, officerSnapshot: snapshot, assignedBy: req.user._id, note: text(req.body?.note), assignmentVersion: item.app.assignmentVersion });
        await item.app.save({ session }); output = assignmentDto("PHONE", item.app, item.app, officer);
        await Notification.create([{ userId: officer._id, title: "Phone application reassigned", message: `You have been assigned ${item.app.reference}.`, type: "PHONE", referenceId: item.app._id, referenceType: "AdminAssignment" }], { session });
        // Keep the prior ID solely in the audit record; no customer data is exposed.
        item.previousOfficer = previous;
      }
      await audit(req, "ADMIN_PARTNER_ASSIGNMENT_REASSIGNED", "Reassigned application through Head Office workbench", { partnerId: String(partner._id), applicationId: String(item.app._id), service: item.service, officerId: String(officer._id) }, session);
    });
    res.json({ success: true, assignment: output });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); } finally { await session.endSession(); }
};

exports.unassign = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const item = await activeAssignmentForMutation(req.params.assignmentId, session);
      if (!item.app.businessPartner) throw problem("Assignment does not belong to a Business Partner.", 403);
      const partner = await partnerFor(item.app.businessPartner, item.service, session);
      if (item.service === "SOLAR") {
        item.current.status = "ENDED"; item.current.endedAt = new Date();
        await item.current.save({ session });
      } else {
        const formerOfficer = item.app.assignedOfficer;
        item.app.assignmentState = "UNASSIGNED"; item.app.assignmentVersion = (item.app.assignmentVersion || 0) + 1;
        item.app.assignmentTimeline.push({ action: "UNASSIGNED", officer: formerOfficer, officerSnapshot: item.app.assignmentSnapshot || null, assignedBy: req.user._id, note: text(req.body?.note), assignmentVersion: item.app.assignmentVersion });
        // Preserve assignedOfficer/snapshot for history, but authorization is
        // governed by assignmentState and is now irrevocably inactive.
        await item.app.save({ session });
      }
      result = { id: req.params.assignmentId, service: item.service, resourceId: String(item.app._id), unassigned: true };
      await audit(req, "ADMIN_PARTNER_ASSIGNMENT_UNASSIGNED", "Unassigned application through Head Office workbench", { partnerId: String(partner._id), applicationId: String(item.app._id), service: item.service }, session);
    });
    res.json({ success: true, assignment: result });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); } finally { await session.endSession(); }
};