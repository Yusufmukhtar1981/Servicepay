"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registrationIdentity } = require("../services/registrationIdentity");

test("legacy NIN registration retains masked pending metadata only", () => {
  assert.deepEqual(registrationIdentity({ nin: "12345678901" }), {
    ninNumberMasked: "*******8901", ninVerificationStatus: "PENDING",
  });
  assert.deepEqual(registrationIdentity({ ninNumber: "12345678901" }),
    registrationIdentity({ nin: "12345678901" }));
});

test("BVN registration never mislabels BVN as NIN or returns raw identity", () => {
  const metadata = registrationIdentity({ identityType: "BVN", bvn: "12345678901" });
  assert.deepEqual(metadata, {
    bvnNumberMasked: "*******8901", bvnVerificationStatus: "PENDING",
  });
  assert(!JSON.stringify(metadata).includes("12345678901"));
  assert(!Object.keys(metadata).some(key => key.startsWith("nin")));
});

test("invalid, mixed or mismatched identities fail without including their values", () => {
  for (const body of [{}, { nin: "123" }, { nin: "1234567890A" },
    { nin: "12345678901", bvn: "12345678901" },
    { identityType: "NIN", bvn: "12345678901" },
    { identityType: "BVN", nin: "12345678901" },
    { identityType: "OTHER", nin: "12345678901" }]) {
    assert.throws(() => registrationIdentity(body), error =>
      error.statusCode === 400 && !error.message.includes("12345678901"));
  }
});
