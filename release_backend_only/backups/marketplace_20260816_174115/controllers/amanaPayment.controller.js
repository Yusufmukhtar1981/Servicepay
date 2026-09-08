const mongoose = require("mongoose");

const User = require(
  "../models/user.model"
);

const Transaction = require(
  "../models/transaction.model"
);

const AmanaOrder = require(
  "../models/amanaOrder.model"
);

/*
 * Pay for a ServicePay Amana order
 * using the customer's ServicePay wallet.
 *
 * This process:
 * 1. Verifies the transaction PIN.
 * 2. Checks the wallet balance.
 * 3. Debits the wallet.
 * 4. Creates a transaction record.
 * 5. Marks the Amana order as PAID.
 *
 * MongoDB transaction protects against
 * partial debit or duplicate payment.
 */
const payAmanaOrder = async (
  req,
  res
) => {
  const session =
    await mongoose.startSession();

  try {
    const customerId =
      req.user?._id || req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const transactionPin = String(
      req.body.transactionPin || ""
    ).trim();

    if (!/^\d{4}$/.test(transactionPin)) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter your 4-digit transaction PIN.",
      });
    }

    session.startTransaction();

    /*
     * Load the customer with the hidden
     * transactionPin field.
     */
    const customer = await User.findOne({
      _id: customerId,
      status: "ACTIVE",
    })
      .select("+transactionPin")
      .session(session);

    if (!customer) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "Customer account not found or inactive.",
      });
    }

    if (
      !customer.transactionPinSet ||
      !customer.transactionPin
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "TRANSACTION_PIN_NOT_SET",
        message:
          "Please create your transaction PIN before making this payment.",
      });
    }

    const pinIsCorrect =
      await customer.compareTransactionPin(
        transactionPin
      );

    if (!pinIsCorrect) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "INVALID_TRANSACTION_PIN",
        message:
          "Incorrect transaction PIN.",
      });
    }

    /*
     * Load the order and confirm that it
     * belongs to this customer.
     */
    const order =
      await AmanaOrder.findOne({
        _id: req.params.id,
        customer: customerId,
      }).session(session);

    if (!order) {
      await session.abortTransaction();

      return res.status(404).json({
        success: false,
        message:
          "ServicePay Amana order not found.",
      });
    }

    /*
     * Prevent cancelled or refunded orders
     * from being paid.
     */
    if (
      order.status === "CANCELLED" ||
      order.status === "REFUNDED"
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "This ServicePay Amana order cannot be paid.",
      });
    }

    /*
     * Idempotency protection.
     * Do not debit the same order twice.
     */
    if (
      order.walletDebited ||
      order.paymentStatus === "PAID" ||
      order.status === "PAID"
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "ORDER_ALREADY_PAID",
        message:
          "This ServicePay Amana order has already been paid.",
      });
    }

    if (
      order.status !== "PENDING_PAYMENT" ||
      order.paymentStatus !== "PENDING"
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "This order is not currently awaiting payment.",
      });
    }

    const amountToPay = Number(
      order.totalAmount
    );

    if (
      !Number.isFinite(amountToPay) ||
      amountToPay <= 0
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        message:
          "The Amana order amount is invalid.",
      });
    }

    if (
      Number(customer.walletBalance) <
      amountToPay
    ) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_BALANCE",
        message:
          "Insufficient wallet balance. Please fund your wallet and try again.",
        data: {
          walletBalance:
            Number(
              customer.walletBalance
            ) || 0,

          requiredAmount: amountToPay,

          shortage: Number(
            (
              amountToPay -
              Number(
                customer.walletBalance
              )
            ).toFixed(2)
          ),
        },
      });
    }

    /*
     * Atomic wallet debit.
     *
     * The walletBalance condition ensures
     * another simultaneous request cannot
     * spend more than the available balance.
     */
    const updatedCustomer =
      await User.findOneAndUpdate(
        {
          _id: customerId,

          status: "ACTIVE",

          walletBalance: {
            $gte: amountToPay,
          },
        },
        {
          $inc: {
            walletBalance:
              -amountToPay,

            totalTransactions: 1,
          },
        },
        {
          new: true,
          session,
        }
      );

    if (!updatedCustomer) {
      await session.abortTransaction();

      return res.status(400).json({
        success: false,
        code: "INSUFFICIENT_BALANCE",
        message:
          "Insufficient wallet balance. Please fund your wallet and try again.",
      });
    }

    /*
     * A deterministic payment reference
     * prevents duplicate transaction records.
     */
    const paymentReference =
      `AMANA-PAY-${order.reference}`;

    const transactions =
      await Transaction.create(
        [
          {
            reference:
              paymentReference,

            customerId:
              customer._id,

            agentId:
              customer.agentId ||
              null,

            stateManagerId:
              customer.stateManagerId ||
              null,

            zonalManagerId:
              customer.zonalManagerId ||
              null,

            serviceType: "AMANA",

            provider:
              "SERVICEPAY_WALLET",

            phone:
              order.beneficiary?.phone ||
              customer.phone ||
              null,

            amount: amountToPay,

            agentCommission: 0,

            stateManagerCommission: 0,

            zonalManagerCommission: 0,

            /*
             * For now, the service fee is
             * treated as ServicePay profit.
             */
            servicepayProfit:
              Number(
                order.serviceFee
              ) || 0,

            status: "SUCCESSFUL",

            providerResponse: {
              amanaOrderId:
                order._id,

              amanaReference:
                order.reference,

              category:
                order.category,

              title:
                order.title,

              beneficiaryName:
                order.beneficiary
                  ?.fullName,

              walletBalanceBefore:
                Number(
                  customer.walletBalance
                ),

              walletBalanceAfter:
                Number(
                  updatedCustomer.walletBalance
                ),

              paidAt: new Date(),
            },
          },
        ],
        {
          session,
        }
      );

    const paymentTransaction =
      transactions[0];

    /*
     * Mark the Amana order as paid.
     */
    order.paymentStatus = "PAID";

    order.status = "PAID";

    order.walletDebited = true;

    order.paidAt = new Date();

    order.paymentTransaction =
      paymentTransaction._id;

    await order.save({
      session,
    });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,

      message:
        "ServicePay Amana payment completed successfully.",

      data: {
        order:
          order.toSafeObject(),

        transaction: {
          id:
            paymentTransaction._id,

          reference:
            paymentTransaction.reference,

          amount:
            paymentTransaction.amount,

          status:
            paymentTransaction.status,

          serviceType:
            paymentTransaction.serviceType,

          createdAt:
            paymentTransaction.createdAt,
        },

        walletBalance:
          Number(
            updatedCustomer.walletBalance
          ),
      },
    });
  } catch (error) {
    try {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
    } catch (abortError) {
      console.error(
        "Amana payment abort error:",
        abortError
      );
    }

    console.error(
      "Pay Amana order error:",
      error
    );

    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,
        message:
          "ServicePay Amana order not found.",
      });
    }

    if (
      error?.code === 11000
    ) {
      return res.status(400).json({
        success: false,
        code: "DUPLICATE_PAYMENT",
        message:
          "This ServicePay Amana order has already been paid.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to complete the ServicePay Amana payment.",
    });
  } finally {
    await session.endSession();
  }
};

module.exports = {
  payAmanaOrder,
};