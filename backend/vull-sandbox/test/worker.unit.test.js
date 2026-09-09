const test = require("node:test");
const assert = require("node:assert/strict");
const { pollLoop } = require("../worker");
const {
  isPublicAddress,
  REQUEST_TIMEOUT_MS,
  LEASE_MS,
} = require("../services/webhookDelivery");

test("HTTPS timeout is strictly shorter than worker lease", () => {
  assert.ok(REQUEST_TIMEOUT_MS > 0);
  assert.ok(REQUEST_TIMEOUT_MS < LEASE_MS);
});

test("public-address classifier rejects reserved IPv4 and IPv6 ranges", () => {
  const rejected = [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:10.0.0.1",
    "::ffff:100.64.0.1",
  ];
  for (const address of rejected) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

test("poll loop delivers work appearing after an empty pass and stops", async () => {
  const controller = new AbortController();
  let available = false;
  let passes = 0;
  let deliveries = 0;
  await pollLoop({
    signal: controller.signal,
    pollIntervalMs: 1000,
    processPending: async () => {
      passes += 1;
      if (available) {
        deliveries += 1;
        controller.abort();
      }
    },
    sleep: async () => {
      available = true;
    },
  });
  assert.equal(passes, 2);
  assert.equal(deliveries, 1);
  assert.equal(controller.signal.aborted, true);
});

test("poll loop fails after three consecutive processing errors", async () => {
  let errors = 0;
  await assert.rejects(
    pollLoop({
      processPending: async () => { throw new Error("database unavailable"); },
      sleep: async () => {},
      onError: () => { errors += 1; },
      maxConsecutiveErrors: 3,
    }),
    /database unavailable/
  );
  assert.equal(errors, 3);
});