const axios = require("axios");
const User = require("../models/user.model");

exports.initializePayment = async (req, res) => {
  console.log("========== PAYSTACK INITIALIZE ==========");
  console.log("Request body:", req.body);
  console.log("User:", req.user?._id || req.user?.id);
  console.log(
    "Paystack key loaded:",
    Boolean(process.env.PAYSTACK_SECRET_KEY)
  );

  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const numericAmount = Number(req.body.amount);

    if (!email || !Number.isFinite(numericAmount)) {
      return res.status(400).json({
        success: false,
        message: "Email da amount suna da bukata.",
      });
    }

    if (numericAmount < 100) {
      return res.status(400).json({
        success: false,
        message: "Mafi ƙarancin wallet funding shi ne ₦100.",
      });
    }

    const secretKey = String(
      process.env.PAYSTACK_SECRET_KEY || ""
    ).trim();

    if (!secretKey.startsWith("sk_")) {
      console.log("PAYSTACK_SECRET_KEY bai yi daidai ba.");

      return res.status(500).json({
        success: false,
        message: "Paystack Secret Key bai yi daidai ba.",
      });
    }

    const paystackResponse = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: String(Math.round(numericAmount * 100)),
      },
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    console.log("Paystack success:", paystackResponse.data);

    return res.status(200).json({
      success: true,
      message: "Payment initialized successfully.",
      authorizationUrl:
        paystackResponse.data.data.authorization_url,
      accessCode: paystackResponse.data.data.access_code,
      reference: paystackResponse.data.data.reference,
    });
  } catch (error) {
    const statusCode = error.response?.status || 500;
    const paystackError =
      error.response?.data || error.message;

    console.log("Paystack status:", statusCode);
    console.log("Paystack initialize error:", paystackError);

    return res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        "An samu matsala wajen fara payment.",
    });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const reference = String(
      req.body.reference || ""
    ).trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference yana da bukata.",
      });
    }

    const secretKey = String(
      process.env.PAYSTACK_SECRET_KEY || ""
    ).trim();

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        timeout: 30000,
      }
    );

    const payment = response.data.data;

    if (payment.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "Ba a kammala payment cikin nasara ba.",
      });
    }

    const amountPaid = Number(payment.amount) / 100;

    const userId = req.user?._id || req.user?.id;

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $inc: {
          walletBalance: amountPaid,
        },
      },
      {
        new: true,
      }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Ba a samu user ba.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `An saka ₦${amountPaid} a wallet ɗinka.`,
      walletBalance: user.walletBalance,
      reference,
    });
  } catch (error) {
    console.log(
      "Paystack verification error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "An samu matsala wajen tabbatar da payment.",
    });
  }
};