const { v2: cloudinary } = require("cloudinary");
const KycProfile = require("../models/kycProfile.model");

const configureCloudinary = () => {
  const cloudName =
    process.env.CLOUDINARY_CLOUD_NAME ||
    process.env.CLOUD_NAME;

  const apiKey =
    process.env.CLOUDINARY_API_KEY ||
    process.env.API_KEY;

  const apiSecret =
    process.env.CLOUDINARY_API_SECRET ||
    process.env.API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary storage is not configured.");
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
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    stream.end(buffer);
  });
};

const normalizeType = (value) => {
  const type = String(value || "")
    .trim()
    .toUpperCase();

  const allowed = new Set([
    "SELFIE",
    "ID_DOCUMENT",
    "PROOF_OF_ADDRESS",
  ]);

  return allowed.has(type) ? type : "";
};

const uploadKycDocument = async (req, res) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Please select an image.",
      });
    }

    const mimeType = String(
      req.file.mimetype || ""
    ).toLowerCase();

    if (!mimeType.startsWith("image/")) {
      return res.status(400).json({
        success: false,
        message: "Only image files are allowed.",
      });
    }

    const documentType =
      normalizeType(req.body?.documentType);

    if (!documentType) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid KYC document type.",
      });
    }

    let profile =
      await KycProfile.findOne({
        user: userId,
      });

    if (!profile) {
      profile = await KycProfile.create({
        user: userId,
      });
    }

    const result = await uploadBuffer(
      req.file.buffer,
      `servicepay/kyc/${userId}`
    );

    const url =
      String(result?.secure_url || "")
        .trim();

    if (!url) {
      return res.status(500).json({
        success: false,
        message:
          "Unable to obtain uploaded document URL.",
      });
    }

    if (documentType === "SELFIE") {
      profile.selfieUrl = url;
    }

    if (documentType === "ID_DOCUMENT") {
      profile.idDocumentUrl = url;
    }

    if (
      documentType ===
      "PROOF_OF_ADDRESS"
    ) {
      profile.proofOfAddressUrl = url;
    }

    await profile.save();

    return res.status(200).json({
      success: true,
      message:
        "KYC document uploaded successfully.",
      documentType,
      url,
      kyc: profile,
    });
  } catch (error) {
    console.error(
      "KYC DOCUMENT UPLOAD ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to upload KYC document.",
      error: error.message,
    });
  }
};

const validateDocumentsForTier = (
  profile,
  requestedLevel
) => {
  const level = String(
    requestedLevel ||
    profile?.requestedLevel ||
    profile?.level ||
    "TIER_1"
  )
    .trim()
    .toUpperCase();

  const selfie =
    String(profile?.selfieUrl || "")
      .trim();

  const idDocument =
    String(
      profile?.idDocumentUrl || ""
    ).trim();

  const proofOfAddress =
    String(
      profile?.proofOfAddressUrl || ""
    ).trim();

  if (
    level === "TIER_2" &&
    (!selfie || !idDocument)
  ) {
    return {
      valid: false,
      message:
        "Tier 2 requires Government ID and Selfie.",
    };
  }

  if (
    level === "TIER_3" &&
    (
      !selfie ||
      !idDocument ||
      !proofOfAddress
    )
  ) {
    return {
      valid: false,
      message:
        "Tier 3 requires Government ID, Selfie and Proof of Address.",
    };
  }

  return {
    valid: true,
    message: "",
  };
};

module.exports = {
  uploadKycDocument,
  validateDocumentsForTier,
};
