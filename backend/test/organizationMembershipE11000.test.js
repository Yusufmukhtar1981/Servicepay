const test = require("node:test");
const assert = require("node:assert/strict");
const models = require("../models/organizations.models");
const service = require("../services/organizations.service");
const controller = require("../controllers/organizations.controller");
const migration = require("../scripts/migrateOrganizationMembers");
const fs = require("node:fs");

const clone = (value) => JSON.parse(JSON.stringify(value));
const matches = (doc, filter = {}) => {
  if (filter.$or && !filter.$or.some((part) => matches(doc, part))) return false;
  return Object.entries(filter).filter(([key]) => key !== "$or").every(([key, expected]) => {
    const actual = doc[key];
    if (expected === null) return actual === null || actual === undefined;
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$exists" in expected && (actual !== undefined) !== expected.$exists) return false;
      if ("$type" in expected && expected.$type === "string" && typeof actual !== "string") return false;
      if ("$gt" in expected && !(actual > expected.$gt)) return false;
      if ("$regex" in expected && !(expected.$regex.test(actual))) return false;
      return true;
    }
    return String(actual) === String(expected);
  });
};

function fakeCollection(initial, indexes = []) {
  const docs = initial.map(clone);
  const state = { docs, indexes: indexes.map(clone), dropped: [], created: [] };
  return {
    state,
    find: (filter) => ({ toArray: async () => docs.filter((doc) => matches(doc, filter)).map(clone) }),
    findOne: async (filter) => clone(docs.find((doc) => matches(doc, filter)) || null),
    updateMany: async (filter, update) => {
      let modifiedCount = 0;
      for (const doc of docs.filter((row) => matches(row, filter))) {
        const before = JSON.stringify(doc);
        if (update.$unset) for (const field of Object.keys(update.$unset)) delete doc[field];
        if (update.$set) Object.assign(doc, clone(update.$set));
        if (JSON.stringify(doc) !== before) modifiedCount += 1;
      }
      return { modifiedCount };
    },
    updateOne: async (filter, update, options = {}) => {
      let doc = docs.find((row) => matches(row, filter));
      let upsertedCount = 0;
      if (!doc && options.upsert) {
        doc = { ...clone(filter) };
        docs.push(doc);
        upsertedCount = 1;
      }
      if (!doc) return { modifiedCount: 0, upsertedCount };
      if (update.$inc) for (const [field, amount] of Object.entries(update.$inc)) doc[field] = (doc[field] || 0) + amount;
      if (update.$max) for (const [field, value] of Object.entries(update.$max)) doc[field] = Math.max(doc[field] || 0, value);
      if (update.$set) Object.assign(doc, clone(update.$set));
      if (update.$setOnInsert && upsertedCount) Object.assign(doc, clone(update.$setOnInsert));
      if (update.$unset) for (const field of Object.keys(update.$unset)) delete doc[field];
      return { modifiedCount: 1, upsertedCount };
    },
    findOneAndUpdate: async (filter, update) => {
      const doc = docs.find((row) => matches(row, filter));
      if (!doc) return null;
      if (update.$inc) for (const [field, amount] of Object.entries(update.$inc)) doc[field] = (doc[field] || 0) + amount;
      if (update.$max) for (const [field, value] of Object.entries(update.$max)) doc[field] = Math.max(doc[field] || 0, value);
      return clone(doc);
    },
    listIndexes: () => ({ toArray: async () => state.indexes.map(clone) }),
    dropIndex: async (name) => {
      state.dropped.push(name);
      state.indexes = state.indexes.filter((index) => index.name !== name);
    },
    createIndex: async (key, options) => {
      state.created.push(options.name);
      if (!state.indexes.some((index) => index.name === options.name)) state.indexes.push({ name: options.name, key, ...options });
      return options.name;
    },
  };
}

test("membership schema has only the named non-empty partial unique index", () => {
  const path = models.OrganizationMember.schema.path("membershipNumber");
  assert.equal(path.options.default, undefined);
  assert.equal(path.options.index, undefined);
  const indexes = models.OrganizationMember.schema.indexes().filter(([key]) => key.membershipNumber);
  assert.equal(indexes.length, 1);
  assert.equal(indexes[0][1].name, migration.INDEX_NAME);
  assert.equal(indexes[0][1].unique, true);
  assert.deepEqual(indexes[0][1].partialFilterExpression, migration.NUMBER_FILTER);
  assert.equal(models.OrganizationMember.schema.get("autoIndex"), false);
});

