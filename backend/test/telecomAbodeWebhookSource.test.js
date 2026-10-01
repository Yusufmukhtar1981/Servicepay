"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeIp,
  verifyTelecomAbodeSource,
} = require("../services/telecomAbodeWebhookSource.service");
const actualRenderObservationMatrix = require(
  "./fixtures/telecomAbodeRenderProxy.observations.json",
);

// The Render diagnostic observed these exact local/Render hops. Cloudflare
// ranges below are copied from its published lists at test-writing time:
// https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
// (accessed 2026-10-01). Production config remains owned by the parent agent.
const OBSERVED_RENDER_TRUSTED_PROXY_CIDRS = [
  "127.0.0.1/32",
  "10.29.222.90/32",
  "10.31.245.18/32",
  "10.25.136.6/32",
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

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

const capturedRequest = (observed, { substituteProviderSource = false } = {}) => {
  const captures = [
    ["x-forwarded-for", "xForwardedFor"],
    ["cf-connecting-ip", "cfConnectingIp"],
    ["x-real-ip", "xRealIp"],
    ["true-client-ip", "trueClientIp"],
    ["forwarded", "forwarded"],
    ["cf-connecting-ipv6", "cfConnectingIpv6"],
    ["host", "host"],
  ];
  const actualClientIp = normalizeIp(observed.cfConnectingIp.values[0]);
  const headers = {};
  const rawHeaders = [];

  if (substituteProviderSource) {
    assert.equal(actualClientIp, "34.55.20.87");
    assert.equal(observed.forwarded.values.length, 0);
  }

  for (const [headerName, captureName] of captures) {
    const capture = observed[captureName];
    assert.ok(capture && Array.isArray(capture.values));
    assert.equal(capture.truncated, false);

    let values = [...capture.values];
    if (substituteProviderSource && captureName === "xForwardedFor") {
      const chain = values[0].split(",");
      assert.equal(normalizeIp(chain[0].trim()), actualClientIp);
      chain[0] = "49.12.92.4";
      values[0] = chain.join(",");
    } else if (
      substituteProviderSource &&
      ["cfConnectingIp", "xRealIp", "trueClientIp", "cfConnectingIpv6"]
        .includes(captureName) &&
      values.length > 0
    ) {
      assert.ok(
        values.every((value) => normalizeIp(value.trim()) === actualClientIp),
        `${captureName} did not corroborate the observed client`,
      );
      values = values.map(() => "49.12.92.4");
    }

    if (values.length === 0) continue;
    headers[headerName] = values.join(", ");
    for (const value of values) rawHeaders.push(headerName, value);
  }

  return request(observed.socketPeer, headers, rawHeaders);
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
    { "cf-connecting-ip": "49.12.92.4" },
  );
  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: ["198.51.100.0/24"],
    }),
    true,
  );
});

test("accepts Telecom Abode at the client position of the observed Render and Cloudflare chain", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 172.68.23.26, 10.31.245.18",
    {
      "cf-connecting-ip": "49.12.92.4",
      host: "api.servicepay.ng",
      "cf-ray": "observed-render-chain-test",
    },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    true,
  );
});

test("accepts only the separately observed third Render private hop when configured exactly", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 172.68.23.26, 10.29.222.90",
    { "cf-connecting-ip": "49.12.92.4" },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    true,
  );
  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS.filter(
        (cidr) => cidr !== "10.29.222.90/32",
      ),
    }),
    false,
  );
});

test("rejects the non-provider client IP in the otherwise valid observed proxy chain", () => {
  const req = xffRequest(
    "127.0.0.1",
    "34.55.20.87, 172.68.23.26, 10.31.245.18",
    {
      "cf-connecting-ip": "34.55.20.87",
      host: "api.servicepay.ng",
    },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    false,
  );
});

test("rejects observed caller-supplied provider prefix when Render and Cloudflare append the actual client", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 34.55.20.87, 172.70.179.125, 10.25.136.6",
    {
      "cf-connecting-ip": "34.55.20.87",
      host: "api.servicepay.ng",
      "cf-ray": "observed-render-spoof-test",
    },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    false,
  );
});

test("rejects a trusted Cloudflare edge whose CF-Connecting-IP disagrees with XFF", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 2a06:98c0:3600::103",
    { "cf-connecting-ip": "2a06:98c0:3600::103" },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    false,
  );
});

test("normalizes mapped IPv6 for both observed socket peer and provider chain source", () => {
  const mappedSocket = xffRequest(
    "::ffff:127.0.0.1",
    "49.12.92.4, 172.68.23.26, 10.31.245.18",
    { "cf-connecting-ip": "49.12.92.4" },
  );
  const mappedSource = xffRequest(
    "127.0.0.1",
    "::ffff:49.12.92.4, 172.68.23.26, 10.31.245.18",
    { "cf-connecting-ip": "::ffff:49.12.92.4" },
  );

  for (const req of [mappedSocket, mappedSource]) {
    assert.equal(
      verifyTelecomAbodeSource(req, {
        trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
      }),
      true,
    );
  }
});

test("fails closed when an observed Render private hop is not explicitly trusted", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 172.70.179.125, 10.25.136.6",
    { "cf-connecting-ip": "49.12.92.4" },
  );
  const configuredWithoutThisObservedHop =
    OBSERVED_RENDER_TRUSTED_PROXY_CIDRS.filter(
      (cidr) => cidr !== "10.25.136.6/32",
    );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: configuredWithoutThisObservedHop,
    }),
    false,
  );
});

