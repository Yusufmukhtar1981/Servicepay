const test = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "student-link-contract-test-secret";
const links = require("../services/edupayStudentLink.service");

test("student-link tokens are opaque and round-trip only through verification", () => {
  const child = { _id: "507f1f77bcf86cd799439011" };
  const token = links.childToken(child, "507f1f77bcf86cd799439012");
  assert.equal(typeof token, "string");
  assert.equal(token.includes(child._id), false);
  const payload = links.verifyChildToken(token);
  assert.equal(payload.childId, child._id);
  assert.equal(payload.schoolId, "507f1f77bcf86cd799439012");
  assert.equal(payload.typ, "EDUPAY_CHILD_LINK");
});

test("admission matching is whitespace-insensitive and case-insensitive", () => {
  assert.equal(links.normalizeAdmission(" ab 001 "), "AB001");
  assert.equal(links.admissionPattern("ab 001").test(" AB001 "), true);
  assert.equal(links.admissionPattern("ab 001").test("AB002"), false);
});

test("invalid or cross-purpose tokens fail closed", () => {
  const token = links.candidateToken({ _id: "507f1f77bcf86cd799439011" }, "507f1f77bcf86cd799439012");
  assert.throws(() => links.verifyChildToken(token), /invalid or expired/i);
});