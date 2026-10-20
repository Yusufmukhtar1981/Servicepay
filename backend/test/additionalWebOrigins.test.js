"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { additionalWebOrigins } = require("../config/additionalWebOrigins");

test("existing deployments retain an empty additional allowlist by default", () => {
  assert.deepEqual(additionalWebOrigins(), []);
});

test("configured web hosts are exact HTTPS origins and deduplicated", () => {
  assert.deepEqual(
    additionalWebOrigins(" https://CUSTOMER.example/, https://admin.example,https://customer.example "),
    ["https://customer.example", "https://admin.example"]
  );
});

for (const invalid of [
  "http://customer.example", "https://*.example", "*",
  "https://user:password@customer.example", "https://customer.example/path",
  "https://customer.example?token=x", "https://customer.example#fragment",
  "not a URL",
]) {
  test(`rejects unsafe origin form: ${invalid.split(":")[0]}`, () => {
    assert.throws(() => additionalWebOrigins(invalid));
  });
}
