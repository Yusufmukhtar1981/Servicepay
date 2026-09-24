const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/edupay.controller");

const invoke = (handler, request) => new Promise((resolve, reject) => {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); },
  };
  Promise.resolve(handler(request, response)).catch(reject);
});

test("state-manager school endpoints reject users outside STATE_MANAGER role", async () => {
  const response = await invoke(controller.stateManagerCreateSchool, {
    user: { _id: "507f1f77bcf86cd799439011", role: "CUSTOMER" },
    body: { schoolName: "No Access", location: "Lagos", state: "Lagos" },
  });
  assert.equal(response.status, 403);
});

test("state-manager school creation validates required registration fields", async () => {
  const response = await invoke(controller.stateManagerCreateSchool, {
    user: { _id: "507f1f77bcf86cd799439011", role: "STATE_MANAGER" },
    body: { schoolName: "Incomplete School", location: "Lagos" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "SCHOOL_FIELDS_REQUIRED");
});