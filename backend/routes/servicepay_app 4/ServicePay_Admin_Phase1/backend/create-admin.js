require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./config/db");
const User = require("./models/user.model");

async function createAdmin() {
  await connectDB();

  const email = String(process.env.ADMIN_EMAIL || "admin@servicepay.ng").toLowerCase();
  const phone = String(process.env.ADMIN_PHONE || "08000000000");
  const password = String(process.env.ADMIN_PASSWORD || "ServicePay123");
  const fullName = String(process.env.ADMIN_NAME || "ServicePay Admin");

  let admin = await User.findOne({ $or: [{ email }, { phone }] });

  if (admin) {
    admin.fullName = fullName;
    admin.email = email;
    admin.phone = phone;
    admin.password = password;
    admin.role = "HEAD_OFFICE";
    admin.status = "ACTIVE";
    await admin.save();
    console.log(`✅ Admin updated: ${email}`);
  } else {
    admin = await User.create({
      fullName,
      email,
      phone,
      password,
      role: "HEAD_OFFICE",
      status: "ACTIVE",
    });
    console.log(`✅ Admin created: ${admin.email}`);
  }

  console.log("Login password:", password);
  await mongoose.connection.close();
}

createAdmin().catch(async (error) => {
  console.error("❌ Unable to create admin:", error.message);
  await mongoose.connection.close();
  process.exit(1);
});
