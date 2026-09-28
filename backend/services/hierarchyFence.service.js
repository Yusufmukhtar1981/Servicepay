const mongoose = require("mongoose");
const User = require("../models/user.model");

const activeUser = {
  status: "ACTIVE",
  isDeleted: { $ne: true },
};

const versionCondition = (version) =>
  Number(version || 0) === 0
    ? { $in: [0, null] }
    : Number(version);

const bumpHierarchyVersion = async (user, session) => {
  const update = await User.updateOne(
    {
      _id: user._id,
      role: user.role,
      ...activeUser,
      hierarchyVersion: versionCondition(user.hierarchyVersion),
    },
    { $inc: { hierarchyVersion: 1 } },
    { session, timestamps: false },
  );
  if (update.matchedCount !== 1) {
    throw Object.assign(new Error("The reporting line changed during this operation. Refresh and retry."), {
      status: 409,
      code: "HIERARCHY_CHANGED",
    });
  }
};

const requireActiveParent = async (parentId, role, session) => {
  const parent = await User.findOne({
    _id: parentId,
    role,
    ...activeUser,
  }).session(session).select("+hierarchyVersion").lean();
  if (!parent) {
    throw Object.assign(new Error("The selected parent is no longer active."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  await bumpHierarchyVersion(parent, session);
  return parent;
};

const requireActiveLineage = async (user, session) => {
  const zone = String(user.zone || "").trim();
  if (!zone) {
    throw Object.assign(new Error("The parent has no verified zone."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  if (user.role === "ZONAL_MANAGER") return { zone };

  const state = String(user.state || "").trim();
  if (!state || !user.zonalManagerId) {
    throw Object.assign(new Error("The parent has incomplete state or zone lineage."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  const zonal = await User.findOne({
    _id: user.zonalManagerId,
    role: "ZONAL_MANAGER",
    ...activeUser,
    zone,
  }).session(session).select("_id").lean();
  if (!zonal) {
    throw Object.assign(new Error("The parent's active Zonal Manager could not be verified."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  if (user.role === "STATE_MANAGER") {
    return { zone, state, zonalManagerId: zonal._id };
  }
  if (user.role !== "AGENT" || !user.stateManagerId) {
    throw Object.assign(new Error("The parent is not a verified Aggregator (legacy AGENT)."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  const stateManager = await User.findOne({
    _id: user.stateManagerId,
    role: "STATE_MANAGER",
    ...activeUser,
    zone,
    state,
    zonalManagerId: zonal._id,
  }).session(session).select("_id").lean();
  if (!stateManager) {
    throw Object.assign(new Error("The parent's active State Manager could not be verified."), {
      status: 409,
      code: "HIERARCHY_PARENT_INVALID",
    });
  }
  return { zone, state, zonalManagerId: zonal._id, stateManagerId: stateManager._id };
};

const withParentFence = async (parentId, role, callback) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const parent = await requireActiveParent(parentId, role, session);
      const lineage = await requireActiveLineage(parent, session);
      await callback(parent, lineage, session);
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  bumpHierarchyVersion,
  requireActiveParent,
  requireActiveLineage,
  withParentFence,
};