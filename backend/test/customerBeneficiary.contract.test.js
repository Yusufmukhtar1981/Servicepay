const fs = require("fs");

describe("customer beneficiary safety contract", () => {
  test("uses customer-scoped unique normalized phone records", () => {
    const model = fs.readFileSync("backend/models/customerBeneficiary.model.js", "utf8");
    expect(model).toMatch(/customer:\s*\{/);
    expect(model).toMatch(/customer:\s*1,\s*phone:\s*1/);
    expect(model).toMatch(/unique:\s*true/);
  });

  test("routes expose authenticated CRUD and controller normalizes Nigerian numbers", () => {
    const routes = fs.readFileSync("backend/routes/customerBeneficiary.routes.js", "utf8");
    const controller = fs.readFileSync("backend/controllers/customerBeneficiary.controller.js", "utf8");
    expect(routes).toMatch(/router\.use\(protect\)/);
    expect(routes).toMatch(/router\.get/);
    expect(routes).toMatch(/router\.post/);
    expect(routes).toMatch(/router\.patch/);
    expect(routes).toMatch(/router\.delete/);
    expect(controller).toMatch(/startsWith\("234"\)/);
    expect(controller).toMatch(/customer: customerId\(req\)/);
  });
});