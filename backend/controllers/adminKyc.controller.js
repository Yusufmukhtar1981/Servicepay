const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");
const {
  safeKycProfile,
  validateDocumentsForTier,
} = require("../services/kycRequirements.service");
const {
  getAuthorizedDocumentUrl,
  normalizeUploadType,
} = require("./kycDocument.controller");

const ALLOWED_ACTIONS = new Set([
  "APPROVED",
  "VERIFIED",
  "REJECTED",
  "REQUEST_MORE_INFORMATION",
]);

const canReview = (profile) =>
  ["PENDING", "UNDER_REVIEW"].includes(String(profile?.status || "").toUpperCase());

const isHeadOffice = (user) =>
  String(user?.role || "").trim().toUpperCase() === "HEAD_OFFICE";

const requireHeadOffice = (req, res) => {
  if (isHeadOffice(req.user)) return true;
  res.status(403).json({
    success: false,
    message: "Head Office access is required.",
  });
  return false;
};

const serializeAdmin = (profile) => {
  const safe = safeKycProfile(profile, { includeReviewHistory: true });
  const user = profile.user && typeof profile.user === "object"
    ? {
        id: String(profile.user._id || ""),
        fullName: String(profile.user.fullName || ""),
        phone: String(profile.user.phone || ""),
        email: String(profile.user.email || ""),
        accountNumber: String(profile.user.accountNumber || ""),
      }
    : undefined;
  const verifiedBy =
    profile.verifiedBy && typeof profile.verifiedBy === "object"
      ? {
          id: String(profile.verifiedBy._id || ""),
          fullName: String(profile.verifiedBy.fullName || ""),
          email: String(profile.verifiedBy.email || ""),
        }
      : null;

  return {
    ...safe,
    user,
    servicePayAccountIdentity: user?.accountNumber || user?.id || "",
    nin: String(profile.submittedNin || ""),
    bvn: String(profile.submittedBvn || ""),
    verification: {
      method: String(profile.verificationMethod || ""),
      verifiedAt: profile.verifiedAt || null,
      verifiedBy,
    },
  };
};

