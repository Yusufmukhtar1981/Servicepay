"use strict";
const { v2: cloudinary } = require("cloudinary");
const { fail } = require("./marketing.service");

function client() {
  if (!["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"].every(k => !!process.env[k])) {
    throw fail("Marketing media storage is not configured.", 503);
  }
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true });
  return cloudinary;
}
async function store(buffer, publicId) {
  return new Promise((resolve, reject) => {
    client().uploader.upload_stream({
      resource_type: "raw", type: "authenticated", public_id: publicId,
      overwrite: false, unique_filename: false,
    }, (error, result) => {
      if (error) return reject(fail("Private media upload failed. No marketing record was saved.", 503));
      if (result?.type !== "authenticated" || result?.resource_type !== "raw" || !result.public_id) {
        return reject(fail("Media storage did not confirm private object access.", 503));
      }
      resolve({ provider: "cloudinary", publicId: result.public_id, version: result.version });
    }).end(buffer);
  });
}
async function retrieve(storage) {
  if (storage?.provider !== "cloudinary" || !/^servicepay-marketing\/[a-f0-9-]+\.[a-z0-9]+$/i.test(storage.publicId || "")) {
    throw fail("Private media object identity is invalid.", 503);
  }
  const url = client().utils.private_download_url(storage.publicId, "", {
    resource_type: "raw", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 60,
  });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw fail("Private media download is temporarily unavailable.", 503);
  if (Number(response.headers.get("content-length") || 0) > 8 * 1024 * 1024) throw fail("Stored media exceeds the allowed size.", 503);
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 8 * 1024 * 1024) throw fail("Stored media exceeds the allowed size.", 503);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
module.exports = { store, retrieve };
