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
    version: "1.0.0",
    build: "2026.09.07release",
    commit: "abcdef123456",
  });
  assert.equal(sanitizeBuildValue(" token value! ", "unknown"), "tokenvalue");
});

test("build info has explicit local-development fallbacks", () => {
  assert.deepEqual(getBuildInfo({}), {
    version: "1.0.0",
    build: "unknown",
    commit: "unknown",
  });
});