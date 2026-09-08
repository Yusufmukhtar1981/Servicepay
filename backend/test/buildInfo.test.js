const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getBuildInfo,
  sanitizeBuildValue,
} = require("../utils/buildInfo");

test("build info exposes only sanitized non-sensitive identifiers", () => {
  const info = getBuildInfo({
    SERVICEPAY_BUILD_VERSION: "2026.09.07 release",
    SERVICEPAY_BUILD_COMMIT: "abcdef1234567890",
  });

  assert.deepEqual(info, {
    service: "servicepay-api",
    release: "2026.09.07release",
    commit: "abcdef123456",
    environment: "development",
  });
  assert.equal(sanitizeBuildValue(" token value! ", "unknown"), "tokenvalue");
});

test("build info has explicit local-development fallbacks", () => {
  assert.deepEqual(getBuildInfo({}), {
    service: "servicepay-api",
    release: "unknown",
    commit: "unknown",
    environment: "development",
  });
});

test("environment metadata is sanitized and the contract has no extra fields", () => {
  const info = getBuildInfo({
    RENDER_GIT_COMMIT: "1234567890abcdef",
    NODE_ENV: "production<script>",
  });

  assert.deepEqual(Object.keys(info), [
    "service",
    "release",
    "commit",
    "environment",
  ]);
  assert.equal(info.release, "1234567890abcdef");
  assert.equal(info.commit, "1234567890ab");
  assert.equal(info.environment, "productionscript");
});