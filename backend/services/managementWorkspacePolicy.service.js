"use strict";
const crypto = require("crypto");
const DAY = 86400000;
const ISSUES = Object.freeze({
  PENDING_TRANSACTION: "Pending Transaction",
  FAILED_TRANSACTION: "Failed Transaction",
  SUCCESS_NO_SERVICE: "Successful Transaction but Service Not Received",
  DEBIT_NO_SERVICE: "Wallet Debit Without Service",
  DUPLICATE_TRANSACTION: "Duplicate Transaction",
  INCORRECT_AMOUNT: "Incorrect Amount",
  REFUND_REQUEST: "Refund Request",
  OTHER: "Other",
});
const fail = (message, status = 400, code) => Object.assign(new Error(message), { status, code });
const text = (value, max = 100) => {
  if (typeof value !== "string" || value.trim().length > max) throw fail(`Text must contain at most ${max} characters.`);
  return value.trim();
};
const key = value => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{12,80}$/.test(value)) throw fail("A valid request key is required.");
  return value;
};
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function activity(lastSuccessfulAt, registeredAt, _accountStatus, now = new Date()) {
  const last = lastSuccessfulAt || registeredAt;
  if (!last || !Number.isFinite(+new Date(last))) return "UNKNOWN";
  const days = Math.max(0, Math.floor((+now - +new Date(last)) / DAY));
  if (days > 60) return "INACTIVE";
  if (days > 30) return "DECLINING";
  return lastSuccessfulAt ? "ACTIVE" : "NEW";
}
function registration(query) {
  const result = {};
  for (const [name, op] of [["registeredFrom", "$gte"], ["registeredTo", "$lt"]]) {
    if (!query[name]) continue;
    if (typeof query[name] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(query[name])) throw fail("Registration dates must use YYYY-MM-DD.");
    const date = new Date(query[name] + "T00:00:00.000Z");
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== query[name]) throw fail("Invalid registration date.");
    result[op] = new Date(+date - 3600000 + (op === "$lt" ? DAY : 0));
  }
  if (result.$gte && result.$lt && result.$gte >= result.$lt) throw fail("Registration dates must be ordered.");
  return Object.keys(result).length ? { createdAt: result } : null;
}
function attachments(input = []) {
  if (!Array.isArray(input) || input.length > 2) throw fail("Attach at most two screenshots per submission.");
  return input.map(item => {
    const match = typeof item?.dataUrl === "string" && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(item.dataUrl);
    if (!match || match[2].length > 349528) throw fail("Screenshots must be PNG, JPEG or WebP, at most 256 KiB each.");
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 262144 || bytes.toString("base64") !== match[2]) throw fail("Invalid screenshot encoding.");
    const magic = match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!magic) throw fail("Screenshot contents do not match the selected image type.");
    const name = text(item.name || "screenshot", 100).replace(/[\\/\u0000-\u001f\u007f]/g, "_");
    return { name, mimeType: "image/" + match[1], dataUrl: item.dataUrl };
  });
}
function complaintIntent(actorId, body, customerId, transactionId) {
  const requestKey = key(body.idempotencyKey);
  const issue = text(body.issueCategory, 40);
  if (!Object.hasOwn(ISSUES, issue)) throw fail("Choose a supported complaint category.");
  const description = text(body.description, 3500);
  if (description.length < 10) throw fail("Describe the issue in at least 10 characters.");
  const images = attachments(body.attachments);
  return {
    idempotencyKey: `management:${actorId}:${requestKey}`,
    // Both these unique keys already exist in the Support collection. A logical
    // issue cannot race into two cases even when different managers submit it.
    caseReference: "SPMC-" + hash([String(customerId), String(transactionId), issue]).slice(0, 40).toUpperCase(),
    fingerprint: hash([String(customerId), String(transactionId), issue, description, images]),
    issue, description, attachments: images,
  };
}
const WITHDRAWAL_BLOCKER = Object.freeze({
  enabled: false,
  code: "COMMISSION_CUSTODY_UNVERIFIED",
  message: "Commission earnings were credited into the main wallet. Existing wallet spending and withdrawals are not allocated to individual commission records. A reviewed, approved reconciliation is required before commission-only withdrawals can be enabled. No funds have been reserved or debited.",
});
module.exports = { ISSUES, fail, text, key, hash, activity, registration, attachments, complaintIntent, WITHDRAWAL_BLOCKER, DAY };
