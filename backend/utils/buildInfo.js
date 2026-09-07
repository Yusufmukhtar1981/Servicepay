const packageJson = require("../../package.json");

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
    version: sanitizeBuildValue(packageJson.version, "unknown"),
    build: sanitizeBuildValue(
      environment.SERVICEPAY_BUILD_VERSION || commit,
      "development"
    ),
    commit: commit === "unknown" ? commit : commit.slice(0, 12),
  });
}

module.exports = {
  getBuildInfo,
  sanitizeBuildValue,
};