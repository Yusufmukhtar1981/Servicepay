const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const ensureTransactionIdempotencyIndex = require("../scripts/ensureTransactionIdempotencyIndex");

const INDEX_NAME = "uniq_customer_service_idempotency_key";
const INDEX_KEYS = {
  customerId: 1,
  serviceType: 1,
  idempotencyKey: 1,
};
const PARTIAL_FILTER = {
  idempotencyKey: { $type: "string" },
};

let replSet;
let connection;
let databaseNumber = 0;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
});

test.after(async () => {
  if (connection) {
    await connection.close();
  }
  if (replSet) {
    await replSet.stop();
  }
});

async function useFreshDatabase() {
  if (connection) {
    await connection.close();
  }
  databaseNumber += 1;
  connection = await require("mongoose")
    .createConnection(replSet.getUri(), {
      dbName: `idempotency_migration_${databaseNumber}`,
    })
    .asPromise();
  return connection.db;
}

test("creates the exact partial unique index when the collection is empty", async () => {
  const db = await useFreshDatabase();
  await db.createCollection("transactions");

  await ensureTransactionIdempotencyIndex(db);

  const index = (await db.collection("transactions").indexes()).find(
    (candidate) => candidate.name === INDEX_NAME,
  );
  assert.ok(index);
  assert.deepEqual(index.key, INDEX_KEYS);
  assert.equal(index.unique, true);
  assert.deepEqual(index.partialFilterExpression, PARTIAL_FILTER);
});

test("fails explicitly when duplicate groups exist across service types", async () => {
  const db = await useFreshDatabase();
  const transactions = db.collection("transactions");
  const customerId = new (require("mongoose").Types.ObjectId)();
  await transactions.insertMany([
    { customerId, serviceType: "airtime", idempotencyKey: "same-key" },
    { customerId, serviceType: "airtime", idempotencyKey: "same-key" },
    { customerId, serviceType: "data", idempotencyKey: "same-key" },
  ]);

  await assert.rejects(
    ensureTransactionIdempotencyIndex(db),
    /duplicate idempotency key groups exist in transactions/,
  );
  assert.equal(
    (await transactions.indexes()).some((index) => index.name === INDEX_NAME),
    false,
  );
});

test("fails closed when the named index has conflicting options", async () => {
  const db = await useFreshDatabase();
  const transactions = db.collection("transactions");
  await transactions.createIndex(
    { customerId: 1, serviceType: 1, idempotencyKey: 1 },
    { name: INDEX_NAME, unique: false },
  );

  await assert.rejects(
    ensureTransactionIdempotencyIndex(db),
    /exists but has conflicting uniqueness, keys, or partial filter/,
  );
});

test("is idempotent when rerun against the verified index", async () => {
  const db = await useFreshDatabase();
  await db.createCollection("transactions");

  await ensureTransactionIdempotencyIndex(db);
  await ensureTransactionIdempotencyIndex(db);

  const matches = (await db.collection("transactions").indexes()).filter(
    (index) => index.name === INDEX_NAME,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].unique, true);
});