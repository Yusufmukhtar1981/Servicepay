// One canonical eligibility definition shared by local and interstate operations.
// Administrative assignment may include OFFLINE riders, never suspended, unverified,
// inactive or BUSY riders. Automatic local delivery admission remains ONLINE only.
const eligibleRiderFilter = ({ branchId, manual = false, riderId } = {}) => ({
  ...(riderId ? { _id: riderId } : {}),
  ...(branchId ? { branchId } : {}),
  role: "DELIVERY_RIDER",
  status: "ACTIVE",
  riderVerificationStatus: "VERIFIED",
  availabilityStatus: manual ? { $in: ["ONLINE", "OFFLINE"] } : "ONLINE",
});
const riderSummary = (rider) => ({
  ...rider,
  online: rider.availabilityStatus === "ONLINE",
  riderType: "RIDER",
  verified: rider.riderVerificationStatus === "VERIFIED",
});
module.exports = { eligibleRiderFilter, riderSummary };