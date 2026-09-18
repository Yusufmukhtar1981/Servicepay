const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolUser = require("../models/edupaySchoolUser.model");
const DutyAssignment = require("../models/edupayDutyAssignment.model");
const EduPaySettings = require("../models/edupaySettings.model");
const AppSettings = require("../models/appSettings.model");
const { school: schoolMiddleware } = require("../middleware/edupay.middleware");
const controller = require("../controllers/edupay.controller");
const { evaluateEduPayReadiness } = require("../controllers/featureControl.controller");

const uri = String(process.env.MONGODB_URI || "").trim();
const dbName = `edupay_en_${crypto.randomBytes(12).toString("hex")}`;

const invokeSchool = async (userId, schoolId) => new Promise((resolve, reject) => {
  const req = {
    user: { _id: userId },
    headers: { "x-edupay-school-id": String(schoolId) },
    query: {},
    body: {},
  };
  const res = {
    status: (status) => ({ json: (body) => resolve({ status, body }) }),
  };
  schoolMiddleware[1](req, res, (error) => {
    if (error) return reject(error);
    resolve({ status: 200, req });
  });
});

const readiness = () => new Promise((resolve, reject) => {
  const res = {
    json: resolve,
    status: (status) => ({ json: (body) => reject(Object.assign(new Error(body?.message || "readiness failed"), { status })) }),
  };
  controller.adminReadiness({}, res).catch(reject);
});

test("EduPay enablement is financial-only in a real isolated Mongo database", { skip: !uri }, async (t) => {
  await mongoose.connect(uri, { dbName });
  t.after(async () => {
    try {
      await mongoose.connection.dropDatabase();
    } finally {
      await mongoose.disconnect();
    }
  });

  await EduPaySettings.create({
    key: "GLOBAL",
    schoolCommissionRate: 5,
    parentShortfallChargeRate: 10,
    settlementMethod: "DEDUCT_COMMISSION",
  });
  if (AppSettings.schema.path("fintechControl.featureRegistry")) {
    await AppSettings.create({ fintechControl: { featureRegistry: { edupay: { enabled: false } } } });
  }

  const original = {
    EDUPAY_SQUAD_TRANSFER_ENABLED: process.env.EDUPAY_SQUAD_TRANSFER_ENABLED,
    EDUPAY_SQUAD_PRODUCTION_ENABLED: process.env.EDUPAY_SQUAD_PRODUCTION_ENABLED,
    EDUPAY_SQUAD_SECRET_KEY: process.env.EDUPAY_SQUAD_SECRET_KEY,
    EDUPAY_SQUAD_MERCHANT_ID: process.env.EDUPAY_SQUAD_MERCHANT_ID,
    EDUPAY_SQUAD_BASE_URL: process.env.EDUPAY_SQUAD_BASE_URL,
    EDUPAY_ACCOUNT_ENCRYPTION_KEY: process.env.EDUPAY_ACCOUNT_ENCRYPTION_KEY,
  };
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, {
    EDUPAY_SQUAD_TRANSFER_ENABLED: "true",
    EDUPAY_SQUAD_PRODUCTION_ENABLED: "true",
    EDUPAY_SQUAD_SECRET_KEY: "integration-test-secret",
    EDUPAY_SQUAD_MERCHANT_ID: "integration-test-merchant",
    EDUPAY_SQUAD_BASE_URL: "https://api.squadco.com",
    EDUPAY_ACCOUNT_ENCRYPTION_KEY: "integration-test-encryption",
  });

  assert.equal(await DutyAssignment.countDocuments({}), 0);
  const result = await readiness();
  assert.equal(result.ready, true);
  assert.equal(result.eduPayActive, true);
  assert.equal(result.customerInitiationEnabled, true);
  assert.equal(result.dutyCoverage.ready, false);
  assert.equal(await evaluateEduPayReadiness(), true);

  const user = await User.create({
    fullName: "EduPay Integration User",
    phone: `080${Date.now()}`,
    email: `${dbName}@test.invalid`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
  const states = [
    ["approved", "APPROVED", true],
    ["pending", "PENDING_REVIEW", false],
    ["suspended", "SUSPENDED", false],
    ["inactive", "APPROVED", false],
  ];
  const schools = await Promise.all(states.map(async ([name, status, active]) => {
    const row = await School.create({ name, address: name, state: "Lagos", status, active });
    await SchoolUser.create({ school: row._id, user: user._id, role: "ADMIN", status: "ACTIVE" });
    return row;
  }));
  const accepted = await invokeSchool(user._id, schools[0]._id);
  assert.equal(accepted.status, 200);
  assert.equal(String(accepted.req.eduPaySchool._id), String(schools[0]._id));
  for (const row of schools.slice(1)) {
    const denied = await invokeSchool(user._id, row._id);
    assert.equal(denied.status, 403);
  }

  await EduPaySettings.updateOne({ key: "GLOBAL" }, { $unset: { settlementMethod: 1 } });
  assert.equal(await evaluateEduPayReadiness(), false);
});