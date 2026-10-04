const mongoose = require("mongoose");

const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const Transaction = require("../models/transaction.model");
const RiderWalletLedger = require("../models/riderWalletLedger.model");

/*
|--------------------------------------------------------------------------
| CREDIT RIDER COMMISSION
|--------------------------------------------------------------------------
|
| Commission is credited only when:
|
| 1. Delivery status is DELIVERED
| 2. Payment is PAID with an exact successful Delivery transaction
| 3. Delivery has a valid fee and an assigned Rider
| 4. Commission has not been credited before
|
| MongoDB transaction prevents duplicate credit.
|
*/

const creditRiderCommissionIfEligible =
  async ({
    deliveryId,
    riderId,
  }) => {
    const session =
      await mongoose.startSession();

    let result = {
      credited: false,
      amount: 0,
      servicepayProfit: 0,
      reason: "",
    };

    try {
      await session.withTransaction(
        async () => {
          const delivery =
            await Delivery.findById(
              deliveryId
            ).session(session);

          if (!delivery) {
            result.reason =
              "DELIVERY_NOT_FOUND";
            return;
          }

          if (
            String(delivery.status)
              .toUpperCase() !==
            "DELIVERED"
          ) {
            result.reason =
              "DELIVERY_NOT_COMPLETED";
            return;
          }

          if (delivery.paymentStatus !== "PAID") {
            result.reason = "DELIVERY_NOT_PAID";
            return;
          }


          if (!delivery.assignedRiderId) {
            result.reason =
              "NO_ASSIGNED_RIDER";
            return;
          }

          const assignedRiderId =
            String(
              delivery.assignedRiderId
            );

          if (
            riderId &&
            assignedRiderId !==
              String(riderId)
          ) {
            result.reason =
              "RIDER_MISMATCH";
            return;
          }

          if (
            delivery
              .riderCommissionCredited ===
            true
          ) {
            result.reason =
              "ALREADY_CREDITED";

            result.amount = Number(
              delivery
                .riderCommissionAmount ||
                0
            );

            result.servicepayProfit =
              Number(
                delivery
                  .servicepayProfit ||
                  0
              );

            return;
          }

          const deliveryFee = Number(
            delivery.deliveryFee || 0
          );

          if (
            !Number.isFinite(
              deliveryFee
            ) ||
            deliveryFee <= 0
          ) {
            result.reason =
              "DELIVERY_FEE_NOT_SET";
            return;
          }

          const paymentTransaction = await Transaction.findOne({
            customerId: delivery.customerId,
            serviceType: "DELIVERY",
            status: "SUCCESSFUL",
            amount: deliveryFee,
            "providerResponse.deliveryId": delivery._id,
          }).session(session).lean();

          let counterConfirmation = false;
          if (!paymentTransaction && delivery.counter?.payment?.confirmation === "MANAGER_MANUAL_CONFIRMATION" &&
              ["CASH", "POS", "BANK_TRANSFER"].includes(delivery.counter.payment.method) &&
              Number(delivery.counter.payment.amount) === deliveryFee &&
              String(delivery.counter.branch?._id) === String(delivery.branchId)) {
            // A cash/POS/bank counter collection is NOT a fabricated customer
            // wallet transaction. Only the committed, bound manager audit
            // authorizes the established Rider commission pipeline.
            counterConfirmation = !!await require("../models/branchAuditLog.model").exists({
              branchId: delivery.branchId,
              actorId: delivery.counter.payment.approvedBy,
              action: "BRANCH_DELIVERY_PAYMENT_CONFIRMED",
              "metadata.orderId": delivery._id,
              "metadata.kind": "DELIVERY",
              "metadata.amount": deliveryFee,
              "metadata.method": delivery.counter.payment.method,
            }).session(session);
          }
          if (!paymentTransaction && !counterConfirmation) {
            result.reason = "DELIVERY_PAYMENT_TRANSACTION_NOT_FOUND";
            return;
          }

          /*
           * Calculate and lock commission
           * using the model method.
           */
          const calculation =
            delivery.calculateCommission();

          const commissionAmount =
            Number(
              calculation
                .riderCommissionAmount ||
                0
            );

          const servicepayProfit =
            Number(
              calculation
                .servicepayProfit ||
                0
            );

          if (
            !Number.isFinite(
              commissionAmount
            ) ||
            commissionAmount < 0
          ) {
            result.reason =
              "INVALID_COMMISSION";
            return;
          }

          /*
           * Conditional update ensures
           * this delivery cannot credit twice.
           */
          const creditedDelivery =
            await Delivery.findOneAndUpdate(
              {
                _id: delivery._id,

                riderCommissionCredited: {
                  $ne: true,
                },

                status: "DELIVERED",
                paymentStatus: "PAID",
                deliveryFee,
                customerId: delivery.customerId,
                assignedRiderId: delivery.assignedRiderId,
              },
              {
                $set: {
                  riderCommissionAmount:
                    commissionAmount,

                  servicepayProfit,

                  commissionCalculatedAt:
                    delivery
                      .commissionCalculatedAt ||
                    new Date(),

                  riderCommissionCredited:
                    true,

                  riderCommissionCreditedAt:
                    new Date(),

                  riderCommissionStatus:
                    "CREDITED",
                },
              },
              {
                new: true,
                session,
              }
            );

          if (!creditedDelivery) {
            result.reason =
              "ALREADY_CREDITED";
            return;
          }

          const updatedRider =
            await User.findOneAndUpdate(
              {
                _id:
                  delivery
                    .assignedRiderId,

                role:
                  "DELIVERY_RIDER",
              },
              {
                $inc: {
                  totalRiderEarnings:
                    commissionAmount,

                  pendingRiderSettlement:
                    commissionAmount,
                },
              },
              {
                new: true,
                session,
              }
            );

          if (!updatedRider) {
            throw new Error(
              "Assigned Delivery Rider was not found."
            );
          }

          await RiderWalletLedger.create([{
            riderId: updatedRider._id,
            type: "DELIVERY_EARNING",
            direction: "CREDIT",
            amount: commissionAmount,
            oldBalance: Number((Number(updatedRider.pendingRiderSettlement) - commissionAmount).toFixed(2)),
            newBalance: Number(Number(updatedRider.pendingRiderSettlement).toFixed(2)),
            reference: `RIDER-DELIVERY-${delivery._id}-EARNING`,
            deliveryId: delivery._id,
            reason: "Delivery commission earned",
          }], { session });

          result = {
            credited: true,
            amount:
              commissionAmount,
            servicepayProfit,
            reason:
              "COMMISSION_CREDITED",
          };
        }
      );

      return result;
    } finally {
      await session.endSession();
    }
  };

module.exports = {
  creditRiderCommissionIfEligible,
};