"use strict";
const cloudinary = require("cloudinary").v2;
const existing = require("./amanaDocument.service");

async function uploadOne(file, _folder, metadata, dependencies = {}) {
  existing.validateFile(file);
  (dependencies.configure || existing.configureCloudinary)();
  const uploader = dependencies.uploader || cloudinary.uploader;
  const result = await new Promise((resolve, reject) => {
    const stream = uploader.upload_stream({
      public_id: metadata.publicId,
      // Financial evidence must retain its original bytes. Cloudinary image
      // delivery can re-encode PNG/JPEG files even without an explicit transform.
      resource_type: "raw", type: "authenticated", overwrite: false,
    }, (error, response) => error ? reject(error) : resolve(response));
    stream.end(file.buffer);
  });
  if (result?.public_id !== metadata.publicId) throw new Error("EXPENSE_STORAGE_IDENTIFIER_MISMATCH");
  return { assetId: result.public_id, resourceType: "raw" };
}
module.exports = { uploadOne };
