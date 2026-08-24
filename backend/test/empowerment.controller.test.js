const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePhone,
  asMoney,
} = require("../controllers/empowerment.controller");
const Transaction = require("../models/transaction.model");
const EmpowermentPayout = require("../models/empowermentPayout.model");
const EmpowermentDisbursement = require(
  "../models/empowermentDisbursement.model"
);

test("Empowerment normalizes Nigerian beneficiary phone numbers", () => {
  assert.equal(normalizePhone("+234 803 123 4567"), "08031234567");
  assert.equal(normalizePhone("2348031234567"), "08031234567");
  assert.equal(normalizePhone("0803-123-4567"), "08031234567");
});

test("Empowerment funding rejects zero, negative and malformed amounts", () => {
  assert.equal(asMoney(0), null);
  assert.equal(asMoney(-500), null);
  assert.equal(asMoney("not-money"), null);
  assert.equal(asMoney("1200.456"), 1200.46);
});

test("Empowerment transaction and payout schemas enforce auditable records", () => {
  const serviceTypes = Transaction.schema.path("serviceType").enumValues;
  assert.ok(serviceTypes.includes("EMPOWERMENT_FUNDING"));
  assert.ok(serviceTypes.includes("EMPOWERMENT_DISBURSEMENT"));

  const payoutIndex = EmpowermentPayout.schema.indexes().find(
    ([keys, options]) =>
      keys.program === 1 &&
      keys.beneficiary === 1 &&
      options.unique === true
  );
  assert.ok(payoutIndex, "program/beneficiary payout must be unique");

  assert.equal(
    EmpowermentDisbursement.schema.path("idempotencyKey").isRequired,
    true
  );
});