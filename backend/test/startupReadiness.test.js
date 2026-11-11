const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { inspect, verify, matches, manifest } = require("../services/startupReadiness.service");
function fixture() {
  const collections = new Map();
  for (const spec of manifest) {
    if (!collections.has(spec.collection)) collections.set(spec.collection, []);
    collections.get(spec.collection).push({ key: spec.key, unique: true,
      ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
      ...(spec.sparse ? { sparse: true } : {}) });
  }
  const db = {
    listCollections: () => ({ toArray: async () => [...collections.keys()].map(name => ({ name })) }),
    collection: name => ({
      indexes: async () => collections.get(name),
      findOne: async () => null,
      aggregate: () => ({ next: async () => null }),
      createIndex: () => { throw Error("Forbidden write"); },
      updateMany: () => { throw Error("Forbidden write"); },
      dropIndex: () => { throw Error("Forbidden write"); },
    }),
  };
  return { db, collections };
}
test("startup verifies versioned invariants repeatedly without executing repairs", async () => {
  const f = fixture();
  assert.deepEqual(await inspect(f.db), { ready: true, issues: [], writes: 0 });
  assert.deepEqual(await inspect(f.db), { ready: true, issues: [], writes: 0 });
  assert.equal(new Set(manifest.map(s => s.id)).size, manifest.length);
});
test("production's three missing uniqueness guards prevent startup", async () => {
  const f = fixture();
  for (const name of ["banktransfers", "organizationwallets", "idverifications"])
    f.collections.set(name, []);
  await assert.rejects(verify({ db: f.db }), error =>
    error.code === "STARTUP_READINESS_BLOCKED" && error.readiness.issues.length === 3);
});
test("missing namespace cannot be implicitly provisioned by readiness", async () => {
  const f = fixture(); f.collections.delete("transactions");
  assert.ok((await inspect(f.db)).issues.some(i => i.code === "NAMESPACE_MISSING"));
});
test("legacy backfill prerequisites are verified, not silently repaired", async () => {
  const f = fixture(), original = f.db.collection;
  f.db.collection = name => ({ ...original(name), findOne: async () =>
    name === "interstateshipments" ? { _id: "disposable-fixture" } : null });
  assert.ok((await inspect(f.db)).issues.some(i => i.id === "shipment-tracking-backfill-v1"));
});
test("catalog read failure is fatal, never permission to skip verification", async () => {
  const f = fixture(); f.db.listCollections = () => { throw Error("Catalog unavailable"); };
  await assert.rejects(verify({ db: f.db }), /Catalog unavailable/);
});
test("nonunique, hidden and TTL indexes are not accepted as financial uniqueness", () => {
  const spec = manifest[0];
  const good = { key: spec.key, unique: true, partialFilterExpression: spec.partial };
  assert.equal(matches(good, spec), true);
  for (const extra of [{ unique: false }, { hidden: true }, { expireAfterSeconds: 0 },
    { collation: { locale: "en" } }, { partialFilterExpression: {} }])
    assert.equal(matches({ ...good, ...extra }, spec), false);
});
test("real entrypoint configures initialization before routes and does not run migrations", () => {
  const source = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const db = fs.readFileSync(path.join(__dirname, "../config/db.js"), "utf8");
  assert.ok(source.indexOf("startupReadiness.configure()") < source.indexOf("marketplace.routes"));
  assert.doesNotMatch(source, /\.migrate\(\)|\.migrateTracking\(\)|\.backfill\(\)/);
  assert.doesNotMatch(db, /await (fixCardRequestReferenceIndex|migrateOrganizationMembers|ensureTransactionIdempotencyIndex|ensureDeliveryIdempotencyIndex)\(/);
  assert.match(db, /await startupReadiness.verify/);
  assert.match(source, /startTelecomAbodeReconciliationWorker\(\)/);
});
