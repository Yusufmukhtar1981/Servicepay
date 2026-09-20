const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const edupayRoutes = require("../routes/edupay.routes");
const adminRoutes = require("../routes/adminEdupay.routes");
const models = require("../models/edupayAcademicManagement.model");

const request = (app, method, path, body) => new Promise((resolve, reject) => {
  const server = app.listen(0, "127.0.0.1", () => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port: server.address().port, method, path, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, (res) => {
      let text = ""; res.on("data", (chunk) => { text += chunk; }); res.on("end", () => { server.close(); resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }); });
    });
    req.on("error", (e) => { server.close(); reject(e); }); req.end(payload);
  });
});

const routePaths = (router) => router.stack.filter((layer) => layer.route).map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

test("academic models expose tenant and duplicate-safe compound indexes", () => {
  assert.ok(models.EduPayStudent.schema.indexes().some(([fields, options]) => fields.school === 1 && fields.studentId === 1 && options.unique));
  assert.ok(models.EduPayAttendance.schema.indexes().some(([fields, options]) => fields.school === 1 && fields.student === 1 && fields.date === 1 && options.unique));
  assert.ok(models.EduPayScore.schema.indexes().some(([fields, options]) => fields.school === 1 && fields.assessment === 1 && fields.student === 1 && options.unique));
});

test("academic route contract is mounted without replacing finance routes", () => {
  const paths = routePaths(edupayRoutes);
  assert.ok(paths.includes("GET /school/academic/dashboard"));
  assert.ok(paths.includes("POST /school/academic/attendance"));
  assert.ok(paths.includes("POST /school/academic/teachers"));
  assert.ok(paths.includes("PATCH /school/academic/teachers/:teacherId"));
  assert.ok(paths.includes("PATCH /school/academic/teachers/:teacherId/status"));
  assert.ok(paths.includes("POST /school/academic/teachers/:teacherId/reset-password"));
  assert.ok(paths.includes("PUT /school/academic/assessments/:assessmentId/scores"));
  assert.ok(paths.includes("GET /children/:childId/academic/results"));
  assert.ok(paths.includes("POST /plans/:planId/contributions"));
  assert.ok(routePaths(adminRoutes).includes("GET /academic-overview"));
  assert.ok(routePaths(adminRoutes).includes("POST /schools"));
  assert.ok(routePaths(adminRoutes).includes("POST /schools/:schoolId/reset-password"));
});

test("academic and existing finance ownership routes reject unauthenticated callers", async () => {
  const app = express(); app.use(express.json()); app.use("/api/edupay", edupayRoutes);
  for (const path of [
    "/api/edupay/school/academic/dashboard",
    "/api/edupay/school/academic/attendance/roster?classId=000000000000000000000001",
    "/api/edupay/children/000000000000000000000001/academic/results",
    "/api/edupay/plans/000000000000000000000001",
  ]) assert.equal((await request(app, "GET", path)).status, 401, path);
});