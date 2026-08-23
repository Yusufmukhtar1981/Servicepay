const SUPPORTED_DOCUMENT_TYPES = new Set([
  "NIN_SLIP",
  "NATIONAL_ID",
  "DRIVERS_LICENSE",
  "INTERNATIONAL_PASSPORT",
  "VOTERS_CARD",
]);

const EDITABLE_STATUSES = new Set([
  "NOT_STARTED",
  "REJECTED",
  "NEEDS_MORE_INFORMATION",
]);

const normalizeDocumentType = (value) => {
  const type = String(value || "").trim().toUpperCase();
  return SUPPORTED_DOCUMENT_TYPES.has(type) ? type : "";
};

const requiresDocumentBack = (documentType) =>
  ["NATIONAL_ID", "DRIVERS_LICENSE", "VOTERS_CARD"].includes(
    normalizeDocumentType(documentType),
  );

const hasPrivateAsset = (profile, field) =>
  Boolean(String(profile?.[field] || "").trim());

const documentFlags = (profile) => {
  const hasLegacySelfie = Boolean(String(profile?.selfieUrl || "").trim());
  const hasLegacyId = Boolean(String(profile?.idDocumentUrl || "").trim());
  const hasLegacyProof = Boolean(
    String(profile?.proofOfAddressUrl || "").trim(),
  );

  return {
    documentType: normalizeDocumentType(profile?.documentType),
    selfieUploaded: hasPrivateAsset(profile, "selfieAssetId"),
    idDocumentUploaded: hasPrivateAsset(profile, "idDocumentAssetId"),
    idDocumentBackUploaded: hasPrivateAsset(profile, "idDocumentBackAssetId"),
    proofOfAddressUploaded: hasPrivateAsset(profile, "proofOfAddressAssetId"),
    selfieNeedsSecureReupload: !hasPrivateAsset(profile, "selfieAssetId") && hasLegacySelfie,
    idDocumentNeedsSecureReupload:
      !hasPrivateAsset(profile, "idDocumentAssetId") && hasLegacyId,
    proofOfAddressNeedsSecureReupload:
      !hasPrivateAsset(profile, "proofOfAddressAssetId") && hasLegacyProof,
  };
};

const canEditKyc = (profile) =>
  EDITABLE_STATUSES.has(String(profile?.status || "NOT_STARTED").toUpperCase());

const validateDocumentsForTier = (profile, requestedLevel) => {
  const level = String(
    requestedLevel || profile?.requestedLevel || profile?.level || "TIER_1",
  )
    .trim()
    .toUpperCase();
  const flags = documentFlags(profile);

  if (level === "TIER_1") {
    return { valid: true, message: "" };
  }

  if (!flags.documentType || !flags.idDocumentUploaded || !flags.selfieUploaded) {
    return {
      valid: false,
      message: "Tier 2 requires a supported government ID and a selfie.",
    };
  }

  if (
    requiresDocumentBack(flags.documentType) &&
    !flags.idDocumentBackUploaded
  ) {
    return {
      valid: false,
      message: "Please upload the back of your government ID.",
    };
  }

  if (level === "TIER_3" && !flags.proofOfAddressUploaded) {
    return {
      valid: false,
      message: "Tier 3 requires proof of address.",
    };
  }

  return { valid: true, message: "" };
};

const safeReviewHistory = (profile) =>
  Array.isArray(profile?.reviewHistory)
    ? profile.reviewHistory.map((entry) => ({
        action: String(entry?.action || ""),
        reason: String(entry?.reason || ""),
        occurredAt: entry?.occurredAt || null,
      }))
    : [];

const safeKycProfile = (profile, { includeReviewHistory = false } = {}) => {
  const source = typeof profile?.toObject === "function" ? profile.toObject() : profile || {};
  const identity = {
    ninVerified: source.ninVerified === true,
    ninLast4: String(source.ninLast4 || ""),
    ninVerifiedAt: source.ninVerifiedAt || null,
    bvnVerified: source.bvnVerified === true,
    bvnLast4: String(source.bvnLast4 || ""),
    bvnVerifiedAt: source.bvnVerifiedAt || null,
    matchStatus: String(source.identityMatchStatus || "NOT_VERIFIED"),
  };

  return {
    _id: source._id,
    id: source._id?.toString?.() || "",
    status: String(source.status || "NOT_STARTED"),
    level: String(source.level || "TIER_1"),
    requestedLevel: String(source.requestedLevel || source.level || "TIER_1"),
    firstName: String(source.firstName || ""),
    middleName: String(source.middleName || ""),
    lastName: String(source.lastName || ""),
    dateOfBirth: source.dateOfBirth || null,
    gender: String(source.gender || ""),
    phone: String(source.phone || ""),
    email: String(source.email || ""),
    address: String(source.address || ""),
    state: String(source.state || ""),
    lga: String(source.lga || ""),
    rejectionReason: String(source.rejectionReason || ""),
    reviewReason: String(source.reviewReason || ""),
    submittedAt: source.submittedAt || null,
    reviewedAt: source.reviewedAt || null,
    approvedAt: source.approvedAt || null,
    identity,
    documents: documentFlags(source),
    liveness: {
      status: String(source.livenessStatus || "NOT_STARTED"),
    },
    ...(includeReviewHistory ? { reviewHistory: safeReviewHistory(source) } : {}),
  };
};

module.exports = {
  SUPPORTED_DOCUMENT_TYPES,
  normalizeDocumentType,
  requiresDocumentBack,
  documentFlags,
  canEditKyc,
  validateDocumentsForTier,
  safeReviewHistory,
  safeKycProfile,
};