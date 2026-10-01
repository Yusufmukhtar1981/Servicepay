const mongoose = require("mongoose");
const User = require("../models/user.model");
const { getZonalScope } = require("./zonalScope.service");
const {
  requireActiveParent,
  requireActiveLineage,
} = require("./hierarchyFence.service");

const GLOBAL_ROLES = new Set([
  "HEAD_OFFICE",
  "HEAD_OFFICE_ADMIN",
  "ADMIN",
  "SUPER_ADMIN",
  "SERVICEPAY_SUPER_ADMIN",
]);
const MANAGER_ROLES = new Set(["ZONAL_MANAGER", "STATE_MANAGER", "AGENT"]);
const active = { status: "ACTIVE", isDeleted: { $ne: true } };
const stringId = (value) => value ? String(value) : "";
const objectId = (value) => mongoose.Types.ObjectId.isValid(value) ? value : null;

/**
 * Record ownership is recalculated from the live manager tree. Saved manager
 * snapshots on a record are never used to discover or extend this tree.
 */
async function getManagedRecordScope(user) {
  const actor = user && await User.findOne({
    _id: objectId(user._id || user.id),
    ...active,
  }).lean();
  if (!actor) {
    return { actor: null, global: false, aggregatorIds: [], stateManagerIds: [], customerIds: [] };
  }
  const role = String(actor.role || "").toUpperCase();
  if (GLOBAL_ROLES.has(role)) {
    return { actor, global: true, aggregatorIds: [], stateManagerIds: [], customerIds: [] };
  }
  if (!MANAGER_ROLES.has(role)) {
    return { actor, global: false, aggregatorIds: [], stateManagerIds: [], customerIds: [] };
  }
  const tree = await getZonalScope(actor);
  return {
    actor,
    global: false,
    // AGENT is the actual legacy role for Aggregator accounts.
    aggregatorIds: tree.agentIds || [],
    stateManagerIds: tree.stateManagerIds || [],
    customerIds: tree.customerIds || [],
  };
}

/**
 * Build a record filter from current, verified owner IDs. Legacy creator
 * fallback is deliberately restricted to records without an aggregatorId;
 * historical State/Zonal Manager snapshots cannot independently grant access.
 */
function managedRecordFilter(scope, {
  creatorField = "createdBy",
  aggregatorField = "aggregatorId",
  stateManagerField = null,
  includeLegacyCustomers = false,
  includeLegacyStateManagers = false,
} = {}) {
  if (scope?.global === true) return {};

  const aggregatorIds = Array.isArray(scope?.aggregatorIds) ? scope.aggregatorIds.filter(Boolean) : [];
  const customerIds = Array.isArray(scope?.customerIds) ? scope.customerIds.filter(Boolean) : [];
  const stateManagerIds = Array.isArray(scope?.stateManagerIds) ? scope.stateManagerIds.filter(Boolean) : [];
  const agentActor = String(scope?.actor?.role || "").toUpperCase() === "AGENT";
  const branches = [];

  if (aggregatorIds.length) branches.push({ [aggregatorField]: { $in: aggregatorIds } });

  // A legacy record created directly by an Aggregator remains visible when
  // its new aggregatorId is absent. Its creator must be a current verified
  // Aggregator ID, not merely a saved manager snapshot.
  if (aggregatorIds.length) {
    branches.push({
      [creatorField]: { $in: aggregatorIds },
      [aggregatorField]: null,
    });
  }

  // Agents own only their own records. In particular, their scope includes a
  // parent State Manager and agentless State-Manager customers, but that
  // parent audience must never be inherited by an Agent record filter.
  if (!agentActor && includeLegacyCustomers && customerIds.length) {
    branches.push({
      [creatorField]: { $in: customerIds },
      [aggregatorField]: null,
    });
  }

  // Direct State Manager-created legacy records are accepted only when the
  // creator is itself a currently scoped State Manager. The duplicate
  // stateManagerField check rejects inconsistent records and snapshots alone
  // never establish ownership.
  if (!agentActor && includeLegacyStateManagers && stateManagerField && stateManagerIds.length) {
    branches.push({
      [creatorField]: { $in: stateManagerIds },
      $or: [
        { [stateManagerField]: { $in: stateManagerIds } },
        { [stateManagerField]: null },
      ],
      [aggregatorField]: null,
    });
  }

  if (!branches.length) return { _id: { $in: [] } };
  return branches.length === 1 ? branches[0] : { $or: branches };
}

function conflict(message, status = 409, code = "HIERARCHY_PARENT_INVALID") {
  return Object.assign(new Error(message), { status, code });
}

/**
 * Execute an Aggregator-owned creation while holding hierarchy version fences
 * for the live AGENT, State Manager, and Zonal Manager documents.
 */
async function withAggregatorRecordCreation(user, callback) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const actorId = objectId(user && (user._id || user.id));
      if (!actorId) throw conflict("A valid active Aggregator is required.", 403, "AGGREGATOR_REQUIRED");

      const actor = await requireActiveParent(actorId, "AGENT", session);
      if (!actor.stateManagerId || !actor.zonalManagerId || !String(actor.state || "").trim() || !String(actor.zone || "").trim()) {
        throw conflict("The Aggregator has incomplete State Manager or Zonal Manager lineage.");
      }

      const stateManager = await requireActiveParent(actor.stateManagerId, "STATE_MANAGER", session);
      const zonalManager = await requireActiveParent(stateManager.zonalManagerId, "ZONAL_MANAGER", session);
      if (stringId(stateManager._id) !== stringId(actor.stateManagerId) ||
          stringId(zonalManager._id) !== stringId(actor.zonalManagerId) ||
          stringId(stateManager.zonalManagerId) !== stringId(zonalManager._id) ||
          stateManager.zone !== actor.zone || stateManager.state !== actor.state ||
          zonalManager.zone !== actor.zone) {
        throw conflict("The Aggregator's current parent lineage could not be verified.");
      }

      const verifiedLineage = await requireActiveLineage(actor, session);
      if (stringId(verifiedLineage.stateManagerId) !== stringId(stateManager._id) ||
          stringId(verifiedLineage.zonalManagerId) !== stringId(zonalManager._id)) {
        throw conflict("The Aggregator's current parent lineage changed.");
      }

      const ownership = {
        createdBy: actor._id,
        createdByRole: "AGENT",
        aggregatorId: actor._id,
        stateManagerId: stateManager._id,
        zonalManagerId: zonalManager._id,
      };
      result = await callback(ownership, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  getManagedRecordScope,
  managedRecordFilter,
  withAggregatorRecordCreation,
};