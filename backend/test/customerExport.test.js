const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const ExcelJS = require("exceljs");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const controller = require("../controllers/adminCustomerExport.controller");
const { writeExport, csvCell } = require("../services/customerExport.service");
const { requirePermission } = require("../middleware/staffPermission.middleware");
const { STAFF_PERMISSIONS: P, validateStaffPermissions } = require("../config/staffPermissions");

const id = (i) => i.toString(16).padStart(24, "0");
const rows = Array.from({ length: 2501 }, (_, i) => ({
  _id: id(i + 1), fullName: `Customer ${i} — Àmina`,
  phone: `080${String(i).padStart(8, "0")}`, email: `customer${i}@example.invalid`,
  password: "NEVER_EXPORT_PASSWORD", transactionPin: "NEVER_EXPORT_PIN",
  role: "CUSTOMER", zone: i % 2 ? "South" : "North",
}));
let server, base, directory;
let auditFails = false, findFails = false, queries = [], auditRows = [];
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === "$and") return value.every((part) => matches(row, part));
    if (key === "$or") return value.some((part) => matches(row, part));
    if (value && typeof value === "object") {
      if ("$ne" in value) return row[key] !== value.$ne;
      if ("$in" in value) return value.$in.includes(row[key]);
      if ("$gt" in value) return row[key] > value.$gt;
      if ("$regex" in value) return new RegExp(value.$regex, value.$options).test(row[key] || "");
    }
    return row[key] === value;
  });
}
const originals = { find: User.find, count: User.countDocuments, audit: Audit.create };

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "servicepay-export-test-"));
  User.find = (filter) => {
    queries.push(filter);
    const matching = rows.filter((row) => matches(row, filter));
    let limit = rows.length;
    const chain = {
      select(fields) { assert.equal(fields, "_id fullName phone email"); return chain; },
      sort(sort) { assert.deepEqual(sort, { _id: 1 }); return chain; },
      limit(value) { limit = value; return chain; },
      maxTimeMS() { return chain; },
      lean() { return chain; },
      then(resolve, reject) { return (findFails ? Promise.reject(new Error("db offline")) :
        Promise.resolve(matching.slice(0, limit))).then(resolve, reject); },
      cursor(options) {
        assert.equal(options.batchSize, 250);
        return {
          async *[Symbol.asyncIterator]() {
            if (findFails) throw new Error("db offline");
            for (const row of matching) yield row;
          }, async close() {},
        };
      },
    };
    return chain;
  };
  User.countDocuments = (filter) => ({ maxTimeMS: async () => rows.filter((row) => matches(row, filter)).length });
  Audit.create = async (entry) => {
    if (auditFails) throw new Error("audit offline");
    auditRows.push(entry);
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (!req.headers.authorization) return res.status(401).json({ success: false });
    const limited = req.headers.authorization === "Bearer limited";
    req.user = { _id: id(5000), role: "STAFF" };
    req.staffAccess = { permissions: limited ? [P.USERS_VIEW] : [P.USERS_VIEW, P.CUSTOMERS_EXPORT],
      scope: req.headers.authorization === "Bearer scoped" ? { type: "ZONE", zone: "North" } : { type: "GLOBAL" } };
    next();
  });
  const auth = [requirePermission(P.USERS_VIEW), requirePermission(P.CUSTOMERS_EXPORT)];
  app.get("/customers", ...auth, controller.listCustomers);
  app.post("/download", ...auth, controller.download);
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  User.find = originals.find; User.countDocuments = originals.count; Audit.create = originals.audit;
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
});
const request = (body, auth = "Bearer exporter") => fetch(base + "/download", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: auth },
  body: JSON.stringify({ scope: "all", format: "csv", action: "download", ...body }),
});
test("export permission is assignable and does not follow users.view alone", async () => {
  assert.equal(P.CUSTOMERS_EXPORT, "customers.export");
  assert.equal(validateStaffPermissions([P.CUSTOMERS_EXPORT]).valid, true);
  assert.equal((await request({}, "Bearer limited")).status, 403);
  assert.equal((await fetch(base + "/customers")).status, 401);
  assert.equal((await fetch(base + "/customers", { headers: { Authorization: "Bearer limited" } })).status, 403);
});
test("scope constraints fail closed and always restrict to undeleted customers", () => {
  const scoped = (scope) => ({ staffAccess: { scope } });
  for (const scope of [{}, { type: "CUSTOM" }, { type: "ZONE" },
    { type: "STATE", zone: "North" }, { type: "BRANCH", branchId: "" }]) {
    assert.throws(() => controller.baseFilter(scoped(scope)), { status: 403 });
  }
  for (const [scope, expected] of [
    [{ type: "ZONE", zone: "North" }, { zone: "North" }],
    [{ type: "STATE", zone: "North", state: "Kano" }, { zone: "North", state: "Kano" }],
    [{ type: "BRANCH", branchId: id(4) }, { branchId: id(4) }],
    [{ type: "SELF", userId: id(5) }, { _id: id(5) }],
  ]) {
    const filter = controller.baseFilter(scoped(scope), "a.*@");
    assert.deepEqual(filter.$and[0], { role: "CUSTOMER", isDeleted: { $ne: true } });
    assert.deepEqual(filter.$and[1], expected);
    assert.equal(filter.$and[2].$or[0].fullName.$regex, "a\\.\\*@");
  }
});
test("server pagination is bounded, cursor validated, projection is safe", async () => {
  const headers = { Authorization: "Bearer exporter" };
  const response = await fetch(base + "/customers?limit=50&q=Customer", { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const data = await response.json();
  assert.equal(data.customers.length, 50);
  assert.equal(data.nextCursor, id(50));
  assert.deepEqual(Object.keys(data.customers[0]), ["id", "fullName", "phone", "email"]);
  assert.equal((await fetch(base + "/customers?limit=1000", { headers })).status, 400);
  assert.equal((await fetch(base + "/customers?after=bad", { headers })).status, 400);
  await fetch(base + "/customers?after=" + id(50), { headers });
  assert.deepEqual(queries.at(-1).$and.at(-1), { _id: { $gt: id(50) } });
});
test("all-customer CSV is complete beyond the first page and audited without PII", async () => {
  const response = await request({});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment.*Servicepay-Customers.csv/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const csv = await response.text();
  assert.equal(csv.trim().split("\r\n").length, rows.length + 1);
  assert.ok(csv.includes(rows.at(-1).email));
  assert.ok(!csv.includes("NEVER_EXPORT"));
  assert.deepEqual(auditRows.at(-1).metadata,
    { dataset: "CUSTOMER_CONTACTS", scope: "all", format: "csv", action: "download", rowCount: 2501 });
  assert.ok(!JSON.stringify(auditRows).includes("@example.invalid"));
});
test("filtered export applies name/phone/email search; selected export rejects out-of-scope IDs", async () => {
  assert.equal((await request({ scope: "filtered", query: "a+b" })).status, 200);
  assert.equal(queries.at(-1).$and.at(-1).$or.length, 3);
  assert.equal(queries.at(-1).$and.at(-1).$or[1].phone.$regex, "a\\+b");
  assert.equal((await request({ scope: "selected", ids: [] })).status, 400);
  assert.equal((await request({ scope: "selected", ids: [id(1), id(9999)] })).status, 403);
  assert.equal((await request({ scope: "selected", ids: ["invalid"] })).status, 400);
  const selected = await request({ scope: "selected", ids: [id(1), id(2)] });
  assert.equal(selected.status, 200);
  assert.equal((await selected.text()).trim().split("\r\n").length, 3);
  assert.deepEqual(queries.at(-1).$and.at(-1), { _id: { $in: [id(1), id(2)] } });
});
test("scoped downloads exclude other zones, including forged selected IDs", async () => {
  const response = await request({}, "Bearer scoped");
  assert.equal(response.status, 200);
  const csv = await response.text();
  assert.ok(csv.includes(rows[0].email));
  assert.ok(!csv.includes(rows[1].email));
  assert.equal((await request({ scope: "selected", ids: [id(1), id(2)] }, "Bearer scoped")).status, 403);
});
test("XLSX contains every row, keeps phone numbers as text, never creates formulas", async () => {
  const response = await request({ format: "xlsx", action: "share" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /spreadsheetml/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.getWorksheet("Customers");
  assert.equal(sheet.rowCount, rows.length + 1);
  assert.equal(sheet.getCell("B2").value, rows[0].phone);
  assert.equal(sheet.getCell(`C${rows.length + 1}`).value, rows.at(-1).email);
  assert.equal(sheet.getCell("B2").type, ExcelJS.ValueType.String);
});
test("PDF generation supports Unicode, many pages and printable PDF bytes", async () => {
  const response = await request({ format: "pdf", action: "print" });
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.includes(Buffer.from("%%EOF")));
  assert.ok((bytes.toString("latin1").match(/\/Type \/Page\b/g) || []).length > 40);
  await fs.writeFile(path.join(directory, "customers.pdf"), bytes);
  const { execFileSync } = require("node:child_process");
  const text = execFileSync("pdftotext", [path.join(directory, "customers.pdf"), "-"], { maxBuffer: 2000000 }).toString();
  assert.ok(text.includes("Àmina"));
  assert.ok(text.includes(rows.at(-1).email));
  assert.ok(!text.includes("NEVER_EXPORT"));
});
test("malformed format/action/search cannot expand an export", async () => {
  for (const body of [{ format: "html" }, { scope: "unknown" }, { action: "unknown" },
    { format: "csv", action: "print" }, { scope: "filtered", query: { $ne: null } },
    { scope: "filtered", query: "a".repeat(201) }]) {
    assert.equal((await request(body)).status, 400);
  }
});
test("database and audit failures fail closed without returning personal-data files", async () => {
  findFails = true;
  assert.equal((await request({})).status, 503);
  findFails = false;
  auditFails = true;
  const response = await request({});
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /json/);
  auditFails = false;
});
test("CSV formula injection is neutralized, quotes/newlines preserved", () => {
  for (const value of ["=SUM(A1)", "+cmd", "-1+2", "@SUM(A1)", " \t=cmd", "\tunsafe"]) {
    assert.ok(csvCell(value).startsWith('"\''));
  }
  assert.equal(csvCell('A "quoted", name\nnext'), '"A ""quoted"", name\nnext"');
});
test("generation cancellation fails and cannot deliver a partial file", async () => {
  const aborter = new AbortController(); aborter.abort();
  async function* source() { yield rows[0]; }
  await assert.rejects(writeExport(path.join(directory, "cancelled.csv"), "csv", source(), aborter.signal), /cancelled/);
});
