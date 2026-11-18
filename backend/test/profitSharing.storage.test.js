"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { namespaces, inspect, provision } = require("../scripts/provisionProfitSharingStorage");
function fixture(initial = []) {
  const rows = new Map(initial.map(name => [name, {
    name, type: "collection", options: {}, indexes: [{ name: "_id_", key: { _id: 1 } }],
  }]));
  const created = [];
  const db = {
    listCollections(filter) {
      assert.deepEqual(filter, { name: { $in: [...namespaces] } });
      return { toArray: async () => [...rows.values()] };
    },
    collection(name) {
      assert.ok(namespaces.includes(name));
      return {
        indexes: async () => rows.get(name).indexes,
        findOne: async query => {
          assert.deepEqual(query, { _id: { $not: { $type: "string" } } });
          return rows.get(name).incompatible || null;
        },
      };
    },
    async createCollection(name) {
      assert.ok(namespaces.includes(name)); assert.equal(rows.has(name), false);
      rows.set(name, { name, type: "collection", options: {},
        indexes: [{ name: "_id_", key: { _id: 1 } }] });
      created.push(name);
    },
  };
  return { db, rows, created };
}
test("default is read-only and names exactly the three existing engine namespaces", async () => {
  const f = fixture();
  assert.deepEqual(namespaces, ["profitsharingadmissions", "profitsharingevents", "profitsharingaccounts"]);
  const result = await provision(f.db);
  assert.equal(result.mode, "PLAN_ONLY"); assert.equal(result.writes, 0);
  assert.deepEqual(f.created, []);
});
test("explicit approval creates only absent namespaces and is safely repeatable", async () => {
  const f = fixture([namespaces[0]]);
  const existing = f.rows.get(namespaces[0]);
  const first = await provision(f.db, { approved: true });
  assert.deepEqual(first.created, namespaces.slice(1));
  assert.equal(f.rows.get(namespaces[0]), existing);
  assert.ok(first.namespaces.every(row => row.idempotencyIndexVerified));
  assert.deepEqual((await provision(f.db, { approved: true })).created, []);
});
test("incompatible existing records block every creation without modifying them", async () => {
  const f = fixture([namespaces[0]]);
  f.rows.get(namespaces[0]).incompatible = { _id: "opaque-test-result" };
  await assert.rejects(provision(f.db, { approved: true }), { code: "INCOMPATIBLE_COMMISSION_RECORDS" });
  assert.deepEqual(f.created, []);
});
test("a missing, nonunique, hidden or partial id index fails closed", async () => {
  for (const index of [null, { unique: false }, { hidden: true }, { sparse: true },
    { partialFilterExpression: { valid: true } }, { expireAfterSeconds: 5 }]) {
    const f = fixture([namespaces[0]]);
    f.rows.get(namespaces[0]).indexes = index ?
      [{ name: "_id_", key: { _id: 1 }, ...index }] : [];
    await assert.rejects(inspect(f.db), { code: "COMMISSION_IDEMPOTENCY_INDEX_NOT_VERIFIED" });
    assert.deepEqual(f.created, []);
  }
});
test("views and capped collections cannot be repurposed", async () => {
  for (const value of [{ type: "view" }, { options: { capped: true } }]) {
    const f = fixture([namespaces[0]]); Object.assign(f.rows.get(namespaces[0]), value);
    await assert.rejects(provision(f.db, { approved: true }), { code: "INCOMPATIBLE_COMMISSION_NAMESPACE" });
    assert.deepEqual(f.created, []);
  }
});
test("a capacity failure stops safely and preserves partial work for a later resume", async () => {
  const f = fixture(), create = f.db.createCollection;
  f.db.createCollection = async name => {
    if (name === namespaces[1]) throw Object.assign(Error("namespace capacity"), { code: "CAPACITY" });
    await create(name);
  };
  await assert.rejects(provision(f.db, { approved: true }), error => {
    assert.deepEqual(error.createdNamespaces, [namespaces[0]]); return error.code === "CAPACITY";
  });
  assert.deepEqual(f.created, [namespaces[0]]);
  f.db.createCollection = create;
  assert.deepEqual((await provision(f.db, { approved: true })).created, namespaces.slice(1));
});
test("real disposable MongoDB preserves records and enforces deterministic id uniqueness", async () => {
  for (const key of ["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"]) {
    assert.equal(process.env[key], undefined, "Ambient database configuration is forbidden");
  }
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const { MongoClient } = require("mongoose").mongo;
  const mongo = await MongoMemoryServer.create();
  const client = new MongoClient(mongo.getUri());
  try {
    await client.connect(); const db = client.db("commission_storage_disposable");
    await db.collection("protected_records").insertOne({ _id: "existing", balanceKobo: 17341 });
    const originalIndexes = await db.collection("protected_records").indexes();
    assert.equal((await provision(db)).writes, 0);
    assert.deepEqual((await provision(db, { approved: true })).created, [...namespaces]);
    await db.collection(namespaces[1]).insertOne({ _id: "accrual:test-only", kind: "ACCRUAL", data: {} });
    await assert.rejects(db.collection(namespaces[1]).insertOne({
      _id: "accrual:test-only", kind: "ACCRUAL", data: {},
    }), { code: 11000 });
    assert.deepEqual((await provision(db, { approved: true })).created, []);
    assert.deepEqual(await db.collection("protected_records").findOne({ _id: "existing" }),
      { _id: "existing", balanceKobo: 17341 });
    assert.deepEqual(await db.collection("protected_records").indexes(), originalIndexes);
    assert.equal(await db.collection(namespaces[1]).countDocuments(), 1);
  } finally { await client.close(); await mongo.stop(); }
});
