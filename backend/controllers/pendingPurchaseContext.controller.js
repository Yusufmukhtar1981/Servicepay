const Transaction = require("../models/transaction.model");

function createPendingPurchaseContext({ count = filter => Transaction.countDocuments(filter) } = {}) {
  return async (req, res) => {
    if (String(req.user?.role).toUpperCase() !== "CUSTOMER" || !req.user?._id)
      return res.status(403).json({ success: false, message: "Customer access only." });
    const service = String(req.query?.serviceType || "").toUpperCase();
    const phone = String(req.query?.phone || "");
    const network = String(req.query?.network || "").toUpperCase();
    const plan = String(req.query?.planCode || "");
    if (!["DATA", "AIRTIME"].includes(service) ||
        (phone && !/^0\d{10}$/.test(phone)) ||
        (network && !["MTN", "AIRTEL", "GLO", "9MOBILE"].includes(network)) ||
        plan.length > 160)
      return res.status(400).json({ success: false, message: "Invalid purchase details." });
    try {
      const filter = {
        customerId: req.user._id, serviceType: service,
        $or: [
          { status: "PENDING" },
          { status: "FAILED", dispatchStatus: { $ne: "REFUNDED" },
            debitLedgerEntryId: { $ne: null } },
        ],
      };
      const matching = { ...filter, phone };
      if (network) matching["providerResponse.network"] = network;
      if (service === "DATA" && plan) matching["providerResponse.planCode"] = plan;
      const [pendingCount, matchingPendingCount] = await Promise.all([
        count(filter), phone ? count(matching) : 0,
      ]);
      return res.json({ success: true, pendingCount, matchingPendingCount });
    } catch (_) {
      return res.status(503).json({ success: false, message: "Earlier purchase information is unavailable." });
    }
  };
}

module.exports = { createPendingPurchaseContext, getPendingPurchaseContext: createPendingPurchaseContext() };