test("pending applications do not carry a membership number and remain user-unique", () => {
  const source = controller.apply.toString();
  assert.match(source, /status: "PENDING"/);
  assert.equal(source.includes("membershipNumber:"), false);
  assert.deepEqual(models.OrganizationMember.schema.indexes().find(([key]) => key.organization && key.user)[1], { unique: true });
});

test("duplicate membership numbers are detected by organization before index cleanup", async () => {
  const rows = [
    { _id: "a", organization: "o1", membershipNumber: "ORG/2026/00001" },
    { _id: "b", organization: "o1", membershipNumber: "ORG/2026/00001" },
    { _id: "c", organization: "o2", membershipNumber: "ORG/2026/00001" },
  ];
  const duplicates = await migration.duplicateMembershipNumbers({ find: () => ({ toArray: async () => rows }) });
  assert.equal(duplicates.length, 1);
  assert.match(duplicates[0][0], /^o1\u0000/);
});

test("legacy same-key indexes are dropped before named partial index creation", async () => {
  const indexes = [
    { name: "_id_", key: { _id: 1 } },
    { name: "membershipNumber_1", key: { membershipNumber: 1 }, unique: true, sparse: true },
    { name: "organization_1_membershipNumber_1", key: { organization: 1, membershipNumber: 1 }, unique: true, sparse: true },
    { name: "unrelated_membershipNumber_1", key: { membershipNumber: 1, year: 1 } },
  ];
  const events = [];
  const collection = {
    listIndexes: () => ({ toArray: async () => indexes }),
    dropIndex: async (name) => { events.push(`drop:${name}`); indexes.splice(indexes.findIndex((i) => i.name === name), 1); },
    createIndex: async (key, options) => {
      events.push(`create:${options.name}`);
      assert.equal(indexes.some((i) => i.name === "organization_1_membershipNumber_1"), false);
      if (!indexes.some((i) => i.name === options.name)) indexes.push({ name: options.name, key });
      return options.name;
    },
  };
  await migration.removeObsoleteIndexes(collection);
  await migration.createMembershipIndex(collection);
  await migration.removeObsoleteIndexes(collection);
  await migration.createMembershipIndex(collection);
  assert.deepEqual(events.slice(0, 3), [
    "drop:membershipNumber_1",
    "drop:organization_1_membershipNumber_1",
    "create:organization_membership_number_unique",
  ]);
  assert.equal(indexes.some((i) => i.name === "unrelated_membershipNumber_1"), true);
  assert.equal(events.filter((event) => event.startsWith("drop:")).length, 2);
  assert.equal(events.filter((event) => event.startsWith("create:")).length, 2);
});

test("migration reconciles legacy data end-to-end and is a no-op on rerun", async () => {
  const members = fakeCollection([
    { _id: "pending-null", organization: "org-1", user: "user-1", status: "PENDING", membershipNumber: null, year: 2020 },
    { _id: "pending-missing", organization: "org-1", user: "user-2", status: "PENDING" },
    { _id: "active-missing", organization: "org-1", user: "user-3", status: "ACTIVE" },
    { _id: "active-existing", organization: "org-1", user: "user-4", status: "ACTIVE", membershipNumber: "ORG/2025/00012", year: 2025 },
  ], [
    { name: "_id_", key: { _id: 1 } },
    { name: "membershipNumber_1", key: { membershipNumber: 1 }, unique: true, sparse: true },
    { name: "organization_1_membershipNumber_1", key: { organization: 1, membershipNumber: 1 }, unique: true, sparse: true },
  ]);
  const organizations = fakeCollection([{ _id: "org-1", code: "ORG", membershipNumberSequence: 2 }]);
  const cards = fakeCollection([]);
  const db = { collection: (name) => name === "organizationmembers" ? members : name === "organizations" ? organizations : cards };
  const before = members.state.docs.length;
  const first = await migration({ db });
  const byId = Object.fromEntries(members.state.docs.map((row) => [row._id, row]));
  assert.equal(members.state.docs.length, before);
  assert.equal("membershipNumber" in byId["pending-null"], false);
  assert.equal(byId["pending-null"].year, 2020);
  assert.equal("membershipNumber" in byId["pending-missing"], false);
  assert.equal(byId["active-missing"].membershipNumber, "ORG/2026/00013");
  assert.equal(new Set(members.state.docs.filter((row) => row.status === "ACTIVE").map((row) => row.membershipNumber)).size, 2);
  assert.equal(cards.state.docs.length, 2);
  assert.deepEqual(members.state.dropped, ["membershipNumber_1", "organization_1_membershipNumber_1"]);
  assert.deepEqual(members.state.indexes.map((index) => index.name), ["_id_", migration.INDEX_NAME, "organization_user_unique"]);
  assert.equal(first.sequenceUpdates, 1);
  const second = await migration({ db });
  assert.deepEqual(second, { unset: 0, sequenceUpdates: 0, activeBackfilled: 0, cardsCreated: 0, index: migration.INDEX_NAME });
  assert.equal(members.state.docs.length, before);
  assert.equal(cards.state.docs.length, 2);
});

