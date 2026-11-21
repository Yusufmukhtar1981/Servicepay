"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeletionVerification, identifierFilter, OTP_TTL_MS } = require("../services/privacyDeletionVerification.service");

const copy = value => structuredClone(value);
const at = (value, path) => path.split(".").reduce((object, key) => object?.[key], value);
function set(object, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  for (const key of keys) object = object[key] ||= {};
  object[last] = copy(value);
}
function matches(record, filter) {
  return Object.entries(filter).every(([path, wanted]) => {
    const value = at(record, path);
    if (wanted && typeof wanted === "object" && !(wanted instanceof Date)) {
      return Object.entries(wanted).every(([operator, expected]) => {
        if (operator === "$in") return expected.includes(value);
        if (operator === "$ne") return value !== expected;
        if (operator === "$gt") return +value > +expected;
        if (operator === "$lt") return +value < +expected;
        throw new Error(`Unsupported test filter ${operator}`);
      });
    }
    return value === wanted;
  });
}
const query = fn => {
  const promise = Promise.resolve().then(fn);
  return { then: (...args) => promise.then(...args), select() { return this; } };
};
function fixture({ verified = true, blockedContact = false, delivery = true } = {}) {
  let counter = 0;
  let timestamp = +new Date("2026-11-21T00:00:00Z");
  const records = [];
  const messages = [];
  const user = {
    _id: "111111111111111111111111", fullName: "Disposable Test Customer",
    phone: "08000000000", email: "disposable@example.invalid",
    role: "CUSTOMER", emailVerified: verified, profileRecoveryBlocked: { email: blockedContact },
  };
  const mutate = (record, update) => {
    if (!record) return null;
    for (const [key, value] of Object.entries(update.$set || {})) set(record, key, value);
    for (const [key, value] of Object.entries(update.$inc || {})) set(record, key, (at(record, key) || 0) + value);
    for (const key of Object.keys(update.$unset || {})) {
      const keys = key.split("."); const last = keys.pop();
      const parent = keys.reduce((object, part) => object?.[part], record);
      if (parent) delete parent[last];
    }
    for (const [key, value] of Object.entries(update.$push || {})) (record[key] ||= []).push(copy(value));
    return copy(record);
  };
  const requests = {
    findOne(filter) { return query(() => copy(records.find(record => matches(record, filter)) || null)); },
    findOneAndUpdate(filter, update) {
      return query(() => mutate(records.find(record => matches(record, filter)), update));
    },
    async updateOne(filter, update) {
      const updated = mutate(records.find(record => matches(record, filter)), update);
      return { modifiedCount: updated ? 1 : 0 };
    },
    async create(fields) {
      if (fields.activeRequestKey && records.some(record => record.activeRequestKey === fields.activeRequestKey)) {
        throw Object.assign(new Error("duplicate active request"), { code: 11000 });
      }
      const record = { _id: (++counter).toString(16).padStart(24, "0"), ...copy(fields) };
      records.push(record);
      return copy(record);
    },
  };
  const service = createDeletionVerification({
    requests,
    users: { findOne: filter => query(() => matches(user, filter) ? copy(user) : null) },
    sendEmail: async message => { messages.push(message); return { success: delivery }; },
    makeId: () => (++counter).toString(16).padStart(24, "0"),
    randomCode: () => "654321", secret: () => "unit-test-key-not-a-production-secret".repeat(2),
    now: () => new Date(timestamp),
    verifyPassword: async (subject, password) => Boolean(subject && password === "disposable-test-password"),
  });
  return { service, records, messages, user, advance: ms => { timestamp += ms; } };
}

test("identifiers support email and Nigerian local/international phone without accepting objects", () => {
  assert.deepEqual(identifierFilter("Customer@Example.invalid"), { email: "customer@example.invalid" });
  assert(identifierFilter("+2348000000000").phone.$in.includes("08000000000"));
  assert.equal(identifierFilter({ $ne: "" }), null);
});

test("challenge response is generic, and only the existing verified email receives a sensitive message", async () => {
  const f = fixture();
  const result = await f.service.challenge(f.user.phone);
  assert.match(result.challengeId, /^[a-f0-9]{24}\.[a-f0-9]{64}$/);
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].to, f.user.email);
  assert.equal(f.messages[0].sensitive, true);
  assert(!JSON.stringify(f.records).includes("654321"));
  assert(!JSON.stringify(result).includes(f.user.email));
  const unknown = await f.service.challenge("unknown@example.invalid");
  assert.deepEqual(Object.keys(unknown), Object.keys(result));
  assert.equal(f.messages.length, 1);
});

