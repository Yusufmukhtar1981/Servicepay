"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeIp,
  verifyTelecomAbodeSource,
} = require("../services/telecomAbodeWebhookSource.service");

const request = (remoteAddress, headers = {}, rawHeaders) => ({
  socket: { remoteAddress },
  headers,
  ...(rawHeaders === undefined ? {} : { rawHeaders }),
});

const xffRequest = (remoteAddress, xForwardedFor, extraHeaders = {}) => {
  const headers = {
    "x-forwarded-for": xForwardedFor,
    ...extraHeaders,
  };
  const rawHeaders = Object.entries(headers).flatMap(([name, value]) => [
    name,
    value,
  ]);
  return request(remoteAddress, headers, rawHeaders);
};

test("normalizes IPv4-mapped IPv6 addresses to IPv4", () => {
  assert.equal(normalizeIp("::ffff:49.12.92.4"), "49.12.92.4");
  assert.equal(normalizeIp("0:0:0:0:0:ffff:310c:5c04"), "49.12.92.4");
  assert.equal(normalizeIp("2001:0db8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.equal(normalizeIp("not-an-ip"), null);
});

test("allows the confirmed source when it is the direct socket peer", () => {
  assert.equal(verifyTelecomAbodeSource(request("49.12.92.4")), true);
});

test("allows the confirmed source as a mapped IPv6 direct socket peer", () => {
  assert.equal(
    verifyTelecomAbodeSource(request("::ffff:49.12.92.4")),
    true,
  );
});

test("rejects a different direct socket peer", () => {
  assert.equal(verifyTelecomAbodeSource(request("49.12.92.5")), false);
  assert.equal(
    verifyTelecomAbodeSource({
      ...request("203.0.113.40"),
      ip: "49.12.92.4",
    }),
    false,
  );
  assert.equal(verifyTelecomAbodeSource(request("10.20.30.40")), false);
});

test("rejects a forged X-Forwarded-For provider address from a public wrong peer", () => {
  assert.equal(
    verifyTelecomAbodeSource(xffRequest("203.0.113.40", "49.12.92.4")),
    false,
  );
});

test("a host or Render hostname does not make caller-supplied forwarding data trusted", () => {
  for (const host of ["api.servicepay.ng", "servicepay-j6jg.onrender.com"]) {
    const req = xffRequest("203.0.113.40", "49.12.92.4");
    req.headers.host = host;
    assert.equal(verifyTelecomAbodeSource(req), false, host);
  }
});

test("uses right-to-left extraction through only explicitly trusted proxy CIDRs", () => {
  const req = xffRequest(
    "198.51.100.9",
    "49.12.92.4, 198.51.100.6, 198.51.100.8",
  );
  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: ["198.51.100.0/24"],
    }),
    true,
  );
});

test("rejects a spoofed X-Forwarded-For prefix before the rightmost untrusted hop", () => {
  const req = xffRequest(
    "198.51.100.9",
    "49.12.92.4, 203.0.113.40, 198.51.100.8",
  );
  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: ["198.51.100.0/24"],
    }),
    false,
  );
});

test("rejects proxy headers from an unknown or untrusted peer", () => {
  assert.equal(
    verifyTelecomAbodeSource(xffRequest("10.20.30.40", "49.12.92.4")),
    false,
  );
  assert.equal(
    verifyTelecomAbodeSource(
      xffRequest("10.20.30.40", "49.12.92.4"),
      { trustedProxyCidrs: ["198.51.100.0/24"] },
    ),
    false,
  );
});

test("requires X-Forwarded-For when the socket peer is a trusted proxy", () => {
  assert.equal(
    verifyTelecomAbodeSource(request("198.51.100.9"), {
      trustedProxyCidrs: ["198.51.100.0/24"],
    }),
    false,
  );
});

test("rejects malformed or conflicting forwarding chains", () => {
  assert.equal(
    verifyTelecomAbodeSource(
      xffRequest("198.51.100.9", "49.12.92.4, not-an-ip"),
      { trustedProxyCidrs: ["198.51.100.0/24"] },
    ),
    false,
  );

  assert.equal(
    verifyTelecomAbodeSource(
      request(
        "198.51.100.9",
        { "x-forwarded-for": "49.12.92.4, 198.51.100.8" },
        [
          "x-forwarded-for", "49.12.92.4, 198.51.100.8",
          "X-Forwarded-For", "203.0.113.40",
        ],
      ),
      { trustedProxyCidrs: ["198.51.100.0/24"] },
    ),
    false,
  );

  assert.equal(
    verifyTelecomAbodeSource(
      xffRequest("198.51.100.9", "49.12.92.4, 198.51.100.8", {
        forwarded: "for=203.0.113.40",
      }),
      { trustedProxyCidrs: ["198.51.100.0/24"] },
    ),
    false,
  );
});

test("returns only boolean decisions and leaks no source or chain detail", () => {
  const decisions = [
    verifyTelecomAbodeSource(request("49.12.92.5")),
    verifyTelecomAbodeSource(xffRequest("203.0.113.40", "49.12.92.4")),
    verifyTelecomAbodeSource(request("198.51.100.9"), {
      trustedProxyCidrs: ["198.51.100.0/24"],
    }),
  ];

  assert.deepEqual(decisions, [false, false, false]);
  assert.ok(decisions.every((decision) => typeof decision === "boolean"));
});