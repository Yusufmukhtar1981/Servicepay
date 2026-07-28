const Transaction = require("../models/transaction.model");

const getMyTransactions = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user.",
      });
    }

    const {
      page = 1,
      limit = 100,
      status,
      serviceType,
    } = req.query;

    const pageNumber = Math.max(
      parseInt(page, 10) || 1,
      1
    );

    const limitNumber = Math.min(
      Math.max(parseInt(limit, 10) || 100, 1),
      200
    );

    const filter = {
      customerId: userId,
    };

    if (status) {
      filter.status = String(status)
        .trim()
        .toUpperCase();
    }

    if (serviceType) {
      filter.serviceType = String(serviceType)
        .trim()
        .toUpperCase();
    }

    const [transactions, total] =
      await Promise.all([
        Transaction.find(filter)
          .sort({
            createdAt: -1,
          })
          .skip(
            (pageNumber - 1) *
              limitNumber
          )
          .limit(limitNumber)
          .lean(),

        Transaction.countDocuments(
          filter
        ),
      ]);

    return res.status(200).json({
      success: true,
      message:
        "Transactions fetched successfully.",
      total,
      page: pageNumber,
      limit: limitNumber,
      transactions,
      data: {
        total,
        page: pageNumber,
        limit: limitNumber,
        transactions,
      },
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

    const transaction =
      await Transaction.findOne({
        _id: req.params.id,
        customerId: userId,
      }).lean();

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
    });
  } catch (error) {
    console.error(
      "Get transaction details error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch transaction details.",
    });
  }
};

module.exports = {
  getMyTransactions,
  getTransactionById,
};
