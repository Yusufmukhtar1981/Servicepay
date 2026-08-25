const { v2: cloudinary } = require("cloudinary");

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);

const configureCloudinary = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Secure Amana document storage is not configured.");
    error.code = "STORAGE_UNAVAILABLE";
    throw error;
  }
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
};

const hasSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (mimeType === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  return false;
};

const validateFile = (file) => {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (!file?.buffer || !allowedMimeTypes.has(mimeType) || !hasSignature(file.buffer, mimeType)) {
    const error = new Error("Amana uploads must be valid JPEG, PNG, or PDF files.");
    error.code = "UNSUPPORTED_DOCUMENT";
    throw error;
  }
  if (file.buffer.length > MAX_DOCUMENT_BYTES) {
    const error = new Error("Amana documents must be 8 MB or smaller.");
    error.code = "DOCUMENT_TOO_LARGE";
    throw error;
  }
};

const uploadOne = async (file, folder) => {
  validateFile(file);
  configureCloudinary();
  const resourceType = String(file.mimetype).toLowerCase() === "application/pdf" ? "raw" : "image";
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType, type: "authenticated", overwrite: false },
      (error, response) => (error ? reject(error) : resolve(response))
    );
    stream.end(file.buffer);
  });
  const assetId = String(result?.public_id || "").trim();
  if (!assetId) throw new Error("Document storage did not confirm the upload.");
  return {
    assetId,
    originalName: String(file.originalname || "amana-document").slice(0, 180),
    mimeType: String(file.mimetype).toLowerCase(),
    resourceType,
    uploadedAt: new Date(),
  };
};

const uploadMany = async (files, folder) => Promise.all((files || []).map((file) => uploadOne(file, folder)));

const buildSignedUrl = (document) => {
  if (!document?.assetId) return "";
  configureCloudinary();
  return cloudinary.url(document.assetId, {
    resource_type: document.resourceType || "image",
    type: "authenticated",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 300,
  });
};

module.exports = { MAX_DOCUMENT_BYTES, validateFile, uploadOne, uploadMany, buildSignedUrl };