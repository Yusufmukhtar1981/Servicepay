const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Writable } = require("node:stream");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const { v2: cloudinary } = require("cloudinary");

const User = require("../models/user.model");
const AmanaOrder = require("../models/amanaOrder.model");
const AmanaFundingRecord = require("../models/amanaFundingRecord.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const customer = require("../controllers/amana.controller");
const admin = require("../controllers/adminAmana.controller");
const payment = require("../controllers/amanaPayment.controller");

let mongo;
let sequence = 0;
let uploaded = 0;

const models = [User, AmanaOrder, AmanaFundingRecord, AdminAuditLog];
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n", "ascii");

const makeFile = (name = "evidence.jpg", mimetype = "image/jpeg", buffer = jpeg) => ({
  mimetype,
  originalname: name,
  buffer,
});

const makeRequest = ({
  user = null,
  body = {},
  params = {},
  query = {},
  files = {},
  method = "POST",
} = {}) => ({
  user,
  body,
  params,
  query,
  files,
  method,
  originalUrl: "/test/amana",
  ip: "127.0.0.1",
  get() { return "amana-test"; },
});

const call = async (handler, options) => {
  const result = {};
  const res = {
    status(code) { result.status = code; return this; },
    json(body) { result.status ??= 200; result.body = body; return this; },
  };
  await handler(makeRequest(options), res);
  return result;
};

const createUser = async (role = "CUSTOMER") => {
  sequence += 1;
  return User.create({
    fullName: `Amana Test ${sequence}`,
    phone: `080800${String(sequence).padStart(5, "0")}`,
    email: `amana-${sequence}@example.test`,
    password: "Password123!",
    role,
    status: "ACTIVE",
  });
};

const categoryDetails = (category) => {
  if (category === "SCHOOL_FEES") {
    return { schoolName: "ServicePay Academy", studentName: "Student Test", classLevel: "JSS 2", termSession: "Second Term 2026" };
  }
  if (category === "MEDICAL_SUPPORT") {
    return { facilityName: "ServicePay Clinic", patientName: "Patient Test", treatmentDescription: "Required outpatient medical treatment." };
  }
  return { householdSize: 4, foodItems: ["Rice", "Beans"] };
};

const requestBody = (category = "FOOD_PACKAGE") => ({
  category,
  title: `${category} support`,
  description: "A protected support request with enough detail for review.",
  amount: 2000,
  beneficiary: {
    fullName: "Beneficiary Test",
    phone: "08030000000",
    relationship: "Sibling",
    state: "Kano",
    lga: "Nassarawa",
    address: "1 ServicePay Street, Kano",
  },
  categoryDetails: categoryDetails(category),
  providerDetails: { name: "Initial provider", phone: "08030000001" },
});

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "amana-protected-tests" });
  await Promise.all(models.map((model) => model.init()));
  process.env.CLOUDINARY_CLOUD_NAME = "amana-test";
  process.env.CLOUDINARY_API_KEY = "amana-test-key";
  process.env.CLOUDINARY_API_SECRET = "amana-test-secret";
  cloudinary.uploader.upload_stream = (_options, callback) => {
    const stream = new Writable({ write(_chunk, _encoding, done) { done(); } });
    queueMicrotask(() => {
      uploaded += 1;
      callback(null, { public_id: `servicepay/amana/test/${uploaded}` });
    });
    return stream;
  };
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
});

