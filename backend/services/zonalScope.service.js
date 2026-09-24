const mongoose = require("mongoose");
const User = require("../models/user.model");

const ACTIVE = { isDeleted: { $ne: true }, status: "ACTIVE" };
// Scope is visibility, not mutation authorization. Suspended/blocked assigned
// users remain visible for oversight and history, provided their lineage is
// still intact and the account was not deleted.
const ASSIGNED = { isDeleted: { $ne: true } };
const id = (value) => (value ? String(value) : "");
const oid = (value) => mongoose.Types.ObjectId.isValid(value) ? value : null;

/*
 * A scope is deliberately assembled from verified parent links rather than
 * from a single $or query.  This prevents a stale/conflicting reference from
 * leaking a user from another zone.
 */
async function getZonalScope(user) {
  const actor = user && await User.findOne({ _id: oid(user._id || user.id), ...ACTIVE }).lean();
  if (!actor || !actor.zone) return { stateManagerIds: [], agentIds: [], customerIds: [] };
  const role = String(actor.role || "").toUpperCase();
  if (!["ZONAL_MANAGER", "STATE_MANAGER", "AGENT"].includes(role)) {
    return { stateManagerIds: [], agentIds: [], customerIds: [] };
  }
  const zone = actor.zone;
  const smMap = new Map(), agentMap = new Map(), customerMap = new Map();
  // Legacy accounts may not have been backfilled with zone/state/manager
  // metadata. Their required parent IDs remain authoritative; optional
  // metadata is accepted when absent, but never when it conflicts.
  const same = (row, field, value) => row && row[field] && id(row[field]) === id(value) &&
    row.isDeleted !== true;
  const optional = (row, field, value) =>
    row[field] === undefined || row[field] === null || row[field] === "" ||
    value === undefined || value === null || value === "" || row[field] === value;
  const optionalId = (row, field, value) =>
    row[field] === undefined || row[field] === null || row[field] === "" || id(row[field]) === id(value);

  let sms = [];
  if (role === "ZONAL_MANAGER") {
    sms = await User.find({ ...ASSIGNED, role: "STATE_MANAGER", zonalManagerId: actor._id }).lean();
  } else if (role === "STATE_MANAGER") {
    const parent = await User.findOne({ ...ASSIGNED, _id: actor.zonalManagerId, role: "ZONAL_MANAGER", zone }).lean();
    if (parent) sms = [actor];
  }
  for (const sm of sms) if (optional(sm, "zone", zone) &&
    (role !== "ZONAL_MANAGER" || same(sm, "zonalManagerId", actor._id))) smMap.set(id(sm._id), sm);

  let agents = [];
  if (role === "AGENT") {
    // An agent is also a valid scope root when this service is used by
    // downstream callers; verify the complete parent chain before returning it.
    const parent = await User.findOne({
      ...ASSIGNED, _id: actor.stateManagerId, role: "STATE_MANAGER",
      zone, zonalManagerId: actor.zonalManagerId,
    }).lean();
    if (parent && parent.state === actor.state) {
      smMap.set(id(parent._id), parent);
      agents = [actor];
    }
  }
  else {
    const smIds = [...smMap.values()].map((x) => x._id);
    if (smIds.length) agents = await User.find({ ...ASSIGNED, role: "AGENT", stateManagerId: { $in: smIds } }).lean();
  }
  for (const agent of agents) {
    const sm = smMap.get(id(agent.stateManagerId));
    if (!sm || !optional(agent, "zone", zone) || !optional(agent, "state", sm.state) ||
      !optionalId(agent, "zonalManagerId", sm.zonalManagerId) ||
      !same(agent, "stateManagerId", sm._id)) continue;
    agentMap.set(id(agent._id), agent);
  }

  const agentIds = [...agentMap.values()].map((x) => x._id);
  const smIds = [...smMap.values()].map((x) => x._id);
  if (agentIds.length || smIds.length) {
    const lineage = [];
    if (agentIds.length) lineage.push({ agentId: { $in: agentIds } });
    if (smIds.length) lineage.push({ stateManagerId: { $in: smIds }, agentId: null });
    const customers = await User.find({ ...ASSIGNED, role: "CUSTOMER", $or: lineage }).lean();
    for (const customer of customers) {
      const agent = agentMap.get(id(customer.agentId));
      const sm = smMap.get(id(customer.stateManagerId));
      const validAgentChild = agent && optional(customer, "zone", zone) &&
        optional(customer, "state", agent.state) &&
        same(customer, "agentId", agent._id) &&
        optionalId(customer, "stateManagerId", agent.stateManagerId);
      const validStateManagerChild = !customer.agentId && sm &&
        optional(customer, "zone", zone) && optional(customer, "state", sm.state) &&
        same(customer, "stateManagerId", sm._id);
      if ((!validAgentChild && !validStateManagerChild) ||
        !optionalId(customer, "zonalManagerId", agent ? smMap.get(id(agent.stateManagerId))?.zonalManagerId : sm?.zonalManagerId) ||
        (customer.zonalManagerId && id(customer.zonalManagerId) !== id(actor._id) && role === "ZONAL_MANAGER")) continue;
      customerMap.set(id(customer._id), customer);
    }
  }
  return {
    stateManagerIds: [...smMap.keys()],
    agentIds: [...agentMap.keys()],
    customerIds: [...customerMap.keys()],
  };
}

module.exports = { getZonalScope };