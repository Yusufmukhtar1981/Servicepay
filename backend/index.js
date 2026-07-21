const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const connectDB = require("./config/db");

const paystackRoutes = require("./routes/paystack.routes");
const clubkonnectRoutes = require("./routes/clubkonnect.routes");
const authRoutes = require("./routes/auth.routes");
const transferRoutes = require("./routes/transfer.routes");

connectDB();

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "OK",
    message: "Servicepay Backend is running",
  });
});

app.use("/api/paystack", paystackRoutes);
app.use("/api/clubkonnect", clubkonnectRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/transfer", transferRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});