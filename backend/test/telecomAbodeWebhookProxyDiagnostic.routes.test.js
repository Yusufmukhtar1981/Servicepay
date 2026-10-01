"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const jwt = require("jsonwebtoken");

const User = require("../models/user.model");
const diagnosticRouter = require(
  "../routes/telecomAbodeWebhookProxyDiagnostic.routes",
);

const TEST_JWT_SECRET = "test-only-diagnostic-auth-secret";

const createToken = (id = "head-office-test-user", claims = {}) =>
  jwt.sign(
    { id, authTokenVersion: 0, ...claims },
    TEST_JWT_SECRET,
    { expiresIn: "5m" },
  );

const withMockUsers = (t, users = {}) => {
  const previousSecret = process.env.JWT_SECRET;
  const previousFindById = User.findById;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  User.findById = (id) => ({
    select: async () => users[id] || null,
  });
  t.after(() => {
    User.findById = previousFindById;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
};

const activeUser = (role) => ({
  _id: "head-office-test-user",
  role,
  status: "ACTIVE",
  authTokenVersion: 0,
});

const startServer = async (t, router = diagnosticRouter) => {
  const app = express();
  app.use("/_diagnostics/telecom-abode-proxy", router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
};

const getJson = (server, { token, headers = {} } = {}) =>
  new Promise((resolve, reject) => {
    const requestHeaders = { ...headers };
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    const request = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path: "/_diagnostics/telecom-abode-proxy",
      method: "GET",
      headers: requestHeaders,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode,
        body: JSON.parse(body),
      }));
    });
    request.on("error", reject);
    request.end();
  });

test("diagnostic requires the existing AdminJWT authentication", async (t) => {
  withMockUsers(t);
  const server = await startServer(t);

  const response = await getJson(server);

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Unauthorized.",
  });
});

test("expired AdminJWT credentials are rejected", async (t) => {
  withMockUsers(t);
  const server = await startServer(t);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  const expiredToken = jwt.sign(
    {
      id: "head-office-test-user",
      authTokenVersion: 0,
      exp: Math.floor(Date.now() / 1000) - 10,
    },
    TEST_JWT_SECRET,
  );
  const response = await getJson(server, { token: expiredToken });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    success: false,
    message: "Invalid or expired token.",
  });
});

test("diagnostic denies authenticated users without the exact Head Office role", async (t) => {
  withMockUsers(t, { "head-office-test-user": activeUser("CUSTOMER") });
  const server = await startServer(t);
  const originalError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalError; });

  const response = await getJson(server, { token: createToken() });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    success: false,
    message: "Access denied.",
  });
});

test("the diagnostic route expires and then returns only a generic not-found response", async (t) => {
  const expiredRouter = diagnosticRouter
    .createTelecomAbodeWebhookProxyDiagnosticRouter({
      expiresAt: Date.now() - 1,
    });
  const server = await startServer(t, expiredRouter);

  const response = await getJson(server);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    success: false,
    message: "Not found.",
  });
});

test("Head Office receives only bounded proxy-observation fields", async (t) => {
  withMockUsers(t, { "head-office-test-user": activeUser("HEAD_OFFICE") });
  const server = await startServer(t);
  const xff = [
    "49.12.92.4",
    ...Array.from({ length: 24 }, (_, index) => `198.51.100.${index + 1}`),
  ].join(", ");
  const token = createToken();

  const response = await getJson(server, {
    token,
    headers: {
      host: "api.servicepay.ng",
      "x-forwarded-for": xff,
      "cf-connecting-ip": "49.12.92.4",
      "cf-ray": "test-ray-id",
      cookie: "test-cookie-canary",
      "x-unrelated-private-header": "private-header-canary",
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), [
    "diagnosticExpiresAt",
    "observed",
    "success",
  ]);
  assert.deepEqual(Object.keys(response.body.observed).sort(), [
    "cfConnectingIp",
    "cfRay",
    "host",
    "socketPeer",
    "xForwardedFor",
  ]);
  assert.equal(response.body.observed.socketPeer, "127.0.0.1");
  assert.deepEqual(response.body.observed.xForwardedFor, {
    values: [xff.slice(0, 256)],
    truncated: true,
  });
  assert.deepEqual(response.body.observed.cfConnectingIp, {
    values: ["49.12.92.4"],
    truncated: false,
  });
  assert.deepEqual(response.body.observed.host, {
    values: ["api.servicepay.ng"],
    truncated: false,
  });
  assert.deepEqual(response.body.observed.cfRay, {
    values: ["test-ray-id"],
    truncated: false,
  });
  assert.equal(JSON.stringify(response.body).includes(token), false);
  assert.equal(JSON.stringify(response.body).includes("test-cookie-canary"), false);
  assert.equal(
    JSON.stringify(response.body).includes("private-header-canary"),
    false,
  );
});