test("unverified and administratively blocked email contacts never receive an OTP", async () => {
  for (const options of [{ verified: false }, { blockedContact: true }]) {
    const f = fixture(options);
    await f.service.challenge(f.user.phone);
    assert.equal(f.messages.length, 0);
    assert.equal(f.records.length, 0);
  }
});

test("a correct OTP plus explicit confirmation creates one verified request and a private receipt", async () => {
  const f = fixture();
  const challenge = await f.service.challenge(f.user.phone);
  const receipt = await f.service.submit({ ...challenge, code: "654321", confirmation: true });
  assert.equal(receipt.status, "PENDING");
  assert.match(receipt.statusToken, /^[a-f0-9]{64}$/);
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0].ownershipVerification.method, "EMAIL_OTP");
  assert.equal(f.records[0].deletionVerification, undefined);
  assert.equal(f.records[0].confirmationAccepted, true);
  const status = await f.service.status(receipt);
  assert.equal(status.referenceId, receipt.referenceId);
  assert(!JSON.stringify(status).includes(f.user.email));
  assert(!JSON.stringify(status).includes(receipt.statusToken));
  await assert.rejects(f.service.submit({ ...challenge, code: "654321", confirmation: true }), /invalid or expired/);
});

test("old unverified form submissions cannot create a deletion request", async () => {
  const f = fixture();
  await assert.rejects(f.service.submit({
    fullName: f.user.fullName, phone: f.user.phone, email: f.user.email, confirmation: true,
  }), /invalid or expired/);
  assert.equal(f.records.length, 0);
});

test("password verification is available without trusting an unverified email", async () => {
  const f = fixture({ verified: false });
  const receipt = await f.service.submit({
    identifier: f.user.phone, currentPassword: "disposable-test-password", confirmation: true,
  });
  assert.equal(receipt.status, "PENDING");
  assert.equal(f.records[0].ownershipVerification.method, "PASSWORD");
  assert.equal(f.messages.length, 0);
  assert(!JSON.stringify(f.records).includes("disposable-test-password"));
});

test("wrong password, unknown account and missing confirmation are rejected without request creation", async () => {
  const f = fixture();
  for (const input of [
    { identifier: f.user.email, currentPassword: "wrong", confirmation: true },
    { identifier: "unknown@example.invalid", currentPassword: "wrong", confirmation: true },
    { identifier: f.user.email, currentPassword: "disposable-test-password", confirmation: false },
  ]) await assert.rejects(f.service.submit(input));
  assert.equal(f.records.length, 0);
});

test("OTP attempts, expiry, failed delivery and changed destinations fail closed", async () => {
  const f = fixture();
  const challenge = await f.service.challenge(f.user.phone);
  for (let i = 0; i < 5; i++) await assert.rejects(f.service.submit({ ...challenge, code: "111111", confirmation: true }));
  await assert.rejects(f.service.submit({ ...challenge, code: "654321", confirmation: true }));

  const expired = fixture();
  const old = await expired.service.challenge(expired.user.email);
  expired.advance(OTP_TTL_MS + 1);
  await assert.rejects(expired.service.submit({ ...old, code: "654321", confirmation: true }));

  const failed = fixture({ delivery: false });
  const unsent = await failed.service.challenge(failed.user.email);
  await assert.rejects(failed.service.submit({ ...unsent, code: "654321", confirmation: true }));

  const changed = fixture();
  const before = await changed.service.challenge(changed.user.email);
  changed.user.email = "replacement@example.invalid";
  await assert.rejects(changed.service.submit({ ...before, code: "654321", confirmation: true }));
});

test("status lookup requires the unguessable capability and never exposes internal staff notes", async () => {
  const f = fixture();
  const receipt = await f.service.submit({
    identifier: f.user.phone, currentPassword: "disposable-test-password", confirmation: true,
  });
  f.records[0].history.push({ status: "UNDER_REVIEW", changedAt: new Date(), note: "internal-only-compliance-note" });
  assert(!JSON.stringify(await f.service.status(receipt)).includes("internal-only-compliance-note"));
  await assert.rejects(f.service.status({ ...receipt, statusToken: "a".repeat(64) }));
  await assert.rejects(f.service.status({ ...receipt, requestId: "b".repeat(24) }));
  f.advance(31 * 24 * 60 * 60 * 1000);
  await assert.rejects(f.service.status(receipt));
});

test("concurrent independently verified submissions preserve one active request", async () => {
  const f = fixture();
  const receipts = await Promise.all(Array.from({ length: 12 }, () => f.service.submit({
    identifier: f.user.phone, currentPassword: "disposable-test-password", confirmation: true,
  })));
  assert.equal(f.records.length, 1);
  assert.equal(new Set(receipts.map(receipt => receipt.requestId)).size, 1);
});
