"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const path = require("node:path");

test("Saved Numbers owner/legacy reads run concurrently with narrow projections", async () => {
  let ownerStarted = false, legacyStarted = false;
  let resolveOwner, resolveLegacy;
  const ownerPromise = new Promise(r => resolveOwner = r);
  const legacyPromise = new Promise(r => resolveLegacy = r);
  const projections = [];
  const chain = (promise) => ({
    select(fields) { projections.push(fields); return this; },
    limit() { return this; },
    lean() { return promise; },
  });
  const User = { findOne(filter) {
    ownerStarted = true;
    assert.equal(filter._id, "a"); assert.equal(filter.role, "CUSTOMER");
    return chain(ownerPromise);
  }};
  const Legacy = { find(filter) {
    legacyStarted = true; assert.equal(filter.customer, "a");
    return chain(legacyPromise);
  }};
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, "../controllers/customerBeneficiary.controller.js"), "utf8");
  vm.runInNewContext(source, {
    exports, console, Date,
    require(name) {
      if (name.endsWith("user.model")) return User;
      if (name.endsWith("customerBeneficiary.model")) return Legacy;
      if (name.includes("nigerianMsisdn")) return { normalizeNigerianMsisdn: v => v };
      if (name === "mongoose") return {};
      throw Error("Unexpected dependency");
    },
  });
  let body;
  const pending = exports.list({ user: { _id: "a" }, query: {} }, { json(value) { body=value; } });
  assert.equal(ownerStarted, true); assert.equal(legacyStarted, true);
  resolveOwner({ _id: "a", savedTelecomBeneficiaries: [] });
  resolveLegacy([]);
  await pending;
  assert.equal(body.success, true);
  assert.equal(body.beneficiaries.length, 0);
  assert.ok(projections.includes("_id savedTelecomBeneficiaries savedTelecomLegacyDeleted"));
});

test("profile reuses only the middleware-validated Customer document", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../controllers/auth.controller.js"), "utf8");
  const start = source.indexOf("exports.getProfile =");
  const end = source.indexOf("\nexports.", start + 1);
  const section = source.slice(start, end);
  let reads = 0;
  class User {
    constructor() { this._id="a";this.role="CUSTOMER"; }
    static async findById() { reads++;return new User(); }
  }
  const exports = {};
  vm.runInNewContext(section, {
    exports, User, console,
    activeEduPaySchoolMemberships: async () => [],
    formatUser: u => ({ _id:u._id,role:u.role }),
  });
  const response = () => ({ status(n) { this.code=n;return this; },json(v){this.body=v;return this;} });
  const r = response();
  await exports.getProfile({user:new User()},r);
  assert.equal(r.code,200);assert.equal(reads,0);
  // A plain client-shaped object cannot bypass the database/profile check.
  await exports.getProfile({user:{_id:"a",role:"CUSTOMER"}},response());
  assert.equal(reads,1);
});