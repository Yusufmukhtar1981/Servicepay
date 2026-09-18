const test = require("node:test");
const assert = require("node:assert/strict");

const DeviceSession = require("../models/deviceSession.model");
const BiometricGrant = require("../models/biometricGrant.model");
const User = require("../models/user.model");
const biometric = require("../services/biometric.service");
const controller = require("../controllers/biometric.controller");

const original = new Map();
const replace = (object, name, value) => {
  if (!original.has(`${object.modelName || object.constructor.name}:${name}`)) {
    original.set(`${object.modelName || object.constructor.name}:${name}`, [object, name, object[name]]);
  }
  object[name] = value;
};
const restore = () => {
  for (const [object, name, value] of original.values()) object[name] = value;
  original.clear();
};
const selected = value => ({ select: async () => value });
const response = async (handler, req) => {
  const result = {};
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  };
  await handler(req, res);
  return result;
};
const user = (overrides = {}) => ({
  _id: "507f1f77bcf86cd799439011",
  status: "ACTIVE",
  authTokenVersion: 3,
  toObject() { return { _id: this._id, status: this.status, password: "secret", transactionPin: "1234", authTokenVersion: 3 }; },
  ...overrides,
});

test.afterEach(restore);

test("canonicalizes nested vectors while excluding every credential-bearing field", () => {
  const value = biometric.canonicalize({
    z: [{ b: 2, a: 1, token: "secret" }],
    a: { intentHash: "ignored", nested: { pin: "1234", keep: true } },
    biometricGrant: "ignored",
  });
  assert.deepEqual(value, { a: { nested: { keep: true } }, z: [{ a: 1, b: 2 }] });
  assert.equal(
    biometric.intentHash("transfer", "idem-1", { z: 1, a: 2 }),
    biometric.intentHash("transfer", "idem-1", { a: 2, z: 1 }),
  );
});

test("production payment operations use the exact grant constants", () => {
  assert.equal(biometric.BIOMETRIC_OPERATIONS.REQUEST_MONEY_PAYMENT, "REQUEST_MONEY_PAYMENT");
  assert.equal(biometric.BIOMETRIC_OPERATIONS.PAY_LINK_PAYMENT, "PAY_LINK_PAYMENT");
  assert.equal(biometric.BIOMETRIC_OPERATIONS.GROUP_WALLET_CONTRIBUTION, "GROUP_WALLET_CONTRIBUTION");
  assert.equal(biometric.BIOMETRIC_OPERATIONS.ORGANIZATION_PAYMENT, "ORGANIZATION_PAYMENT");
  assert.equal(biometric.BIOMETRIC_OPERATIONS.ORGANIZATION_TREASURY_WITHDRAWAL, "ORGANIZATION_TREASURY_WITHDRAWAL");
});

test("credential and grant schemas persist hashes only, never plaintext secrets", () => {
  assert.equal(DeviceSession.schema.path("credentialHash").options.select, false);
  assert.equal(BiometricGrant.schema.path("grantHash").options.select, false);
  assert.equal(DeviceSession.schema.path("credentialHash").options.required, true);
  assert.equal(BiometricGrant.schema.path("grantHash").options.required, true);
  assert.equal(DeviceSession.schema.path("credentialHash").instance, "String");
  assert.equal(BiometricGrant.schema.path("grantHash").instance, "String");
});

test("enrollment requires active user and recent password authentication", async () => {
  replace(DeviceSession, "countDocuments", async () => 0);
  let created;
  replace(DeviceSession, "create", async value => { created = value; });
  replace(DeviceSession, "findOne", () => ({ sort: async () => ({ deviceId: "device-1", expiresAt: new Date(Date.now() + 1000) }) }));
  const req = { user: user(), authAmr: ["pwd"], authTime: Math.floor(Date.now() / 1000), body: {} };
  const enrolled = await response(controller.enroll, req);
  assert.equal(enrolled.status, 201);
  assert.match(enrolled.body.credential, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.userId, req.user._id);
  assert.equal(created.credentialHash, biometric.hash(enrolled.body.credential));
  assert.equal("credential" in created, false);
  assert.equal(created.authTokenVersionAtEnrollment, 3);

  const stale = await response(controller.enroll, { ...req, authTime: Math.floor(Date.now() / 1000) - 601 });
  assert.equal(stale.status, 403);
  assert.equal(stale.body.code, "PASSWORD_REAUTH_REQUIRED");
  const inactive = await response(controller.enroll, { ...req, user: user({ status: "DISABLED" }) });
  assert.equal(inactive.status, 403);
});

