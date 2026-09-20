const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/edupay.controller");
const SchoolUser = require("../models/edupaySchoolUser.model");
const SchoolHandoff = require("../models/edupaySchoolHandoff.model");
const User = require("../models/user.model");

const objectId = (value) => ({ toString: () => value });
const school = { _id: objectId("000000000000000000000101"), name: "Greenfield Academy", status: "APPROVED", active: true };
const membership = { school, role: "OWNER", status: "ACTIVE" };
const response = () => ({
  statusCode: 200, body: null, cookies: [], cleared: [],
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  cookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
  clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
});

test("School Portal handoff is tenant-bound, host-only, and one-time", async () => {
  const originals = {
    find: SchoolUser.find, findOne: SchoolUser.findOne,
    create: SchoolHandoff.create, update: SchoolHandoff.findOneAndUpdate,
    userFindOne: User.findOne, jwtSecret: process.env.JWT_SECRET,
  };
  process.env.JWT_SECRET = "school-handoff-test-secret";
  let created;
  SchoolUser.find = () => ({ sort: () => ({ populate: async () => [membership] }) });
  SchoolHandoff.create = async (row) => { created = row; return row; };
  try {
    const denied = response();
    await controller.createSchoolHandoff({
      user: { _id: objectId("000000000000000000000201") },
      body: { schoolId: "000000000000000000000999" },
      headers: { "x-forwarded-proto": "https" }, hostname: "api.servicepay.ng", secure: true,
    }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(created, undefined);

    const started = response();
    await controller.createSchoolHandoff({
      user: { _id: objectId("000000000000000000000201") },
      body: { schoolId: "000000000000000000000101" },
      headers: { "x-forwarded-proto": "https" }, hostname: "api.servicepay.ng", secure: true,
    }, started);
    assert.equal(started.statusCode, 201);
    assert.equal(started.cookies[0].options.httpOnly, true);
    assert.equal(started.cookies[0].options.secure, true);
    assert.equal(started.cookies[0].options.sameSite, "lax");
    assert.equal("domain" in started.cookies[0].options, false);

    const code = started.cookies[0].value;
    let consumeCount = 0;
    SchoolHandoff.findOneAndUpdate = (query) => ({
      lean: async () => {
        assert.ok(query.expiresAt.$gt instanceof Date);
        consumeCount += 1;
        return consumeCount === 1
          ? { user: objectId("000000000000000000000201"), school: objectId("000000000000000000000101") }
          : null;
      },
    });
    User.findOne = () => ({ select: async () => ({
      _id: objectId("000000000000000000000201"), authTokenVersion: 4,
      status: "ACTIVE", fullName: "School Owner", role: "CUSTOMER",
    }) });
    SchoolUser.findOne = () => ({ populate: async () => membership });
    const request = {
      headers: {
        origin: "https://admin.servicepay.ng",
        cookie: `servicepay_school_handoff=${encodeURIComponent(code)}`,
        "x-forwarded-proto": "https",
      },
      hostname: "api.servicepay.ng", secure: true,
    };
    const consumed = response();
    await controller.consumeSchoolHandoff(request, consumed);
    assert.equal(consumed.statusCode, 200);
    assert.equal(consumed.body.schoolId, "000000000000000000000101");
    assert.ok(consumed.body.token);
    const replayed = response();
    await controller.consumeSchoolHandoff(request, replayed);
    assert.equal(replayed.statusCode, 401);
    assert.equal(replayed.body.code, "SCHOOL_HANDOFF_INVALID");
    const badOrigin = response();
    await controller.consumeSchoolHandoff({
      ...request, headers: { ...request.headers, origin: "https://evil.servicepay.ng" },
    }, badOrigin);
    assert.equal(badOrigin.statusCode, 403);
  } finally {
    SchoolUser.find = originals.find; SchoolUser.findOne = originals.findOne;
    SchoolHandoff.create = originals.create; SchoolHandoff.findOneAndUpdate = originals.update;
    User.findOne = originals.userFindOne;
    if (originals.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originals.jwtSecret;
  }
});