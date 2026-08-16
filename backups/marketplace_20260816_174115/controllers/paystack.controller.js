const axios = require("axios");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const PAYSTACK_BASE_URL = "https://api.paystack.co";

const getSecretKey = () => {
  const secretKey = String(
    process.env.PAYSTACK_SECRET_KEY || ""
  ).trim();

  if (!secretKey.startsWith("sk_")) {
    throw new Error(
      "PAYSTACK_SECRET_KEY is missing or invalid."
    );
  }

  return secretKey;
};

const getUserId = (req) => {
  return (
    req.user?._id?.toString() ||
    req.user?.id?.toString() ||
    ""
  );
};

exports.initializePayment = async (req, res) => {
  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const user = await User.findById(userId).select(
      "email fullName phone status"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "This account is not active.",
      });
    }

    if (!user.email) {
      return res.status(400).json({
        success: false,
        message:
          "Please add an email address to your account before funding your wallet.",
      });
    }

    const amount = Number(req.body.amount);

    if (!Number.isFinite(amount)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid funding amount.",
      });
    }

    if (amount < 100) {
      return res.status(400).json({
        success: false,
        message:
          "The minimum wallet funding amount is ₦100.",
      });
    }

    const amountInKobo = Math.round(amount * 100);
    const secretKey = getSecretKey();

    /*
     * Paystack zai mayar da customer zuwa wannan URL
     * bayan payment ya kammala.
     *
     * Idan PAYSTACK_CALLBACK_URL yana Render,
     * za a yi amfani da shi.
     *
     * Idan babu shi, zai koma ServicePay homepage
     * maimakon nuna 404.
     */
    const callbackUrl = String(
      process.env.PAYSTACK_CALLBACK_URL ||
        "https://servicepay.ng/"
    ).trim();

    const requestBody = {
      email: user.email.trim().toLowerCase(),
      amount: amountInKobo,
      currency: "NGN",
      callback_url: callbackUrl,

      metadata: {
        userId,
        purpose: "WALLET_FUNDING",
        customerName: user.fullName || "",
        customerPhone: user.phone || "",
        expectedAmount: amount,
      },
    };

    const paystackResponse = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const paymentData = paystackResponse.data?.data;

    if (
      !paymentData?.authorization_url ||
      !paymentData?.reference
    ) {
      return res.status(502).json({
        success: false,
        message:
          "Paystack did not return valid payment information.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment initialized successfully.",
      authorizationUrl: paymentData.authorization_url,
      accessCode: paymentData.access_code,
      reference: paymentData.reference,
      amount,
      callbackUrl,
    });
  } catch (error) {
    console.error(
      "Paystack initialize error:",
      error.response?.data || error.message
    );

    return res
      .status(error.response?.status || 500)
      .json({
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          "Unable to initialize wallet funding.",
      });
  }
};

exports.verifyPayment = async (req, res) => {
  let session;

  try {
    const userId = getUserId(req);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    const reference = String(
      req.body.reference ||
        req.query.reference ||
        ""
    ).trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required.",
      });
    }

    const previouslyProcessed =
      await Transaction.findOne({
        reference,
        serviceType: "WALLET_FUNDING",
        status: "SUCCESSFUL",
      });

    if (previouslyProcessed) {
      const existingUser = await User.findById(
        userId
      ).select("walletBalance");

      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        message:
          "This wallet funding payment has already been processed.",
        walletBalance:
          existingUser?.walletBalance || 0,
        amount: previouslyProcessed.amount,
        reference,
      });
    }

    const secretKey = getSecretKey();

    const paystackResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(
        reference
      )}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
        timeout: 30000,
      }
    );

    const payment = paystackResponse.data?.data;

    if (!payment) {
      return res.status(502).json({
        success: false,
        message:
          "Paystack did not return payment information.",
      });
    }

    if (payment.status !== "success") {
      return res.status(400).json({
        success: false,
        message: "The payment was not successful.",
      });
    }

    if (payment.currency !== "NGN") {
      return res.status(400).json({
        success: false,
        message: "Unsupported payment currency.",
      });
    }

    const paymentUserId = String(
      payment.metadata?.userId || ""
    );

    if (
      !paymentUserId ||
      paymentUserId !== userId
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This payment does not belong to the logged-in user.",
      });
    }

    if (
      payment.metadata?.purpose &&
      payment.metadata.purpose !==
        "WALLET_FUNDING"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This payment was not initialized for wallet funding.",
      });
    }

    const amountPaid =
      Number(payment.amount) / 100;

    if (
      !Number.isFinite(amountPaid) ||
      amountPaid < 100
    ) {
      return res.status(400).json({
        success: false,
        message: "The paid amount is invalid.",
      });
    }

    const expectedAmount = Number(
      payment.metadata?.expectedAmount
    );

    if (
      Number.isFinite(expectedAmount) &&
      Math.abs(
        expectedAmount - amountPaid
      ) > 0.01
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The paid amount does not match the initialized amount.",
      });
    }

    session = await mongoose.startSession();

    let updatedUser;

    await session.withTransaction(async () => {
      const duplicateTransaction =
        await Transaction.findOne({
          reference,
          serviceType: "WALLET_FUNDING",
        }).session(session);

      if (duplicateTransaction) {
        const duplicateError = new Error(
          "PAYMENT_ALREADY_PROCESSED"
        );

        duplicateError.code =
          "PAYMENT_ALREADY_PROCESSED";

        throw duplicateError;
      }

      updatedUser =
        await User.findOneAndUpdate(
          {
            _id: userId,
            status: "ACTIVE",
          },
          {
            $inc: {
              walletBalance: amountPaid,
              totalTransactions: 1,
            },
          },
          {
            new: true,
            session,
          }
        );

      if (!updatedUser) {
        throw new Error(
          "User account was not found or is not active."
        );
      }

      await Transaction.create(
        [
          {
            reference,
            customerId: userId,
            agentId:
              updatedUser.agentId || null,
            stateManagerId:
              updatedUser.stateManagerId ||
              null,
            zonalManagerId:
              updatedUser.zonalManagerId ||
              null,
            serviceType: "WALLET_FUNDING",
            provider: "PAYSTACK",
            amount: amountPaid,
            status: "SUCCESSFUL",
            providerResponse: {
              id: payment.id,
              reference: payment.reference,
              channel: payment.channel,
              currency: payment.currency,
              paidAt:
                payment.paid_at ||
                payment.paidAt ||
                null,
            },
          },
        ],
        {
          session,
        }
      );
    });

    return res.status(200).json({
      success: true,
      alreadyProcessed: false,
      message: `₦${amountPaid.toFixed(
        2
      )} was added to your wallet.`,
      walletBalance:
        updatedUser.walletBalance,
      amount: amountPaid,
      reference,
    });
  } catch (error) {
    if (
      error.code ===
        "PAYMENT_ALREADY_PROCESSED" ||
      error.code === 11000
    ) {
      const userId = getUserId(req);

      const user = await User.findById(
        userId
      ).select("walletBalance");

      return res.status(200).json({
        success: true,
        alreadyProcessed: true,
        message:
          "This wallet funding payment has already been processed.",
        walletBalance:
          user?.walletBalance || 0,
      });
    }

    console.error(
      "Paystack verification error:",
      error.response?.data ||
        error.message
    );

    return res
      .status(error.response?.status || 500)
      .json({
        success: false,
        message:
          error.response?.data?.message ||
          error.message ||
          "Unable to verify the payment.",
      });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};