test("device settings current/list expose safe state and enforce user ownership", async () => {
  const own = {
    deviceId: "device-owned",
    status: "ACTIVE",
    loginEnabled: true,
    transactionEnabled: false,
    expiresAt: new Date(),
    lastUsedAt: null,
    createdAt: new Date(),
    credentialHash: "must-not-leak",
  };
  let listQuery;
  replace(DeviceSession, "find", query => {
    listQuery = query;
    return { sort: async () => [own] };
  });
  const listed = await response(controller.devices, { user: user() });
  assert.deepEqual(listQuery, { userId: user()._id });
  assert.equal(listed.body.devices[0].deviceId, "device-owned");
  assert.equal("credentialHash" in listed.body.devices[0], false);

  let currentQuery;
  replace(DeviceSession, "findOne", query => {
    currentQuery = query;
    return Promise.resolve(own);
  });
  const current = await response(controller.currentDevice, {
    user: user(),
    query: { deviceId: "device-owned" },
    get: () => undefined,
  });
  assert.equal(current.status, undefined);
  assert.equal(current.body.device.deviceId, "device-owned");
  assert.equal(currentQuery.userId, user()._id);
  assert.equal(currentQuery.deviceId, "device-owned");
  assert.equal(currentQuery.status, "ACTIVE");
});

test("device PATCH updates independent flags and cannot update another user", async () => {
  let updateQuery;
  let update;
  replace(DeviceSession, "findOneAndUpdate", (query, changes) => {
    updateQuery = query;
    update = changes;
    return Promise.resolve({
      deviceId: "device-owned",
      loginEnabled: false,
      transactionEnabled: true,
    });
  });
  const result = await response(controller.toggle, {
    user: user(),
    params: { deviceId: "device-owned" },
    body: { loginEnabled: false },
  });
  assert.equal(result.body.device.loginEnabled, false);
  assert.deepEqual(update, { $set: { loginEnabled: false } });
  assert.equal(updateQuery.userId, user()._id);
  assert.equal(updateQuery.deviceId, "device-owned");
  assert.equal(updateQuery.status, "ACTIVE");

  replace(DeviceSession, "findOneAndUpdate", async () => null);
  const missing = await response(controller.toggle, {
    user: user(),
    params: { deviceId: "not-owned" },
    body: { transactionEnabled: true },
  });
  assert.equal(missing.status, 404);
});

test("current device only reports active owned devices", async () => {
  replace(DeviceSession, "findOne", async () => null);
  const missing = await response(controller.currentDevice, {
    user: user(),
    query: { deviceId: "revoked-or-foreign" },
    get: () => undefined,
  });
  assert.equal(missing.status, 404);
});

test("active session rejects inactive, expired, and auth-token-version-mismatched users", async () => {
  const session = {
    userId: "u1", expiresAt: new Date(Date.now() + 10000), authTokenVersionAtEnrollment: 3,
  };
  replace(DeviceSession, "findOne", () => selected(session));
  const credential = biometric.newCredential();
  await assert.doesNotReject(() => biometric.activeSession("d1", credential, { _id: "u1", authTokenVersion: 3 }));
  await assert.rejects(() => biometric.activeSession("d1", credential, { _id: "u1", authTokenVersion: 4 }), e => e.code === "TOKEN_REVOKED");
  session.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(() => biometric.activeSession("d1", credential, { _id: "u1", authTokenVersion: 3 }), /expired/);
});

