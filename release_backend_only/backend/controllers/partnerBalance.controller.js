const Partner = require("../models/partner.model");

exports.getBalance = async (req, res) => {
  try {
    const partnerId =
      req.partner?._id ||
      req.partner?.id ||
      req.partnerId;

    if (!partnerId) {
      return res.status(401).json({
        success: false,
        message: "Partner authentication required.",
      });
    }

    const partner = await Partner.findById(partnerId)
      .select(
        "businessName status walletBalance dailyLimit permissions"
      )
      .lean();

    if (!partner) {
      return res.status(404).json({
        success: false,
        message: "Partner account not found.",
      });
    }

    const status = String(partner.status || "").toUpperCase();

    if (
      status === "SUSPENDED" ||
      status === "REVOKED" ||
      status === "BLOCKED"
    ) {
      return res.status(403).json({
        success: false,
        message: "Partner API access is currently disabled.",
      });
    }

    return res.json({
      success: true,
      data: {
        businessName: partner.businessName || "",
        walletBalance: Number(partner.walletBalance || 0),
        dailyLimit: Number(partner.dailyLimit || 0),
        status: partner.status || "",
        currency: "NGN",
      },
    });
  } catch (error) {
    console.error("Partner balance error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch partner balance.",
    });
  }
};
