const mongoose = require('mongoose');
require('./services/emailAutomation.service');
const { startCustomerBroadcast } = require('./services/customerBroadcast.service');
const express = require("express");

const adminRoleUsersRoutes = require("./routes/adminRoleUsers.routes");
const withdrawalRoutes = require("./routes/withdrawal.routes");
const servicepayFeaturesRoutes = require("./routes/servicepayFeatures.routes");
const airtimeToCashRoutes = require("./routes/airtimeToCash.routes");
const cors = require("cors");
const helmet = require("helmet");

require("dotenv").config();

const connectDB = require("./config/db");

const businessWalletRoutes = require(
  "./routes/businessWallet.routes"
);

/*
 * =====================================================
 * ROUTES
 * =====================================================
 */

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

const riderRoutes = require(
  "./routes/rider.routes"
);

/*
 * ServicePay Keke Ride
 */
const kekeRideRoutes = require(
  "./routes/kekeRide.routes"
);

/*
 * ServicePay Keke Fare
 */
const kekeFareSettingRoutes = require(
  "./routes/kekeFareSetting.routes"
);

const adminKekeFareSettingRoutes = require(
  "./routes/adminKekeFareSetting.routes"
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

const amanaRoutes = require(
  "./routes/amana.routes"
);

const adminAmanaRoutes = require(
  "./routes/adminAmana.routes"
);

/*
 * =====================================================
 * APP
 * =====================================================
 */

const app = express();

/*
 * =====================================================
 * DATABASE
 * =====================================================
 */

connectDB();

/*
 * =====================================================
 * SECURITY / MIDDLEWARE
 * =====================================================
 */

const empowermentRoutes = require("./routes/empowerment.routes");

app.use(helmet());
app.use(cors());

/*
 * Keep original raw JSON payload.
 *
 * SecureWaveNG uses rawBody for
 * HMAC-SHA256 webhook signature verification.
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

/*
 * =====================================================
 * HEALTH CHECK
 * =====================================================
 */

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    status: "OK",
    message:
      "Servicepay Backend is running",
  });
});

app.get(
  "/api/health",
  (req, res) => {
    res.status(200).json({
      success: true,
      status: "OK",
      service: "ServicePay API",
      timestamp:
        new Date().toISOString(),
    });
  }
);

/*
 * =====================================================
 * PAYMENT / VTU
 * =====================================================
 */

app.use(
  "/api/paystack",
  paystackRoutes
);

app.use(
  "/api/clubkonnect",
  clubkonnectRoutes
);

app.use(
  "/api/securewave",
  securewaveRoutes
);

/*
 * =====================================================
 * AUTH
 * =====================================================
 */

app.use(
  "/api/auth",
  authRoutes
);

/*
 * =====================================================
 * TRANSFERS
 * =====================================================
 */

app.use(
  "/api/transfer",
  transferRoutes
);

/*
 * =====================================================
 * SERVICEPAY AMANA
 * =====================================================
 */

app.use(
  "/api/amana",
  amanaRoutes
);

app.use(
  "/api/admin/amana",
  adminAmanaRoutes
);

/*
 * =====================================================
 * ID VERIFICATION
 * =====================================================
 */

app.use(
  "/api/id-verification",
  idVerificationRoutes
);

/*
 * =====================================================
 * DELIVERY
 * =====================================================
 */

app.use(
  "/api/delivery",
  deliveryRoutes
);

/*
 * =====================================================
 * RIDER
 * =====================================================
 */

app.use(
  "/api/riders",
  riderRoutes
);

/*
 * Keep old route for existing screens.
 */
app.use(
  "/api/rider",
  riderRoutes
);

/*
 * =====================================================
 * SERVICEPAY KEKE RIDE
 * =====================================================
 */

app.use(
  "/api/keke-rides",
  kekeRideRoutes
);

/*
 * =====================================================
 * SERVICEPAY KEKE FARE
 * =====================================================
 *
 * Customer / App:
 *
 * GET  /api/keke-fare
 * POST /api/keke-fare/estimate
 */

app.use(
  "/api/keke-fare",
  kekeFareSettingRoutes
);

/*
 * Head Office / Admin:
 *
 * GET    /api/admin/keke-fare
 * POST   /api/admin/keke-fare
 * DELETE /api/admin/keke-fare/:id
 */

app.use(
  "/api/admin/keke-fare",
  adminKekeFareSettingRoutes
);

/*
 * =====================================================
 * NOTIFICATIONS
 * =====================================================
 */

app.use(
  "/api/notifications",
  notificationRoutes
);

/*
 * =====================================================
 * ADMIN
 * =====================================================
 */

app.use(
  "/api/admin",
  adminRoutes
);

