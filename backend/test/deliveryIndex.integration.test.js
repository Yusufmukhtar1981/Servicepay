const test = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { MongoClient, ObjectId } = require("mongodb");
const ensureIndex = require("../scripts/ensureDeliveryIdempotencyIndex");

test("startup creates and verifies the delivery retry index without changing legacy orders", async () => {
  const replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ args: ["--nounixsocket"] }],
  });
  const client = new MongoClient(replica.getUri());
  try {
    await client.connect();
    const db = client.db("delivery_index_integration");
    const deliveries = db.collection("deliveries");
    const old = await deliveries.insertOne({ customerId: new ObjectId(), paymentStatus: "PAID", status: "PENDING" });
    await ensureIndex(db);
    await ensureIndex(db);
    const indexes = await deliveries.indexes();
    assert.equal(indexes.find((index) => index.name === "customerId_1_idempotencyKey_1")?.unique, true);
    assert.equal((await deliveries.findOne({ _id: old.insertedId })).paymentStatus, "PAID");
    const customerId = new ObjectId();
    await deliveries.insertOne({ customerId, idempotencyKey: "same-request" });
    await assert.rejects(deliveries.insertOne({ customerId, idempotencyKey: "same-request" }), { code: 11000 });
    await deliveries.insertOne({ customerId, paymentStatus: "PAID" });
    await deliveries.insertOne({ customerId, paymentStatus: "PAID" });
  } finally {
    await client.close();
    await replica.stop();
  }
});