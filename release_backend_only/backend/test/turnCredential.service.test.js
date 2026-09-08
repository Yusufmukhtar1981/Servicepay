const test = require("node:test");
const assert = require("node:assert/strict");
const turn = require("../services/turnCredential.service");

const previous = { TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN };
const credentials = () => {
  process.env.TWILIO_ACCOUNT_SID = ["AC", "3".repeat(32)].join("");
  process.env.TWILIO_AUTH_TOKEN = "test-auth-token-not-a-real-secret";
};
test.after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  turn.__resetForTests();
});

test("Twilio NTS POST has Basic auth and TTL without exposing credentials in config", async () => {
  credentials(); let request;
  turn.__setFetchForTests(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ ttl: 120, ice_servers: [{ url: "turn:global.turn.twilio.com:3478?transport=udp", username: "ephemeral-user", credential: "ephemeral-credential" }] }) };
  });
  const config = await turn.getCallConfig();
  assert.match(request.url, /Accounts\/AC3{32}\/Tokens\.json$/);
  assert.equal(request.options.method, "POST");
  assert.match(request.options.headers.authorization, /^Basic /);
  assert.equal(Buffer.from(request.options.headers.authorization.slice(6), "base64").toString(), `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`);
  assert.equal(request.options.body, "Ttl=3600");
  assert.deepEqual(config.iceServers, [{ urls: "turn:global.turn.twilio.com:3478?transport=udp", username: "ephemeral-user", credential: "ephemeral-credential" }]);
  assert.equal(JSON.stringify(config).includes(process.env.TWILIO_AUTH_TOKEN), false);
  assert.equal(JSON.stringify(config).includes(process.env.TWILIO_ACCOUNT_SID), false);
});

test("normalized token result is cached only before its expiry margin", async () => {
  credentials(); let ticks = 0; let requests = 0;
  turn.__setNowForTests(() => ticks);
  turn.__setFetchForTests(async () => {
    requests++;
    return { ok: true, json: async () => ({ ttl: 60, ice_servers: [{ urls: ["stun:global.turn.twilio.com:3478", "bad://not-ice"] }, { urls: "turn:global.turn.twilio.com:3478", username: "u", credential: "c" }] }) };
  });
  await turn.getCallConfig(); await turn.getCallConfig();
  assert.equal(requests, 1);
  ticks = 31_000; // TTL 60 less 30 second safety margin
  await turn.getCallConfig();
  assert.equal(requests, 2);
});

test("missing secrets fails closed without connector or static fallback", async () => {
  delete process.env.TWILIO_ACCOUNT_SID; delete process.env.TWILIO_AUTH_TOKEN;
  let called = false; turn.__setFetchForTests(async () => { called = true; });
  const config = await turn.getCallConfig();
  assert.equal(called, false);
  assert.deepEqual(config, { callingAvailable: false, reason: "Calling is unavailable because TURN credentials are not configured.", iceServers: [] });
});

test("Twilio HTTP and malformed responses fail closed without leaking auth token", async () => {
  credentials();
  turn.__setFetchForTests(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const failed = await turn.getCallConfig();
  assert.equal(failed.callingAvailable, false);
  assert.equal(JSON.stringify(failed).includes(process.env.TWILIO_AUTH_TOKEN), false);
  turn.__setFetchForTests(async () => ({ ok: true, json: async () => ({ ice_servers: [{ urls: "https://not-turn.example" }] }) }));
  const malformed = await turn.getCallConfig();
  assert.equal(malformed.callingAvailable, false);
});

test("STUN-only or incomplete TURN token responses fail closed and never cache", async () => {
  credentials(); let requests = 0;
  const cases = [
    [{ urls: "stun:global.turn.twilio.com:3478" }],
    [{ urls: "turn:global.turn.twilio.com:3478", credential: "credential" }],
    [{ urls: "turn:global.turn.twilio.com:3478", username: "username" }],
  ];
  for (const ice_servers of cases) {
    turn.__setFetchForTests(async () => { requests++; return { ok: true, json: async () => ({ ttl: 3600, ice_servers }) }; });
    const config = await turn.getCallConfig();
    assert.equal(config.callingAvailable, false);
  }
  assert.equal(requests, 3);
});

test("valid mixed STUN and credentialed TURN response preserves both", async () => {
  credentials();
  turn.__setFetchForTests(async () => ({ ok: true, json: async () => ({
    ttl: 120,
    ice_servers: [
      { urls: "stun:global.turn.twilio.com:3478" },
      { urls: "turn:global.turn.twilio.com:3478", username: "short-user", credential: "short-credential" },
    ],
  }) }));
  const config = await turn.getCallConfig();
  assert.equal(config.callingAvailable, true);
  assert.equal(config.iceServers.length, 2);
  assert.match(config.iceServers[0].urls, /^stun:/);
  assert.match(config.iceServers[1].urls, /^turn:/);
});

test("TTL at or below safety margin is not cached beyond provider expiry", async () => {
  credentials(); let requests = 0; let clock = 0;
  turn.__setNowForTests(() => clock);
  turn.__setFetchForTests(async () => {
    requests++;
    return { ok: true, json: async () => ({ ttl: 30, ice_servers: [{ urls: "turn:global.turn.twilio.com:3478", username: "u", credential: "c" }] }) };
  });
  await turn.getCallConfig();
  clock = 1;
  await turn.getCallConfig();
  assert.equal(requests, 2);
});