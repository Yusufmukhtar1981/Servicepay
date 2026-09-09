function sanitizeBuildValue(value, fallback) {
  const sanitized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "")
    .slice(0, 64);
  return sanitized || fallback;
}

function getBuildInfo(environment = process.env) {
  const commit = sanitizeBuildValue(
    environment.SERVICEPAY_BUILD_COMMIT || environment.RENDER_GIT_COMMIT,
    "unknown"
  );

  return Object.freeze({
    service: "servicepay-api",
    release: sanitizeBuildValue(
      environment.SERVICEPAY_BUILD_VERSION || commit,
      "development"
    ),
    commit: commit === "unknown" ? commit : commit.slice(0, 12),
    environment: sanitizeBuildValue(
      environment.SERVICEPAY_ENVIRONMENT || environment.NODE_ENV,
      "development"
    ),
  });
}

module.exports = {
  getBuildInfo,
  sanitizeBuildValue,
};