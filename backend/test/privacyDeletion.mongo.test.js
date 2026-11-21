"use strict";

// Self-contained localhost replica set. Never reads MONGODB_URI or connects to
// an ambient database; no provider transport or production credential is used.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { createDeletionVerification } = require("../services/privacyDeletionVerification.service");
const { createDeletionProcessor } = require("../services/privacyDeletionProcessing.service");

test("real Mongo transactions preserve financial records, roll back failed erasure, and complete one verified request", {
  timeout: 90000,
  skip: !process.env.SERVICEPAY_TEST_MONGOD,
}, async () => {
  const binary = await fs.realpath(process.env.SERVICEPAY_TEST_MONGOD);
  assert(binary.endsWith("mongod-x64-ubuntu-7.0.14"), "Use the explicitly approved cached test binary.");
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "servicepay-deletion-local-"));
  const child = spawn(binary, ["--bind_ip", "127.0.0.1", "--port", String(port),
    "--dbpath", directory, "--replSet", "privacy_local_test", "--wiredTigerCacheSizeGB", "0.25",
    "--logpath", path.join(directory, "mongod.log")], { stdio: "ignore" });
  let bootstrap;
  try {
    mongoose.set("autoCreate", false);
    mongoose.set("autoIndex", false);
    const direct = `mongodb://127.0.0.1:${port}/admin?directConnection=true`;
    const deadline = Date.now() + 20000;
    while (!bootstrap) {
      try { bootstrap = await mongoose.createConnection(direct, { serverSelectionTimeoutMS: 400 }).asPromise(); }
      catch (error) { if (Date.now() > deadline || child.exitCode != null) throw new Error("Disposable local Mongo failed to start."); }
    }
    await bootstrap.db.admin().command({
      replSetInitiate: { _id: "privacy_local_test", members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
    });
    while (!(await bootstrap.db.admin().command({ hello: 1 })).isWritablePrimary) {
      if (Date.now() > deadline) throw new Error("Disposable replica election timed out.");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    await bootstrap.close(); bootstrap = null;
    await mongoose.connect(`mongodb://127.0.0.1:${port}/servicepay_test_privacy?replicaSet=privacy_local_test`,
      { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    assert.equal(mongoose.connection.host, "127.0.0.1");
    const startupReadiness = require("../services/startupReadiness.service");
    startupReadiness.configure();

    const User = require("../models/user.model");
    const Wallet = require("../models/wallet.model");
    const Transaction = require("../models/transaction.model");
    const Beneficiary = require("../models/customerBeneficiary.model");
    const DeviceSession = require("../models/deviceSession.model");
    const PrivacyRequest = require("../models/privacyRequest.model");
    const Audit = require("../models/adminAuditLog.model");
    const Cashback = require("../models/cashbackEntry.model");
    const models = [User, Wallet, Transaction, Beneficiary, DeviceSession, PrivacyRequest, Audit, Cashback];
    for (const model of models) {
      assert.equal(model.db, mongoose.connection);
      await model.createCollection();
    }
    await PrivacyRequest.collection.createIndex({ activeRequestKey: 1 }, { unique: true, sparse: true });
    await PrivacyRequest.collection.createIndex({ referenceId: 1 }, { unique: true, sparse: true });
    // Satisfy the real runtime startup guards with empty, disposable fixtures.
    // Never disable those guards or substitute a fake successful verification.
    for (const spec of startupReadiness.manifest) {
      const db = mongoose.connection.db;
      if (!(await db.listCollections({ name: spec.collection }).hasNext())) {
        await db.createCollection(spec.collection);
      }
      await db.collection(spec.collection).createIndex(spec.key, {
        name: `local_${spec.id}`, unique: true,
        ...(spec.sparse ? { sparse: true } : {}),
        ...(spec.partial ? { partialFilterExpression: spec.partial } : {}),
      });
    }
    const readiness = await startupReadiness.verify(mongoose.connection);
    assert.equal(readiness.ready, true);
    assert.equal(readiness.writes, 0);
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();
    const password = "disposable-local-password";
    const hash = await bcrypt.hash(password, 12);
    await User.collection.insertMany([
      { _id: userId, role: "CUSTOMER", fullName: "Disposable Local Customer", phone: "08000000000",
        email: "local@example.invalid", emailVerified: true, status: "ACTIVE", password: hash,
        walletBalance: 0, walletHeldBalance: 0, commissionBalance: 0, authTokenVersion: 0,
        address: "Disposable fixture address", nin: "TEST-NOT-REAL-NIN", profilePhotoPublicId: "test-only-fixture",
        transactionPin: "test-only-hash", referredBy: adminId, referralCode: "LOCAL-REFERRAL" },
      { _id: adminId, role: "HEAD_OFFICE", fullName: "Disposable Local Admin", phone: "08000000001",
        password: hash, authTokenVersion: 0, status: "ACTIVE" },
    ]);
    await Wallet.collection.insertOne({ user: userId, balance: 0 });
    await Transaction.collection.insertOne({ reference: "LOCAL-FINANCIAL-AUDIT", customerId: userId,
      amount: 100, status: "SUCCESS", serviceType: "DATA", immutableFixture: true });
    await Beneficiary.collection.insertOne({ customer: userId, phone: "08000000002", name: "Local saved contact" });
    await DeviceSession.collection.insertOne({ userId, deviceId: "local-test-device", familyId: "local-family",
      credentialHash: "a".repeat(64), status: "ACTIVE", loginEnabled: true, transactionEnabled: true });
    const walletBefore = await Wallet.collection.findOne({ user: userId });
    const transactionBefore = await Transaction.collection.findOne({ customerId: userId });
    const verification = createDeletionVerification({
      users: User, requests: PrivacyRequest, sendEmail: async () => { throw new Error("No email is allowed in this test."); },
      makeId: () => new mongoose.Types.ObjectId(), secret: () => "local-test-only-key".repeat(4),
    });
    await assert.rejects(verification.submit({ identifier: "unknown@example.invalid", currentPassword: "wrong", confirmation: true }));
    const receipt = await verification.submit({ identifier: "08000000000", currentPassword: password, confirmation: true });
    const recorded = await PrivacyRequest.findById(receipt.requestId).lean();
    assert.equal(+recorded.processingDeadlineAt - +recorded.submittedAt, 30 * 24 * 60 * 60 * 1000);
    await PrivacyRequest.updateOne({ _id: receipt.requestId }, { $set: { status: "APPROVED" } });

    const base = {
      users: User, wallets: Wallet, cashbackEntries: Cashback, transactions: Transaction,
      beneficiaries: Beneficiary, deviceSessions: DeviceSession, requests: PrivacyRequest,
      startSession: () => mongoose.startSession(),
      reauthenticate: require("../services/accountRecovery.service").reauthenticate,
    };
    const input = {
      requestId: receipt.requestId,
      actor: { _id: adminId, role: "HEAD_OFFICE", fullName: "Local Administrator", authTokenVersion: 0 },
      body: { currentPassword: password, completionEvidence: {
        confirmation: `DELETE ${receipt.referenceId}`,
        associatedDataReviewReference: "LOCAL TEST: all personal data belongs to this disposable fixture.",
        processorRequestsReference: "LOCAL TEST: no real processor or third-party account exists.",
        retentionPolicyReference: "LOCAL TEST: preserve immutable financial and audit fixture records.",
        retentionScope: "LOCAL TEST: financial evidence retained; policy review recorded for test only.",
        retentionReviewBy: new Date(Date.now() + 86400000).toISOString(),
        otherSystemsReviewed: true, processorsReviewed: true, financialObligationsReviewed: true,
      } },
    };
    const failure = createDeletionProcessor({ ...base, audits: { create: async () => { throw new Error("intentional test audit failure"); } } });
    await assert.rejects(failure.complete(input), /intentional test audit failure/);
    assert.equal((await User.findById(userId)).fullName, "Disposable Local Customer");
    assert.equal(await Beneficiary.countDocuments({ customer: userId }), 1);
    assert.equal((await PrivacyRequest.findById(receipt.requestId)).status, "APPROVED");
    assert.equal((await DeviceSession.findOne({ userId })).status, "ACTIVE");

    const processor = createDeletionProcessor({ ...base, audits: Audit });
    await processor.complete(input);
    const deleted = await User.collection.findOne({ _id: userId });
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.authTokenVersion, 1);
    assert.equal(deleted.password, undefined);
    assert.equal(deleted.transactionPin, undefined);
    assert.equal(deleted.nin, undefined);
    assert.equal(deleted.address, undefined);
    assert.equal(deleted.profilePhotoPublicId, undefined);
    assert.equal(String(deleted.referredBy), String(adminId));
    assert.equal(deleted.referralCode, "LOCAL-REFERRAL");
    assert.equal(await Beneficiary.countDocuments({ customer: userId }), 0);
    const device = await DeviceSession.collection.findOne({ userId });
    assert.equal(device.status, "REVOKED");
    assert.equal(device.credentialHash, undefined);
    assert.deepEqual(await Wallet.collection.findOne({ user: userId }), walletBefore);
    assert.deepEqual(await Transaction.collection.findOne({ customerId: userId }), transactionBefore);
    assert.equal(await Audit.countDocuments({ action: "PRIVACY_REQUEST_UPDATED", "metadata.operation": "ACCOUNT_DELETION_COMPLETED" }), 1);
    assert.equal((await verification.status(receipt)).status, "COMPLETED");
    await assert.rejects(processor.complete(input), /Only an approved/);
    assert.equal(await Audit.countDocuments({ action: "PRIVACY_REQUEST_UPDATED", "metadata.operation": "ACCOUNT_DELETION_COMPLETED" }), 1);

    // The production address-book feature may never have been used. Deletion
    // must not implicitly provision its absent optional collection.
    assert.equal(mongoose.connection.db.databaseName, "servicepay_test_privacy");
    await Beneficiary.collection.drop(); // Disposable localhost fixture only.
    const secondUser = new mongoose.Types.ObjectId();
    await User.collection.insertOne({
      _id: secondUser, role: "CUSTOMER", fullName: "Second Disposable Fixture",
      phone: "08000000003", password: hash, status: "ACTIVE", walletBalance: 0,
    });
    const secondReceipt = await verification.submit({
      identifier: "08000000003", currentPassword: password, confirmation: true,
    });
    await PrivacyRequest.updateOne({ _id: secondReceipt.requestId }, { $set: { status: "APPROVED" } });
    await processor.complete({
      ...input, requestId: secondReceipt.requestId,
      body: { ...input.body, completionEvidence: {
        ...input.body.completionEvidence, confirmation: `DELETE ${secondReceipt.referenceId}`,
      } },
    });
    assert.equal((await mongoose.connection.db.listCollections({ name: Beneficiary.collection.name }).toArray()).length, 0);
  } finally {
    await bootstrap?.close().catch(() => {});
    await mongoose.disconnect();
    if (child.exitCode == null) {
      const exit = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exit;
    }
    // This directory was exclusively created by this test, contains only
    // disposable localhost fixtures, and is never an application/database path.
    await fs.rm(directory, { recursive: true, force: true });
  }
});
