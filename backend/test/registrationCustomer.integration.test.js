"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/user.model");
const { registerUser } = require("../controllers/auth.controller");
let replica, server, base;
before(async () => {
  assert(!process.env.MONGODB_URI, "Tests must not inherit production database credentials.");
  process.env.JWT_SECRET = "isolated-registration-fixture-not-a-production-key";
  mongoose.set("autoIndex", false);
  replica = await MongoMemoryReplSet.create({ binary: { version: "7.0.14" },
    replSet: { count: 1, storageEngine: "wiredTiger", args: ["--nounixsocket"] } });
  await mongoose.connect(replica.getUri(), { dbName: "registration_isolated" });
  const app = express();
  app.use(express.json());
  app.post("/register", registerUser);
  await new Promise(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}/register`;
});
after(async () => {
  await new Promise(resolve => server?.close(resolve));
  await mongoose.disconnect();
  await replica?.stop();
});
const submit = async body => {
  const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const form = { fullName: "Registration Fixture", phone: "08098760001",
  email: "registration@example.invalid", password: "FixtureStrong1!",
  transactionPin: "2580", confirmTransactionPin: "2580",
  state: "Lagos", lga: "Ikeja", nin: "12345678901", acceptTerms: true, kycConsent: true };

test("new NIN customer is created with hashed secrets and masked identity only", async () => {
  const result = await submit(form);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.user.role, "CUSTOMER");
  const saved = await User.collection.findOne({ phone: form.phone });
  assert.equal(saved.walletBalance, 0);
  assert.equal(saved.ninNumberMasked, "*******8901");
  assert.equal(saved.nin || "", "");
  assert.notEqual(saved.password, form.password);
  assert.notEqual(saved.transactionPin, form.transactionPin);
  assert(!JSON.stringify(result.body).includes(form.nin));
  assert(!JSON.stringify(result.body).includes(form.password));
});

test("BVN creates pending BVN metadata without claiming NIN verification", async () => {
  const result = await submit({ ...form, phone: "+2348098760002",
    email: "bvn-registration@example.invalid", nin: undefined,
    identityType: "BVN", bvn: "12345678901" });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const saved = await User.collection.findOne({ phone: "08098760002" });
  assert.equal(saved.bvnNumberMasked, "*******8901");
  assert.equal(saved.bvnVerificationStatus, "PENDING");
  assert.equal(saved.ninNumberMasked, undefined);
  assert.equal(saved.nin || "", "");
  assert(!JSON.stringify(saved).includes("12345678901"));
});

test("public privileged registration and invalid PIN confirmation create no account", async () => {
  const before = await User.countDocuments();
  for (const role of ["AGENT", "STATE_MANAGER", "ZONAL_MANAGER", "HEAD_OFFICE"]) {
    assert.equal((await submit({ ...form, role })).status, 403);
  }
  assert.equal((await submit({ ...form, confirmTransactionPin: "2581" })).status, 400);
  assert.equal(await User.countDocuments(), before);
});
