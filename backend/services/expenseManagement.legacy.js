"use strict";
const c = require("./expenseManagement.common");
const legacy = require("./financialControl.service");
async function list(query, actor) {
  c.allow(actor, c.r.PERMISSIONS.view);
  return legacy.expenses(query);
}
async function document(id, actor) {
  c.allow(actor, c.r.PERMISSIONS.view);
  c.allow(actor, c.r.PERMISSIONS.documents);
  await c.storage.requireReady();
  const value = await legacy.document(c.r.id(id, "Historical expense ID"));
  const buffer = Buffer.from(value.dataBase64, "base64");
  require("./expenseManagement.documents").validate({ buffer, mimetype: value.type });
  if (!["application/pdf", "image/png", "image/jpeg"].includes(value.type) ||
      buffer.length !== value.size ||
      (value.sha256 && require("crypto").createHash("sha256").update(buffer).digest("hex") !== value.sha256)) {
    throw c.r.fail("Historical evidence metadata requires review; no file was delivered.", 409);
  }
  await c.append({ subjectType: "DOCUMENT", subjectId: `legacy-${id}`,
    action: "LEGACY_EXPENSE_DOCUMENT_DOWNLOADED", actor,
    reason: "Authorized historical expense evidence download; original record was not modified.",
    before: null, after: { legacyExpenseId: id } });
  return { buffer, mimeType: value.type, filename: `ServicePay-Historical-Expense-${id}.${
    value.type === "application/pdf" ? "pdf" : value.type === "image/png" ? "png" : "jpg"}` };
}
module.exports = { list, document };
