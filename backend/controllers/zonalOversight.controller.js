const mongoose = require("mongoose");
const { protect } = require("../middleware/auth.middleware");
const zonalScopeService = require("../services/zonalScope.service");
const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const Transaction = require("../models/transaction.model");
const EduPaySchool = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const { Organization } = require("../models/organizations.models");

const idList = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const oid = (value) => String(value);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pagination = (req) => ({
  page: Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1)),
  limit: Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 20)),
});
const scopeQuery = (scope) => {
  const stateManagerIds = idList(scope && scope.stateManagerIds);
  const agentIds = idList(scope && scope.agentIds);
  const customerIds = idList(scope && scope.customerIds);
  return { stateManagerIds, agentIds, customerIds };
};
// Transactions are customer-owned records.  Manager/agent references are
// historical denormalized metadata and must never broaden a zone.
const transactionQuery = (scope) => ({
  customerId: { $in: scope.customerIds },
});
const deliverySummary = (scope) => Delivery.aggregate([
  // Aggregation does not perform Mongoose's normal ObjectId casting.
  { $match: { customerId: { $in: scope.customerIds
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value)) } } },
  { $group: {
    _id: null,
    total: { $sum: 1 },
    pending: { $sum: { $cond: [{ $eq: ["$status", "PENDING"] }, 1, 0] } },
    inProgress: { $sum: { $cond: [{ $in: ["$status", ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"]] }, 1, 0] } },
    completed: { $sum: { $cond: [{ $eq: ["$status", "DELIVERED"] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } },
    cancelled: { $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] } },
    totalValue: { $sum: { $ifNull: ["$deliveryFee", 0] } },
  } },
  { $limit: 1 },
]);
const projection = {
  delivery: "_id trackingNumber customerId branchId pickupState deliveryState status createdAt updatedAt",
  edupay: "_id name schoolCode schoolType state lga status active stateManagerId createdAt updatedAt",
  empowerment: "_id name organizationType registrationNumber state lga status verificationStatus createdBy createdAt updatedAt",
  organizations: "_id name slug code type description status organizationType registrationStatus country state lga createdBy createdAt updatedAt",
};
const requestProjection = "_id schoolName state status stateManagerId school createdAt updatedAt";

function authorized(req, res, next) {
  if (!req.user || String(req.user.role || "").toUpperCase() !== "ZONAL_MANAGER") {
    return res.status(403).json({ success: false, message: "Zonal manager access required." });
  }
  return next();
}

// This middleware is exported for mounting applications which already use protect.
exports.middleware = [protect, authorized];

async function customerCreators(ids) {
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids }, role: "CUSTOMER" }).select("_id").lean();
  return users.map((user) => user._id);
}

