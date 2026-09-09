require("dotenv").config();

const mongoose = require("mongoose");
const DeliveryCoverage = require("../models/deliveryCoverage.model");

async function run() {
  const mongoUri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;

  if (!mongoUri) {
    console.error(
      "❌ MongoDB connection string not found. Expected MONGO_URI, MONGODB_URI or DATABASE_URL."
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);

    console.log("✅ Connected to MongoDB");

    const beforeTotal =
      await DeliveryCoverage.countDocuments({});

    const beforeLive =
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

    const afterLive =
      await DeliveryCoverage.countDocuments({
        isLive: true,
      });

    console.log("");
    console.log("=================================");
    console.log(" SERVICEPAY DELIVERY COVERAGE");
    console.log("=================================");
    console.log(`Total states: ${beforeTotal}`);
    console.log(`Live before: ${beforeLive}`);
    console.log(`Updated: ${result.modifiedCount}`);
    console.log(`Live now: ${afterLive}`);
    console.log("=================================");
    console.log("");
    console.log(
      "✅ ALL EXISTING DELIVERY STATES ARE NOW LIVE"
    );
  } catch (error) {
    console.error(
      "❌ Delivery coverage activation failed:",
      error.message
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

run();
