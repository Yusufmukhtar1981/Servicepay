const { v2: cloudinary } = require("cloudinary");
const {
  MAX_MARKETPLACE_IMAGE_BYTES: MAX_BYTES,
  getMarketplaceImageMimeType: imageMime,
  hasSupportedMarketplaceImageSignature: validSignature,
} = require("./marketplaceImage.service");

// Reuse existing image validation and storage, not a second upload provider.
exports.uploadAnnouncementImage = async (file) => {
  if (!file?.buffer || !imageMime(file) || !validSignature(file.buffer, imageMime(file))) {
    const error = new Error("Choose a valid JPEG, PNG, or WebP image.");
    error.status = 400;
    throw error;
  }
  if (file.buffer.length > MAX_BYTES) {
    const error = new Error("Banner images must be 5 MB or smaller.");
    error.status = 413;
    throw error;
  }
  const credentials = {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  };
  if (Object.values(credentials).some((value) => !value)) {
    const error = new Error("Banner image storage is temporarily unavailable. Use an existing HTTPS image URL.");
    error.status = 503;
    throw error;
  }
  const result = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      ...credentials,
      folder: "servicepay/announcements",
      resource_type: "image",
      allowed_formats: ["jpg", "png", "webp"],
      overwrite: false,
      timeout: 30000,
      // Store the complete original image, without a crop transformation.
    }, (error, value) => error ? reject(error) : resolve(value));
    stream.end(file.buffer);
  });
  if (!result?.secure_url || !String(result.secure_url).startsWith("https://")) {
    throw new Error("Image storage did not return a secure image URL.");
  }
  return { imageUrl: result.secure_url, width: result.width, height: result.height };
};