test("rotation atomically changes credential and revokes previous-credential replay", async () => {
  const old = biometric.newCredential();
  const next = biometric.newCredential();
  const session = { _id: "s1", previousCredentialHash: null };
  let update;
  replace(DeviceSession, "findOneAndUpdate", (query, change) => {
    update = { query, change };
    return {
      select: async () => ({ ...session, credentialHash: biometric.hash(next), previousCredentialHash: biometric.hash(old) }),
    };
  });
  const rotated = await biometric.rotate(session, old);
  assert.equal(rotated.credential.length, 43);
  assert.equal(update.query.credentialHash, biometric.hash(old));
  assert.equal(update.change.$set.previousCredentialHash, biometric.hash(old));
  assert.equal("credential" in update.change.$set, false);

  let revoked;
  replace(DeviceSession, "findOneAndUpdate", () => ({ select: async () => null }));
  replace(DeviceSession, "findOne", () => selected({ ...session, previousCredentialHash: biometric.hash(old) }));
  replace(DeviceSession, "updateOne", async (query, change) => { revoked = { query, change }; });
  await assert.rejects(() => biometric.rotate(session, old), e => e.code === "CREDENTIAL_REPLAY");
  assert.equal(revoked.change.$set.status, "REVOKED");
  assert.ok(revoked.change.$set.reuseDetectedAt);
});

test("biometric login rotates the credential and does not expose password or PIN", async () => {
  process.env.JWT_SECRET = "biometric-test-secret";
  const old = biometric.newCredential();
  const session = { _id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 10000), authTokenVersionAtEnrollment: 3 };
  let findCalls = 0;
  replace(DeviceSession, "findOne", () => {
    findCalls++;
    return selected(findCalls === 1 ? session : session);
  });
  replace(User, "findById", () => selected(user({ _id: "u1" })));
  replace(DeviceSession, "findOneAndUpdate", () => ({
    select: async () => ({ ...session, previousCredentialHash: biometric.hash(old) }),
  }));
  const result = await response(controller.login, { body: { deviceId: "d1", credential: old }, ip: "biometric-contract-test" });
  assert.equal(result.status, undefined);
  assert.equal(result.body.success, true);
  assert.notEqual(result.body.credential, old);
  assert.equal("password" in result.body.user, false);
  assert.equal("transactionPin" in result.body.user, false);
});

test("grant creation stores operation, exact intent, idempotency key, and only grant hash", async () => {
  let created;
  replace(BiometricGrant, "create", async value => { created = value; });
  const raw = await biometric.createGrant({ userId: "u1", deviceId: "d1", operation: "wallet.transfer", intentHash: "a".repeat(64), idempotencyKey: "idem-9" });
  assert.equal(created.grantHash, biometric.hash(raw));
  assert.equal(created.operation, "wallet.transfer");
  assert.equal(created.intentHash, "a".repeat(64));
  assert.equal(created.idempotencyKey, "idem-9");
  assert.equal("grant" in created, false);
});

test("grant consumption matches exact operation/body intent and expiry", async () => {
  const grant = biometric.newCredential();
  const expected = biometric.intentHash("wallet.transfer", "idem-1", { amount: 25 });
  let query;
  replace(BiometricGrant, "findOneAndDelete", value => {
    query = value;
    return selected(value.intentHash === expected && value.operation === "wallet.transfer" && value.idempotencyKey === "idem-1" ? { grantHash: biometric.hash(grant) } : null);
  });
  await assert.doesNotReject(() => biometric.consumeGrant({ userId: "u1", deviceId: "d1", operation: "wallet.transfer", intentHash: expected, idempotencyKey: "idem-1", grant }));
  assert.equal(query.operation, "wallet.transfer");
  assert.equal(query.intentHash, expected);
  await assert.rejects(() => biometric.consumeGrant({ userId: "u1", deviceId: "d1", operation: "wallet.transfer", intentHash: "b".repeat(64), idempotencyKey: "idem-1", grant }), e => e.code === "BIOMETRIC_GRANT_INVALID");
  assert.ok(query.expiresAt.$gt instanceof Date);
});

