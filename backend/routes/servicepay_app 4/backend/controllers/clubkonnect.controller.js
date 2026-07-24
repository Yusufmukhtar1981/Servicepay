const axios = require("axios");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

const networkCodes = { MTN: "01", Airtel: "04", Glo: "02", "9mobile": "03" };

exports.buyAirtime = async (req, res) => {
  let transaction;
  try {
    const network = String(req.body.network || "").trim();
    const phone = String(req.body.phone || "").trim();
    const amount = Number(req.body.amount);
    if (!networkCodes[network] || !/^0\d{10}$/.test(phone) || !Number.isFinite(amount) || amount < 50) {
      return res.status(400).json({ success: false, message: "Enter a valid network, 11-digit phone number, and an amount of at least ₦50." });
    }
    const userId = req.user?._id || req.user?.id;
    const reference = `AIR-${Date.now()}-${Math.random().toString(36).slice(2,8).toUpperCase()}`;
    transaction = await Transaction.create({ reference, customerId: userId, agentId: req.user.agentId || null, stateManagerId: req.user.stateManagerId || null, zonalManagerId: req.user.zonalManagerId || null, serviceType: "AIRTIME", provider: network, phone, amount, status: "PENDING" });
    const debited = await User.findOneAndUpdate({ _id: userId, status: "ACTIVE", walletBalance: { $gte: amount } }, { $inc: { walletBalance: -amount, totalTransactions: 1 } }, { new: true });
    if (!debited) {
      transaction.status = "FAILED"; transaction.providerResponse = { message: "Insufficient wallet balance" }; await transaction.save();
      return res.status(400).json({ success: false, message: "Insufficient wallet balance." });
    }
    try {
      const response = await axios.get("https://www.nellobytesystems.com/APIAirtimeV1.asp", { params: { UserID: process.env.CLUBKONNECT_USER_ID, APIKey: process.env.CLUBKONNECT_API_KEY, MobileNetwork: networkCodes[network], Amount: amount, MobileNumber: phone, RequestID: reference }, timeout: 30000 });
      const provider = response.data;
      const text = JSON.stringify(provider).toLowerCase();
      const success = text.includes('successful') || text.includes('success') || provider?.status === 'ORDER_RECEIVED';
      if (!success) throw new Error(provider?.response_description || provider?.message || "Provider rejected the purchase");
      transaction.status = "SUCCESSFUL"; transaction.providerResponse = provider; await transaction.save();
      return res.json({ success: true, message: "Airtime purchase completed successfully.", reference, walletBalance: debited.walletBalance, providerResponse: provider });
    } catch (providerError) {
      await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount, totalTransactions: -1 } });
      transaction.status = "REFUNDED"; transaction.providerResponse = { error: providerError.response?.data || providerError.message }; await transaction.save();
      return res.status(502).json({ success: false, message: "The airtime provider could not complete the request. Your wallet has been refunded.", reference });
    }
  } catch (error) {
    console.error("Airtime error:", error.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Unable to complete airtime purchase." });
  }
};
