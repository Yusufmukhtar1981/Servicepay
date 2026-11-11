const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const readiness = require("../services/startupReadiness.service");
readiness.configure();
const Probe = mongoose.model("StartupProbe", new mongoose.Schema({ value: Number }),
  "startup_probes");
let mongo;
test.before(async () => {
  assert.ok(!["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k]),
    "Never use ambient database credentials");
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 },
    instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(mongo.getUri());
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test("automatic model initialization creates neither collections nor indexes", async () => {
  await Probe.init();
  assert.equal(await mongoose.connection.db.listCollections(
    { name: "startup_probes" }).hasNext(), false);
});
test("unverified startup blocks model writes without implicitly creating storage", async () => {
  await assert.rejects(Probe.create({ value: 1 }), { code: "STARTUP_NOT_VERIFIED" });
  assert.equal(await mongoose.connection.db.listCollections(
    { name: "startup_probes" }).hasNext(), false);
});
test("provisioned invariants permit ordinary writes, but not unprovisioned first-use storage", async () => {
  const db = mongoose.connection.db;
  for (const spec of readiness.manifest) {
    if (!await db.listCollections({ name: spec.collection }).hasNext())
      await db.createCollection(spec.collection);
    await db.collection(spec.collection).createIndex(spec.key, {
      unique: true, ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
      ...(spec.sparse ? { sparse: true } : {}),
    });
  }
  await readiness.verify();
  await assert.rejects(Probe.create({ value: 1 }), { code: "STORAGE_NOT_PROVISIONED" });
  await db.createCollection("startup_probes");
  const created = await Probe.create({ value: 2 });
  assert.equal(created.value, 2);
  await readiness.verify();
  assert.equal(await Probe.countDocuments({}), 1);
});
