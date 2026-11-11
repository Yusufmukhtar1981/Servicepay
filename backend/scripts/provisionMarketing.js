"use strict";
const mongoose = require("mongoose");
const { migrate } = require("../services/marketingMigration.service");

async function main() {
  if (process.argv[2] !== "--approved" ||
      process.env.SERVICEPAY_ALLOW_MARKETING_PROVISION !== "1" ||
      !process.env.MONGODB_URI) {
    throw new Error("Explicit approval and database target are required. No writes attempted.");
  }
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000, autoCreate: false, autoIndex: false,
  });
  try {
    const outcome = await migrate(mongoose.connection.db);
    console.log(JSON.stringify({ marketingMigration: "complete", ...outcome }));
  } finally { await mongoose.disconnect(); }
}
main().catch(e => {
  console.error("Marketing provisioning stopped:", e.code || e.message);
  process.exitCode = 1;
});