test("rejects conflicting caller-supplied Cloudflare and proxy identity headers", () => {
  const req = xffRequest(
    "127.0.0.1",
    "49.12.92.4, 34.55.20.87, 172.70.179.125, 10.25.136.6",
    {
      "cf-connecting-ip": "34.55.20.87",
      "x-real-ip": "49.12.92.4",
      "true-client-ip": "49.12.92.4",
    },
  );

  assert.equal(
    verifyTelecomAbodeSource(req, {
      trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
    }),
    false,
  );
});

test("rejects each unobserved identity alias when it disagrees with the trusted XFF source", () => {
  const chain = "34.55.20.87, 172.68.23.26, 10.31.245.18";
  const conflictingHeaders = [
    { "x-real-ip": "49.12.92.4" },
    { "true-client-ip": "49.12.92.4" },
    { "cf-connecting-ipv6": "2001:db8::49" },
    { forwarded: "for=49.12.92.4" },
  ];

  for (const extraHeaders of conflictingHeaders) {
    const req = xffRequest(
      "127.0.0.1",
      chain,
      {
        "cf-connecting-ip": "34.55.20.87",
        ...extraHeaders,
      },
    );
    assert.equal(
      verifyTelecomAbodeSource(req, {
        trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
      }),
      false,
      Object.keys(extraHeaders)[0],
    );
  }
});

test("replays every stored two-host Render observation through the verifier", () => {
  const rows = actualRenderObservationMatrix.rows;
  const hosts = new Set(rows.map((row) => row.host));
  const cases = new Set(rows.map((row) => row.case));
  assert.equal(rows.length, 16);
  assert.equal(
    actualRenderObservationMatrix.diagnosticCommit,
    "cce8616310d25de2b99dc4eea36c158ce49a29d4",
  );
  assert.ok(hosts.has("api.servicepay.ng"));
  assert.ok(hosts.has("servicepay-j6jg.onrender.com"));
  assert.equal(cases.size, 8);
  for (const host of hosts) {
    assert.equal(rows.filter((row) => row.host === host).length, 8);
  }
  assert.equal(rows.filter((row) => row.http === 200).length, 12);
  assert.equal(rows.filter((row) => row.http === 403).length, 4);

  for (const row of rows) {
    if (row.http === 403) {
      assert.ok(["spoof-cf", "spoof-all"].includes(row.case));
      assert.equal(row.server, "cloudflare");
      assert.equal(row.responseType, "text/html; charset=UTF-8");
      assert.equal(row.observed, undefined);
      continue;
    }

    assert.equal(row.http, 200);
    const observed = row.observed;
    assert.equal(normalizeIp(observed.socketPeer), "127.0.0.1");
    assert.equal(observed.xForwardedFor.truncated, false);
    assert.equal(observed.cfConnectingIp.truncated, false);
    assert.equal(observed.trueClientIp.truncated, false);
    assert.equal(observed.forwarded.truncated, false);
    assert.equal(observed.xRealIp.truncated, false);
    assert.equal(observed.cfConnectingIpv6.truncated, false);
    assert.equal(observed.cfConnectingIp.values.length, 1);
    assert.ok(
      normalizeIp(observed.cfConnectingIp.values[0]) !== "49.12.92.4",
      `${row.host}/${row.case} did not use the confirmed provider as the probe source`,
    );

    assert.equal(
      verifyTelecomAbodeSource(capturedRequest(observed), {
        trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
      }),
      false,
      `${row.host}/${row.case} must not authenticate the non-provider probe`,
    );
  }
});

test("stored ordinary observations positively replay provider-source substitution", () => {
  const rows = actualRenderObservationMatrix.rows;
  const ordinaryRows = rows.filter((row) => row.case === "ordinary");
  assert.equal(ordinaryRows.length, 2);

  for (const row of ordinaryRows) {
    const observed = row.observed;
    const originalChain = observed.xForwardedFor.values[0].split(",");
    const req = capturedRequest(observed, { substituteProviderSource: true });
    const substitutedChain = req.headers["x-forwarded-for"].split(",");

    assert.deepEqual(substitutedChain.slice(1), originalChain.slice(1));
    assert.equal(req.headers["cf-connecting-ip"], "49.12.92.4");
    assert.equal(req.headers["true-client-ip"], "49.12.92.4");
    assert.equal(req.headers["x-real-ip"], undefined);
    assert.equal(req.headers.forwarded, undefined);
    assert.equal(req.headers["cf-connecting-ipv6"], undefined);
    assert.equal(
      verifyTelecomAbodeSource(req, {
        trustedProxyCidrs: OBSERVED_RENDER_TRUSTED_PROXY_CIDRS,
      }),
      true,
      `${row.host} ordinary proxy suffix must accept provider-source substitution`,
    );
  }
});

test("stored Render matrix captures every verifier identity alias", () => {
  const rows = actualRenderObservationMatrix.rows;
  assert.equal(rows.length, 16);
  for (const row of rows) {
    if (!row.observed) continue;
    for (const name of [
      "xRealIp",
      "trueClientIp",
      "forwarded",
      "cfConnectingIpv6",
    ]) {
      assert.ok(
        row.observed[name] &&
          Array.isArray(row.observed[name].values) &&
          typeof row.observed[name].truncated === "boolean",
        `${row.host}/${row.case} omitted ${name}`,
      );
    }
  }
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
  assert.equal(
    verifyTelecomAbodeSource(
      xffRequest(
        "198.51.100.9",
        "49.12.92.4, 198.51.100.8",
      ),
      { trustedProxyCidrs: ["198.51.100.0/24"] },
    ),
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