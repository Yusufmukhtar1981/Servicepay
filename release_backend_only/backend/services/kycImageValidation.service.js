const hasSupportedImageSignature = (buffer, mimeType) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;

  const isJpeg =
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  return (
    (mimeType === "image/jpeg" && isJpeg) ||
    (mimeType === "image/png" && isPng)
  );
};

module.exports = { hasSupportedImageSignature };