const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const edupayRoutes = require("../routes/edupay.routes");
const squadWebhookRoutes = require("../routes/edupaySquadWebhook.routes");
const squad = require("../services/edupaySquad.service");
const { adminOnly } = require("../middleware/auth.middleware");
const { canConfigureDuties } = require("../routes/adminEdupay.routes");
const { allowSchoolRoles } = require("../middleware/edupay.middleware");

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

test("EduPay Squad webhook HTTP route forwards a valid signed raw reversal callback", async () => {
  const app = express(); app.use("/api/edupay/webhooks/squad", squadWebhookRoutes);
  const oldSecret = process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = "http-route-secret";
  const raw = JSON.stringify({ event: "REVERSED", data: { transaction_reference: "EDUPAY-HTTP-REV", status: "REVERSED", amount: 19000000, currency: "NGN" } });
  const crypto = require("crypto"); const signature = crypto.createHmac("sha512", process.env.EDUPAY_SQUAD_WEBHOOK_SECRET).update(raw).digest("hex");
  const original = squad.handleWebhook; let forwarded;
  squad.handleWebhook = async (args) => { forwarded = args; return { status: "REVERSED" }; };
  try {
    const response = await request(app, { method: "POST", path: "/api/edupay/webhooks/squad", body: JSON.parse(raw), headers: { "x-squad-encrypted-body": signature } });
    assert.equal(response.status, 200); assert.equal(response.body.settlement.status, "REVERSED"); assert.equal(Buffer.isBuffer(forwarded.raw), true); assert.equal(forwarded.payload.event, "REVERSED");
  } finally {
    squad.handleWebhook = original; if (oldSecret === undefined) delete process.env.EDUPAY_SQUAD_WEBHOOK_SECRET; else process.env.EDUPAY_SQUAD_WEBHOOK_SECRET = oldSecret;
  }
});

test("duty owner admission accepts Super Admin roles but rejects HEAD_OFFICE", async () => {
  const app = express(); app.use((req, res, next) => { req.user = { _id: "000000000000000000000001", role: req.get("x-test-role") }; next(); }); app.put("/duty", adminOnly("SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"), (req, res) => res.json({ success: true }));
  assert.equal((await request(app, { method: "PUT", path: "/duty", headers: { "x-test-role": "SUPER_ADMIN" } })).status, 200);
  assert.equal((await request(app, { method: "PUT", path: "/duty", headers: { "x-test-role": "SERVICEPAY_SUPER_ADMIN" } })).status, 200);
  assert.equal((await request(app, { method: "PUT", path: "/duty", headers: { "x-test-role": "HEAD_OFFICE" } })).status, 403);
});

test("readiness duty capability matches protected duty-route admission", () => {
  assert.equal(canConfigureDuties({ role: "SUPER_ADMIN" }), true);
  assert.equal(canConfigureDuties({ role: "servicepay-super-admin" }), true);
  assert.equal(canConfigureDuties({ role: "SERVICEPAY_SUPER_ADMIN" }), true);
  assert.equal(canConfigureDuties({ role: "HEAD_OFFICE" }), false);
});

test("school administration rejects teacher and generic staff memberships", async () => {
  const app = express();
  app.use((req, res, next) => {
    req.eduPaySchoolUser = { role: req.get("x-school-role") };
    next();
  });
  app.get(
    "/school/manage",
    allowSchoolRoles("OWNER", "ADMIN", "SCHOOL_ADMIN"),
    (req, res) => res.json({ success: true }),
  );
  for (const role of ["TEACHER", "STAFF", "FINANCE"]) {
    assert.equal((await request(app, { method: "GET", path: "/school/manage", headers: { "x-school-role": role } })).status, 403);
  }
  for (const role of ["OWNER", "ADMIN", "SCHOOL_ADMIN"]) {
    assert.equal((await request(app, { method: "GET", path: "/school/manage", headers: { "x-school-role": role } })).status, 200);
  }
});