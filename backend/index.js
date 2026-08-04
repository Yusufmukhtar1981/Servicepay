const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

require("dotenv").config();

const connectDB = require("./config/db");

const staffManagementRoutes = require(
  "./routes/staffManagement.routes"
);

const appSettingsRoutes = require(
  "./routes/appSettings.routes"
);

const paystackRoutes = require(
  "./routes/paystack.routes"
);

const clubkonnectRoutes = require(
  "./routes/clubkonnect.routes"
);

const securewaveRoutes = require(
  "./routes/securewave.routes"
);

const authRoutes = require(
  "./routes/auth.routes"
);

const transferRoutes = require(
  "./routes/transfer.routes"
);

const idVerificationRoutes = require(
  "./routes/idVerification.routes"
);

const deliveryRoutes = require(
  "./routes/delivery.routes"
);

const notificationRoutes = require(
  "./routes/notification.routes"
);

const adminRoutes = require(
  "./routes/admin.routes"
);

const walletRoutes = require(
  "./routes/wallet.routes"
);

const manualFundingRoutes = require(
  "./routes/manualfunding.routes"
);

const announcementRoutes = require(
  "./routes/announcement.routes"
);

const transactionRoutes = require(
  "./routes/transaction.routes"
);

const electricityRoutes = require(
  "./routes/electricity.routes"
);

const transactionPinRoutes = require(
  "./routes/transactionPin.routes"
);

const managementRoutes = require(
  "./routes/management.routes"
);

const productCommissionRoutes = require(
  "./routes/productCommission.routes"
);

const examPinRoutes = require(
  "./routes/examPin.routes"
);

const amanaRoutes = require("./routes/amana.routes");

const adminAmanaRoutes = require(
  "./routes/adminAmana.routes"
);

const app = express();

connectDB();

app.use(helmet());
app.use(cors());

/*
 * Keep the original raw JSON payload.
 * SecureWaveNG uses it for HMAC-SHA256
 * webhook signature verification.
 */
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    },
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "OK",
    message:
      "Servicepay Backend is running",
  });
});

app.use(
  "/api/paystack",
  paystackRoutes
);

app.use(
  "/api/clubkonnect",
  clubkonnectRoutes
);

app.use(
  "/api/auth",
  authRoutes
);

app.use(
  "/api/transfer",
  transferRoutes
);

app.use("/api/amana", amanaRoutes);

app.use(
  "/api/admin/amana",
  adminAmanaRoutes
);

app.use(
  "/api/securewave",
  securewaveRoutes
);

app.use(
  "/api/id-verification",
  idVerificationRoutes
);

app.use(
  "/api/delivery",
  deliveryRoutes
);

app.use(
  "/api/notifications",
  notificationRoutes
);

app.use(
  "/api/admin",
  adminRoutes
);

app.use(
  "/api/wallet",
  walletRoutes
);

app.use(
  "/api/manual-funding",
  manualFundingRoutes
);

app.use(
  "/api/announcement",
  announcementRoutes
);

app.use(
  "/api/transactions",
  transactionRoutes
);

app.use(
  "/api/electricity",
  electricityRoutes
);

app.use(
  "/api/transaction-pin",
  transactionPinRoutes
);

app.use(
  "/api/management",
  managementRoutes
);

app.use(
  "/api/settings",
  appSettingsRoutes
);

app.use(
  "/api/staff-management",
  staffManagementRoutes
);

app.use(
  "/api/admin/product-commissions",
  productCommissionRoutes
);

/*
 * Exam PIN routes:
 *
 * GET  /api/exam-pin/products
 * POST /api/exam-pin/buy
 * GET  /api/exam-pin/history
 * GET  /api/exam-pin/history/:id
 */
app.use(
  "/api/exam-pin",
  examPinRoutes
);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message:
      `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    res
      .status(error.status || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Internal server error.",
      });
  }
);

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🚀 Server running on port ${PORT}`
    );
  }
);