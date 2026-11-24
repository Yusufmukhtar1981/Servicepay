"use strict";
const c = require("./expenseManagement.common");
const { r } = c;
const TYPE = "DEPARTMENT_REQUEST";
const DEPARTMENTS = Object.freeze(["OPERATIONS", "MARKETING", "LOGISTICS", "HUMAN_RESOURCES",
  "IT_TECHNICAL", "ADMINISTRATION", "FINANCE", "DELIVERY", "CUSTOMER_SUPPORT", "AUDIT", "COMPLIANCE"]);
const department = value => r.text(value, "Department", 120).toUpperCase()
  .replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
const has = (actor, permission) => actor.permissions?.includes(permission) === true;
function portal(actor) {
  if (!actor?.id || !["HEAD_OFFICE", "STAFF"].includes(actor.role) ||
      (actor.role !== "HEAD_OFFICE" && actor.isStaff !== true) ||
      !Object.values(r.PERMISSIONS).some(permission => has(actor, permission))) {
    throw r.fail("An active authorized staff assignment is required.", 403);
  }
}
function capabilities(actor) {
  portal(actor);
  const global = actor.scope === "GLOBAL";
  const financeAccess = global && has(actor, r.PERMISSIONS.view);
  const ownDepartment = actor.department ? department(actor.department) : "";
  return {
    financeAccess, requestAccess: true,
    canCreateRequests: has(actor, r.PERMISSIONS.request) || (global && has(actor, r.PERMISSIONS.create)),
    canViewDepartmentRequests: financeAccess || (global && !!ownDepartment && has(actor, r.PERMISSIONS.department)),
    canConfigurePolicies: global && actor.role === "HEAD_OFFICE" && has(actor, r.PERMISSIONS.policy),
    canReviewRequests: global && has(actor, r.PERMISSIONS.approve),
    canRecordPayments: financeAccess && has(actor, r.PERMISSIONS.pay),
    department: ownDepartment, departments: actor.role === "HEAD_OFFICE" && financeAccess
      ? [...new Set([...DEPARTMENTS, ...(ownDepartment ? [ownDepartment] : [])])]
      : ownDepartment ? [ownDepartment] : [],
  };
}
function canReview(item, actor) {
  const access = capabilities(actor);
  return access.canReviewRequests && ["SUBMITTED", "UNDER_REVIEW", "PENDING_APPROVAL"].includes(item.status) &&
    r.canApprove({ ...item, status: "PENDING_APPROVAL" }, actor);
}
function assigned(item, actor) {
  return capabilities(actor).canReviewRequests && (item.approvalSnapshot?.steps || [])
    .some(step => [...(step.userIds || []), ...(step.backupUserIds || [])].map(String).includes(actor.id));
}
function view(item, actor) {
  const access = capabilities(actor);
  if (item.recordType !== TYPE || !(String(item.createdBy) === actor.id || access.financeAccess ||
      assigned(item, actor) || (access.canViewDepartmentRequests &&
        item.department === access.department))) throw r.fail("Expense request was not found.", 404);
}
function actions(item, actor) {
  const access = capabilities(actor), own = String(item.createdBy) === actor.id;
  const result = [];
  if (own && access.canCreateRequests && ["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(item.status)) {
    result.push("EDIT", "SUBMIT");
  }
  if (canReview(item, actor)) {
    if (item.status === "SUBMITTED") result.push("BEGIN_REVIEW");
    if (item.status !== "PENDING_APPROVAL") result.push("SEND_FOR_APPROVAL");
    result.push("APPROVE", "REJECT", "REQUEST_CHANGES");
  }
  if (access.canRecordPayments && item.status === "APPROVED") result.push("PAY");
  if ((own || (access.financeAccess && has(actor, r.PERMISSIONS.cancel))) &&
      !["PAID", "REVERSED", "CANCELLED"].includes(item.status)) result.push("CANCEL");
  return result;
}
function upload(actor) {
  const access = capabilities(actor);
  if (!access.canCreateRequests && !access.canRecordPayments) throw r.fail("Request or payment evidence upload permission is required.", 403);
}
async function document(actor, row, requestId) {
  portal(actor);
  if (requestId) {
    const item = await c.Expense.findOne({ _id: r.id(requestId), recordType: TYPE }).lean();
    if (!item) throw r.fail("Expense request was not found.", 404);
    view(item, actor);
    if (String(row.expenseId) !== requestId) {
      throw r.fail("Document was not found for this request.", 404);
    }
  } else if (row.expenseId || String(row.uploadedBy) !== actor.id) throw r.fail("Document was not found.", 404);
}
module.exports = { TYPE, DEPARTMENTS, department, has, portal, capabilities, canReview, assigned, view, actions, upload, document };
