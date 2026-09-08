const mongoose = require("mongoose");
const DeliveryCoverage = require("../models/deliveryCoverage.model");

const MIGRATION_KEY =
  "servicepay-delivery-all-states-live-2026-08-09-v1";

async function activateAllDeliveryStatesOnce() {
  try {
    const runMigration = async () => {
      try {
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
            "✅ Delivery state launch migration already completed."
          );
          return;
        }

        const totalStates =
          await DeliveryCoverage.countDocuments({});

        const liveBefore =
          await DeliveryCoverage.countDocuments({
            isLive: true,
          });

        const result =
          await DeliveryCoverage.updateMany(
            {},
            {
              $set: {
                isLive: true,
                unavailableMessage: "",
                expectedLaunchDate: null,
                activatedAt: new Date(),
                deactivatedAt: null,
                deactivatedBy: null,
              },
            }
          );

        const liveNow =
          await DeliveryCoverage.countDocuments({
            isLive: true,
          });

        await migrations.insertOne({
          _id: MIGRATION_KEY,
          migration:
            "ACTIVATE_ALL_DELIVERY_STATES",
          totalStates,
          liveBefore,
          modifiedCount:
            result.modifiedCount || 0,
          liveNow,
          completedAt: new Date(),
        });

        console.log("");
        console.log(
          "========================================"
        );
        console.log(
          " SERVICEPAY DELIVERY LAUNCH MIGRATION"
        );
        console.log(
          "========================================"
        );
        console.log(
          `Total delivery states: ${totalStates}`
        );
        console.log(
          `Live before: ${liveBefore}`
        );
        console.log(
          `Updated: ${result.modifiedCount || 0}`
        );
        console.log(
          `Live now: ${liveNow}`
        );
        console.log(
          "✅ ALL EXISTING DELIVERY STATES ARE LIVE"
        );
        console.log(
          "========================================"
        );
        console.log("");
      } catch (error) {
        console.error(
          "❌ Delivery launch migration failed:",
          error.message
        );
      }
    };

    if (mongoose.connection.readyState === 1) {
      await runMigration();
      return;
    }

    mongoose.connection.once(
      "open",
      runMigration
    );
  } catch (error) {
    console.error(
      "❌ Unable to prepare delivery migration:",
      error.message
    );
  }
}

module.exports = activateAllDeliveryStatesOnce;
