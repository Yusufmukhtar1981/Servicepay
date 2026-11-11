// Operational extensions reuse existing records. No financial mutations or new
// collections: all writes are narrow and audited in the same Mongo transaction.
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const Product = require("../models/marketplace.model");
const Merchant = require("../models/marketplaceMerchant.model");
const Order = require("../models/marketplaceOrder.model");
const Audit = require("../models/adminAuditLog.model");
const enterprise = require("../services/operationsEnterprise.service");
const fail = enterprise.fail;
const permission = (req, key) => enterprise.permitted(req, key);
const wrap = fn => async (req, res) => {
  try {
    if (!enterprise.operational(req)) throw fail(403, "Global Operations Manager access required.");
    res.set("Cache-Control", "no-store");
    return await fn(req, res);
  } catch (e) {
    return res.status(e.statusCode || 503).json({ success: false,
      message: e.statusCode ? e.message : "Operational records are temporarily unavailable." });
  }
};
const check = (req, p) => { if (!permission(req, p)) throw fail(403, `Permission required: ${p}`); };
const pagination = query => {
  const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
const search = value => {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 120) throw fail(400, "Search must be at most 120 characters.");
  return new RegExp(value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
};
const group = model => model.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 });
const counts = rows => Object.fromEntries(rows.map(r => [r._id || "UNKNOWN", r.count]));
exports.hub = wrap(async (req, res) => {
  const permissions = {
    profileEdit: permission(req, "users.update"),
    deliveryView: permission(req, "delivery.view"),
    marketplaceView: permission(req, "marketplace.view"),
    marketplaceModerate: permission(req, "marketplace.moderate"),
    staffView: permission(req, "operations.staff.view"),
  };
  const [customers, deliveries, products, staff] = await Promise.all([
    User.aggregate([{ $match: { role: "CUSTOMER", isDeleted: { $ne: true } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }),
    permissions.deliveryView ? group(Delivery) : null,
    permissions.marketplaceView ? group(Product) : null,
    permissions.staffView ? User.aggregate([{ $match: {
      role: { $in: ["ZONAL_MANAGER", "STATE_MANAGER", "AGENT"] }, isDeleted: { $ne: true },
    } }, { $group: { _id: "$role", count: { $sum: 1 } } }]).option({ maxTimeMS: 5000 }) : null,
  ]);
  const c = counts(customers), total = customers.reduce((s, v) => s + v.count, 0);
  const people = staff ? counts(staff) : null;
  return res.json({ success: true, data: {
    customers: { total, active: c.ACTIVE || 0, inactive: total - (c.ACTIVE || 0) },
    deliveries: deliveries ? counts(deliveries) : null, products: products ? counts(products) : null,
    staff: people ? { ZONAL_MANAGER: people.ZONAL_MANAGER || 0, STATE_MANAGER: people.STATE_MANAGER || 0,
      AGGREGATOR: people.AGENT || 0 } : null, permissions,
  } });
});
exports.directory = wrap(async (req, res) => {
  check(req, "operations.staff.view");
  // AGENT is the established database role for Aggregators, not a new role.
  const roles = { ZONAL_MANAGER: "ZONAL_MANAGER", STATE_MANAGER: "STATE_MANAGER", AGGREGATOR: "AGENT" };
  const role = roles[req.query.role];
  if (!role) throw fail(400, "Select ZONAL_MANAGER, STATE_MANAGER or AGGREGATOR.");
  const { page, limit, skip } = pagination(req.query), q = search(req.query.q);
  const filter = { role, isDeleted: { $ne: true } };
  if (q) filter.$or = ["fullName", "phone", "email", "zone", "state", "lga"].map(k => ({ [k]: q }));
  if (req.query.parentId) {
    if (!mongoose.isValidObjectId(req.query.parentId)) throw fail(400, "Invalid parent ID.");
    if (role === "STATE_MANAGER") filter.zonalManagerId = req.query.parentId;
    else if (role === "AGENT") filter.stateManagerId = req.query.parentId;
    else throw fail(400, "Zonal Managers have no inferred parent.");
  }
  const [items, total] = await Promise.all([
    User.find(filter).select("_id fullName phone email zone state lga status zonalManagerId stateManagerId createdAt")
      .populate({ path: "zonalManagerId", select: "_id fullName role", match: { role: "ZONAL_MANAGER" } })
      .populate({ path: "stateManagerId", select: "_id fullName role", match: { role: "STATE_MANAGER" } })
      .sort({ fullName: 1, _id: 1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    User.countDocuments(filter).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
});
exports.activity = wrap(async (req, res) => {
  const periods = { day: 1, week: 7, month: 30, year: 365 }, period = req.query.period || "month";
  if (!Object.hasOwn(periods, period)) throw fail(400, "Invalid period.");
  const { page, limit, skip } = pagination(req.query);
  // Only operational actions; never recovery secrets, KYC documents or finance payloads.
  const filter = { createdAt: { $gte: new Date(Date.now() - periods[period] * 86400000) },
    $or: [{ action: "USER_PROFILE_UPDATED" }, { action: "USER_STATUS_UPDATED" },
      { action: "FINTECH_OPERATION", "metadata.module": "OPERATIONS_MARKETPLACE" }] };
  const [items, total] = await Promise.all([
    Audit.find(filter).select("_id action actorName reason targetUserName createdAt")
      .sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    Audit.countDocuments(filter).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit) } });
});
exports.marketplace = wrap(async (req, res) => {
  check(req, "marketplace.view");
  const kind = req.query.kind || "sellers";
  if (!["sellers", "orders"].includes(kind)) throw fail(400, "Select sellers or orders.");
  const { page, limit, skip } = pagination(req.query), q = search(req.query.q), filter = {};
  const sellers = kind === "sellers";
  const Model = sellers ? Merchant : Order;
  if (q) filter.$or = (sellers ? ["storeName", "phone", "email"] : ["orderReference", "customerName", "customerPhone"])
    .map(k => ({ [k]: q }));
  const fields = sellers ? "_id user storeName status phone email state createdAt" :
    "_id orderReference customerName orderStatus createdAt totalAmount";
  const [items, total] = await Promise.all([
    Model.find(filter).select(fields).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    Model.countDocuments(filter).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { items: items.map(v => sellers ? v : { ...v, status: v.orderStatus }),
    total, page, pages: Math.ceil(total / limit) } });
});
exports.sellerStatus = wrap(async (req, res) => {
  check(req, "marketplace.moderate");
  const { status, expectedStatus } = req.body || {}, reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const statuses = ["ACTIVE", "SUSPENDED", "REJECTED", "PENDING"];
  if (!mongoose.isValidObjectId(req.params.id) || !statuses.includes(status) ||
      !statuses.includes(expectedStatus) || reason.length < 10 || reason.length > 500)
    throw fail(400, "Valid seller, expected status and a reason of 10–500 characters are required.");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const seller = await Merchant.findOneAndUpdate({ _id: req.params.id, status: expectedStatus },
        { $set: { status } }, { session, returnDocument: "after", runValidators: true });
      if (!seller) throw fail(409, "Seller state changed. Refresh before retrying.");
      await Audit.create([{ actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName,
        action: "FINTECH_OPERATION", reason,
        metadata: { module: "OPERATIONS_MARKETPLACE", sellerId: String(seller._id), previousStatus: expectedStatus, status },
      }], { session });
    });
  } finally { await session.endSession(); }
  return res.json({ success: true, data: { id: req.params.id, status } });
});
exports.report = wrap(async (req, res) => {
  if (!permission(req, "reports.export") && !permission(req, "operations.reports.export"))
    throw fail(403, "Operational report export permission required.");
  const periods = { day: 1, week: 7, month: 30, year: 365 };
  const period = req.query.period || "month", type = req.query.type || "customers";
  if (!Object.hasOwn(periods, period)) throw fail(400, "Invalid report period.");
  const date = { $gte: new Date(Date.now() - periods[period] * 86400000) };
  const definitions = {
    customers: { model: User, filter: { role: "CUSTOMER", createdAt: date },
      fields: "fullName status createdAt", permission: "users.view" },
    "profile-changes": { model: Audit, filter: { action: "USER_PROFILE_UPDATED", createdAt: date },
      fields: "actorName targetUserName reason createdAt", permission: "users.view" },
    deliveries: { model: Delivery, filter: { createdAt: date },
      fields: "trackingNumber status createdAt updatedAt assignedRiderId", permission: "delivery.view" },
    marketplace: { model: Audit, filter: { action: "FINTECH_OPERATION", "metadata.module": "OPERATIONS_MARKETPLACE", createdAt: date },
      fields: "actorName reason createdAt metadata.productId metadata.sellerId metadata.previousStatus metadata.status",
      permission: "marketplace.view" },
    staff: { model: Audit, filter: { createdAt: date },
      fields: "actorName actorRole action createdAt", permission: "operations.staff.view" },
  };
  if (!Object.hasOwn(definitions, type)) throw fail(400, "Invalid operational report.");
  const definition = definitions[type];
  check(req, definition.permission);
  const rows = await definition.model.find(definition.filter).select(definition.fields)
    .sort({ createdAt: -1, _id: -1 }).limit(10001).maxTimeMS(10000).lean();
  if (rows.length > 10000) throw fail(422, "Report exceeds 10,000 records. Choose a shorter period; no partial export was produced.");
  const columns = definition.fields.split(" ");
  const cell = value => {
    let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+@\-\t\r\n]/.test(text.trimStart())) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const body = [columns.join(","), ...rows.map(row => columns.map(key =>
    cell(key.split(".").reduce((v, k) => v?.[k], row))).join(","))].join("\r\n");
  await Audit.create([{ actorId: req.user._id, actorRole: req.user.role, actorName: req.user.fullName,
    action: "FINANCIAL_REPORT_EXPORTED", reason: "Operational CSV export",
    metadata: { module: "OPERATIONS_REPORTS", type, period, rowCount: rows.length },
  }]);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="servicepay-operations-${type}-${period}.csv"`);
  return res.send("\ufeff" + body);
});
exports._test = { pagination, search };
