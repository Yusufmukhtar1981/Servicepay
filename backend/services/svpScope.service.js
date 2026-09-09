const User = require("../models/user.model");
const mongoose = require("mongoose");
const TYPES = Object.freeze(["GLOBAL", "REGION", "STATE", "BRANCHES", "DEPARTMENT", "PRODUCTS", "CUSTOM"]);
const objectId = (value) => mongoose.Types.ObjectId.isValid(value);
const ids = (values) => [...new Set((values || []).map(String))];

const normalizeScope = (source = {}) => {
  const type = String(source.type || "").trim().toUpperCase();
  if (!TYPES.includes(type)) throw new Error("Invalid SVP scope type.");
  const scope = { type };
  if (type === "REGION") scope.region = String(source.region || "").trim();
  if (type === "STATE") scope.state = String(source.state || "").trim();
  if (type === "DEPARTMENT") scope.department = String(source.department || "").trim().toUpperCase();
  if (type === "BRANCHES") scope.branchIds = ids(source.branchIds);
  if (type === "PRODUCTS") scope.products = ids(source.products).map((value) => value.toUpperCase());
  if (type === "CUSTOM") scope.filters = source.filters;
  if ((type === "REGION" && !scope.region) || (type === "STATE" && !scope.state) ||
      (type === "DEPARTMENT" && !scope.department) || (["BRANCHES", "PRODUCTS"].includes(type) && !scope[type === "BRANCHES" ? "branchIds" : "products"].length)) throw new Error(`A value is required for ${type} scope.`);
  if (type === "BRANCHES" && scope.branchIds.some((value) => !objectId(value))) throw new Error("branchIds must be valid ids.");
  if (type === "CUSTOM") {
    const filters = scope.filters;
    const allowed = ["region", "state", "branchIds", "products", "staffIds", "customerIds", "riderIds"];
    if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).some((key) => !allowed.includes(key))) throw new Error("CUSTOM scope filters are invalid.");
    if (filters.branchIds && (!Array.isArray(filters.branchIds) || filters.branchIds.some((value) => !objectId(value)))) throw new Error("CUSTOM branchIds are invalid.");
    ["staffIds", "customerIds", "riderIds"].forEach((key) => { if (filters[key] && (!Array.isArray(filters[key]) || filters[key].some((value) => !objectId(value)))) throw new Error(`CUSTOM ${key} are invalid.`); });
  }
  return scope;
};

// Returns an explicit deny filter where a requested domain cannot be mapped.
const filterFor = async (scope, domain) => {
  const deny = { _id: { $exists: false } };
  if (!scope || !TYPES.includes(scope.type)) return deny;
  if (scope.type === "GLOBAL") return {};
  const f = scope.type === "CUSTOM" ? (scope.filters || {}) : scope;
  if (domain === "transaction") {
    const filter = {};
    if (scope.type === "BRANCHES" || (Array.isArray(f.branchIds) && f.branchIds.length)) filter.branchId = { $in: scope.branchIds || f.branchIds };
    if (scope.type === "PRODUCTS" || (Array.isArray(f.products) && f.products.length)) filter.serviceType = { $in: scope.products || f.products };
    if (f.staffIds) filter.agentId = { $in: f.staffIds };
    if (f.customerIds) filter.customerId = { $in: f.customerIds };
    if (f.riderIds) return deny; // Transaction has no trustworthy rider field.
    if (scope.type === "DEPARTMENT") {
      const staff = await User.find({ department: scope.department, isStaff: true }).distinct("_id");
      return { agentId: { $in: staff } };
    }
    if (scope.type === "STATE" || scope.type === "REGION" || f.state || f.region) {
      const users = await User.find({ ...(scope.type === "STATE" ? { state: scope.state } : {}), ...(scope.type === "REGION" ? { zone: scope.region } : {}), ...(f.state ? { state: f.state } : {}), ...(f.region ? { zone: f.region } : {}) }).distinct("_id");
      filter.customerId = { $in: users };
    }
    return Object.keys(filter).length ? filter : deny;
  }
  if (domain === "user") {
    if (scope.type === "REGION") return { zone: scope.region };
    if (scope.type === "STATE") return { state: scope.state };
    if (scope.type === "BRANCHES") return { branchId: { $in: scope.branchIds } };
    if (scope.type === "DEPARTMENT") return { department: scope.department };
    if (scope.type === "CUSTOM") return f.customerIds ? { _id: { $in: f.customerIds } } : f.staffIds ? { _id: { $in: f.staffIds } } : f.riderIds ? { _id: { $in: f.riderIds } } : deny;
    return deny; // product scope is not a User ownership dimension.
  }
  if (domain === "branch") {
    if (scope.type === "BRANCHES") return { _id: { $in: scope.branchIds } };
    if (scope.type === "STATE") return { state: scope.state };
    if (scope.type === "CUSTOM" && f.branchIds) return { _id: { $in: f.branchIds } };
    return deny;
  }
  return deny;
};
module.exports = { SVP_SCOPE_TYPES: TYPES, normalizeScope, filterFor };