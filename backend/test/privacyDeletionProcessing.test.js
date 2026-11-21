"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createDeletionProcessor, validateCompletionEvidence, assertVerifiedOwner,
  assertNoUnsettledBalances, userErasureUpdate,
} = require("../services/privacyDeletionProcessing.service");

const actor = { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", role: "HEAD_OFFICE", fullName: "Test Administrator" };
const userId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const referenceId = "SP-PR-TEST-ONLY";
const timestamp = new Date("2026-11-21T00:00:00Z");
const evidence = () => ({
  confirmation: `DELETE ${referenceId}`,
  otherSystemsReviewed: true, processorsReviewed: true, financialObligationsReviewed: true,
  associatedDataReviewReference: "TEST ONLY: associated-data erasure case verified in disposable fixture.",
  processorRequestsReference: "TEST ONLY: no real processor request or external account exists.",
  retentionPolicyReference: "TEST ONLY: financial audit preservation policy fixture.",
  retentionScope: "TEST ONLY: preserve all financial and audit evidence; review under fixture policy.",
  retentionReviewBy: "2027-01-21T00:00:00Z",
});
const request = () => ({
  _id: "cccccccccccccccccccccccc", referenceId, subjectUser: userId,
  status: "APPROVED", requestKind: "ACCOUNT_DELETION", confirmationAccepted: true,
  ownershipVerification: { method: "PASSWORD", verifiedAt: timestamp, subjectUser: userId },
  requester: { email: "disposable@example.invalid" },
});
const query = value => ({ session() { return Promise.resolve(value); } });
function fixture(options = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const user = { _id: userId, role: "CUSTOMER", walletBalance: 0, walletHeldBalance: 0, commissionBalance: 0, ...options.user };
  const processor = createDeletionProcessor({
    users: {
      findOne: () => query(options.noUser ? null : user),
      collection: { updateOne: async (filter, update) => {
        calls.push({ model: "User", filter, update });
        return { modifiedCount: options.concurrentUserChange ? 0 : 1 };
      } },
    },
    wallets: { findOne: () => query(options.wallet || { balance: 0 }) },
    cashbackEntries: { exists: () => query(options.cashback ? { _id: "cashback" } : null) },
    transactions: { exists: filter => { calls.push({ model: "Transaction", filter }); return query(options.pending ? { _id: "pending" } : null); } },
    beneficiaries: { deleteMany: async filter => { calls.push({ model: "CustomerBeneficiary", filter }); return { deletedCount: 2 }; } },
    deviceSessions: { updateMany: async (filter, update) => { calls.push({ model: "DeviceSession", filter, update }); return { modifiedCount: 1 }; } },
    requests: {
      findOne: () => query(options.noRequest ? null : { ...request(), ...options.request }),
      updateOne: async (filter, update) => { calls.push({ model: "PrivacyRequest", filter, update }); return { modifiedCount: options.concurrentRequestChange ? 0 : 1 }; },
    },
    audits: { create: async entries => { if (options.auditFailure) throw new Error("audit unavailable"); calls.push({ model: "AdminAuditLog", entries }); } },
    reauthenticate: async (admin, password) => {
      if (password !== "unit-test-reauthentication") throw Object.assign(new Error("fresh authentication required"), { status: 401 });
    },
    startSession: async () => ({
      async withTransaction(fn) {
        try { await fn(); committed = true; } catch (error) { rolledBack = true; throw error; }
      },
      async endSession() { calls.push({ model: "Session", ended: true }); },
    }),
    now: () => timestamp,
  });
  return {
    calls, get committed() { return committed; }, get rolledBack() { return rolledBack; },
    run: (body = {}) => processor.complete({
      requestId: request()._id, actor: options.actor || actor,
      body: { currentPassword: "unit-test-reauthentication", completionEvidence: evidence(), ...body },
    }),
  };
}

test("processing rejects legacy/unverified/mismatched ownership and missing consequences confirmation", () => {
  assert.doesNotThrow(() => assertVerifiedOwner(request()));
  for (const patch of [
    { ownershipVerification: undefined },
    { ownershipVerification: { method: "PASSWORD", verifiedAt: timestamp, subjectUser: "other-customer" } },
    { confirmationAccepted: false },
  ]) assert.throws(() => assertVerifiedOwner({ ...request(), ...patch }), /verify ownership/);
});

test("completion requires recorded actual associated-system, processor and legal-retention reviews", () => {
  assert.equal(validateCompletionEvidence({ completionEvidence: evidence() }, referenceId, timestamp).mode, "HEAD_OFFICE_REVIEWED");
  for (const patch of [
    { confirmation: "DELETE DIFFERENT REQUEST" },
    { otherSystemsReviewed: false }, { processorsReviewed: false }, { financialObligationsReviewed: false },
    { associatedDataReviewReference: "" }, { processorRequestsReference: "" },
    { retentionPolicyReference: "" }, { retentionScope: "" },
    { retentionReviewBy: "invalid" }, { retentionReviewBy: "2020-01-01" },
  ]) assert.throws(() => validateCompletionEvidence({ completionEvidence: { ...evidence(), ...patch } }, referenceId, timestamp));
});

test("all visible wallet, business, commission and held balances must be exactly zero", () => {
  assert.doesNotThrow(() => assertNoUnsettledBalances({ walletBalance: 0 }, { balance: 0 }));
  for (const field of ["walletBalance", "walletHeldBalance", "businessWalletBalance", "businessWalletLockedBalance", "withdrawalLockedBalance", "commissionBalance", "solarCommissionBalance"]) {
    assert.throws(() => assertNoUnsettledBalances({ [field]: 0.000001 }, { balance: 0 }), /Outstanding balances/);
  }
  assert.throws(() => assertNoUnsettledBalances({ walletBalance: NaN }, null));
  assert.throws(() => assertNoUnsettledBalances({ walletBalance: 0 }, { balance: 1 }));
});

test("erasure update removes actual profile/authentication secrets, never money or historical references", () => {
  const update = userErasureUpdate(userId, actor._id, timestamp);
  assert.equal(update.$set.isDeleted, true);
  assert.equal(update.$set.status, "BLOCKED");
  assert.equal(update.$inc.authTokenVersion, 1);
  for (const field of ["password", "transactionPin", "address", "residentialAddress", "profilePhotoPublicId", "nin", "dateOfBirth", "accountRecoveryState", "profileContactChallenge"]) assert.equal(update.$unset[field], 1);
  for (const field of ["walletBalance", "walletHeldBalance", "commissionBalance", "referredBy", "referralCode", "ninVerificationReference", "createdAt"]) {
    assert.equal(update.$unset[field], undefined);
    assert.equal(update.$set[field], undefined);
  }
});

test("only Head Office with fresh authentication can execute completion", async () => {
  for (const role of ["CUSTOMER", "CUSTOMER_SUPPORT", "OPERATIONS_MANAGER", "AGGREGATOR", "STATE_MANAGER", "ZONAL_MANAGER"]) {
    const f = fixture({ actor: { ...actor, role } });
    await assert.rejects(f.run(), error => error.status === 403);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(f.run({ currentPassword: "incorrect" }), /fresh authentication/);
  assert.equal(f.calls.length, 0);
});

test("pending provider outcomes, outstanding funds and immutable cashback entitlements prevent erasure", async () => {
  for (const options of [{ pending: true }, { user: { walletBalance: 2 } }, { wallet: { balance: 2 } }, { cashback: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert(!f.calls.some(call => call.update || call.model === "CustomerBeneficiary"));
    assert.equal(f.committed, false);
    assert.equal(f.rolledBack, true);
  }
});

test("successful processing touches only scoped personal data, revokes credentials and inserts mandatory audit", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(f.committed, true);
  assert.equal(result.completionEvidence.financialRecordsModified, false);
  assert.equal(result.completionEvidence.savedContactsDeleted, 2);
  const lookup = f.calls.find(call => call.model === "Transaction");
  assert.equal(lookup.filter.customerId, userId);
  assert.equal(lookup.filter.user, undefined);
  const contacts = f.calls.find(call => call.model === "CustomerBeneficiary");
  assert.deepEqual(contacts.filter, { customer: userId });
  const completed = f.calls.find(call => call.model === "PrivacyRequest");
  assert.equal(completed.filter.status, "APPROVED");
  assert.equal(completed.update.$set.status, "COMPLETED");
  assert.equal(completed.update.$unset.activeRequestKey, 1);
  assert.equal(completed.update.$set.requester.email, undefined);
  assert(f.calls.some(call => call.model === "AdminAuditLog"));
  assert(!f.calls.some(call => ["Wallet", "Ledger", "CashbackEntry"].includes(call.model)));
});

test("audit failure and concurrent record changes abort completion instead of claiming partial success", async () => {
  for (const options of [{ auditFailure: true }, { concurrentUserChange: true }, { concurrentRequestChange: true }, { noRequest: true }, { noUser: true }]) {
    const f = fixture(options);
    await assert.rejects(f.run());
    assert.equal(f.committed, false);
    assert.equal(f.rolledBack, true);
    assert(f.calls.some(call => call.model === "Session" && call.ended));
  }
});
