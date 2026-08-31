const test = require("node:test");
const assert = require("node:assert/strict");
const turn = require("../services/turnCredential.service");

const env = { NODE_ENV: process.env.NODE_ENV, CALL_TURN_URLS: process.env.CALL_TURN_URLS, CALL_TURN_USERNAME: process.env.CALL_TURN_USERNAME, CALL_TURN_CREDENTIAL: process.env.CALL_TURN_CREDENTIAL };
const restore = () => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  turn.__resetForTests();
};
test.after(restore);

test("connector returns normalized expiring Twilio ICE servers without account fields", async () => {
  let requests = 0;
  const fixtureAccountSid = ["AC", "1".repeat(32)].join("");
  turn.__setConnectorFactory(() => ({ proxy: async (_connector, requestPath) => {
    requests++;
    if (requestPath.includes("Accounts.json")) return { json: async () => ({ accounts: [{ sid: fixtureAccountSid }] }) };
    return { json: async () => ({ ttl: 120, ice_servers: [{ url: "turn:global.turn.twilio.com:3478?transport=udp", username: "fixture-user", credential: "fixture-value" }] }) };
  }}));
  const config = await turn.getCallConfig();
  assert.equal(config.callingAvailable, true);
  assert.deepEqual(config.iceServers, [{ urls: "turn:global.turn.twilio.com:3478?transport=udp", username: "fixture-user", credential: "fixture-value" }]);
  assert.equal(JSON.stringify(config).includes(fixtureAccountSid), false);
  assert.equal(requests, 2);
});

test("connector response is cached before TTL expiry", async () => {
  let requests = 0;
  const fixtureAccountSid = ["AC", "2".repeat(32)].join("");
  turn.__setConnectorFactory(() => ({ proxy: async (_name, path) => {
    requests++; return { json: async () => path.includes("Accounts.json")
      ? { accounts: [{ sid: fixtureAccountSid }] }
      : { ttl: 120, ice_servers: [{ urls: "stun:global.turn.twilio.com:3478" }] } };
  }}));
  await turn.getCallConfig(); await turn.getCallConfig();
  assert.equal(requests, 2);
});

test("static configured TURN is used when connector is unavailable", async () => {
  process.env.NODE_ENV = "production";
  process.env.CALL_TURN_URLS = "turn:render.example:3478";
  process.env.CALL_TURN_USERNAME = "render-user";
  process.env.CALL_TURN_CREDENTIAL = "fixture-value";
  turn.__setConnectorFactory(() => ({ proxy: async () => { throw new Error("not connected"); } }));
  const config = await turn.getCallConfig();
  assert.equal(config.callingAvailable, true);
  assert.equal(config.iceServers.some((server) => server.username === "render-user"), true);
});

test("production unavailable response is clear and contains no configured secret", async () => {
  process.env.NODE_ENV = "production";
  delete process.env.CALL_TURN_URLS; delete process.env.CALL_TURN_USERNAME;
  process.env.CALL_TURN_CREDENTIAL = "fixture-value";
  turn.__setConnectorFactory(() => ({ proxy: async () => { throw new Error("not connected"); } }));
  const config = await turn.getCallConfig();
  assert.deepEqual(config.iceServers, []);
  assert.equal(config.callingAvailable, false);
  assert.match(config.reason, /TURN connectivity is not configured/);
  assert.equal(JSON.stringify(config).includes("fixture-value"), false);
});