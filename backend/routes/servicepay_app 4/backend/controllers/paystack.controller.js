const axios = require("axios");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

exports.initializePayment = async (req, res) => {
  try {
    const email = String(req.body.email || req.user?.email || "").trim().toLowerCase();
    const amount = Number(req.body.amount);
    if (!email || !Number.isFinite(amount)) return res.status(400).json({ success:false, message:"Email and amount are required." });
    if (amount < 100) return res.status(400).json({ success:false, message:"Minimum wallet funding is ₦100." });
    const key = String(process.env.PAYSTACK_SECRET_KEY || "").trim();
    if (!key.startsWith("sk_")) return res.status(500).json({ success:false, message:"Paystack is not configured correctly." });
    const response = await axios.post("https://api.paystack.co/transaction/initialize", { email, amount: Math.round(amount * 100), metadata: { userId: String(req.user._id || req.user.id), purpose: "WALLET_FUNDING" } }, { headers: { Authorization:`Bearer ${key}`, "Content-Type":"application/json" }, timeout:30000 });
    const data=response.data.data;
    return res.json({ success:true, message:"Payment initialized successfully.", authorizationUrl:data.authorization_url, accessCode:data.access_code, reference:data.reference });
  } catch(error) { return res.status(error.response?.status || 500).json({ success:false, message:error.response?.data?.message || "Unable to initialize payment." }); }
};

exports.verifyPayment = async (req, res) => {
  try {
    const reference=String(req.body.reference || "").trim();
    if (!reference) return res.status(400).json({ success:false, message:"Payment reference is required." });
    const existing=await Transaction.findOne({ reference, serviceType:"WALLET_FUNDING", status:"SUCCESSFUL" });
    if (existing) {
      const user=await User.findById(req.user._id || req.user.id);
      return res.json({ success:true, message:"Payment was already verified.", walletBalance:user.walletBalance, reference });
    }
    const key=String(process.env.PAYSTACK_SECRET_KEY || "").trim();
    const response=await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers:{Authorization:`Bearer ${key}`}, timeout:30000 });
    const payment=response.data.data;
    if (payment.status !== "success") return res.status(400).json({ success:false, message:"Payment has not been completed successfully." });
    const userId=String(req.user._id || req.user.id);
    if (payment.metadata?.userId && String(payment.metadata.userId) !== userId) return res.status(403).json({success:false,message:"This payment does not belong to your account."});
    const amount=Number(payment.amount)/100;
    const user=await User.findByIdAndUpdate(userId,{$inc:{walletBalance:amount,totalTransactions:1}},{new:true});
    await Transaction.create({ reference, customerId:userId, agentId:user.agentId || null, stateManagerId:user.stateManagerId || null, zonalManagerId:user.zonalManagerId || null, serviceType:"WALLET_FUNDING", provider:"PAYSTACK", amount, status:"SUCCESSFUL", providerResponse:payment });
    return res.json({success:true,message:`₦${amount.toFixed(2)} has been added to your wallet.`,walletBalance:user.walletBalance,reference});
  } catch(error) {
    if (error?.code===11000) { const user=await User.findById(req.user._id || req.user.id); return res.json({success:true,message:"Payment was already verified.",walletBalance:user.walletBalance,reference:req.body.reference}); }
    return res.status(error.response?.status || 500).json({success:false,message:error.response?.data?.message || "Unable to verify payment."});
  }
};
