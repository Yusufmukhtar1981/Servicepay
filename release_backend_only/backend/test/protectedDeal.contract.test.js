const test = require("node:test");
const assert = require("node:assert/strict");
const ProtectedDeal = require("../models/protectedDeal.model");
const TrustDispute = require("../models/trustDispute.model");
const { calculateTrustScore } = require("../services/trustScore.service");
const { _customerDispute } = require("../controllers/protectedDeal.controller");
const {
  _adminDeal,
  _adminDispute,
} = require("../controllers/adminProtectedDeal.controller");

test("protected deal and dispute models expose only controlled lifecycle states", () => {
  assert.deepEqual(
    ProtectedDeal.schema.path("status").enumValues,
    ["CREATED", "FUNDED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "DISPUTED", "REFUNDED", "CANCELLED"]
  );
  assert.deepEqual(TrustDispute.schema.path("resolution").enumValues, ["", "RELEASE", "REFUND"]);
  assert.equal(ProtectedDeal.schema.path("fundingIdempotencyKey").options.unique, true);
  assert.equal(TrustDispute.schema.path("deal").options.unique, true);
});

test("trust scoring accepts only persisted protected-deal metrics supplied by the server", () => {
  const result = calculateTrustScore({
    user: { status: "ACTIVE", createdAt: "2025-01-01T00:00:00.000Z" },
    protectedMetrics: { protectedTransactionsCount: 3, completionRate: 100, resolvedDisputesCount: 1 },
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.equal(result.scoreInputs.protectedTransactionsCount, 3);
  assert.equal(result.scoreInputs.completionRate, 100);
  // base 5 + twelve months + three completed deals + completion bonus
  assert.equal(result.trustScore, 25);
});

test("the Trust score engine emits only current production levels", () => {
  const result = calculateTrustScore({
    user: { status: "ACTIVE", createdAt: "2023-01-01T00:00:00.000Z" },
    successfulIdentityVerifications: 2,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
  assert.ok(["NEW", "BASIC", "TRUSTED", "HIGHLY_TRUSTED", "RESTRICTED"].includes(result.trustLevel));
  assert.notEqual(result.trustLevel, "VERIFIED");
});

test("customer disputes exclude internal staff resolution material", () => {
  const projected = _customerDispute({
    _id: "dispute-1",
    deal: "deal-1",
    status: "RESOLVED",
    reason: "Not delivered",
    description: "Customer-visible description",
    evidenceReferences: ["internal/evidence.pdf"],
    resolution: "REFUND",
    resolutionNote: "Internal fraud review notes",
    resolvedBy: "staff-1",
  });
  assert.equal(projected.details, "Customer-visible description");
  assert.equal(projected.resolution, "REFUND");
  assert.equal(Object.hasOwn(projected, "resolutionNote"), false);
  assert.equal(Object.hasOwn(projected, "resolvedBy"), false);
  assert.equal(Object.hasOwn(projected, "evidenceReferences"), false);
});

test("admin DTOs expose safe party names and submitted dispute detail", () => {
  const deal = _adminDeal({
    _id: "deal-1",
    buyer: { _id: "buyer-1", fullName: "Buyer Name" },
    seller: { _id: "seller-1", fullName: "Seller Name" },
    amount: 5000,
    currency: "NGN",
    title: "Laptop repair",
    status: "DISPUTED",
  });
  const dispute = _adminDispute({
    _id: "dispute-1",
    deal: { _id: "deal-1", reference: "TPD-1", title: "Laptop repair" },
    openedBy: { _id: "buyer-1", fullName: "Buyer Name" },
    buyer: { _id: "buyer-1", fullName: "Buyer Name" },
    seller: { _id: "seller-1", fullName: "Seller Name" },
    reason: "Not delivered",
    description: "The agreed delivery date passed.",
    evidenceReferences: ["trust/evidence-1.pdf"],
    status: "OPEN",
  });
  assert.equal(deal.buyer.displayName, "Buyer Name");
  assert.equal(deal.seller.displayName, "Seller Name");
  assert.equal(dispute.details, "The agreed delivery date passed.");
  assert.deepEqual(dispute.evidenceReferences, ["trust/evidence-1.pdf"]);
});