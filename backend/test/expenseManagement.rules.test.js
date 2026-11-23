"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../services/expenseManagement.rules");
const owner = "100000000000000000000001", reviewer = "100000000000000000000002";
const role = "200000000000000000000001", categoryId = "300000000000000000000001";
const input = extra => ({ title: "Office supplies", categoryId, description: "Paper for internal operations",
  businessPurpose: "Internal administration", amount: "1250.25", expenseDate: "2026-11-23",
  paymentMethod: "BANK_TRANSFER", beneficiary: "Test supplier", reference: "INVOICE-TEST-1",
  department: "Administration", documentIds: ["400000000000000000000001"], ...extra });
test("NGN calculation uses exact integer kobo without rounding or assumed zero fees", () => {
  assert.equal(r.amountMinor("1250.25"), 125025);
  assert.equal(r.amountMinor("0.01"), 1);
  assert.equal(r.amountMinor(12.5), 1250);
  for (const invalid of ["0", "-1", "1.001", "1e3", "NaN", Infinity, null, {}, 0.1 + 0.2]) {
    assert.throws(() => r.amountMinor(invalid), { statusCode: 400 });
  }
});
test("creation only accepts request fields and never accepts forged approvals or submitters", () => {
  assert.equal(r.expense(input()).amountMinor, 125025);
  for (const extra of [{ status: "PAID" }, { createdBy: reviewer }, { amountMinor: 1 }, { $set: {} }]) {
    assert.throws(() => r.expense(input(extra)), /Unsupported expense field/);
  }
});
test("evidence is mandatory unless an exception reason is provided for separate authorization", () => {
  assert.throws(() => r.expense(input({ documentIds: [] })), /supporting evidence/);
  assert.equal(r.expense(input({ documentIds: [], evidenceExceptionReason: "Original invoice was lost; finance must authorize." }))
    .evidenceExceptionReason.length > 10, true);
});
test("strict dates reject overflow rather than silently moving the accounting period", () => {
  assert.equal(r.date("2024-02-29"), "2024-02-29");
  for (const value of ["2026-02-29", "2026-13-01", "2026-11-31", "invalid"]) assert.throws(() => r.date(value));
});
test("vendor/beneficiary and department/branch cannot both be absent", () => {
  assert.throws(() => r.expense(input({ beneficiary: "" })), /vendor|beneficiary/);
  assert.throws(() => r.expense(input({ department: "" })), /department or branch/);
});
test("approval policy contains no preset approvers and requires explicit step assignments", () => {
  assert.throws(() => r.approvalSteps([]));
  assert.throws(() => r.approvalSteps([{ label: "Review" }]));
  assert.deepEqual(r.approvalSteps([{ label: "Finance review", userIds: [reviewer] }]),
    [{ label: "Finance review", userIds: [reviewer], roleIds: [] }]);
});
test("self-approval and repeating the same reviewer across steps are prohibited", () => {
  const item = { status: "PENDING_APPROVAL", createdBy: owner, submittedBy: owner, approvals: [],
    approvalSnapshot: { steps: [{ userIds: [owner, reviewer], roleIds: [role] },
      { userIds: [reviewer], roleIds: [] }] } };
  assert.equal(r.canApprove(item, { id: owner, roleId: role }), false);
  assert.equal(r.canApprove(item, { id: reviewer }), true);
  assert.equal(r.canApprove({ ...item, approvals: [{ actorId: reviewer }] }, { id: reviewer }), false);
  assert.equal(r.canApprove({ ...item, status: "PAID" }, { id: reviewer }), false);
});
test("unknown reviewers cannot approve merely because they are staff", () => {
  const item = { status: "PENDING_APPROVAL", createdBy: owner, submittedBy: owner,
    approvalSnapshot: { steps: [{ userIds: [reviewer], roleIds: [] }] } };
  assert.equal(r.canApprove(item, { id: "100000000000000000000003", roleId: role }), false);
});
test("idempotency keys bind to the actual authenticated submitter", () => {
  const key = "test-request-key-0001";
  assert.equal(r.requestKey(key, owner), r.requestKey(key, owner));
  assert.notEqual(r.requestKey(key, owner), r.requestKey(key, reviewer));
  assert.throws(() => r.requestKey("short", owner));
  assert.equal(r.hash({ b: 2, a: 1 }), r.hash({ a: 1, b: 2 }));
});
test("filters are bounded and reject Mongo operator injection", () => {
  assert.throws(() => r.filters({ from: "2026-12-01", to: "2026-01-01" }));
  assert.throws(() => r.filters({ vendorId: { $ne: null } }));
  assert.throws(() => r.filters({ status: { $ne: "PAID" } }));
  assert.throws(() => r.expectedVersion(-1));
  assert.throws(() => r.expectedVersion("0"));
});
