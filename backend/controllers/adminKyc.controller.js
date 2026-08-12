const KycProfile = require("../models/kycProfile.model");

const ALLOWED_STATUS = new Set([
  "PENDING",
  "UNDER_REVIEW",
  "VERIFIED",
  "REJECTED",
]);

exports.getKycApplications = async (req, res) => {
  try {
    const {
      status,
      level,
      search,
      page = 1,
      limit = 50,
    } = req.query || {};

    const filter = {};

    if (status) {
      filter.status = String(status).toUpperCase();
    }

    if (level) {
      filter.level = String(level).toUpperCase();
    }

    if (search) {
      const safeSearch = String(search)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { firstName: { $regex: safeSearch, $options: "i" } },
        { middleName: { $regex: safeSearch, $options: "i" } },
        { lastName: { $regex: safeSearch, $options: "i" } },
        { phone: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(
      100,
      Math.max(1, Number(limit) || 50)
    );

    const [items, total] = await Promise.all([
      KycProfile.find(filter)
        .populate(
          "user",
          "fullName phone email role status state lga"
        )
        .sort({ submittedAt: -1, createdAt: -1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit),
      KycProfile.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page: safePage,
      limit: safeLimit,
      kycApplications: items,
    });
  } catch (error) {
    console.error("ADMIN GET KYC ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load KYC applications.",
      error: error.message,
    });
  }
};

exports.getKycApplication = async (req, res) => {
  try {
    const profile = await KycProfile.findById(
      req.params.kycId
    ).populate(
      "user",
      "fullName phone email role status state lga createdAt"
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "KYC application was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      kyc: profile,
    });
  } catch (error) {
    console.error("ADMIN GET KYC DETAIL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load KYC application.",
      error: error.message,
    });
  }
};

exports.updateKycStatus = async (req, res) => {
  try {
    const status = String(
      req.body?.status || ""
    ).toUpperCase();

    const rejectionReason = String(
      req.body?.rejectionReason || ""
    ).trim();

    if (!ALLOWED_STATUS.has(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be PENDING, UNDER_REVIEW, VERIFIED or REJECTED.",
      });
    }

    if (
      status === "REJECTED" &&
      !rejectionReason
    ) {
      return res.status(400).json({
        success: false,
        message:
          "A rejection reason is required.",
      });
    }

    const profile = await KycProfile.findById(
      req.params.kycId
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "KYC application was not found.",
      });
    }

    profile.status = status;

    if (status === "REJECTED") {
      profile.rejectionReason = rejectionReason;
    } else {
      profile.rejectionReason = "";
    }

    if (
      status === "VERIFIED" ||
      status === "REJECTED"
    ) {
      profile.reviewedAt = new Date();
    }

    profile.metadata = {
      ...(profile.metadata || {}),
      lastReviewedBy:
        req.user?._id?.toString?.() || "",
      lastReviewedAt: new Date(),
    };

    await profile.save();

    return res.status(200).json({
      success: true,
      message: `KYC status updated to ${status}.`,
      kyc: profile,
    });
  } catch (error) {
    console.error("ADMIN UPDATE KYC ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update KYC status.",
      error: error.message,
    });
  }
};
