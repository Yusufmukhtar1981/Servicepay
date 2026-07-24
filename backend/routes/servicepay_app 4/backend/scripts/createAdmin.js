const mongoose = require("mongoose");
require("dotenv").config();

const User = require("../models/user.model");

const createOrUpdateAdmin = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI baya cikin .env");
    }

    if (!process.env.ADMIN_PASSWORD) {
      throw new Error("ADMIN_PASSWORD ba a saka ba");
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB connected");

    const email = "admin@servicepay.ng";
    const phone = "08033671266";

    let admin = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (admin) {
      admin.fullName = "Yusif Muntari";
      admin.email = email;
      admin.phone = phone;
      admin.password = process.env.ADMIN_PASSWORD;
      admin.role = "HEAD_OFFICE";
      admin.status = "ACTIVE";

      await admin.save();

      console.log("ADMIN UPDATED SUCCESSFULLY");
    } else {
      admin = await User.create({
        fullName: "Yusif Muntari",
        email,
        phone,
        password: process.env.ADMIN_PASSWORD,
        role: "HEAD_OFFICE",
        status: "ACTIVE",
        walletBalance: 10000,
        commissionBalance: 0,
      });

      console.log("ADMIN CREATED SUCCESSFULLY");
    }

    console.log(`Email: ${admin.email}`);
    console.log(`Phone: ${admin.phone}`);
    console.log(`Role: ${admin.role}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("ADMIN SETUP FAILED:", error.message);

    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    process.exit(1);
  }
};

createOrUpdateAdmin();