test("creates protected Food, School Fees, and Medical requests with evidence", async () => {
  const customerUser = await createUser();
  for (const category of ["FOOD_PACKAGE", "SCHOOL_FEES", "MEDICAL_SUPPORT"]) {
    const result = await call(customer.createAmanaOrder, {
      user: customerUser,
      body: requestBody(category),
      files: { attachment: [makeFile(`${category}.jpg`)] },
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.order.status, "SUBMITTED");
    assert.match(result.body.data.order.reference, /^AMANA-[A-F0-9]{12}$/);
    assert.equal(result.body.data.order.supportingDocuments.length, 1);
  }
});

test("accepts JPEG, PNG, and PDF evidence and returns it to customer and Head Office views", async () => {
  const customerUser = await createUser();
  const headOffice = await createUser("HEAD_OFFICE");
  const files = [
    makeFile("school-invoice.jpeg"),
    makeFile("medical-prescription.png", "image/png", png),
    makeFile("food-support.pdf", "application/pdf", pdf),
  ];
  const created = await call(customer.createAmanaOrder, {
    user: customerUser,
    body: requestBody("FOOD_PACKAGE"),
    files: { attachments: files },
  });
  assert.equal(created.status, 201);
  const order = await AmanaOrder.findById(created.body.data.order._id);
  assert.equal(order.supportingDocuments.length, 3);
  assert.deepEqual(order.supportingDocuments.map((document) => document.mimeType), ["image/jpeg", "image/png", "application/pdf"]);
  assert.ok(order.supportingDocuments.every((document) => document.requestReference === order.reference));
  assert.ok(order.supportingDocuments.every((document) => String(document.uploadedBy) === String(customerUser._id)));

  const customerList = await call(customer.getMyAmanaOrders, { user: customerUser, method: "GET" });
  assert.equal(customerList.status, 200);
  assert.equal(customerList.body.data.orders[0].supportingDocuments.length, 3);
  assert.ok(customerList.body.data.orders[0].supportingDocuments.every((document) => document.url));

  const adminDetail = await call(admin.getAmanaOrderById, {
    user: headOffice,
    params: { id: order._id.toString() },
    method: "GET",
  });
  assert.equal(adminDetail.status, 200);
  assert.equal(adminDetail.body.data.order.supportingDocuments.length, 3);
  assert.equal(adminDetail.body.data.order.providerPayment?.receipt ?? null, null);
  assert.ok(adminDetail.body.data.order.supportingDocuments.some((document) => document.mimeType === "application/pdf"));
});

test("rejects unsupported, empty, and missing Amana evidence files", async () => {
  const user = await createUser();
  const invalid = await call(customer.createAmanaOrder, {
    user,
    body: requestBody("FOOD_PACKAGE"),
    files: { attachment: [makeFile("malware.exe", "application/x-msdownload", Buffer.from("MZ"))] },
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /valid JPEG, PNG, or PDF/i);
  assert.equal(await AmanaOrder.countDocuments(), 0);

  const empty = await call(customer.createAmanaOrder, {
    user,
    body: requestBody("FOOD_PACKAGE"),
    files: { attachment: [makeFile("empty.pdf", "application/pdf", Buffer.alloc(0))] },
  });
  assert.equal(empty.status, 400);
  assert.equal(await AmanaOrder.countDocuments(), 0);

  const spoofed = await call(customer.createAmanaOrder, {
    user,
    body: requestBody("FOOD_PACKAGE"),
    files: { attachment: [makeFile("not-a-real-jpeg.jpg", "image/jpeg", pdf)] },
  });
  assert.equal(spoofed.status, 400);
  assert.match(spoofed.body.message, /valid JPEG, PNG, or PDF/i);
  assert.equal(await AmanaOrder.countDocuments(), 0);

  const oversized = await call(customer.createAmanaOrder, {
    user,
    body: requestBody("FOOD_PACKAGE"),
    files: { attachment: [makeFile("large-evidence.jpg", "image/jpeg", Buffer.concat([jpeg, Buffer.alloc((8 * 1024 * 1024) + 1)]))] },
  });
  assert.equal(oversized.status, 400);
  assert.match(oversized.body.message, /8 MB or smaller/i);
  assert.equal(await AmanaOrder.countDocuments(), 0);

  const missing = await call(customer.createAmanaOrder, {
    user,
    body: requestBody("FOOD_PACKAGE"),
    files: {},
  });
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /supporting document/i);
  assert.equal(await AmanaOrder.countDocuments(), 0);
});

test("rejects incomplete protected category data before storage/payment", async () => {
  const user = await createUser();
  const invalidFood = requestBody("FOOD_PACKAGE");
  invalidFood.categoryDetails = { householdSize: 0, foodItems: [] };
  const result = await call(customer.createAmanaOrder, {
    user,
    body: invalidFood,
    files: { attachment: [makeFile()] },
  });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /household size/i);
  assert.equal(await AmanaOrder.countDocuments(), 0);
});

