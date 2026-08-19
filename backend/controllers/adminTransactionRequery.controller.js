const Transaction = require("../models/transaction.model");

/**
 * HEAD OFFICE central ServicePay transaction lookup/requery.
 *
 * IMPORTANT:
 * This endpoint does NOT mutate wallet balances or transaction status.
 * It returns the authoritative status currently stored in ServicePay.
 * Provider-specific live requery can be added later service-by-service.
 */
exports.adminRequeryTransaction = async (req, res) => {
  try {
    const rawReference =
      req.body?.reference ??
      req.body?.transactionReference ??
      req.body?.transaction_reference ??
      req.query?.reference;

    const reference = String(rawReference || "").trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Transaction reference is required.",
      });
    }

    const transaction = await Transaction.findOne({
      reference: {
        $regex: `^${reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        $options: "i",
      },
    })
      .populate("customerId", "fullName name phone email role status")
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "ServicePay transaction was not found.",
        reference,
      });
    }

    const customer = transaction.customerId || null;

    return res.status(200).json({
      success: true,
      message: "Transaction found successfully.",
      source: "SERVICEPAY_TRANSACTION_LEDGER",
      liveProviderRequery: false,
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        serviceType: transaction.serviceType,
        status: transaction.status,
        amount: transaction.amount,
        description: transaction.description || null,

        customer: customer
          ? {
              id: customer._id,
              name: customer.fullName || customer.name || null,
              phone: customer.phone || null,
              email: customer.email || null,
              role: customer.role || null,
              status: customer.status || null,
            }
          : null,

        providerResponse: transaction.providerResponse ?? null,

        aggregatorCommission: transaction.aggregatorCommission ?? 0,
        stateManagerCommission: transaction.stateManagerCommission ?? 0,
        zonalManagerCommission: transaction.zonalManagerCommission ?? 0,
        servicepayProfit: transaction.servicepayProfit ?? 0,

        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
      },
    });
  } catch (error) {
    console.error("ADMIN CENTRAL TRANSACTION REQUERY ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to query this transaction right now.",
    });
  }
};
