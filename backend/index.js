const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const paystackRoutes = require("./routes/paystack.routes");

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

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});