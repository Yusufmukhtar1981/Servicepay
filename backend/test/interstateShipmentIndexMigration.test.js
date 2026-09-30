const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { migrate, ensurePaymentKeyIndex } = require("../services/interstateShipmentIndexMigration.service");
const Shipment = require("../models/interstateShipment.model");

let mongo;

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), {
    dbName: "interstate-index-migration-tests",
    autoIndex: false,
  });
});
test.after(async () => { await mongoose.disconnect(); await mongo.stop(); });

test("first-use startup creates and verifies the unique index even when autoIndex is disabled", async () => {
  await migrate();
  assert.equal(
    await mongoose.connection.db.listCollections(
      { name: Shipment.collection.collectionName },
      { nameOnly: true },
    ).hasNext(),
    true,
  );
  const index = (await Shipment.collection.indexes()).find(
    (entry) => entry.key.paymentIdempotencyKey === 1,
  );
  assert.equal(index.unique, true);
  assert.deepEqual(index.partialFilterExpression, {
    paymentIdempotencyKey: { $type: "string" },
  });
});

test("startup migration repairs the actual shipment collection before serving requests", async () => {
  const collection = mongoose.connection.db.collection(Shipment.collection.collectionName);
  for (const index of await collection.indexes()) {
    if (index.key.paymentIdempotencyKey === 1) await collection.dropIndex(index.name);
  }
  await collection.createIndex({ paymentIdempotencyKey: 1 }, {
    name: "paymentIdempotencyKey_1",
    unique: true,
    sparse: true,
  });
  await collection.insertOne({ paymentIdempotencyKey: null });
  await migrate();
  const indexes = await collection.indexes();
  assert.equal(indexes.some((index) => index.name === "paymentIdempotencyKey_1"), false);
  assert.ok(indexes.some((index) => (
    index.unique === true &&
    index.partialFilterExpression?.paymentIdempotencyKey?.$type === "string"
  )));
  await collection.insertMany([
    { paymentIdempotencyKey: null },
    { paymentIdempotencyKey: null },
  ]);
});

test("legacy sparse unique index is replaced without a uniqueness gap or unrelated index changes", async () => {
  const collection = await mongoose.connection.db.createCollection("legacy-shipment-index-test");
  await collection.createIndex({ paymentIdempotencyKey: 1 }, {
    name: "paymentIdempotencyKey_1",
    unique: true,
    sparse: true,
  });
  await collection.createIndex({ customerId: 1 }, { name: "customerId_1" });
  await collection.insertMany([{ paymentIdempotencyKey: null }, { customerId: 1 }]);

  await ensurePaymentKeyIndex(collection);
  const indexes = await collection.indexes();
  const paymentIndexes = indexes.filter((index) => index.key.paymentIdempotencyKey === 1);
  assert.equal(paymentIndexes.length, 1);
  assert.equal(paymentIndexes[0].unique, true);
  assert.deepEqual(paymentIndexes[0].partialFilterExpression, {
    paymentIdempotencyKey: { $type: "string" },
  });
  assert.ok(indexes.some((index) => index.name === "customerId_1"));
  await collection.insertMany([
    { paymentIdempotencyKey: null },
    {},
    { paymentIdempotencyKey: "paid-first" },
    { paymentIdempotencyKey: "paid-second" },
  ]);
  await assert.rejects(
    collection.insertOne({ paymentIdempotencyKey: "paid-first" }),
    (error) => error.code === 11000,
  );
  await ensurePaymentKeyIndex(collection);
  assert.equal(
    (await collection.indexes()).filter((index) => index.key.paymentIdempotencyKey === 1).length,
    1,
  );
});

test("duplicate actual payment keys fail closed without removing an existing index", async () => {
  const collection = await mongoose.connection.db.createCollection("duplicate-shipment-index-test");
  await collection.createIndex({ paymentIdempotencyKey: 1 }, { name: "existing_payment_lookup" });
  await collection.insertMany([
    { paymentIdempotencyKey: "duplicate" },
    { paymentIdempotencyKey: "duplicate" },
  ]);
  await assert.rejects(
    ensurePaymentKeyIndex(collection),
    /Duplicate Interstate payment keys/,
  );
  assert.ok((await collection.indexes()).some((index) => index.name === "existing_payment_lookup"));
});