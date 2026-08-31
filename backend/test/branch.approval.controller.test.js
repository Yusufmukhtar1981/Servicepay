const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const controller = require("../controllers/branch.controller");
const Branch = require("../models/branch.model");
const BranchTarget = require("../models/branchTarget.model");
const Approval = require("../models/branchApprovalRequest.model");
const BranchAuditLog = require("../models/branchAuditLog.model");
const LedgerEntry = require("../models/ledgerEntry.model");

let mongo;
const models = [Branch, BranchTarget, Approval, BranchAuditLog, LedgerEntry];
const oid = () => new mongoose.Types.ObjectId();
const call = async (handler, { user, params = {}, body = {} }) => {
  const result = {};
  await handler({ user, params, body, query: {}, staffAccess: { isHeadOffice: true }, get: () => undefined }, {
    status(code) { result.status = code; return this; },
    json(payload) { result.body = payload; return this; },
  });
  return result;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "branch-approval-tests" });
  await Promise.all(models.map((model) => model.init()));
});
test.after(async () => { await mongoose.disconnect(); await mongo?.stop(); });
test.beforeEach(async () => {
  await Promise.all(models.filter((model) => model !== LedgerEntry).map((model) => model.deleteMany({})));
  await LedgerEntry.collection.deleteMany({});
});

const fixture = async () => {
  const requester = oid(); const reviewer = oid();
  const branch = await Branch.create({ code: `B${String(oid()).slice(-6)}`, name: "Approval Branch", assignedModules: ["OPS"], createdBy: requester });
  return { requester, reviewer, branch };
};
const createApproval = (branch, requester, type, details = {}) => Approval.create({
  branchId: branch._id, requestKey: String(oid()), type, title: "Request", details, status: "SUBMITTED", requestedBy: requester,
});
const targetDetails = (metric) => ({ module: "OPS", metric, period: "2026-01", periodType: "MONTHLY", startDate: new Date("2026-01-01"), endDate: new Date("2026-01-31"), category: "OPERATIONS", target: 10 });

test("approved target action completes and is applied exactly once", async () => {
  const { requester, reviewer, branch } = await fixture();
  const request = await createApproval(branch, requester, "TARGET_CREATE", targetDetails("CASES"));
  const result = await call(controller.reviewApproval, { user: { _id: reviewer }, params: { requestId: request._id }, body: { status: "APPROVED" } });
  assert.equal(result.body.request.status, "COMPLETED");
  assert.equal(result.body.request.executionStatus, "EXECUTED");
  assert.equal(await BranchTarget.countDocuments({ branchId: branch._id }), 1);
  const repeat = await call(controller.reviewApproval, { user: { _id: reviewer }, params: { requestId: request._id }, body: { status: "APPROVED" } });
  assert.equal(repeat.body.idempotent, true);
  assert.equal(await BranchTarget.countDocuments({ branchId: branch._id }), 1);
});

test("financial approval awaits its owning domain without an execution", async () => {
  const { requester, reviewer, branch } = await fixture();
  const request = await createApproval(branch, requester, "PAYMENT_TRANSFER", { amount: 999999 });
  const result = await call(controller.reviewApproval, { user: { _id: reviewer }, params: { requestId: request._id }, body: { status: "APPROVED" } });
  assert.equal(result.body.request.status, "APPROVED");
  assert.equal(result.body.request.executionStatus, "AWAITING_DOMAIN_EXECUTION");
  assert.equal(await LedgerEntry.countDocuments({}), 0);
});

test("self review is denied and rejection requires a note", async () => {
  const { requester, branch } = await fixture();
  const request = await createApproval(branch, requester, "PAYMENT_TRANSFER");
  const self = await call(controller.reviewApproval, { user: { _id: requester }, params: { requestId: request._id }, body: { status: "APPROVED" } });
  assert.equal(self.status, 403);
  const noNote = await call(controller.reviewApproval, { user: { _id: oid() }, params: { requestId: request._id }, body: { status: "REJECTED" } });
  assert.equal(noNote.status, 400);
});

test("concurrent reviews execute only one target action", async () => {
  const { requester, branch } = await fixture();
  const request = await createApproval(branch, requester, "TARGET_CREATE", targetDetails("LEADS"));
  const results = await Promise.all([oid(), oid()].map((reviewer) => call(controller.reviewApproval, { user: { _id: reviewer }, params: { requestId: request._id }, body: { status: "APPROVED" } })));
  assert.equal(results.filter((result) => !result.body.idempotent && result.body.request?.status === "COMPLETED").length, 1);
  assert.equal(await BranchTarget.countDocuments({ branchId: branch._id }), 1);
});