test("final biometric request may add its bound device without changing business intent", async () => {
  const grant = biometric.newCredential();
  const operation = "TRANSFER";
  const idempotencyKey = "device-bound-intent";
  const businessIntent = { amount: 25, beneficiary: "acct-1" };
  const expected = biometric.intentHash(operation, idempotencyKey, businessIntent);
  let query;
  replace(User, "findById", () => selected(user({ transactionPin: null })));
  replace(BiometricGrant, "findOneAndDelete", value => {
    query = value;
    return selected(value.deviceId === "d1" && value.idempotencyKey === idempotencyKey && value.intentHash === expected
      ? { grantHash: biometric.hash(grant) } : null);
  });
  await assert.doesNotReject(() => biometric.authorizeTransaction({
    userId: user()._id,
    body: { ...businessIntent, idempotencyKey, deviceId: "d1", biometricGrant: grant },
    operation,
    idempotencyKey,
  }));
  assert.equal(query.deviceId, "d1");
  assert.equal(biometric.intentHash(operation, idempotencyKey, { ...businessIntent, idempotencyKey }), expected);
  await assert.rejects(() => biometric.authorizeTransaction({
    userId: user()._id,
    body: { amount: 26, deviceId: "d1", biometricGrant: grant },
    operation,
    idempotencyKey,
  }), e => e.code === "BIOMETRIC_GRANT_INVALID");
  await assert.rejects(() => biometric.authorizeTransaction({
    userId: user()._id,
    body: { ...businessIntent, deviceId: "d2", biometricGrant: grant },
    operation,
    idempotencyKey,
  }), e => e.code === "BIOMETRIC_GRANT_INVALID");
});

test("transaction authorization preserves PIN fallback and consumes biometric grants once", async () => {
  const pinUser = user({
    transactionPin: "2468",
    transactionPinSet: true,
    transactionPinFailedAttempts: 0,
    transactionPinAttemptVersion: 0,
    save: async () => {},
    setTransactionPin() {},
    markModified() {},
  });
  replace(User, "findById", () => selected(pinUser));
  replace(User, "findOneAndUpdate", () => ({
    select: async () => ({ ...pinUser, transactionPinFailedAttempts: 1, transactionPinAttemptVersion: 1 }),
  }));
  replace(User, "updateOne", async () => ({ modifiedCount: 1 }));
  assert.deepEqual(await biometric.authorizeTransaction({ userId: "u1", body: { transactionPin: "2468" }, operation: "pay", idempotencyKey: "i", session: null }), { method: "pin" });

  let consumes = 0;
  replace(BiometricGrant, "findOneAndDelete", () => ({ select: async () => (++consumes === 1 ? {} : null) }));
  const body = { deviceId: "d1", biometricGrant: biometric.newCredential(), amount: 10 };
  assert.deepEqual(await biometric.authorizeTransaction({ userId: "u1", body, operation: "pay", idempotencyKey: "i" }), { method: "biometric" });
  await assert.rejects(() => biometric.authorizeTransaction({ userId: "u1", body, operation: "pay", idempotencyKey: "i" }), e => e.code === "BIOMETRIC_GRANT_INVALID");
});

test("concurrent grant consumption has one winner", async () => {
  let claimed = false;
  replace(BiometricGrant, "findOneAndDelete", () => ({
    select: async () => {
      if (claimed) return null;
      claimed = true;
      await new Promise(resolve => setImmediate(resolve));
      return {};
    },
  }));
  const args = { userId: "u1", deviceId: "d1", operation: "pay", intentHash: "c".repeat(64), idempotencyKey: "same", grant: biometric.newCredential() };
  const results = await Promise.allSettled([biometric.consumeGrant(args), biometric.consumeGrant(args)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});