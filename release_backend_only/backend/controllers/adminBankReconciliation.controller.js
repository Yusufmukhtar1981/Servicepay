const BankTransfer = require("../models/bankTransfer.model");

const statuses = new Set([
  "PENDING", "PROCESSING", "SUCCESSFUL", "FAILED", "REFUNDED",
]);

exports.listBankReconciliation = async (req, res) => {
  try {
    const query = {};
    const status = String(req.query.status || "").trim().toUpperCase();
    if (status && status !== "ALL") {
      if (!statuses.has(status)) {
        return res.status(400).json({ success: false, message: "Invalid reconciliation status." });
      }
      query.status = status;
    }
    const search = String(req.query.search || "").trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { reference: { $regex: escaped, $options: "i" } },
        { providerReference: { $regex: escaped, $options: "i" } },
        { accountNumber: { $regex: escaped, $options: "i" } },
        { accountName: { $regex: escaped, $options: "i" } },
      ];
    }
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if (from && !Number.isNaN(from.getTime())) query.createdAt = { $gte: from };
    if (to && !Number.isNaN(to.getTime())) {
      query.createdAt = { ...(query.createdAt || {}), $lte: to };
    }
    const records = await BankTransfer.find(query)
      .populate("sender", "fullName name phone email")
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(Number(req.query.limit || 100), 1), 200))
      .lean();
    return res.json({
      success: true,
      records: records.map((record) => ({
        ...record,
        reconciliationEligible: ["PENDING", "PROCESSING", "FAILED"].includes(record.status),
        safeAction: record.status === "SUCCESSFUL" || record.status === "REFUNDED"
          ? "NO_ACTION"
          : record.requeryInProgress ? "PROCESSING" : "REQUERY",
      })),
    });
  } catch (error) {
    console.error("Admin bank reconciliation list error:", error);
    return res.status(500).json({ success: false, message: "Unable to load bank reconciliation records." });
  }
};