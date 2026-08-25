/*
 * Protected Amana support deliberately has no customer-wallet checkout.
 * Keep this handler so older app versions receive a clear migration error
 * instead of silently charging a wallet before Head Office review.
 */
const payAmanaOrder = async (_req, res) => {
  return res.status(410).json({
    success: false,
    code: "PROTECTED_AMANA_PAYMENT",
    message: "Protected Amana requests are reviewed, funded, and paid only to a verified provider by Head Office. Customer wallet payment is not available.",
  });
};

module.exports = { payAmanaOrder };