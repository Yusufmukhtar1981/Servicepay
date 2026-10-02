"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const Legacy = require("../models/customerBeneficiary.model");
const controller = require("../controllers/customerBeneficiary.controller");
let repl, server, url, a, b, admin, sequence = 0;
const token = user => jwt.sign({ id: String(user._id) }, "saved-number-unit-secret");
const request = async (path = "", user = a, body, method) => {
  const r = await fetch(url + path, {
    method: method || (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: "Bearer " + token(user) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
test.before(async () => {
  if (["MONGODB_URI", "MONGO_URI", "MONGO_URL", "DATABASE_URL"].some(k => process.env[k])) throw Error("Do not inherit database credentials.");
  process.env.JWT_SECRET = "saved-number-unit-secret";
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ["--nounixsocket"] }] });
  await mongoose.connect(repl.getUri(), { dbName: "beneficiary-isolation" });
  await User.init();
  const buyer = async role => {
    const n = ++sequence;
    return User.create({ fullName: "Test customer", phone: `080${String(n).padStart(8, "0")}`,
      email: `saved-${n}@test.invalid`, password: "unit-password", role, status: "ACTIVE", walletBalance: 5000 });
  };
  a = await buyer("CUSTOMER"); b = await buyer("CUSTOMER"); admin = await buyer("HEAD_OFFICE");
  const app = express(); app.use(express.json());
  app.use("/numbers", require("../routes/customerBeneficiary.routes"));
  app.use((err, req, res, next) => res.status(500).json({ message: err.message }));
  server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  url = `http://127.0.0.1:${server.address().port}/numbers`;
});
test.after(async () => {
  await new Promise(resolve => server?.close(resolve));
  await mongoose.disconnect(); await repl?.stop();
});
test("normalization accepts local/international mobile formats and rejects unsafe text", () => {
  for (const input of ["08012345678", "2348012345678", "+2348012345678", "+234 801 234 5678", "0801-234-5678"])
    assert.equal(controller.normalizePhone(input), "08012345678");
  for (const prefix of ["070", "081", "090", "091"]) assert.equal(controller.normalizePhone(prefix + "12345678"), prefix + "12345678");
  for (const input of ["abc08012345678", "00000000000", "12345", { phone: "08012345678" }, "+08012345678"])
    assert.equal(controller.normalizePhone(input), "");
});
test("authentication required; non-customers cannot use customer saved numbers", async () => {
  assert.equal((await request("", null)).status, 401);
  assert.equal((await request("", admin)).status, 403);
  assert.equal((await request("", admin, { phone: "08012345678" })).status, 403);
});
test("optional nickname saves persistently without any transaction or new collection", async () => {
  const r = await request("", a, { phone: "+2348012345678", serviceType: "DATA" });
  assert.equal(r.status, 201);
  assert.equal(r.body.beneficiary.name, "");
  assert.equal(r.body.beneficiary.phone, "08012345678");
  assert.equal(r.body.beneficiary.normalizedPhone, "08012345678");
  assert.ok(r.body.beneficiary.createdAt); assert.ok(r.body.beneficiary.updatedAt);
  const list = await request();
  assert.equal(list.body.beneficiaries.length, 1);
  assert.equal(list.body.beneficiaries[0]._id, r.body.beneficiary._id);
  assert.equal((await User.findById(a._id)).walletBalance, 5000);
  assert.equal((await mongoose.connection.db.listCollections({ name: Legacy.collection.name }).toArray()).length, 0);
  assert.equal((await User.findById(a._id).lean()).savedTelecomBeneficiaries, undefined);
});
test("parallel local/international saves yield exactly one account number", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => request("", a, {
    phone: i % 2 ? "2347012345678" : "07012345678", name: "Shared number", serviceType: i % 2 ? "AIRTIME" : "DATA",
  })));
  assert.ok(results.every(r => [200, 201].includes(r.status)));
  assert.equal(new Set(results.map(r => r.body.beneficiary._id)).size, 1);
  const items = (await request()).body.beneficiaries.filter(b => b.phone === "07012345678");
  assert.equal(items.length, 1);
});
test("ownership enforced for list, rename and delete; fresh sessions share account data", async () => {
  const item = (await request()).body.beneficiaries[0];
  assert.equal((await request("", b)).body.beneficiaries.length, 0);
  assert.equal((await request("/" + item._id, b, { name: "stolen" }, "PATCH")).status, 404);
  assert.equal((await request("/" + item._id, b, null, "DELETE")).status, 404);
  assert.equal((await request()).body.beneficiaries.length, 2);
  const own = await request("", b, { phone: item.phone, name: "Other owner" });
  assert.equal(own.status, 201);
  assert.notEqual(own.body.beneficiary._id, item._id);
  const renamed = await request("/" + item._id, a, { name: "My saved number" }, "PATCH");
  assert.equal(renamed.status, 200); assert.equal(renamed.body.beneficiary.name, "My saved number");
  assert.equal((await request("?search=My%20saved")).body.beneficiaries.length, 1);
  assert.equal((await request("/" + item._id, a, null, "DELETE")).status, 200);
  assert.equal((await request()).body.beneficiaries.some(n => n._id === item._id), false);
  assert.equal((await request("", b)).body.beneficiaries.length, 1);
});
test("invalid ids and oversized/type-invalid inputs fail safely", async () => {
  for (const name of ["a".repeat(81), { name: "bad" }])
    assert.equal((await request("", a, { phone: "09012345678", name })).status, 400);
  assert.equal((await request("", a, { phone: "bad08012345678" })).status, 400);
  assert.equal((await request("/invalid", a, { name: "foo" }, "PATCH")).status, 404);
  assert.equal((await request("/invalid", a, null, "DELETE")).status, 404);
});
test("legacy saved numbers are retained, normalized and deleted without resurrection", async () => {
  await Legacy.createCollection(); await Legacy.init();
  const old = await Legacy.create({ customer: a._id, phone: "2349012345678", name: "Legacy", serviceTypes: ["DATA"] });
  assert.ok((await request()).body.beneficiaries.some(b => b._id === String(old._id) && b.phone === "09012345678"));
  assert.equal((await request("/" + old._id, a, { name: "Migrated" }, "PATCH")).status, 200);
  assert.equal((await request("/" + old._id, a, null, "DELETE")).status, 200);
  assert.equal((await request()).body.beneficiaries.some(b => b._id === String(old._id)), false);
});