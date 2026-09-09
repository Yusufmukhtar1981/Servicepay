const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const presence = require("../services/callPresence.service");
const { assertSignalingTopology } = require("../services/callSignaling.service");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("call customer route applies protect and customerOnly", () => {
  const source = read("routes/call.routes.js");
  assert.match(source, /router\.use\(protect, customerOnly\)/);
  assert.match(source, /router\.post\("\/", c\.create\)/);
});

test("call schemas intentionally exclude media and signaling fields", () => {
  const source = read("models/callSession.model.js");
  assert.doesNotMatch(source, /\bsdp\s*:/i);
  assert.doesNotMatch(source, /\bcandidate\s*:/i);
  assert.doesNotMatch(source, /\baudio\s*:/i);
  assert.match(source, /requestKey/);
});

test("missed notifications use an idempotent call-specific dedupe key", () => {
  const source = read("services/call.service.js");
  assert.match(source, /dedupeKey: `missed-call:\$\{changed\._id\}`/);
});

test("presence is truthful only while a socket reference exists", () => {
  const id = "presence-test-user";
  assert.equal(presence.isOnline(id), false);
  presence.add(id); presence.add(id);
  assert.equal(presence.isOnline(id), true);
  presence.remove(id);
  assert.equal(presence.isOnline(id), true);
  presence.remove(id);
  assert.equal(presence.isOnline(id), false);
});

test("socket contract has JWT/version guards and bounded SDP ICE member relay", () => {
  const source = read("services/callSignaling.service.js");
  assert.match(source, /jwt\.verify/);
  assert.match(source, /authTokenVersion/);
  assert.match(source, /user\.role !== "CUSTOMER"/);
  assert.match(source, /MAX_SDP/);
  assert.match(source, /MAX_ICE/);
  assert.match(source, /includes\(socket\.userId\)/);
  assert.match(source, /call:sdp/);
  assert.match(source, /call:ice/);
});

test("timeout propagation and multi-instance protection are explicit", () => {
  const source = read("services/callSignaling.service.js");
  assert.match(source, /cleanupExpired\(\)\.then/);
  assert.match(source, /call-user:\$\{call\.callerId\}/);
  assert.match(source, /call-user:\$\{call\.calleeId\}/);
  assert.match(source, /CALL_SIGNALING_MULTI_INSTANCE/);
  assert.match(source, /shared Socket\.IO adapter/);
});

test("production signaling requires explicit single-instance topology", () => {
  assert.throws(
    () => assertSignalingTopology({ NODE_ENV: "production" }, { log: () => {} }),
    /requires explicit CALL_SIGNALING_MODE=single-instance/
  );
  assert.equal(
    assertSignalingTopology({ NODE_ENV: "production", CALL_SIGNALING_MODE: "single-instance" }, { log: () => {} }),
    "single-instance"
  );
});

test("legacy multi-instance signaling remains fail-closed", () => {
  assert.throws(
    () => assertSignalingTopology({ NODE_ENV: "development", CALL_SIGNALING_MULTI_INSTANCE: "true" }, { log: () => {} }),
    /unsupported without a real shared Socket.IO adapter/
  );
});

test("safe search does not project phone or email and guards privacy", () => {
  const source = read("controllers/call.controller.js");
  assert.match(source, /\.select\("fullName profilePhotoUrl"\)/);
  assert.doesNotMatch(source, /\.select\(".*phone.*"\)/);
  assert.match(source, /blockedUserIds/);
  assert.match(source, /virtualAccount\.accountNumber/);
});

test("admin list validates dates and returns safe computed metadata", () => {
  const source = read("controllers/call.controller.js");
  assert.match(source, /from\/to must be valid ISO dates/);
  assert.match(source, /durationSeconds/);
  assert.match(source, /scopeFilterFor/);
  assert.match(source, /nextBefore/);
});