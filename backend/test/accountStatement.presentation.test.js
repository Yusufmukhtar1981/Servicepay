"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const statements = require("../services/accountStatement.service");

test("balanced entries retain exact running balances and empty-period anchors", () => {
  const previous = { closingBalance: 100 };
  const entries = [
    { createdAt: new Date("2026-11-01T09:00:00Z"), reference: "DEBIT-1",
      openingBalance: 100, closingBalance: 80, amount: 20, direction: "DEBIT" },
    { createdAt: new Date("2026-11-01T10:00:00Z"), reference: "CREDIT-1",
      openingBalance: 80, closingBalance: 90, amount: 10, direction: "CREDIT" },
  ];
  const result = statements.reconcileRows({ previous, entries, transactions: [],
    customer: { walletBalance: 90 }, currentPeriod: true });
  assert.equal(result.openingMinor, 10000);
  assert.equal(result.closingMinor, 9000);
  assert.deepEqual(result.rows.map(r => r.balanceMinor), [8000, 9000]);
  const empty = statements.reconcileRows({ previous, entries: [], transactions: [],
    customer: { walletBalance: 100 }, currentPeriod: true });
  assert.equal(empty.openingMinor, empty.closingMinor);
  assert.equal(empty.rows.length, 0);
  assert.throws(() => statements.reconcileRows({ previous: null, entries: [],
    transactions: [], customer: { walletBalance: 100 } }), /opening/);
});

test("PDF includes posted running balance and preserves a real PDF signature", async () => {
  const PDFDocument = require("pdfkit");
  const originalText = PDFDocument.prototype.text;
  const text = [];
  PDFDocument.prototype.text = function (value, ...args) {
    text.push(String(value));
    return originalText.call(this, value, ...args);
  };
  let bytes;
  try {
    bytes = await statements.pdf({ customer: { fullName: "Statement Fixture", customerId: "TEST" },
    start: "2026-11-01", end: "2026-11-01", openingMinor: 10000, closingMinor: 8000,
    creditsMinor: 0, debitsMinor: 2000, rows: [{
      date: new Date("2026-11-01T09:00:00Z"), reference: "DEBIT-1", description: "Purchase",
      type: "DEBIT", status: "SUCCESS", debitMinor: 2000, creditMinor: 0, balanceMinor: 8000,
    }] });
  } finally {
    PDFDocument.prototype.text = originalText;
  }
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert(bytes.length > 1000);
  assert(text.includes("Balance: NGN 80.00"));
});
