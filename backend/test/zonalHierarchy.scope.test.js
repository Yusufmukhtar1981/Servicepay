/*
 * Isolated scope tests intentionally avoid MongoMemoryReplSet.  They exercise
 * the fail-closed lineage algorithm with the same model-shaped query surface,
 * so they remain runnable when the test runner cannot reserve /tmp for a
 * replica set.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const { getZonalScope } = require("../services/zonalScope.service");

const id = () => new mongoose.Types.ObjectId();
const query = (value) => ({ lean: async () => value });

test("zonal scope isolates two zones and rejects conflicting lineage", async (t) => {
  const z1 = id(), z2 = id(), sm1 = id(), sm2 = id(), a1 = id(), a2 = id();
  const c1 = id(), cross = id(), conflict = id();
  const rows = [
    { _id: z1, role: "ZONAL_MANAGER", zone: "NORTH", status: "ACTIVE", isDeleted: false },
    { _id: z2, role: "ZONAL_MANAGER", zone: "SOUTH", status: "ACTIVE", isDeleted: false },
    { _id: sm1, role: "STATE_MANAGER", zone: "NORTH", state: "KADUNA", zonalManagerId: z1, status: "ACTIVE", isDeleted: false },
    { _id: sm2, role: "STATE_MANAGER", zone: "SOUTH", state: "KADUNA", zonalManagerId: z2, status: "ACTIVE", isDeleted: false },
    { _id: a1, role: "AGENT", zone: "NORTH", state: "KADUNA", stateManagerId: sm1, zonalManagerId: z1, status: "ACTIVE", isDeleted: false },
    { _id: a2, role: "AGENT", zone: "SOUTH", state: "KADUNA", stateManagerId: sm2, zonalManagerId: z2, status: "ACTIVE", isDeleted: false },
    { _id: c1, role: "CUSTOMER", zone: "NORTH", state: "KADUNA", agentId: a1, stateManagerId: sm1, zonalManagerId: z1, status: "ACTIVE", isDeleted: false },
    // A guessed foreign customer whose agent reference points into this zone
    // must still be denied because its own zone/manager lineage conflicts.
    { _id: cross, role: "CUSTOMER", zone: "SOUTH", state: "KADUNA", agentId: a1, stateManagerId: sm1, zonalManagerId: z2, status: "ACTIVE", isDeleted: false },
    { _id: conflict, role: "CUSTOMER", zone: "NORTH", state: "KADUNA", agentId: a1, stateManagerId: sm2, zonalManagerId: z1, status: "ACTIVE", isDeleted: false },
  ];
  const originalFindOne = User.findOne, originalFind = User.find;
  t.after(() => { User.findOne = originalFindOne; User.find = originalFind; });
  User.findOne = (filter) => query(rows.find((r) => String(r._id) === String(filter._id) &&
    (!filter.role || r.role === filter.role) && (!filter.zone || r.zone === filter.zone)));
  User.find = (filter) => query(rows.filter((r) => {
    if (filter.role && r.role !== filter.role) return false;
    if (filter.zone && r.zone !== filter.zone) return false;
    if (filter.zonalManagerId && String(r.zonalManagerId) !== String(filter.zonalManagerId)) return false;
    if (filter.stateManagerId?.$in && !filter.stateManagerId.$in.some((x) => String(x) === String(r.stateManagerId))) return false;
    if (filter.agentId?.$in && !filter.agentId.$in.some((x) => String(x) === String(r.agentId))) return false;
    if (filter.$or && !filter.$or.some((part) =>
      part.agentId?.$in?.some((x) => String(x) === String(r.agentId)) ||
      (part.stateManagerId?.$in?.some((x) => String(x) === String(r.stateManagerId)) && part.agentId === null))) return false;
    return r.isDeleted !== true;
  }));
  const scope = await getZonalScope(rows[0]);
  assert.deepEqual(scope.stateManagerIds, [String(sm1)]);
  assert.deepEqual(scope.agentIds, [String(a1)]);
  assert.deepEqual(scope.customerIds, [String(c1)]);
  assert.equal(scope.customerIds.includes(String(cross)), false);
  assert.equal(scope.customerIds.includes(String(conflict)), false);
});

test("strict scope includes customers safely reparented from an agent to its promoted manager", async (t) => {
  const z = id(), sm = id(), promoted = id(), customer = id();
  const rows = [
    { _id: z, role: "ZONAL_MANAGER", zone: "NORTH", status: "ACTIVE", isDeleted: false },
    { _id: sm, role: "STATE_MANAGER", zone: "NORTH", state: "KADUNA", zonalManagerId: z, status: "ACTIVE", isDeleted: false },
    { _id: promoted, role: "STATE_MANAGER", zone: "NORTH", state: "KADUNA", zonalManagerId: z, promotionParentId: sm, status: "ACTIVE", isDeleted: false },
    { _id: customer, role: "CUSTOMER", zone: "NORTH", state: "KADUNA", agentId: null, stateManagerId: promoted, zonalManagerId: z, status: "ACTIVE", isDeleted: false },
  ];
  const originalFindOne = User.findOne, originalFind = User.find;
  t.after(() => { User.findOne = originalFindOne; User.find = originalFind; });
  User.findOne = (filter) => query(rows.find((r) => String(r._id) === String(filter._id) && (!filter.role || r.role === filter.role)));
  User.find = (filter) => query(rows.filter((r) => {
    if (filter.role && r.role !== filter.role) return false;
    if (filter.zone && r.zone !== filter.zone) return false;
    if (filter.zonalManagerId && String(r.zonalManagerId) !== String(filter.zonalManagerId)) return false;
    if (filter.stateManagerId?.$in && !filter.stateManagerId.$in.some((x) => String(x) === String(r.stateManagerId))) return false;
    if (filter.$or && !filter.$or.some((part) => part.stateManagerId?.$in?.some((x) => String(x) === String(r.stateManagerId)) && part.agentId === null)) return false;
    return r.isDeleted !== true;
  }));
  const scope = await getZonalScope(rows[0]);
  assert.ok(scope.stateManagerIds.includes(String(promoted)));
  assert.ok(scope.customerIds.includes(String(customer)));
});

test("suspended assigned descendants remain visible while deleted descendants do not", async (t) => {
  const z = id(), sm = id(), agent = id(), suspendedCustomer = id(), deletedAgent = id();
  const rows = [
    { _id: z, role: "ZONAL_MANAGER", zone: "NORTH", status: "ACTIVE", isDeleted: false },
    { _id: sm, role: "STATE_MANAGER", zone: "NORTH", state: "KADUNA", zonalManagerId: z, status: "SUSPENDED", isDeleted: false },
    { _id: agent, role: "AGENT", zone: "NORTH", state: "KADUNA", stateManagerId: sm, zonalManagerId: z, status: "BLOCKED", isDeleted: false },
    { _id: suspendedCustomer, role: "CUSTOMER", zone: "NORTH", state: "KADUNA", agentId: agent, stateManagerId: sm, zonalManagerId: z, status: "SUSPENDED", isDeleted: false },
    { _id: deletedAgent, role: "AGENT", zone: "NORTH", state: "KADUNA", stateManagerId: sm, zonalManagerId: z, status: "ACTIVE", isDeleted: true },
  ];
  const originalFindOne = User.findOne, originalFind = User.find;
  t.after(() => { User.findOne = originalFindOne; User.find = originalFind; });
  User.findOne = (filter) => query(rows.find((r) => String(r._id) === String(filter._id) &&
    (!filter.role || r.role === filter.role) && (!filter.zone || r.zone === filter.zone) &&
    r.isDeleted !== true));
  User.find = (filter) => query(rows.filter((r) => {
    if (filter.role && r.role !== filter.role) return false;
    if (filter.zone && r.zone !== filter.zone) return false;
    if (filter.zonalManagerId && String(r.zonalManagerId) !== String(filter.zonalManagerId)) return false;
    if (filter.stateManagerId?.$in && !filter.stateManagerId.$in.some((x) => String(x) === String(r.stateManagerId))) return false;
    if (filter.agentId?.$in && !filter.agentId.$in.some((x) => String(x) === String(r.agentId))) return false;
    if (filter.$or && !filter.$or.some((part) =>
      part.agentId?.$in?.some((x) => String(x) === String(r.agentId)) ||
      (part.stateManagerId?.$in?.some((x) => String(x) === String(r.stateManagerId)) && part.agentId === null))) return false;
    return r.isDeleted !== true;
  }));
  const scope = await getZonalScope(rows[0]);
  assert.deepEqual(scope.stateManagerIds, [String(sm)]);
  assert.deepEqual(scope.agentIds, [String(agent)]);
  assert.deepEqual(scope.customerIds, [String(suspendedCustomer)]);
  assert.equal(scope.agentIds.includes(String(deletedAgent)), false);
});

test("legacy missing zone metadata is accepted only through a complete parent chain", async (t) => {
  const z = id(), sm = id(), agent = id(), valid = id(), conflicting = id();
  const rows = [
    { _id: z, role: "ZONAL_MANAGER", zone: "NORTH", status: "ACTIVE", isDeleted: false },
    { _id: sm, role: "STATE_MANAGER", zonalManagerId: z, status: "ACTIVE", isDeleted: false },
    { _id: agent, role: "AGENT", stateManagerId: sm, status: "ACTIVE", isDeleted: false },
    { _id: valid, role: "CUSTOMER", agentId: agent, stateManagerId: sm, status: "ACTIVE", isDeleted: false },
    { _id: conflicting, role: "CUSTOMER", zone: "SOUTH", agentId: agent, stateManagerId: sm, status: "ACTIVE", isDeleted: false },
  ];
  const originalFindOne = User.findOne, originalFind = User.find;
  t.after(() => { User.findOne = originalFindOne; User.find = originalFind; });
  User.findOne = (filter) => query(rows.find((r) => String(r._id) === String(filter._id) && (!filter.role || r.role === filter.role) && r.isDeleted !== true));
  User.find = (filter) => query(rows.filter((r) => {
    if (filter.role && r.role !== filter.role) return false;
    if (filter.zonalManagerId && String(r.zonalManagerId) !== String(filter.zonalManagerId)) return false;
    if (filter.stateManagerId?.$in && !filter.stateManagerId.$in.some((x) => String(x) === String(r.stateManagerId))) return false;
    if (filter.$or && !filter.$or.some((part) => part.agentId?.$in?.some((x) => String(x) === String(r.agentId)))) return false;
    return r.isDeleted !== true;
  }));
  const scope = await getZonalScope(rows[0]);
  assert.deepEqual(scope.customerIds, [String(valid)]);
});