test("only records a verified-provider payment after exact full controlled funding", async () => {
  const customerUser = await createUser();
  const headOffice = await createUser("HEAD_OFFICE");
  const created = await call(customer.createAmanaOrder, {
    user: customerUser,
    body: requestBody(),
    files: { attachment: [makeFile()] },
  });
  const id = created.body.data.order._id;

  let result = await call(admin.approveAmanaOrder, {
    user: headOffice,
    params: { id },
    body: { approvedAmount: 2000, note: "Eligible for protected support." },
    method: "PATCH",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.order.status, "APPROVED");

  result = await call(admin.updateProvider, {
    user: headOffice,
    params: { id },
    body: {
      type: "FOOD_VENDOR",
      name: "Verified Food Vendor",
      phone: "08030000001",
      accountName: "Vendor Account",
      accountNumber: "0123456789",
      bankName: "Test Bank",
      address: "Vendor Road, Kano",
    },
    method: "PATCH",
  });
  assert.equal(result.status, 200);

  result = await call(admin.verifyProvider, {
    user: headOffice,
    params: { id },
    body: { decision: "VERIFIED", note: "Bank and vendor details checked." },
    method: "PATCH",
  });
  assert.equal(result.status, 200);

  result = await call(admin.recordProviderPayment, {
    user: headOffice,
    params: { id },
    body: { amount: 2000, paymentReference: "PAY-BEFORE-FUNDING", idempotencyKey: "pay-before-funding" },
    files: { paymentReceipt: [makeFile("payment.jpg")] },
  });
  assert.equal(result.status, 409);
  assert.match(result.body.message, /fully funded/i);

  result = await call(admin.recordFunding, {
    user: headOffice,
    params: { id },
    body: { amount: 1000, sourceType: "HEAD_OFFICE", reference: "FUND-ONE", receiptReference: "HO-RECON-ONE", idempotencyKey: "fund-1" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.order.status, "FUNDING_IN_PROGRESS");

  result = await call(admin.recordFunding, {
    user: headOffice,
    params: { id },
    body: { amount: 1000, sourceType: "NGO", reference: "FUND-TWO", receiptReference: "NGO-RECON-TWO", idempotencyKey: "fund-2" },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.order.status, "FULLY_FUNDED");

  const fundingRetry = await call(admin.recordFunding, {
    user: headOffice,
    params: { id },
    body: { amount: 1000, sourceType: "NGO", reference: "FUND-TWO", receiptReference: "NGO-RECON-TWO", idempotencyKey: "fund-2" },
  });
  assert.equal(fundingRetry.status, 200);
  assert.equal(fundingRetry.body.duplicate, true);

  const paymentAttempts = await Promise.all([
    call(admin.recordProviderPayment, {
      user: headOffice,
      params: { id },
      body: { amount: 2000, paymentReference: "PAY-2000-A", idempotencyKey: "pay-2000-a", note: "Bank transfer confirmed." },
      files: { paymentReceipt: [makeFile("payment-a.jpg")] },
    }),
    call(admin.recordProviderPayment, {
      user: headOffice,
      params: { id },
      body: { amount: 2000, paymentReference: "PAY-2000-B", idempotencyKey: "pay-2000-b", note: "Bank transfer confirmed." },
      files: { paymentReceipt: [makeFile("payment-b.jpg")] },
    }),
  ]);
  const successfulPayment = paymentAttempts.find((attempt) => attempt.status === 200);
  const rejectedPayment = paymentAttempts.find((attempt) => attempt.status !== 200);
  assert.ok(successfulPayment);
  assert.ok(rejectedPayment);
  assert.equal(rejectedPayment.status, 409);
  assert.equal(successfulPayment.body.data.order.status, "PAID_TO_PROVIDER");
  assert.equal(successfulPayment.body.data.order.providerPayment.amount, 2000);
  const winningKey = successfulPayment.body.data.order.providerPayment.idempotencyKey;
  const winningReference = successfulPayment.body.data.order.providerPayment.reference;

  const duplicate = await call(admin.recordProviderPayment, {
    user: headOffice,
    params: { id },
    body: { amount: 2000, paymentReference: winningReference, idempotencyKey: winningKey },
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  result = await call(admin.addAmanaFulfilmentProof, {
    user: headOffice,
    params: { id },
    body: { notes: "Food package delivered to beneficiary." },
    files: { proof: [makeFile("delivery.jpg")] },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.order.status, "FULFILLED");

  result = await call(admin.completeAmanaOrder, {
    user: headOffice,
    params: { id },
    body: { note: "Delivery verified." },
    method: "PATCH",
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.order.status, "COMPLETED");

  const stored = await AmanaOrder.findById(id);
  assert.equal(stored.walletDebited, false);
  assert.equal(stored.fundedAmount, 2000);
  assert.equal(stored.statusHistory.some((event) => event.action === "PROVIDER_PAYMENT_RECORDED"), true);
  assert.ok(await AdminAuditLog.countDocuments({ action: "AMANA_PROVIDER_PAYMENT_RECORDED" }));
});

test("the legacy customer wallet payment endpoint is permanently blocked", async () => {
  const result = await call(payment.payAmanaOrder, {});
  assert.equal(result.status, 410);
  assert.equal(result.body.code, "PROTECTED_AMANA_PAYMENT");
});