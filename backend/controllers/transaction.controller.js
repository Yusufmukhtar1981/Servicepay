const {
  getCustomerHistory,
  getCustomerHistoryItem,
} = require("../services/customerHistory.service");

const getMyTransactions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user.",
      });
    }

    const { limit, before } = req.query;

    const history = await getCustomerHistory({
      userId,
      limit,
      before,
    });

    return res.status(200).json({
      success: true,
      message:
        "Transactions fetched successfully.",
      data: {
        transactions: history.transactions,
        pagination: history.pagination,
      },
      transactions: history.transactions,
      pagination: history.pagination,
    });
  } catch (error) {
    console.error(
      "Get transactions error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch transactions.",
    });
  }
};

const getTransactionById = async (
  req,
  res
) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user.",
      });
    }

    const transaction = await getCustomerHistoryItem({
      userId,
      lookupId: req.params.id,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message:
          "Transaction not found.",
      });
    }

    return res.status(200).json({
      success: true,
      transaction,
      data: transaction,
      statusCheck: {
        status: transaction.status,
        liveProviderCheck: false,
        message:
          "Latest recorded status loaded. Live provider requery is not available for this transaction type.",
      },
    });
  } catch (error) {
    console.error(
      "Get transaction details error:",
      error
    );

    return res.status(404).json({
      success: false,
      message:
        "Transaction not found or no longer available.",
    });
  }
};

module.exports = {
  getMyTransactions,
  getTransactionById,
};
