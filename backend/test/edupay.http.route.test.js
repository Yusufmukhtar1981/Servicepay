const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const edupayRoutes = require("../routes/edupay.routes");
const squadWebhookRoutes = require("../routes/edupaySquadWebhook.routes");

const request = (app, { method, path, body, headers = {} }) => new Promise((resolve, reject) => {
  const server = app.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ port, host: "127.0.0.1", method, path, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers } }, (res) => {
      let text = ""; res.on("data", (chunk) => { text += chunk; }); res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
    });
    req.on("error", (error) => { server.close(); reject(error); }); req.end(payload);
  });
});

test("EduPay customer HTTP routes reject unauthenticated ownership access", async () => {
  const app = express(); app.use(express.json()); app.use("/api/edupay", edupayRoutes);
  const response = await request(app, { method: "GET", path: "/api/edupay/plans/000000000000000000000001" });
  assert.equal(response.status, 401);
});

test("EduPay Squad webhook HTTP route rejects invalid signed callbacks", async () => {
  const app = express(); app.use("/api/edupay/webhooks/squad", squadWebhookRoutes);
  const response = await request(app, { method: "POST", path: "/api/edupay/webhooks/squad", body: { event: "SUCCESS" }, headers: { "x-squad-encrypted-body": "00" } });
  assert.equal(response.status, 401);
});