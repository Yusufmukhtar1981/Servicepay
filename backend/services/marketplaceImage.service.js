const { v2: cloudinary } = require("cloudinary");

const SUPPORTED_MARKETPLACE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const configureCloudinary = () => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY || process.env.API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Marketplace image storage is not configured.");
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

const hasSupportedMarketplaceImageSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  const isJpeg =
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isWebp =
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  return (
    (mimeType === "image/jpeg" && isJpeg) ||
    (mimeType === "image/png" && isPng) ||
    (mimeType === "image/webp" && isWebp)
  );
};

const uploadMarketplaceProductImage = async ({ buffer, userId }) => {
  configureCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `servicepay/marketplace/products/${userId}`,
        resource_type: "image",
        type: "upload",
        overwrite: false,
        transformation: [
          {
            width: 2000,
            height: 2000,
            crop: "limit",
            quality: "auto",
            fetch_format: "auto",
          },
        ],
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );

    stream.end(buffer);
  });
};

module.exports = {
  SUPPORTED_MARKETPLACE_IMAGE_TYPES,
  hasSupportedMarketplaceImageSignature,
  uploadMarketplaceProductImage,
};