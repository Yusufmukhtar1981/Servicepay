const mongoose = require("mongoose");
const User = require("../models/user.model");
const { normalizeRole } = require("../middleware/auth.middleware");

const AUDIENCE_KINDS = new Set([
  "ALL_CUSTOMERS",
  "ACTIVE_CUSTOMERS",
  "SELECTED_CUSTOMERS",
  "ROLE",
]);

const normalizeAudience = (audience) => {
  if (!audience || typeof audience !== "object") {
    throw new Error("An audience is required.");
  }
  const kind = String(audience.kind || "").trim().toUpperCase();
  if (!AUDIENCE_KINDS.has(kind)) {
    throw new Error("Invalid audience kind.");
  }
  const result = { kind };
  if (kind === "ROLE") {
    const role = normalizeRole(audience.role);
    if (!role) throw new Error("A role is required for a role audience.");
    result.role = role;
  }
  if (kind === "SELECTED_CUSTOMERS") {
    if (!Array.isArray(audience.userIds) || !audience.userIds.length) {
      throw new Error("At least one customer must be selected.");
    }
    if (audience.userIds.length > 500) {
      throw new Error("A maximum of 500 recipients is allowed.");
    }
    const ids = [...new Set(audience.userIds.map(String))];
    if (ids.some((id) => !mongoose.isValidObjectId(id))) {
      throw new Error("One or more selected customer IDs are invalid.");
    }
    result.userIds = ids;
  }
  return result;
};

const resolveAudience = async (audience) => {
  const normalized = normalizeAudience(audience);
  const filter = {};
  if (normalized.kind === "ALL_CUSTOMERS") filter.role = "CUSTOMER";
  if (normalized.kind === "ACTIVE_CUSTOMERS") {
    filter.role = "CUSTOMER";
    filter.status = "ACTIVE";
  }
  if (normalized.kind === "SELECTED_CUSTOMERS") {
    filter.role = "CUSTOMER";
    filter._id = { $in: normalized.userIds };
  }
  if (normalized.kind === "ROLE") filter.role = normalized.role;

  const users = await User.find(filter)
    .select("_id fullName email role status")
    .lean();
  if (users.length > 500) {
    throw new Error("This audience exceeds the maximum of 500 recipients.");
  }
  return { audience: normalized, users };
};

module.exports = { AUDIENCE_KINDS, normalizeAudience, resolveAudience };