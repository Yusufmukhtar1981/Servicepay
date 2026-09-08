const mongoose = require("mongoose");

const Delivery = require(
  "../models/delivery.model"
);

const {
  creditRiderCommissionIfEligible,
} = require(
  "../services/riderCommission.service"
);

const MIGRATION_KEY =
  "rider-delivered-commission-backfill-2026-08-09-v1";

async function backfillDeliveredRiderCommissionsOnce() {
  const execute = async () => {
    const migrations =
      mongoose.connection.collection(
        "servicepay_system_migrations"
      );

    const alreadyDone =
      await migrations.findOne({
        _id: MIGRATION_KEY,
      });

    if (alreadyDone) {
      console.log(
        "✅ Rider commission backfill already completed."
      );
      return;
    }

    /*
     * Nigeria 2026-08-09 00:00 = UTC 2026-08-08 23:00.
     * Only today's launch/test deliveries are backfilled.
     */
    const launchDayStart =
      new Date(
        "2026-08-08T23:00:00.000Z"
      );

    const deliveries =
      await Delivery.find({
        status: "DELIVERED",

        deliveredAt: {
          $gte: launchDayStart,
        },

        assignedRiderId: {
          $ne: null,
        },

        riderCommissionCredited: {
          $ne: true,
        },

        deliveryFee: {
          $gt: 0,
        },
      })
        .select(
          "_id assignedRiderId trackingNumber"
        )
        .lean();

    let credited = 0;
    let skipped = 0;
    let failed = 0;

    const results = [];

    for (const delivery of deliveries) {
      try {
        const result =
          await creditRiderCommissionIfEligible({
            deliveryId:
              delivery._id,

            riderId:
              delivery.assignedRiderId,
          });

        if (result.credited) {
          credited += 1;
        } else {
          skipped += 1;
        }

        results.push({
          trackingNumber:
            delivery.trackingNumber,

          credited:
            result.credited,

          amount:
            result.amount,

          reason:
            result.reason,
        });
      } catch (error) {
        failed += 1;

        results.push({
          trackingNumber:
            delivery.trackingNumber,

          credited: false,

          reason:
            error.message,
        });
      }
    }

    await migrations.insertOne({
      _id: MIGRATION_KEY,

      migration:
        "BACKFILL_DELIVERED_RIDER_COMMISSIONS",

      found:
        deliveries.length,

      credited,
      skipped,
      failed,
      results,

      completedAt:
        new Date(),
    });

    console.log("");
    console.log(
      "========================================"
    );
    console.log(
      " RIDER COMMISSION BACKFILL"
    );
    console.log(
      "========================================"
    );
    console.log(
      `Delivered found: ${deliveries.length}`
    );
    console.log(
      `Commission credited: ${credited}`
    );
    console.log(
      `Skipped: ${skipped}`
    );
    console.log(
      `Failed: ${failed}`
    );
    console.log(
      "========================================"
    );
  };

  if (
    mongoose.connection.readyState === 1
  ) {
    await execute();
    return;
  }

  mongoose.connection.once(
    "open",
    () => {
      execute().catch(
        (error) => {
          console.error(
            "❌ Rider commission backfill failed:",
            error.message
          );
        }
      );
    }
  );
}

module.exports =
  backfillDeliveredRiderCommissionsOnce;