/*
 * =====================================================
 * WALLET
 * =====================================================
 */

app.use(
  "/api/wallet",
  walletRoutes
);

/*
 * =====================================================
 * MANUAL FUNDING
 * =====================================================
 */

app.use(
  "/api/manual-funding",
  manualFundingRoutes
);

/*
 * =====================================================
 * ANNOUNCEMENTS
 * =====================================================
 */

app.use(
  "/api/announcement",
  announcementRoutes
);

/*
 * =====================================================
 * TRANSACTIONS
 * =====================================================
 */

app.use(
  "/api/transactions",
  transactionRoutes
);

/*
 * =====================================================
 * ELECTRICITY
 * =====================================================
 */

app.use(
  "/api/electricity",
  electricityRoutes
);

/*
 * =====================================================
 * TRANSACTION PIN
 * =====================================================
 */

app.use(
  "/api/transaction-pin",
  transactionPinRoutes
);

/*
 * =====================================================
 * MANAGEMENT
 * =====================================================
 */

app.use(
  "/api/management",
  managementRoutes
);

/*
 * =====================================================
 * APP SETTINGS
 * =====================================================
 */

app.use(
  "/api/settings",
  appSettingsRoutes
);

/*
 * =====================================================
 * STAFF MANAGEMENT
 * =====================================================
 */

app.use(
  "/api/staff-management",
  staffManagementRoutes
);

/*
 * =====================================================
 * PRODUCT COMMISSIONS
 * =====================================================
 */

app.use(
  "/api/admin/product-commissions",
  productCommissionRoutes
);

/*
 * =====================================================
 * EXAM PIN
 * =====================================================
 */

app.use(
  "/api/exam-pin",
  examPinRoutes
);


/*
 * Airtime to Cash API
 * Must be mounted before the 404 handler.
 */
app.use("/api/empowerment", empowermentRoutes);
app.use("/api/airtime-to-cash", airtimeToCashRoutes);


/* ServicePay Feature Hub V1 */
app.use("/api/servicepay-features", servicepayFeaturesRoutes);

/*
 * =====================================================
 * 404
 * =====================================================
 */


app.use(
  "/api/business-wallet",
  businessWalletRoutes
);

app.use("/api/admin/role-users", adminRoleUsersRoutes);

const kycRoutes = require("./routes/kyc.routes");
const adminKycRoutes = require("./routes/adminKyc.routes");

app.use("/api/kyc", kycRoutes);

app.use("/api/admin/kyc", adminKycRoutes);


/* ServicePay public email logo */
app.get('/api/public/servicepay-logo.png', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(
    require('path').join(
      __dirname,
      'public',
      'servicepay-logo.png'
    )
  );
});

app.use(
  (req, res) => {
    res.status(404).json({
      success: false,
      message:
        `Route not found: ${req.method} ${req.originalUrl}`,
    });
  }
);

/*
 * =====================================================

app.use("/api/withdrawals", withdrawalRoutes);

 * GLOBAL ERROR HANDLER
 * =====================================================
 */
app.use(
  (
    error,
    req,
    res,
    next
  ) => {
    console.error(
      "Server error:",
      error
    );

    res
      .status(
        error.status || 500
      )
      .json({
        success: false,
        message:
          error.message ||
          "Internal server error.",
      });
  }
);

/*
 * =====================================================
 * SERVER
 * =====================================================
 */

const PORT =
  process.env.PORT || 3000;




/* One-time ServicePay customer announcement */
mongoose.connection.once('open', () => {
  setTimeout(() => {
    startCustomerBroadcast().catch((error) => {
      console.error('[BROADCAST START]', error);
    });
  }, 5000);
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🚀 ServicePay server running on port ${PORT}`
    );

    console.log(
      "🛺 ServicePay Keke enabled"
    );

    console.log(
      "📍 Rider live location enabled"
    );

    console.log(
      "🔎 Nearest Keke driver matching enabled"
    );

    console.log(
      "🚕 Keke Ride API: /api/keke-rides"
    );

    console.log(
      "💰 Keke Fare API: /api/keke-fare"
    );

    console.log(
      "⚙️ Admin Keke Fare API: /api/admin/keke-fare"
    );
  }
);

/*
 * =========================================================
 * SERVICEPAY DELIVERY LAUNCH MIGRATION
 * Activates all existing states LIVE once after MongoDB
 * connects. A database marker prevents it from running twice.
 * =========================================================
 */
require("./scripts/activateAllDeliveryStatesOnce")();


/*
 * One-time Rider commission backfill.
 * Idempotent through database migration marker.
 */
require("./scripts/backfillDeliveredRiderCommissionsOnce")();
