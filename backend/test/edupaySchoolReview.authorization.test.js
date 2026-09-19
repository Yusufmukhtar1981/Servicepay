const test = require("node:test");
const assert = require("node:assert/strict");
const { protect } = require("../middleware/auth.middleware");
const { adminOnly } = require("../middleware/auth.middleware");
const { loadStaffRole, requirePermission } = require("../middleware/staffPermission.middleware");
const { viewMiddleware, schoolRequestApproval, manageMiddleware } = require("../routes/adminEdupay.routes");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const run = async (handlers, request) => {
  const res = response();
  let reached = false;
  const next = async (index, error) => {
    if (error) throw error;
    if (index === handlers.length) {
      reached = true;
      return;
    }
    await handlers[index](request, res, (nextError) => next(index + 1, nextError));
  };
  await next(0);
  return { reached, res };
};

test("school request approval chain admits all full-access admin roles", async () => {
  const chainAfterAuthentication = schoolRequestApproval.slice(1);
  for (const role of ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"]) {
    const result = await run(chainAfterAuthentication, { user: { role } });
    assert.equal(result.reached, true, `${role} should reach school request approval`);
  }
});

test("EduPay view chain admits all full-access admin roles", async () => {
  const chainAfterAuthentication = viewMiddleware.slice(1);
  for (const role of ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"]) {
    const result = await run(chainAfterAuthentication, { user: { role } });
    assert.equal(result.reached, true, `${role} should reach school request list/detail view`);
  }
});

test("school request approval chain rejects customers and staff", async () => {
  for (const role of ["CUSTOMER", "STAFF"]) {
    const request = { user: { role } };
    for (const [name, chain] of [["view", viewMiddleware], ["approval", schoolRequestApproval]]) {
      const result = await run(chain.slice(1), request);
      assert.equal(result.reached, false, `${role} must not reach ${name}`);
      assert.equal(result.res.statusCode, 403);
    }
  }

  for (const [name, chain] of [["view", viewMiddleware], ["approval", schoolRequestApproval]]) {
    const unauthenticated = await run(chain.slice(1), {});
    assert.equal(unauthenticated.reached, false, `unauthenticated must not reach ${name}`);
    assert.equal(unauthenticated.res.statusCode, 401);
  }
});

test("shared manage chain remains Head Office-only", async () => {
  for (const role of ["HEAD_OFFICE_ADMIN", "ADMIN", "SUPER_ADMIN", "SERVICEPAY_SUPER_ADMIN"]) {
    const result = await run(manageMiddleware.slice(1), { user: { role } });
    assert.equal(result.reached, false, `${role} must remain excluded from shared manage`);
    assert.equal(result.res.statusCode, 403);
  }

  const headOffice = await run(manageMiddleware.slice(1), { user: { role: "HEAD_OFFICE" } });
  assert.equal(headOffice.reached, true);
});

test("route keeps exact school request approval middleware order", () => {
  assert.equal(viewMiddleware.length, 4);
  assert.equal(viewMiddleware[0], protect);
  assert.equal(viewMiddleware[2], loadStaffRole);
  assert.equal(schoolRequestApproval.length, 4);
  assert.equal(schoolRequestApproval[0], protect);
  assert.equal(schoolRequestApproval[2], loadStaffRole);
  assert.equal(manageMiddleware.length, 4);
});