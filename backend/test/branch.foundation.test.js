const test = require("node:test");
const assert = require("node:assert/strict");
const BranchTarget = require("../models/branchTarget.model");
const { isUserWithinScope } = require("../middleware/staffPermission.middleware");

test("Branch A staff cannot access Branch B staff", () => {
  const branchA = "000000000000000000000001";
  const branchB = "000000000000000000000002";
  assert.equal(isUserWithinScope({ scope: { type: "BRANCH", branchId: branchA } }, { branchId: branchA }), true);
  assert.equal(isUserWithinScope({ scope: { type: "BRANCH", branchId: branchA } }, { branchId: branchB }), false);
});

test("target status is on track at 75 percent, achieved and exceeded", () => {
  const target = new BranchTarget({ branchId: "000000000000000000000001", module: "OPS", metric: "CASES", period: "2025-01", periodType: "MONTHLY", startDate: new Date(), endDate: new Date(), category: "OPERATIONS", target: 100, actual: 75, createdBy: "000000000000000000000002" });
  assert.equal(target.refreshStatus(), "ON_TRACK");
  target.actual = 100;
  assert.equal(target.refreshStatus(), "ACHIEVED");
  target.actual = 101;
  assert.equal(target.refreshStatus(), "EXCEEDED_TARGET");
});

test("approval request keys are unique within a branch", () => {
  const Approval = require("../models/branchApprovalRequest.model");
  const indexes = Approval.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.branchId === 1 && fields.requestKey === 1 && options.unique === true));
});