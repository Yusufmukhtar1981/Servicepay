const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_REQUESTS_PER_WINDOW,
  createPrivacyRequestRateLimit,
  deletionIdentityKey,
} = require("../middleware/privacyRequestRateLimit.middleware");

test("public privacy intake is rate limited without storing raw contact data", async () => {
  let count = 0;
  const seen = [];
  const limiter = createPrivacyRequestRateLimit({
    now: () => 1_800_000,
    rateLimitModel: {
      findOneAndUpdate: async (filter, update) => {
        seen.push({ filter, update });
        count += 1;
        return { count };
      },
    },
  });
  const req = {
    ip: "127.0.0.1",
    headers: {},
    body: { email: "customer@example.com" },
  };
  const response = () => ({
    code: 200,
    body: null,
    headers: {},
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; },
  });

  for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i += 1) {
    let called = false;
    await limiter(req, response(), () => { called = true; });
    assert.equal(called, true);
  }
  const blocked = response();
  await limiter(req, blocked, () => assert.fail("rate-limited request continued"));
  assert.equal(blocked.code, 429);
  assert.equal(blocked.body.code, "PRIVACY_REQUEST_RATE_LIMITED");
  assert.equal(typeof seen[0].filter.key, "string");
  assert.equal(seen[0].filter.key.length, 64);
  assert.equal(JSON.stringify(seen).includes("customer@example.com"), false);
});

test("deletion account limits cannot be bypassed using equivalent phone formatting", () => {
  const key = identifier => deletionIdentityKey({ body: { identifier } });
  const canonical = key("08031234567");
  for (const phone of ["+2348031234567", "2348031234567", "0803 123 4567", "(0803)-123-4567"]) {
    assert.equal(key(phone), canonical);
  }
  assert.equal(key("Person@Example.Invalid"), key("person@example.invalid"));
});