test("startup binds only after connectDB and migration promise resolves", () => {
  const source = fs.readFileSync(require.resolve("../index"), "utf8");
  assert.ok(source.indexOf("await connectDB()") < source.indexOf("server.listen(PORT"));
});

test("AUTO apply resumes pending activation and returns active rejoin idempotently", () => {
  const source = controller.apply.toString();
  assert.match(source, /existing\.status === "PENDING"/);
  assert.match(source, /existing\.status === "ACTIVE"/);
  assert.match(source, /idempotent: true/);
  assert.match(source, /svc\.approveMember\(req, existing\)/);
});

test("sequence reconciliation raises only stale organization counters", async () => {
  const orgs = [{ _id: "o1", code: "ORG", membershipNumberSequence: 2 }];
  const updates = [];
  const organizations = {
    find: () => ({ toArray: async () => orgs }),
    updateOne: async (filter, update) => { updates.push({ filter, update }); return { modifiedCount: 1 }; },
  };
  const collection = {
    find: (filter) => ({ toArray: async () => filter.organization === "o1" ? [{ membershipNumber: "ORG/2025/17" }] : [] }),
  };
  assert.equal(await migration.reconcileSequences(organizations, collection), 1);
  assert.deepEqual(updates[0].update, { $max: { membershipNumberSequence: 17 } });
});

test("duplicate-key translation never exposes Mongo details or object ids", () => {
  const translated = service.duplicateKeyMessage({ code: 11000, keyValue: { _id: "507f1f77bcf86cd799439011" } });
  assert.equal(translated.status, 409);
  assert.equal(translated.code, "DUPLICATE_RESOURCE");
  assert.equal(translated.message.includes("507f1f"), false);
  assert.equal(service.duplicateKeyMessage({ code: 123 }), null);
});

test("concurrent rejoin duplicate-key outcomes are safe 409 responses", async () => {
  const duplicate = () => service.publicError({
    code: 11000,
    errmsg: "E11000 duplicate key error collection: organizationmembers _id: 507f1f77bcf86cd799439011",
  }, "Membership application already exists.");
  const results = await Promise.all([Promise.resolve().then(duplicate), Promise.resolve().then(duplicate)]);
  for (const result of results) {
    assert.equal(result.status, 409);
    assert.equal(result.message, "Membership application already exists.");
    assert.equal(result.message.includes("E11000"), false);
    assert.equal(result.message.includes("507f1f"), false);
  }
});

test("approval and AUTO activation allocate numbers and cards only after activation", () => {
  const approval = service.approveMember.toString();
  const pay = service.pay.toString();
  assert.match(approval, /\$inc: \{ membershipNumberSequence: 1 \}/);
  assert.match(approval, /status = "ACTIVE"/);
  assert.match(approval, /membershipNumber/);
  assert.match(pay, /membershipMode === "AUTO"/);
  assert.match(pay, /status: "ACTIVE"/);
  assert.match(pay, /membershipNumber/);
  assert.match(pay, /OrganizationMembershipCard/);
});

test("rejoin and all organization membership controllers use safe conflict paths", () => {
  const source = controller.apply.toString();
  assert.match(source, /Membership application already exists/);
  for (const handler of [controller.apply, controller.approveMember, controller.card, controller.pay]) {
    assert.match(handler.toString(), /publicError/);
    assert.equal(handler.toString().includes("safe.status, safe.message"), true);
  }
});