async function zonalEduPayItems(scope, search) {
  const text = search ? new RegExp(escapeRegex(search), "i") : null;
  const schoolQuery = {
    stateManagerId: { $in: scope.stateManagerIds },
    ...(text && { $or: [{ name: text }, { schoolCode: text }, { state: text }] }),
  };
  const requestQuery = {
    stateManagerId: { $in: scope.stateManagerIds },
    status: { $in: ["PENDING_REVIEW", "CONTACTED"] },
    ...(text && { $or: [{ schoolName: text }, { state: text }, { status: text }] }),
  };
  const [schools, requests] = await Promise.all([
    EduPaySchool.find(schoolQuery).select(projection.edupay).lean(),
    SchoolRequest.find(requestQuery).select(requestProjection).lean(),
  ]);
  const schoolIds = new Set(schools.map((school) => String(school._id)));
  // A request becomes a school after approval. Do not show the same
  // submission twice when its request retains the approved school reference.
  const pending = requests
    .filter((request) => !request.school || !schoolIds.has(String(request.school)))
    .map((request) => ({
      _id: request._id,
      schoolName: request.schoolName,
      state: request.state,
      status: request.status,
      stateManagerId: request.stateManagerId,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    }));
  return [...schools, ...pending].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function sectionSpec(section, scope, search) {
  const text = search ? new RegExp(escapeRegex(search), "i") : null;
  switch (section) {
    case "delivery":
      return { model: Delivery, query: { customerId: { $in: scope.customerIds }, ...(text && { $or: [{ trackingNumber: text }, { status: text }] }) }, select: projection.delivery };
    case "edupay":
      return { model: EduPaySchool, query: { stateManagerId: { $in: scope.stateManagerIds }, ...(text && { $or: [{ name: text }, { schoolCode: text }, { state: text }] }) }, select: projection.edupay };
    case "empowerment":
      return { model: EmpowermentOrganization, query: { createdBy: { $in: scope.customerIds }, ...(text && { $or: [{ name: text }, { state: text }, { organizationType: text }] }) }, select: projection.empowerment };
    case "organizations":
      return { model: Organization, query: { createdBy: { $in: scope.customerIds }, ...(text && { $or: [{ name: text }, { slug: text }, { code: text }, { type: text }] }) }, select: projection.organizations };
    default:
      return null;
  }
}

exports.getOverview = async (req, res, next) => {
  try {
    const scope = scopeQuery(await zonalScopeService.getZonalScope(req.user));
    const creators = await customerCreators(scope.customerIds);
    const [stateManagers, aggregators, customers, transactions, deliveries, edupayItems, empowerment, organizations, deliveryRollup] = await Promise.all([
      User.countDocuments({ _id: { $in: scope.stateManagerIds }, role: "STATE_MANAGER" }),
      User.countDocuments({ _id: { $in: scope.agentIds }, role: { $in: ["AGENT", "AGGREGATOR"] } }),
      User.countDocuments({ _id: { $in: scope.customerIds }, role: "CUSTOMER" }),
      Transaction.countDocuments(transactionQuery(scope)),
      Delivery.countDocuments({ customerId: { $in: scope.customerIds } }),
      // EduPay overview counts each authorized persisted school plus each
      // still-pending request, excluding requests already linked to a school.
      zonalEduPayItems(scope).then((items) => items.length),
      EmpowermentOrganization.countDocuments({ createdBy: { $in: creators } }),
      Organization.countDocuments({ createdBy: { $in: creators } }),
      deliverySummary(scope),
    ]);
    const summary = deliveryRollup[0] || { total: 0, pending: 0, inProgress: 0, completed: 0, failed: 0, cancelled: 0, totalValue: 0 };
    return res.json({ stateManagers, aggregators, customers, transactions, deliveries, deliverySummary: summary, edupaySchools: edupayItems, empowerment, organizations });
  } catch (error) { return next(error); }
};

exports.list = async (req, res, next) => {
  try {
    const scope = scopeQuery(await zonalScopeService.getZonalScope(req.user));
    if (req.params.section === "edupay") {
      const items = await zonalEduPayItems(scope, req.query.search);
      const { page, limit } = pagination(req);
      return res.json({ items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit });
    }
    const spec = sectionSpec(req.params.section, scope, req.query.search);
    if (!spec) return res.status(404).json({ success: false, message: "Unknown oversight section." });
    // Creator fields are restricted to actual CUSTOMER users, not merely IDs
    // that happen to appear in a stale scope document.
    if (req.params.section === "empowerment" || req.params.section === "organizations") {
      spec.query.createdBy = { $in: await customerCreators(scope.customerIds) };
    }
    const { page, limit } = pagination(req);
    const [items, total] = await Promise.all([
      spec.model.find(spec.query).select(spec.select).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      spec.model.countDocuments(spec.query),
    ]);
    return res.json({ items, total, page, limit });
  } catch (error) { return next(error); }
};

exports.getOne = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }
    const scope = scopeQuery(await zonalScopeService.getZonalScope(req.user));
    if (req.params.section === "edupay") {
      const items = await zonalEduPayItems(scope);
      const item = items.find((candidate) => String(candidate._id) === String(req.params.id));
      if (item) return res.json({ item });
      if (await SchoolRequest.exists({ _id: req.params.id }) || await EduPaySchool.exists({ _id: req.params.id })) {
        return res.status(403).json({ success: false, message: "Record is outside your zone." });
      }
      return res.status(404).json({ success: false, message: "Record not found." });
    }
    const spec = sectionSpec(req.params.section, scope);
    if (!spec) return res.status(404).json({ success: false, message: "Unknown oversight section." });
    if (req.params.section === "empowerment" || req.params.section === "organizations") {
      spec.query.createdBy = { $in: await customerCreators(scope.customerIds) };
    }
    const item = await spec.model.findOne({ ...spec.query, _id: req.params.id }).select(spec.select).lean();
    if (item) return res.json({ item });
    // Deliberately distinguish a valid but out-of-zone identifier from a
    // missing record without returning any fields from that record.
    if (await spec.model.exists({ _id: req.params.id })) {
      return res.status(403).json({ success: false, message: "Record is outside your zone." });
    }
    return res.status(404).json({ success: false, message: "Record not found." });
  } catch (error) { return next(error); }
};