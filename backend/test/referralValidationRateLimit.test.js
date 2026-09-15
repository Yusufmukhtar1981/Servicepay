const test = require("node:test");
const assert = require("node:assert/strict");

const {
  referralValidationRateLimit,
  _resetReferralValidationRateLimitForTests,
} = require("../middleware/referralValidationRateLimit.middleware");

test("referral validation limiter allows a bounded window then returns 429", () => {
  _resetReferralValidationRateLimitForTests();
  let nextCalls = 0;
  const result = {};
  const req = {
    ip: "203.0.113.10",
    headers: {},
  };
  const res = {
    set() {},
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };

  for (let request = 0; request < 31; request += 1) {
    referralValidationRateLimit(req, res, () => {
      nextCalls += 1;
    });
  }

  assert.equal(nextCalls, 30);
  assert.equal(result.status, 429);
  assert.deepEqual(result.body.valid, false);
});