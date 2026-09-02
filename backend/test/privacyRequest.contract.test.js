const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public account and data request routes are exposed with rate limiting", () => {
  const routes = read("routes/privacyRequest.routes.js");
  const index = read("index.js");
  assert.match(routes, /account-deletion-requests.*privacyRequestRateLimit/);
  assert.match(routes, /data-requests.*privacyRequestRateLimit/);
  assert.match(index, /app\.use\("\/api\/privacy", privacyRequestRoutes\)/);
});

test("public intake validates identity fields, confirmation and duplicates", () => {
  const source = read("controllers/privacyRequest.controller.js");
  assert.match(source, /PUBLIC_EMAIL/);
  assert.match(source, /PHONE/);
  assert.match(source, /confirmation !== true/);
  assert.match(source, /ACTIVE_PRIVACY_REQUEST_EXISTS/);
  assert.match(source, /activeRequestKey/);
  assert.doesNotMatch(source, /req\.body\.(password|pin|bvn|nin|otp)/i);
});

test("admin request workflow has guarded transitions and retention-safe completion", () => {
  const controller = read("controllers/privacyRequest.controller.js");
  const routes = read("routes/admin.routes.js");
  const permissions = read("config/permissionRegistry.js");
  assert.match(controller, /PENDING: \["UNDER_REVIEW", "REJECTED"\]/);
  assert.match(controller, /UNDER_REVIEW: \["PENDING", "APPROVED", "REJECTED"\]/);
  assert.match(controller, /APPROVED: \["COMPLETED", "REJECTED"\]/);
  assert.match(controller, /\$inc: \{ authTokenVersion: 1 \}/);
  assert.match(controller, /status: "BLOCKED"/);
  assert.match(controller, /Deleted ServicePay Customer/);
  assert.match(routes, /requirePermission\(P\.PRIVACY_VIEW\)/);
  assert.match(routes, /requirePermission\(P\.PRIVACY_MANAGE\)/);
  assert.match(permissions, /"PRIVACY_VIEW", "privacy\.view"/);
  assert.match(permissions, /"PRIVACY_MANAGE", "privacy\.manage"/);
});