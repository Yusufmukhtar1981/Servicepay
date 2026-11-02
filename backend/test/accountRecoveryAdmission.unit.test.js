"use strict";
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../models/privacyRequestRateLimit.model");
const Admission = require("../services/accountRecoveryAdmission.service");
const originalIndexes = Store.collection.indexes;
const originalUpdate = Store.findOneAndUpdate;
afterEach(() => {
  Store.collection.indexes = originalIndexes;
  Store.findOneAndUpdate = originalUpdate;
  delete process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT;
});
test("SMS admission rejects missing, nonunique, sparse and partial indexes without a database write", async () => {
  let writes = 0;
  Store.findOneAndUpdate = async () => { writes++; };
  for (const index of [
    { key: { key: 1, bucket: 1 } },
    { unique: true, key: { key: 1, bucket: 1 }, sparse: true },
    { unique: true, key: { key: 1, bucket: 1 }, partialFilterExpression: { key: "unrelated" } },
  ]) {
    Store.collection.indexes = async () => [index];
    assert.equal(await Admission.ready(), false);
    await assert.rejects(Admission.reserveSend(), { code: "SMS_ADMISSION_UNAVAILABLE" });
  }
  assert.equal(writes, 0);
});
test("SMS index access errors fail closed without a database write", async () => {
  Store.collection.indexes = async () => { throw Error("index unavailable"); };
  Store.findOneAndUpdate = async () => assert.fail("A write must not occur.");
  await assert.rejects(Admission.reserveSend(), { code: "SMS_ADMISSION_UNAVAILABLE" });
});
test("SMS quota uses an isolated namespace and atomic bounded admission without changing settings or contacts", async () => {
  Store.collection.indexes = async () => [{ unique: true, key: { key: 1, bucket: 1 } }];
  let captured;
  Store.findOneAndUpdate = async (filter, update, options) => { captured = { filter, update, options }; };
  process.env.SERVICEPAY_VERIFY_SMS_DAILY_LIMIT = "50";
  await Admission.reserveSend();
  assert.equal(captured.filter.key, "verify-sms:global");
  assert.equal(captured.filter.count.$lt, 50);
  assert.equal(captured.update.$inc.count, 1);
  assert.equal(captured.options.upsert, true);
  assert(captured.update.$setOnInsert.expiresAt > new Date());
  assert.deepEqual(Object.keys(captured.update).sort(), ["$inc", "$setOnInsert"]);
});
