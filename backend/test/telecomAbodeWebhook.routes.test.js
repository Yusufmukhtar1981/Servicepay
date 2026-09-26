const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const webhookRouter = require("../routes/telecomAbodeWebhook.routes");

const validNotification = {
  status: "success",
  api_response: "MTN VTU Airtime #100 sent to 09065903769",
  "request-id": "API_66bbd45c67b7b",
  amount: "100",
  old_wallet: 782,
  new_wallet: 682,
  secret: "test-secret-canary",
};

const createServer = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks/telecom-abode", webhookRouter);
  return http.createServer(app);
};

const postJson = (server, payload) => new Promise((resolve, reject) => {
  const address = server.address();
  const request = http.request({
    host: "127.0.0.1",
    port: address.port,
    path: "/api/webhooks/telecom-abode",
    method: "POST",
    headers: { "content-type": "application/json" },
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
  request.end(JSON.stringify(payload));
});

test("valid unsigned notifications fail closed with a generic verification error", async (t) => {
  const server = createServer();
  const capturedLogs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => capturedLogs.push(args.join(" "));
  console.warn = (...args) => capturedLogs.push(args.join(" "));
  console.error = (...args) => capturedLogs.push(args.join(" "));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await postJson(server, validNotification);

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, {
    error: "WEBHOOK_VERIFICATION_UNAVAILABLE",
  });
  assert.equal(capturedLogs.length, 0);
  assert.equal(
    capturedLogs.join(" ").includes(validNotification["request-id"]),
    false,
  );
  assert.equal(
    capturedLogs.join(" ").includes("09065903769"),
    false,
  );
  assert.equal(capturedLogs.join(" ").includes("test-secret-canary"), false);
});

test("malformed notifications return 400 without logging payload contents", async (t) => {
  const server = createServer();
  const capturedLogs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (...args) => capturedLogs.push(args.join(" "));
  console.warn = (...args) => capturedLogs.push(args.join(" "));
  console.error = (...args) => capturedLogs.push(args.join(" "));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    await new Promise((resolve) => server.close(resolve));
  });

  const response = await postJson(server, {
    status: "success",
    "request-id": "sensitive-request-id",
    api_response: "customer phone 09000000000",
    amount: "not-a-number",
    old_wallet: 782,
    new_wallet: 682,
  });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: "INVALID_WEBHOOK_PAYLOAD" });
  assert.equal(capturedLogs.length, 0);
  assert.equal(capturedLogs.join(" ").includes("sensitive-request-id"), false);
  assert.equal(capturedLogs.join(" ").includes("09000000000"), false);
});

test("repeated valid request IDs remain fail-closed and have no state side effects", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const [first, duplicate] = await Promise.all([
    postJson(server, validNotification),
    postJson(server, validNotification),
  ]);

  assert.equal(first.status, 503);
  assert.equal(duplicate.status, 503);
  assert.deepEqual(first.body, { error: "WEBHOOK_VERIFICATION_UNAVAILABLE" });
  assert.deepEqual(duplicate.body, { error: "WEBHOOK_VERIFICATION_UNAVAILABLE" });
});