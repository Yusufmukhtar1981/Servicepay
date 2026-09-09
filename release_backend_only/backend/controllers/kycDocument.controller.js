const { v2: cloudinary } = require("cloudinary");
const KycProfile = require("../models/kycProfile.model");
const { getOrCreateProfile } = require("./kyc.controller");
const { hasSupportedImageSignature } = require("../services/kycImageValidation.service");
const { canEditKyc, documentFlags, normalizeDocumentType } = require("../services/kycRequirements.service");

const DOCUMENT_FIELDS = {
  SELFIE: "selfieAssetId",
  ID_DOCUMENT_FRONT: "idDocumentAssetId",
  ID_DOCUMENT: "idDocumentAssetId",
  ID_DOCUMENT_BACK: "idDocumentBackAssetId",
  PROOF_OF_ADDRESS: "proofOfAddressAssetId",
};

const normalizeUploadType = (value) => {
  const type = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(DOCUMENT_FIELDS, type) ? type : "";
};

const configureCloudinary = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("KYC document storage is not configured.");
    error.code = "STORAGE_UNAVAILABLE";
    throw error;
  }
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
};

const uploadBuffer = async (buffer, folder) => {
  configureCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        type: "authenticated",
        overwrite: false,
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
    stream.end(buffer);
  });
};

const destroyAsset = async (assetId) => {
  if (!assetId) return;
  configureCloudinary();
  await cloudinary.uploader.destroy(assetId, {
    resource_type: "image",
    type: "authenticated",
    invalidate: true,
  });
};

const uploadKycDocument = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, message: "Please select a JPEG or PNG image." });
    }

    const mimeType = String(req.file.mimetype || "").toLowerCase();
    if (
      !["image/jpeg", "image/png"].includes(mimeType) ||
      !hasSupportedImageSignature(req.file.buffer, mimeType)
    ) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_IMAGE",
        message: "KYC uploads must be valid JPEG or PNG images.",
      });
    }

    const documentType = normalizeUploadType(req.body?.documentType);
    if (!documentType) {
      return res.status(400).json({
        success: false,
        message: "Invalid KYC document type.",
      });
    }

    const profile = await getOrCreateProfile(userId);
    if (!profile) {
      return res.status(404).json({ success: false, message: "User account was not found." });
    }
    if (!canEditKyc(profile)) {
      return res.status(409).json({
        success: false,
        code: "KYC_LOCKED_FOR_REVIEW",
        message: "Your submitted KYC application cannot be changed while it is under review.",
      });
    }

    const requestedDocumentType = normalizeDocumentType(req.body?.governmentIdType);
    if (
      ["ID_DOCUMENT", "ID_DOCUMENT_FRONT", "ID_DOCUMENT_BACK"].includes(documentType) &&
      !requestedDocumentType &&
      !normalizeDocumentType(profile.documentType)
    ) {
      return res.status(400).json({
        success: false,
        message: "Select the type of government ID before uploading it.",
      });
    }

    const result = await uploadBuffer(req.file.buffer, `servicepay/kyc/${userId}`);
    const assetId = String(result?.public_id || "").trim();
    if (!assetId) {
      return res.status(502).json({
        success: false,
        message: "Document storage did not confirm the upload. Please retry.",
      });
    }

    const field = DOCUMENT_FIELDS[documentType];
    const previousAssetId = String(profile[field] || "").trim();
    profile[field] = assetId;
    if (requestedDocumentType) profile.documentType = requestedDocumentType;
    if (documentType === "SELFIE") profile.livenessStatus = "READY_FOR_CHECK";
    await profile.save();

    if (previousAssetId && previousAssetId !== assetId) {
      destroyAsset(previousAssetId).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "KYC document uploaded securely.",
      documentType,
      documents: documentFlags(profile),
    });
  } catch (error) {
    return res.status(error?.code === "STORAGE_UNAVAILABLE" ? 503 : 500).json({
      success: false,
      code: error?.code === "STORAGE_UNAVAILABLE" ? "STORAGE_UNAVAILABLE" : "DOCUMENT_UPLOAD_FAILED",
      message:
        error?.code === "STORAGE_UNAVAILABLE"
          ? "Secure document storage is temporarily unavailable. Please try again later."
          : "Unable to upload KYC document. Please retry.",
    });
  }
};

const removeKycDocument = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const documentType = normalizeUploadType(req.params?.documentType);
    if (!userId || !documentType) {
      return res.status(400).json({ success: false, message: "Invalid KYC document." });
    }
    const profile = await KycProfile.findOne({ user: userId });
    if (!profile) return res.status(404).json({ success: false, message: "KYC profile was not found." });
    if (!canEditKyc(profile)) {
      return res.status(409).json({
        success: false,
        code: "KYC_LOCKED_FOR_REVIEW",
        message: "Your submitted KYC application cannot be changed while it is under review.",
      });
    }

    const field = DOCUMENT_FIELDS[documentType];
    const assetId = String(profile[field] || "").trim();
    profile[field] = "";
    if (documentType === "SELFIE") profile.livenessStatus = "NOT_STARTED";
    await profile.save();
    destroyAsset(assetId).catch(() => {});

    return res.status(200).json({
      success: true,
      documents: documentFlags(profile),
    });
  } catch (_) {
    return res.status(500).json({ success: false, message: "Unable to remove KYC document." });
  }
};

const getAuthorizedDocumentUrl = (assetId) => {
  configureCloudinary();
  return cloudinary.url(assetId, {
    resource_type: "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
};

module.exports = {
  uploadKycDocument,
  removeKycDocument,
  getAuthorizedDocumentUrl,
  normalizeUploadType,
};