const mongoose = require("mongoose");
const User = require("../models/user.model");

const generateCode = (fullName) => {
  const rawName =
    String(fullName || "USER")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();

  const prefix =
    rawName.substring(0, 4).padEnd(4, "X");

  const random =
    Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase();

  return `SP-${prefix}-${random}`;
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      "MONGO_URI is required."
    );
  }

  await mongoose.connect(
    process.env.MONGO_URI
  );

  const customers = await User.find({
    role: "CUSTOMER",
    $or: [
      { referralCode: { $exists: false } },
      { referralCode: null },
      { referralCode: "" },
    ],
  }).select("_id fullName referralCode");

  let updated = 0;

  for (const customer of customers) {
    let saved = false;

    for (let attempt = 0;
      attempt < 10;
      attempt += 1) {

      const code =
        generateCode(
          customer.fullName
        );

      const exists =
        await User.exists({
          referralCode: code,
        });

      if (exists) {
        continue;
      }

      await User.updateOne(
        {
          _id: customer._id,
          $or: [
            {
              referralCode: {
                $exists: false,
              },
            },
            {
              referralCode: null,
            },
            {
              referralCode: "",
            },
          ],
        },
        {
          $set: {
            referralCode: code,
          },
        }
      );

      updated += 1;
      saved = true;
      break;
    }

    if (!saved) {
      console.warn(
        "Could not generate referral code for",
        customer._id.toString()
      );
    }
  }

  console.log(
    `Referral backfill complete. Updated: ${updated}`
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(
    "Referral backfill failed:",
    error
  );

  process.exit(1);
});
