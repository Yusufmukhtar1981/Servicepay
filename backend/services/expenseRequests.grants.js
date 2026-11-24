"use strict";
const c = require("./expenseManagement.common");
const PERMISSIONS = Object.freeze([
  c.r.PERMISSIONS.request, c.r.PERMISSIONS.department, c.r.PERMISSIONS.approve,
  c.r.PERMISSIONS.view, c.r.PERMISSIONS.pay, c.r.PERMISSIONS.documents,
]);
const keyFor = userId => `STAFF_EXPENSE_ACCESS:${userId}`;
function permissions(row, roleId) {
  if (!row?.active || String(row.staffRoleId) !== String(roleId) ||
      row.key !== keyFor(String(row.staffUserId))) return [];
  return (row.expenseGrants || []).filter(value => PERMISSIONS.includes(value));
}
async function load(userId, roleId) {
  if (!userId || !roleId) return [];
  const row = await c.Registry.findOne({ kind: "POLICY", key: keyFor(String(userId)),
    staffUserId: userId, staffRoleId: roleId, active: true }).lean();
  return permissions(row, roleId);
}
module.exports = { PERMISSIONS, keyFor, permissions, load };