exports.getKycApplications = async (req, res) => {
  try {
    if (!requireHeadOffice(req, res)) return;
    const { status, level, search, page = 1, limit = 50 } = req.query || {};
    const filter = {};
    if (status) filter.status = String(status).toUpperCase();
    if (level) filter.requestedLevel = String(level).toUpperCase();
    if (search) {
      const safeSearch = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const profileSearch = [
        { firstName: { $regex: safeSearch, $options: "i" } },
        { middleName: { $regex: safeSearch, $options: "i" } },
        { lastName: { $regex: safeSearch, $options: "i" } },
        { phone: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
      ];
      const matchingUsers = await User.find({
        $or: [
          { fullName: { $regex: safeSearch, $options: "i" } },
          { phone: { $regex: safeSearch, $options: "i" } },
          { email: { $regex: safeSearch, $options: "i" } },
        ],
      })
        .select("_id")
        .limit(100);
      const userIds = matchingUsers.map((user) => user._id);
      if (/^\d{11}$/.test(String(search).trim())) {
        profileSearch.push(
          { submittedNin: String(search).trim() },
          { submittedBvn: String(search).trim() }
        );
      }
      if (userIds.length) profileSearch.push({ user: { $in: userIds } });
      filter.$or = profileSearch;
    }
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const [items, total] = await Promise.all([
      KycProfile.find(filter)
        .select("+submittedNin +submittedBvn")
        .populate("user", "fullName phone email accountNumber")
        .populate("verifiedBy", "fullName email")
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
      kycApplications: items.map(serializeAdmin),
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to load KYC applications." });
  }
};

exports.getKycApplication = async (req, res) => {
  try {
    if (!requireHeadOffice(req, res)) return;
    const profile = await KycProfile.findById(req.params.kycId)
      .select("+submittedNin +submittedBvn")
      .populate("user", "fullName phone email accountNumber")
      .populate("verifiedBy", "fullName email");
    if (!profile) {
      return res.status(404).json({ success: false, message: "KYC application was not found." });
    }
    return res.status(200).json({ success: true, kyc: serializeAdmin(profile) });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to load KYC application." });
  }
};

exports.getKycDocument = async (req, res) => {
  try {
    if (!requireHeadOffice(req, res)) return;
    const documentType = normalizeUploadType(req.params.documentType);
    const profile = await KycProfile.findById(req.params.kycId);
    if (!profile || !documentType) {
      return res.status(404).json({ success: false, message: "KYC document was not found." });
    }
    const field = {
      SELFIE: "selfieAssetId",
      ID_DOCUMENT: "idDocumentAssetId",
      ID_DOCUMENT_FRONT: "idDocumentAssetId",
      ID_DOCUMENT_BACK: "idDocumentBackAssetId",
      PROOF_OF_ADDRESS: "proofOfAddressAssetId",
    }[documentType];
    const assetId = String(profile[field] || "").trim();
    if (!assetId) {
      return res.status(404).json({ success: false, message: "KYC document was not found." });
    }
    return res.status(200).json({
      success: true,
      url: getAuthorizedDocumentUrl(assetId),
      expiresInSeconds: 300,
    });
  } catch (_) {
    return res.status(503).json({
      success: false,
      message: "Authorized document access is temporarily unavailable.",
    });
  }
};

exports.updateKycStatus = async (req, res) => {
  try {
    if (!requireHeadOffice(req, res)) return;
    const action = String(req.body?.status || req.body?.action || "").toUpperCase();
    const manualOverride = req.body?.manualOverride === true;
    const reviewReason = String(
      req.body?.reviewReason || req.body?.rejectionReason || "",
    ).trim();
    if (!ALLOWED_ACTIONS.has(action)) {
      return res.status(400).json({
        success: false,
        message: "Choose APPROVED, REJECTED, or REQUEST_MORE_INFORMATION.",
      });
    }
    if (
      ["REJECTED", "REQUEST_MORE_INFORMATION"].includes(action) &&
      !reviewReason
    ) {
      return res.status(400).json({
        success: false,
        message: "A review reason is required for this action.",
      });
    }

    const profile = await KycProfile.findById(req.params.kycId);
    if (!profile) {
      return res.status(404).json({ success: false, message: "KYC application was not found." });
    }
    if (!canReview(profile)) {
      return res.status(409).json({
        success: false,
        message: "Only submitted KYC applications can be reviewed.",
      });
    }

    const persistedStatus = action === "APPROVED" || action === "VERIFIED"
      ? "VERIFIED"
      : action === "REQUEST_MORE_INFORMATION"
        ? "NEEDS_MORE_INFORMATION"
        : "REJECTED";

    if (persistedStatus === "VERIFIED") {
      const documentCheck = validateDocumentsForTier(profile, profile.requestedLevel);
      if (!manualOverride && !documentCheck.valid) {
        return res.status(400).json({
          success: false,
          message: `KYC cannot be approved: ${documentCheck.message}`,
        });
      }
      profile.level = profile.requestedLevel;
      profile.approvedAt = new Date();
      profile.verifiedAt = profile.approvedAt;
      profile.verifiedBy = req.user?._id || req.user?.id || null;
      profile.verificationMethod = manualOverride
        ? "MANUAL_ADMIN_OVERRIDE"
        : profile.verificationMethod;
    }

    profile.status = persistedStatus;
    profile.reviewReason = reviewReason;
    profile.rejectionReason = persistedStatus === "REJECTED" ? reviewReason : "";
    profile.reviewedAt = new Date();
    profile.reviewedBy = req.user?._id || req.user?.id || null;
    profile.reviewHistory.push({
      action:
        persistedStatus === "VERIFIED" && manualOverride
          ? "MANUAL_ADMIN_OVERRIDE"
          : persistedStatus,
      reason: reviewReason,
      reviewer: profile.reviewedBy,
      occurredAt: profile.reviewedAt,
    });
    await profile.save();
    if (persistedStatus === "VERIFIED") {
      await User.updateOne(
        { _id: profile.user },
        { $set: { kycVerified: true } }
      );
    }
    await profile.populate("user", "fullName phone email accountNumber");
    await profile.populate("verifiedBy", "fullName email");

    return res.status(200).json({
      success: true,
      message: `KYC ${persistedStatus.toLowerCase().replaceAll("_", " ")}.`,
      kyc: serializeAdmin(profile),
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to update KYC status." });
  }
};