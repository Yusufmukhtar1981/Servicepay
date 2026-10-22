const test = require("node:test");
const assert = require("node:assert/strict");
const { billPurchaseState } = require("../services/billPurchaseState.service");

for (const serviceType of ["DATA", "AIRTIME"]) {
  for (const [status, dispatchStatus, expected] of [
    ["PENDING", "READY", "INITIATED"],
    ["PENDING", "CLAIMED", "PROCESSING"],
    ["PENDING", "SENDING", "PROCESSING"],
    ["PENDING", "UNKNOWN", "PENDING_VERIFICATION"],
    ["PENDING", null, "PENDING_VERIFICATION"],
    ["SUCCESSFUL", "UNKNOWN", "SUCCESS"],
    ["FAILED", "UNKNOWN", "FAILED"],
    ["REFUNDED", "UNKNOWN", "REFUNDED"],
  ]) {
    test(`${serviceType}: ${status}/${dispatchStatus} displays ${expected} without changing custody`, () => {
      const tx = Object.freeze({ serviceType, status, dispatchStatus });
      const projected = billPurchaseState(tx);
      assert.equal(projected.processingStatus, expected);
      assert.equal(projected.verificationRequired, expected === "PENDING_VERIFICATION");
      assert.equal(tx.status, status);
      if (expected === "PENDING_VERIFICATION") {
        assert.equal(projected.verificationMessage,
          "Your transaction is being verified. Please do not repeat this purchase.");
      }
    });
  }
}
test("other services and malformed records are not changed", () => {
  for (const tx of [undefined, {}, { serviceType: "ELECTRICITY" }, { serviceType: "TRANSFER" }]) {
    assert.deepEqual(billPurchaseState(tx), {});
  }
});
