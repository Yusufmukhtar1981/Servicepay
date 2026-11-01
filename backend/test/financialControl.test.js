const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../services/financialControl.rules");
const oid = "000000000000000000000001";
const source = (extra = {}) => ({
  _id: oid, reference: "CONTROL-TEST", customerId: oid, serviceType: "DATA",
  provider: "TELECOM_ABODE", amount: 150, status: "SUCCESSFUL",
  createdAt: new Date("2026-11-01T23:30:00Z"),
  agentCommission: 2, stateManagerCommission: 1, zonalManagerCommission: 1,
  providerResponse: { networkName: "MTN", planName: "Historical 1GB",
    telecomAbodeSettlement: { outcome: "SUCCESS", requestIdMatches: true },
    financialAccounting: { providerCost: 100, status: "VERIFIED",
      providerFee: 1, processingFee: 2, otherDirectCosts: 3 } }, ...extra,
});
test("earned bill margin, not customer gross payment, is recorded revenue", () => {
  const row = r.transaction(source());
  assert.equal(row.transactionValue, 150);
  assert.equal(row.recordedRevenue, 50);
  assert.equal(row.providerCosts, 100);
  assert.equal(row.grossProfit, 40); // 50 margin - 4 commissions - 6 other costs.
  assert.equal(r.totals([row], 10).netProfit, null); // No complete expense attestation.
});
test("verified internal network codes receive carrier names without guessing unknown provider IDs", () => {
  for (const [code, label] of Object.entries({ "01": "MTN", "02": "Glo", "03": "9mobile", "04": "Airtel" })) {
    const row = r.transaction(source({ providerResponse: { network: code } }));
    assert.equal(row.network, label);
    assert.equal(r.reportNetwork(code), label);
  }
  assert.equal(r.reportNetwork("unrecognized-provider-network"), "unrecognized-provider-network");
  assert.equal(r.reportNetwork("AIRTEL"), "Airtel");
  assert.equal(r.reportNetwork("toString"), "toString");
});
test("provider costs already deducted in earned margin are not deducted twice", () => {
  const row = r.transaction(source(), 0);
  assert.equal(row.grossProfit, 44);
});
test("actual recorded commissions override default transaction commissions once", () => {
  assert.equal(r.transaction(source(), 500).grossProfit, 39);
});
test("unknown provider cost does not become zero-cost revenue or profit", () => {
  const row = r.transaction(source({ providerResponse: { telecomAbodeSettlement:
    { outcome: "SUCCESS", requestIdMatches: true } } }));
  assert.equal(row.recordedRevenue, null);
  assert.equal(row.grossProfit, null);
  assert.equal(r.totals([row]).providerCosts, null);
  assert.equal(r.totals([row]).missingRevenueCount, 1);
});
test("missing extra costs make gross profit unavailable even with recorded margin", () => {
  const row = r.transaction(source({ providerResponse: { providerPrice: 100,
    telecomAbodeSettlement: { outcome: "SUCCESS", requestIdMatches: true } } }));
  assert.equal(row.recordedRevenue, 50);
  assert.equal(row.grossProfit, null);
  assert.equal(row.reason, "MISSING_DIRECT_COST_EVIDENCE");
});
for (const status of ["PENDING", "FAILED", "REFUNDED", "REVERSED", "PROCESSING"]) {
  test(status + " is not earned revenue", () => {
    const row = r.transaction(source({ status }));
    assert.equal(row.recordedRevenue, 0);
    assert.equal(row.transactionValue, 0);
  });
}
test("success linked to reversal is not earned", () => {
  assert.equal(r.transaction(source({ reversalReference: "refund" })).recordedRevenue, 0);
});
test("uncorrelated provider success is not recognized", () => {
  const row = r.transaction(source({ providerResponse: { providerPrice: 100 } }));
  assert.equal(row.recordedRevenue, null);
  assert.equal(row.reason, "PROVIDER_EVIDENCE_REQUIRED");
});
test("generic zero-default servicepayProfit never proves fee revenue", () => {
  const row = r.transaction(source({ serviceType: "MARKETPLACE", servicepayProfit: 0 }));
  assert.equal(row.recordedRevenue, null);
});
for (const serviceType of ["WALLET_FUNDING", "TRANSFER", "SOLAR_DEPOSIT", "EMPOWERMENT_DISBURSEMENT"]) {
  test(serviceType + " principal never becomes sales/revenue", () => {
    const row = r.transaction(source({ serviceType }));
    assert.equal(row.transactionValue, 0);
    assert.equal(row.recordedRevenue, null);
  });
}
test("historical plan price/cost differences remain separate rows", () => {
  const first = r.transaction(source());
  const second = r.transaction(source({ amount: 180 }));
  const plans = r.planRows([first, second]);
  assert.equal(plans.length, 2);
  assert.equal(plans[0].grossMargin, 80);
  assert.equal(plans[0].marginPercent, 44.44);
});
test("reports group actual network/branch values without adding lifecycle values", () => {
  const rows = [r.transaction(source()), r.transaction(source({ status: "FAILED" }))];
  assert.equal(r.grouped(rows, "network")[0].recordedRevenue, 50);
  assert.equal(r.totals(rows).successRate, 50);
});
test("Nigeria date boundaries and range validation are explicit", () => {
  assert.equal(r.nigeriaDay("2026-11-01T23:30:00Z"), "2026-11-02");
  assert.equal(r.dateMatch(r.filters({ from: "2026-11-01", to: "2026-11-01" })).$gte.toISOString(), "2026-10-31T23:00:00.000Z");
  for (const input of [{ from: "2026-02-30" }, { branch: "bad" }, { ignored: "value" },
    { from: "2025-01-01", to: "2026-11-01" }, { network: { $ne: "" } }]) {
    assert.throws(() => r.filters(input));
  }
});
const expense = (more = {}) => ({ amount: 100, category: "HOSTING", date: "2026-10-01",
  description: "Independent hosting invoice", reference: "INVOICE-EXAMPLE", costNotAlreadyDeducted: true, ...more });
test("expense references are stable and exact retry is deterministic", () => {
  const a = r.expense(expense()), b = r.expense(expense());
  assert.equal(a.id, b.id);
  assert.equal(a.payloadHash, b.payloadHash);
});
test("different references cannot evade identical-expense fingerprint", () => {
  const a = r.expense(expense()), b = r.expense(expense({ reference: "ANOTHER-REFERENCE" }));
  assert.notEqual(a.id, b.id);
  assert.equal(a.claimId, b.claimId);
});
test("expense is not allowed without acknowledgement or valid positive amount", () => {
  for (const more of [{ costNotAlreadyDeducted: false }, { amount: 0 }, { amount: -1 },
    { amount: "100" }, { amount: Infinity }, { date: "2099-01-01" }]) assert.throws(() => r.expense(expense(more)));
});
test("document magic/content/size are checked and HTML never accepted", () => {
  assert.throws(() => r.expense(expense({ supportingDocument: { name: "evil.pdf",
    type: "application/pdf", dataBase64: Buffer.from("<html>bad</html>").toString("base64") } })));
  const doc = r.expense(expense({ supportingDocument: { name: "../../proof.pdf", type: "application/pdf",
    dataBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64") } })).value.supportingDocument;
  assert.equal(doc.type, "application/pdf");
  assert.ok(!doc.name.includes("/"));
});
test("CSV neutralizes formulas, quotes values and labels unknowns", () => {
  const { csvCell } = require("../controllers/financialControl.controller");
  assert.equal(csvCell(null), '"DATA UNAVAILABLE"');
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
});
