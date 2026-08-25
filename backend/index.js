const marketplaceRoutes = require('./routes/marketplace.routes');
const adminCardRoutes = require('./routes/adminCard.routes');
const express = require("express");

const partnerRoutes = require("./routes/partner.routes");
const partnerApplicationRoutes = require("./routes/partnerApplication.routes");
const adminPartnerRoutes = require("./routes/adminPartner.routes");
const cardRoutes = require('./routes/card.routes');
const managementRoutes = require('./routes/management.routes');
const appSettingsRoutes = require("./routes/appSettings.routes");
const cors = require("cors");
const helmet = require("helmet");
const fintechControlMiddleware = require("./middleware/fintechControl.middleware");

require("dotenv").config();

const connectDB = require("./config/db");

const paystackRoutes = require(
  "./routes/paystack.routes"
);
const riderRoutes = require("./routes/rider.routes");

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
const trustRoutes = require("./routes/trust.routes");
const adminTrustRoutes = require(
  "./routes/adminTrust.routes"
);

const electricityRoutes = require(
  "./routes/electricity.routes"
);

const transactionPinRoutes = require(
  "./routes/transactionPin.routes"
);

const app = express();

connectDB();
const adminPartnerApplicationRoutes = require("./routes/adminPartnerApplication.routes");

const empowermentRoutes = require("./routes/empowerment.routes");
const aiSupportRoutes = require("./routes/aiSupport.routes");
const servicepayFeaturesRoutes = require("./routes/servicepayFeatures.routes");
const businessWalletRoutes = require("./routes/businessWallet.routes");
const airtimeToCashRoutes = require("./routes/airtimeToCash.routes");

const adminKycRoutes = require("./routes/adminKyc.routes");
const kycRoutes = require("./routes/kyc.routes");
const amanaRoutes = require("./routes/amana.routes");
const adminAmanaRoutes = require("./routes/adminAmana.routes");
const staffManagementRoutes = require("./routes/staffManagement.routes");
const adminRoleUsersRoutes = require("./routes/adminRoleUsers.routes");




const sudoRoutes = require("./routes/sudo.routes");
const miniAppRoutes = require("./routes/miniApp.routes");

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


/*
 * ServicePay Fintech Control
 * IMPORTANT:
 * Must execute before ServicePay API routes so settings saved from
 * Admin > Platform Configuration affect live backend requests.
 * Public/auth/admin/webhook exclusions are handled inside the middleware.
 */
app.use(fintechControlMiddleware);

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

app.use("/api/trust", trustRoutes);
app.use("/api/admin/trust", adminTrustRoutes);

app.use(
  "/api/electricity",
  electricityRoutes
);

app.use(
  "/api/transaction-pin",
  transactionPinRoutes
);


// ServicePay Fintech Control Enforcement
app.use('/api/marketplace', marketplaceRoutes);
app.use("/api/settings", appSettingsRoutes);
app.use('/api/cards', cardRoutes);

const productCommissionRoutes = require(
"./routes/productCommission.routes"
);

app.use(
  "/api/admin/product-commissions",
  productCommissionRoutes
);

app.use('/api/admin/cards', adminCardRoutes);

// ServicePay management routes
app.use('/api/management', managementRoutes);


/* ServicePay Rider API */
app.use('/api/rider', riderRoutes);
app.use('/api/riders', riderRoutes);


app.use("/api/partner", partnerRoutes);
app.use("/api/partner-applications", partnerApplicationRoutes);
app.use("/api/admin/partners", adminPartnerRoutes);
app.use("/api/admin/partner-applications", adminPartnerApplicationRoutes);
/* ServicePay restored API modules */
app.use("/api/empowerment", empowermentRoutes);
app.use("/api/amana", amanaRoutes);
app.use("/api/admin/amana", adminAmanaRoutes);
app.use("/api/ai-support", aiSupportRoutes);
app.use("/api/servicepay-features", servicepayFeaturesRoutes);
app.use("/api/business-wallet", businessWalletRoutes);
app.use("/api/airtime-to-cash", airtimeToCashRoutes);

/* KYC and Staff Management API modules */
app.use("/api/admin/kyc", adminKycRoutes);
app.use("/api/kyc", kycRoutes);
app.use("/api/staff-management", staffManagementRoutes);
app.use("/api/admin/role-users", adminRoleUsersRoutes);

app.use("/api/mini-apps", miniAppRoutes);
app.use("/api/sudo", sudoRoutes);
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
