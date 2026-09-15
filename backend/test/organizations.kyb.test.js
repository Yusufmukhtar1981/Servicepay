const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const models = require("../models/organizations.models");
const OrganizationDocumentCleanup = require("../models/organizationDocumentCleanup.model");
const service = require("../services/organizations.service");
const controller = require("../controllers/organizations.controller");
const adminOrganizationsRouter = require("../routes/adminOrganizations.routes");
const documentService = require("../services/organizationDocument.service");
const { validateFile, MAX_DOCUMENT_BYTES } = require("../services/amanaDocument.service");
const { STAFF_PERMISSIONS } = require("../config/permissionRegistry");

const userId = new mongoose.Types.ObjectId();
const otherUserId = new mongoose.Types.ObjectId();
const makeOrg = (fields = {}) => new models.Organization({
  _id: new mongoose.Types.ObjectId(),
  name: "Example Organization",
  slug: `example-${Math.random().toString(16).slice(2)}`,
  code: "ORGTEST",
  createdBy: userId,
  status: "DRAFT",
  organizationType: "COMPANY",
  type: "COMPANY",
  registrationStatus: "REGISTERED",
  registrationNumber: "RC12345",
  dateEstablished: new Date("2020-01-01"),
  description: "A description",
  industry: "Technology",
  organizationEmail: "org@example.com",
  organizationPhone: "08012345678",
  officeAddress: { address: "1 Main Street", state: "Lagos", lga: "Ikeja", city: "Ikeja" },
  representative: { fullName: "Ada Example", role: "Director", phone: "08012345679", email: "ada@example.com", nin: "12345678901", residentialAddress: { address: "2 Home Road", state: "Lagos", lga: "Ikeja", city: "Ikeja" } },
  documents: [{ name: "Certificate", documentType: "CERTIFICATE_OF_INCORPORATION", storageKey: "private/key", mimeType: "application/pdf", size: 100 }],
  ...fields,
});
const ownerRequest = (body = {}) => ({ user: { _id: userId }, body, ip: "127.0.0.1" });
const query = (value) => ({ select: async () => value });
const patchStatic = (model, name, implementation) => {
  const previous = model[name];
  model[name] = implementation;
  return () => { model[name] = previous; };
};

test("registered company input is normalized and requires its incorporation document", async () => {
  const normalized = service.normalizeKybInput({
    name: "  Example Company  ",
    organizationType: "company",
    registrationStatus: "registered",
    registrationNumber: "RC-123/45",
    dateEstablished: "2020-01-01",
    description: "A company providing useful services.",
    industry: "Technology",
    organizationEmail: "org@example.com",
    organizationPhone: "08012345678",
    officeAddress: { address: "1 Main", state: "Lagos", lga: "Ikeja", city: "Ikeja" },
    representative: { fullName: "Ada", role: "Director", phone: "08012345679", email: "ada@example.com", nin: "12345678901", residentialAddress: { address: "2 Home Road", state: "Lagos", lga: "Ikeja", city: "Ikeja" } },
  }, { submitting: true });
  assert.equal(normalized.name, "Example Company");
  assert.equal(normalized.organizationType, "COMPANY");
  assert.deepEqual(service.requiredDocumentsFor(normalized), ["CERTIFICATE_OF_INCORPORATION"]);
  const lifecycle = makeOrg({ status: "UNDER_REVIEW" });
  await assert.doesNotReject(() => lifecycle.validate());
});

test("unregistered NGO, cooperative, and association have governing-document requirements", () => {
  for (const type of ["NGO", "COOPERATIVE", "ASSOCIATION", "SCHOOL", "RELIGIOUS", "GOVERNMENT", "COMMUNITY"]) {
    assert.deepEqual(service.requiredDocumentsFor({ organizationType: type, registrationStatus: "UNREGISTERED" }), ["GOVERNING_DOCUMENT"]);
  }
  assert.deepEqual(service.requiredDocumentsFor({ organizationType: "NGO", registrationStatus: "REGISTERED" }), ["REGISTRATION_CERTIFICATE"]);
});

test("Flutter-style KYB payload accepts optional establishment date and residential address/city only", () => {
  const payload = {
    name: "Community School",
    organizationType: "SCHOOL",
    registrationStatus: "UNREGISTERED",
    description: "A school serving the local community.",
    industry: "Education",
    organizationEmail: "school@example.com",
    organizationPhone: "08012345678",
    officeAddress: { address: "1 Main", state: "Lagos", lga: "Ikeja", city: "Ikeja" },
    representative: {
      fullName: "Ada Example", role: "Proprietor", phone: "08012345679", email: "ada@example.com", nin: "12345678901",
      residentialAddress: { address: "2 Home", city: "Ikeja" },
    },
  };
  assert.doesNotThrow(() => service.normalizeKybInput(payload, { submitting: true }));
  const legacyResidential = service.normalizeKybInput({
    representative: {
      residentialAddress: {
        address: "2 Home",
        city: "Ikeja",
        state: "Lagos",
        lga: "Ikeja",
        landmark: "By the market",
      },
    },
  });
  assert.deepEqual(legacyResidential.representative.residentialAddress, {
    address: "2 Home",
    city: "Ikeja",
  });
  assert.throws(() => service.normalizeKybInput({ ...payload, sector: "Education" }, { submitting: true }), /exactly one industry or sector/);
  for (const type of ["SCHOOL", "RELIGIOUS", "GOVERNMENT", "COMMUNITY"]) {
    assert.equal(service.normalizeKybInput({ organizationType: type }).organizationType, type);
  }
});

test("Nigeria state and LGA validation rejects a mismatched location", () => {
  assert.doesNotThrow(() => service.normalizeKybInput({
    officeAddress: { address: "1 Main", state: "FCT", lga: "Gwagwalada" },
  }));
  assert.throws(() => service.normalizeKybInput({
    officeAddress: { address: "1 Main", state: "Lagos", lga: "Kano Municipal" },
  }), /LGA does not belong/);
});

test("KYB sanitization validates email, NIN, registration number, and website", () => {
  assert.throws(() => service.normalizeKybInput({ organizationEmail: "not-an-email" }), /email is invalid/);
  assert.throws(() => service.normalizeKybInput({ registrationNumber: "<script>" }), /invalid characters/);
  assert.throws(() => service.normalizeKybInput({ representative: { nin: "123" } }), /11 digits/);
  assert.throws(() => service.normalizeKybInput({ website: "javascript:alert(1)" }), /HTTP or HTTPS/);
});

test("submission requires description, industry or sector, city, NIN, and residential address", () => {
  const complete = {
    name: "Required Fields Org",
    organizationType: "NGO",
    registrationStatus: "UNREGISTERED",
    description: "Purpose",
    industry: "Education",
    dateEstablished: "2020-01-01",
    organizationEmail: "org@example.com",
    organizationPhone: "08012345678",
    officeAddress: { address: "1 Main", state: "Lagos", lga: "Ikeja", city: "Ikeja" },
    representative: { fullName: "Ada", role: "Trustee", phone: "08012345679", email: "ada@example.com", nin: "12345678901", residentialAddress: { address: "2 Home", state: "Lagos", lga: "Ikeja", city: "Ikeja" } },
  };
  for (const [field, pattern] of [
    ["description", /description is required/],
    ["industry", /industry or sector is required/],
    ["officeAddress", /Office city is required/],
    ["representative.nin", /Representative NIN is required/],
    ["representative.residentialAddress", /residential address is required/],
  ]) {
    const input = JSON.parse(JSON.stringify(complete));
    if (field.includes(".")) delete input[field.split(".")[0]][field.split(".")[1]];
    else if (field === "officeAddress") delete input.officeAddress.city;
    else delete input[field];
    assert.throws(() => service.normalizeKybInput(input, { submitting: true }), pattern, field);
  }
});

test("safe organization serializers never return representative NIN or private storage keys", () => {
  const safe = service.safeOrganization(makeOrg());
  assert.equal(safe.representative.nin, undefined);
  assert.equal(safe.documents[0].storageKey, undefined);
  const admin = { ...safe, representative: { ...safe.representative, nin: "12345678901" } };
  assert.equal(service.safeOrganization(admin).representative.nin, undefined);
});

test("organization profile uses view permission while documents retain dedicated permission", () => {
  assert.ok(Object.values(STAFF_PERMISSIONS).includes("organizations.documents.view"));
  const documentRoute = adminOrganizationsRouter.stack.find((layer) => layer.route?.path === "/:id/documents/:documentId");
  assert.deepEqual(documentRoute.route.stack[0].handle.requiredPermissions, ["organizations.documents.view"]);
  const detailRoute = adminOrganizationsRouter.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.get);
  assert.deepEqual(detailRoute.route.stack[0].handle.requiredPermissions, ["organizations.view"]);
});

test("admin organization profile omits document metadata without document permission", async () => {
  const organization = makeOrg();
  const previousFindById = models.Organization.findById;
  models.Organization.findById = () => ({
    select() {
      return { lean: async () => organization };
    },
  });
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.value = value; return value; },
  });
  try {
    const profileResponse = response();
    await controller.adminDetail({
      params: { id: String(organization._id) },
      user: { role: "STAFF" },
      staffAccess: { permissions: ["organizations.view"] },
    }, profileResponse);
    assert.equal(profileResponse.statusCode, 200);
    assert.equal(profileResponse.value.organization.name, organization.name);
    assert.equal(profileResponse.value.organization.documents, undefined);

    const documentsResponse = response();
    await controller.adminDetail({
      params: { id: String(organization._id) },
      user: { role: "STAFF" },
      staffAccess: { permissions: ["organizations.view", "organizations.documents.view"] },
    }, documentsResponse);
    assert.equal(documentsResponse.statusCode, 200);
    assert.equal(documentsResponse.value.organization.documents[0].storageKey, undefined);
    assert.equal(documentsResponse.value.organization.documents[0].documentType, "CERTIFICATE_OF_INCORPORATION");
  } finally {
    models.Organization.findById = previousFindById;
  }
});

test("owner draft update is authorized and unauthorized owners are rejected", async () => {
  const organization = makeOrg();
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  try {
    const updated = await service.updateOrganizationDraft(ownerRequest({ description: "Updated description" }), organization._id);
    assert.equal(updated.description, "Updated description");
  } finally {
    restoreOrg(); restoreRole(); restoreAudit();
  }
  const unauthorized = makeOrg({ createdBy: otherUserId });
  const restoreUnauthorized = patchStatic(models.Organization, "findOne", () => query(null));
  try {
    await assert.rejects(() => service.updateOrganizationDraft(ownerRequest({ description: "Nope" }), unauthorized._id), /access denied/);
  } finally { restoreUnauthorized(); }
});

test("legacy submit keeps settings.manage authorization and does not require declaration", async () => {
  const organization = makeOrg({ status: "DRAFT" });
  organization.save = async () => organization;
  const previousAccess = service.requireOrganizationAccess;
  const previousAudit = service.audit;
  let auditCount = 0;
  service.requireOrganizationAccess = async (_req, _id, permission, operational) => {
    assert.equal(permission, "settings.manage");
    assert.equal(operational, false);
    return organization;
  };
  service.audit = async () => { auditCount += 1; };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } };
  try {
    await controller.submit({ params: { organizationId: String(organization._id) }, user: { _id: userId }, body: {} }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.value.organization.status, "PENDING_VERIFICATION");
    assert.equal(auditCount, 1);
  } finally {
    service.requireOrganizationAccess = previousAccess;
    service.audit = previousAudit;
  }
});

test("submit requires declaration, preserves required documents, and duplicate submit is idempotent", async () => {
  const organization = makeOrg();
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreClaim = patchStatic(models.Organization, "findOneAndUpdate", async (_filter, update) => {
    if (organization.status !== "DRAFT") return null;
    Object.assign(organization, update.$set);
    return organization;
  });
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  let auditCount = 0;
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => { auditCount += 1; return []; });
  try {
    await assert.rejects(() => service.submitOrganization(ownerRequest({ declaration: false }), organization._id), /declaration is required/);
    const result = await service.submitOrganization(ownerRequest({ declaration: true }), organization._id);
    assert.equal(result.duplicate, false);
    assert.equal(result.organization.status, "PENDING_REVIEW");
    assert.ok(result.organization.submittedAt);
    const duplicate = await service.submitOrganization(ownerRequest({ declaration: true }), organization._id);
    assert.equal(duplicate.duplicate, true);
    assert.equal(auditCount, 1);
    await assert.rejects(() => service.submitOrganization(ownerRequest({ declaration: true, submissionKey: "different-request" }), organization._id), /different submission is already being reviewed/);
  } finally {
    restoreOrg(); restoreClaim(); restoreRole(); restoreAudit();
  }
});

test("review transitions enforce graph and reasons", async () => {
  const organization = makeOrg({ status: "PENDING_REVIEW" });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findById", async () => organization);
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  try {
    assert.equal((await service.reviewOrganization(ownerRequest(), organization._id, "UNDER_REVIEW")).status, "UNDER_REVIEW");
    assert.equal((await service.reviewOrganization(ownerRequest(), organization._id, "APPROVED")).status, "APPROVED");
    await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "SUSPENDED"), /reason is required/);
    assert.equal((await service.reviewOrganization(ownerRequest({ reason: "Risk review" }), organization._id, "SUSPENDED", { reason: "Risk review" })).status, "SUSPENDED");
    assert.equal((await service.reviewOrganization(ownerRequest(), organization._id, "APPROVED")).status, "APPROVED");
    organization.status = "PENDING_REVIEW";
    await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { fields: ["industry"] }), /reason is required/);
    await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Bad path", fields: ["representative"], documents: ["OTHER"] }), /Invalid requested field path/);
    await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Bad doc", fields: ["industry"], documents: ["UNSUPPORTED"] }), /Invalid requested document type/);
    for (const field of [
      "representative.residentialAddress.state",
      "representative.residentialAddress.lga",
      "representative.residentialAddress.landmark",
    ]) {
      await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Unsupported field", fields: [field] }), /Invalid requested field path/);
    }
    const supportedFields = await service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Update profile", fields: ["sector", "website"] });
    assert.deepEqual(supportedFields.requestedInformation.fields, ["industry", "website"]);
    organization.status = "PENDING_REVIEW";
    const legacyField = await service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Legacy type", fields: ["type"] });
    assert.deepEqual(legacyField.requestedInformation.fields, ["organizationType"]);
    organization.status = "PENDING_REVIEW";
    const moreInfo = await service.reviewOrganization(ownerRequest(), organization._id, "MORE_INFORMATION_REQUIRED", { reason: "Clarify industry", fields: ["industry"], documents: ["PROOF_OF_ADDRESS"] });
    assert.deepEqual(moreInfo.requestedInformation.fields, ["industry"]);
    assert.deepEqual(moreInfo.requestedInformation.documents, ["PROOF_OF_ADDRESS"]);
    organization.status = "PENDING_REVIEW";
    await assert.rejects(() => service.reviewOrganization(ownerRequest(), organization._id, "REJECTED"), /reason is required/);
    assert.equal((await service.reviewOrganization(ownerRequest(), organization._id, "REJECTED", { reason: "Incomplete evidence" })).rejectionReason, "Incomplete evidence");
  } finally { restoreOrg(); restoreAudit(); }
});

test("more-information resubmission only permits requested fields", async () => {
  const organization = makeOrg({ status: "MORE_INFORMATION_REQUIRED", requestedInformation: { reason: "Clarify industry", fields: ["industry"], documents: [] } });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  try {
    await assert.rejects(() => service.updateOrganizationDraft(ownerRequest({ description: "Not requested" }), organization._id), /Only requested information/);
    const updated = await service.updateOrganizationDraft(ownerRequest({ industry: "Finance" }), organization._id);
    assert.equal(updated.industry, "Finance");
    organization.requestedInformation.fields = ["representative.email"];
    await assert.rejects(() => service.updateOrganizationDraft(ownerRequest({ representative: { email: "new@example.com", fullName: "Bypass" } }), organization._id), /representative.fullName/);
    const nested = await service.updateOrganizationDraft(ownerRequest({ representative: { email: "new@example.com" } }), organization._id);
    assert.equal(nested.representative.email, "new@example.com");
  } finally { restoreOrg(); restoreRole(); restoreAudit(); }
});

test("sector remediation is canonicalized to industry through resubmission", async () => {
  const organization = makeOrg({
    status: "PENDING_REVIEW",
    industry: "Legacy industry",
    sector: undefined,
  });
  organization.save = async () => organization;
  const restoreById = patchStatic(models.Organization, "findById", async () => organization);
  const restoreFindOne = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreClaim = patchStatic(models.Organization, "findOneAndUpdate", async (_filter, update) => {
    Object.assign(organization, update.$set);
    return organization;
  });
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  try {
    organization.sector = "Legacy sector alias";
    organization.status = "DRAFT";
    const canonicalized = await service.updateOrganizationDraft(
      ownerRequest({ description: "Draft update" }),
      organization._id,
    );
    assert.equal(canonicalized.industry, "Legacy industry");
    assert.equal(canonicalized.sector, undefined);
    organization.status = "PENDING_REVIEW";

    const legacy = service.normalizeKybInput({ sector: "Legacy sector" });
    assert.equal(legacy.industry, "Legacy sector");
    assert.equal(legacy.sector, undefined);
    const dual = service.normalizeKybInput({ industry: "Canonical industry", sector: "Legacy sector" });
    assert.equal(dual.industry, "Canonical industry");
    assert.equal(dual.sector, undefined);

    const requested = await service.reviewOrganization(
      ownerRequest(),
      organization._id,
      "MORE_INFORMATION_REQUIRED",
      { reason: "Clarify industry", fields: ["sector", "industry"] },
    );
    assert.deepEqual(requested.requestedInformation.fields, ["industry"]);

    const updated = await service.updateOrganizationDraft(
      ownerRequest({ sector: "Updated sector" }),
      organization._id,
    );
    assert.equal(updated.industry, "Updated sector");
    assert.equal(updated.sector, undefined);

    const submitted = await service.submitOrganization(
      ownerRequest({ declaration: true }),
      organization._id,
    );
    assert.equal(submitted.duplicate, false);
    assert.equal(submitted.organization.status, "PENDING_REVIEW");
    assert.equal(submitted.organization.industry, "Updated sector");
    assert.equal(submitted.organization.sector, undefined);
  } finally {
    restoreById();
    restoreFindOne();
    restoreClaim();
    restoreRole();
    restoreAudit();
  }
});

test("document uploads reject unsupported type and oversized files before storage", async () => {
  await assert.rejects(() => documentService.uploadOrganizationDocument({ buffer: Buffer.from("%PDF-1.7"), mimetype: "text/plain", originalname: "bad.txt" }, new mongoose.Types.ObjectId(), { documentType: "OTHER" }), (error) => error.status === 400 && /valid JPEG, PNG, or PDF/.test(error.message));
  const oversized = { buffer: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(MAX_DOCUMENT_BYTES)]), mimetype: "application/pdf", originalname: "large.pdf" };
  assert.throws(() => validateFile(oversized), (error) => error.status === 413 && /8 MB or smaller/.test(error.message));
});

test("document upload never starts when provisional intent persistence fails", async () => {
  const previousUploadStream = cloudinary.uploader.upload_stream;
  let uploadStarted = false;
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async () => {
    throw Object.assign(new Error("database unavailable"), { code: "DB_UNAVAILABLE" });
  });
  cloudinary.uploader.upload_stream = () => {
    uploadStarted = true;
    throw new Error("upload must not start");
  };
  try {
    await assert.rejects(
      () => documentService.uploadOrganizationDocument(
        { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "proof.pdf" },
        new mongoose.Types.ObjectId(),
        { documentType: "PROOF_OF_ADDRESS" },
      ),
      /database unavailable/,
    );
    assert.equal(uploadStarted, false);
  } finally {
    cloudinary.uploader.upload_stream = previousUploadStream;
    restoreQueue();
  }
});

test("document upload returns the persisted cast subdocument id and safe metadata", async () => {
  const organization = makeOrg({ documents: [] });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => filter);
  const restoreQueueDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  const previousUploadStream = cloudinary.uploader.upload_stream;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  let uploadOptions;
  cloudinary.uploader.upload_stream = (options, callback) => {
    uploadOptions = options;
    return {
    end() {
      callback(null, { public_id: options.public_id });
    },
    };
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.value = value; return value; },
  };
  try {
    await controller.organizationDocumentUpload({
      params: { organizationId: String(organization._id) },
      user: { _id: userId },
      body: { documentType: "PROOF_OF_ADDRESS", name: "Proof of address" },
      file: { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "proof.pdf" },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.ok(response.value.document._id);
    assert.equal(response.value.document.documentType, "PROOF_OF_ADDRESS");
    assert.equal(response.value.document.name, "Proof of address");
    assert.equal(response.value.document.storageKey, undefined);
    assert.match(uploadOptions.public_id, new RegExp(`^servicepay/organizations/${organization._id}/document-`));
  } finally {
    cloudinary.uploader.upload_stream = previousUploadStream;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreOrg();
    restoreRole();
    restoreAudit();
    restoreQueue();
    restoreQueueDelete();
  }
});

test("document replacement queues the exact previous authenticated asset", async () => {
  const organization = makeOrg({ documents: [] });
  organization.documents.push({
    name: "Old certificate",
    documentType: "CERTIFICATE_OF_INCORPORATION",
    storageKey: "private/old-certificate",
    mimeType: "application/pdf",
    size: 100,
  });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreAudit = patchStatic(models.OrganizationAuditLog, "create", async () => []);
  const previousUploadStream = cloudinary.uploader.upload_stream;
  const previousDestroy = cloudinary.uploader.destroy;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  let destroyed;
  let cleanupIntent;
  const restoreCleanup = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => {
    cleanupIntent = filter;
    return { ...filter };
  });
  const restoreCleanupDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.upload_stream = (options, callback) => ({
    end() {
      callback(null, { public_id: options.public_id });
    },
  });
  cloudinary.uploader.destroy = async (publicId, options) => {
    destroyed = { publicId, options };
    return { result: "ok" };
  };
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.value = value; return value; },
  };
  try {
    await controller.organizationDocumentUpload({
      params: { organizationId: String(organization._id) },
      user: { _id: userId },
      body: { documentType: "CERTIFICATE_OF_INCORPORATION", name: "New certificate" },
      file: { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "certificate.pdf" },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.value.document.documentType, "CERTIFICATE_OF_INCORPORATION");
    assert.equal(cleanupIntent.assetId, "private/old-certificate");
    assert.equal(cleanupIntent.resourceType, "raw");
    assert.equal(destroyed, undefined);
  } finally {
    cloudinary.uploader.upload_stream = previousUploadStream;
    cloudinary.uploader.destroy = previousDestroy;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreOrg();
    restoreRole();
    restoreAudit();
    restoreCleanup();
    restoreCleanupDelete();
  }
});

test("Cloudinary rejects malformed image payloads as client validation errors", async () => {
  const organization = makeOrg({ documents: [] });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => filter);
  const previousUploadStream = cloudinary.uploader.upload_stream;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.upload_stream = (_options, callback) => ({
    end() {
      callback({ http_code: 400 }, null);
    },
  });
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.value = value; return value; },
  };
  try {
    await controller.organizationDocumentUpload({
      params: { organizationId: String(organization._id) },
      user: { _id: userId },
      body: { documentType: "IDENTITY_DOCUMENT", name: "Identity" },
      file: { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mimetype: "image/jpeg", originalname: "bad.jpg" },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.value.message, /valid JPEG, PNG, or PDF/i);
  } finally {
    cloudinary.uploader.upload_stream = previousUploadStream;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreOrg();
    restoreRole();
    restoreQueue();
  }
});

test("document persistence failure compensates the newly uploaded asset", async () => {
  const organization = makeOrg();
  const document = {
    name: "Replacement",
    documentType: "CERTIFICATE_OF_INCORPORATION",
    storageKey: "private/new-certificate",
    mimeType: "application/pdf",
    size: 100,
  };
  organization.save = async () => { throw new Error("save failed"); };
  const previousDestroy = cloudinary.uploader.destroy;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  let queued;
  let destroyed;
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => {
    queued = filter;
    return filter;
  });
  const restoreQueueDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.destroy = async (assetId, options) => {
    destroyed = { assetId, options };
    return { result: "ok" };
  };
  try {
    await assert.rejects(
      () => documentService.persistOrganizationDocument(organization, document, { organizationModel: { exists: async () => false } }),
      /save failed/,
    );
    assert.equal(queued.assetId, "private/key");
    assert.equal(destroyed.assetId, "private/new-certificate");
    assert.equal(destroyed.options.resource_type, "raw");
  } finally {
    cloudinary.uploader.destroy = previousDestroy;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreQueue();
    restoreQueueDelete();
  }
});

test("retirement intent failure compensates the uploaded replacement before save", async () => {
  const organization = makeOrg();
  const document = {
    documentType: "CERTIFICATE_OF_INCORPORATION",
    storageKey: "private/replacement-after-intent-failure",
    mimeType: "application/pdf",
  };
  let saved = false;
  organization.save = async () => { saved = true; };
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async () => {
    throw new Error("database unavailable");
  });
  const restoreQueueDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  const previousDestroy = cloudinary.uploader.destroy;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  let destroyed;
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.destroy = async (assetId) => {
    destroyed = assetId;
    return { result: "ok" };
  };
  try {
    await assert.rejects(
      () => documentService.persistOrganizationDocument(organization, document, { organizationModel: { exists: async () => false } }),
      /database unavailable/,
    );
    assert.equal(saved, false);
    assert.equal(destroyed, document.storageKey);
  } finally {
    cloudinary.uploader.destroy = previousDestroy;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreQueue();
    restoreQueueDelete();
  }
});

test("crash after upload before Mongo save leaves a provisional intent for compensation", async () => {
  const organization = makeOrg();
  organization.save = async () => { throw new Error("save crashed"); };
  const intents = [];
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => {
    intents.push(filter);
    return filter;
  });
  const restoreQueueDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  const previousUpload = cloudinary.uploader.upload_stream;
  const previousDestroy = cloudinary.uploader.destroy;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  let destroyed;
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.upload_stream = (options, callback) => ({
    end() { callback(null, { public_id: options.public_id }); },
  });
  cloudinary.uploader.destroy = async (assetId) => {
    destroyed = assetId;
    return { result: "ok" };
  };
  try {
    const uploaded = await documentService.uploadOrganizationDocument(
      { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "crash.pdf" },
      organization._id,
      { documentType: "CERTIFICATE_OF_INCORPORATION" },
    );
    await assert.rejects(
      () => documentService.persistOrganizationDocument(organization, uploaded, { organizationModel: { exists: async () => false } }),
      /save crashed/,
    );
    assert.equal(intents[0].kind, "PROVISIONAL");
    assert.equal(destroyed, uploaded.storageKey);
  } finally {
    cloudinary.uploader.upload_stream = previousUpload;
    cloudinary.uploader.destroy = previousDestroy;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreQueue();
    restoreQueueDelete();
  }
});

test("failed asset destruction remains queued and not-found completes retry", async () => {
  const item = { _id: "cleanup-1", assetId: "private/old", resourceType: "raw", kind: "PROVISIONAL", attempts: 1 };
  let claims = 0;
  let updates = [];
  let deletions = 0;
  const cleanupModel = {
    findOneAndUpdate() {
      claims += 1;
      const value = claims === 1 || claims === 2 ? item : null;
      return { lean: async () => value };
    },
    updateOne(_filter, update) { updates.push(update); return Promise.resolve(); },
    deleteOne() { deletions += 1; return Promise.resolve(); },
  };
  let destroyAttempts = 0;
  const destroyAsset = async () => {
    destroyAttempts += 1;
    if (destroyAttempts === 1) throw new Error("provider unavailable");
    return { result: "not found" };
  };
  const first = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    organizationModel: { exists: async () => false },
    destroyAsset,
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(first.failed, 1);
  assert.equal(updates[0].$set.status, "PENDING");
  const second = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    organizationModel: { exists: async () => false },
    destroyAsset,
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(second.completed, 1);
  assert.equal(deletions, 1);
});

test("cleanup reference guard defers an intent while any organization still references the asset", async () => {
  const updates = [];
  let destroyed = false;
  const cleanupModel = {
    findOneAndUpdate() {
      return { lean: async () => ({ _id: "cleanup-2", assetId: "private/current", resourceType: "image", kind: "RETIREMENT", attempts: 1 }) };
    },
    updateOne(_filter, update) { updates.push(update); return Promise.resolve(); },
    deleteOne() { throw new Error("referenced asset must not be deleted"); },
  };
  const result = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    organizationModel: { exists: async () => true },
    destroyAsset: async () => { destroyed = true; return { result: "ok" }; },
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(result.deferred, 1);
  assert.equal(destroyed, false);
  assert.equal(updates[0].$set.lastErrorCategory, "asset-still-referenced");
});

test("provisional intent is removed when the saved organization references its asset", async () => {
  let deleted = 0;
  let destroyed = false;
  const cleanupModel = {
    findOneAndUpdate() {
      return { lean: async () => ({ _id: "cleanup-provisional", assetId: "private/current", resourceType: "raw", kind: "PROVISIONAL", attempts: 1 }) };
    },
    deleteOne() { deleted += 1; return Promise.resolve(); },
    updateOne() { throw new Error("provisional intent should not be retried"); },
  };
  const result = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    organizationModel: { exists: async () => true },
    destroyAsset: async () => { destroyed = true; return { result: "ok" }; },
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(result.completed, 1);
  assert.equal(deleted, 1);
  assert.equal(destroyed, false);
});

test("provisional intent is not claimable before upload completes", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const document = { storageKey: "private/before-upload", mimeType: "application/pdf" };
  let inserted;
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter, update) => {
    inserted = { filter, update };
    return filter;
  });
  try {
    const now = new Date("2025-01-01T00:00:00.000Z");
    await documentService.enqueueDocumentAssetCleanup(organizationId, document, { kind: "PROVISIONAL" });
    const state = inserted.update.$setOnInsert;
    assert.equal(state.kind, "PROVISIONAL");
    assert.equal(state.status, "PROCESSING");
    assert.ok(state.leaseUntil > new Date());
    assert.equal(state.nextAttemptAt.getTime(), state.leaseUntil.getTime());
    let destroyed = false;
    const cleanupModel = {
      findOneAndUpdate(filter) {
        assert.deepEqual(filter.$or[0], { status: "PENDING", nextAttemptAt: { $lte: now } });
        assert.deepEqual(filter.$or[1], { status: "PROCESSING", leaseUntil: { $lte: now } });
        return { lean: async () => null };
      },
    };
    const result = await documentService.processDocumentAssetCleanup({
      cleanupModel,
      now,
      organizationModel: { exists: async () => false },
      destroyAsset: async () => { destroyed = true; },
      skipConnectionCheck: true,
      limit: 1,
    });
    assert.equal(result.processed, 0);
    assert.equal(destroyed, false);
  } finally {
    restoreQueue();
  }
});

test("processor does not delete an uploaded provisional asset before organization save", async () => {
  const now = new Date("2025-01-01T00:00:00.000Z");
  const item = {
    _id: "cleanup-uploaded",
    assetId: "private/uploaded-before-save",
    resourceType: "raw",
    kind: "PROVISIONAL",
    status: "PROCESSING",
    leaseUntil: new Date(now.getTime() + 60_000),
    attempts: 0,
  };
  let destroyed = false;
  const cleanupModel = {
    findOneAndUpdate(filter) {
      assert.deepEqual(filter.$or[1], { status: "PROCESSING", leaseUntil: { $lte: now } });
      return { lean: async () => null };
    },
  };
  const result = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    now,
    organizationModel: { exists: async () => false },
    destroyAsset: async () => { destroyed = true; },
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(item.status, "PROCESSING");
  assert.equal(result.processed, 0);
  assert.equal(destroyed, false);
});

test("expired provisional lease recovers a crashed upload", async () => {
  const now = new Date("2025-01-01T00:00:00.000Z");
  const item = {
    _id: "cleanup-expired-provisional",
    assetId: "private/crashed-upload",
    resourceType: "raw",
    kind: "PROVISIONAL",
    status: "PROCESSING",
    leaseUntil: new Date(now.getTime() - 1),
    attempts: 0,
  };
  let deleted = 0;
  let destroyed;
  const cleanupModel = {
    findOneAndUpdate() {
      return { lean: async () => ({ ...item, attempts: 1 }) };
    },
    deleteOne() { deleted += 1; return Promise.resolve(); },
  };
  const result = await documentService.processDocumentAssetCleanup({
    cleanupModel,
    now,
    organizationModel: { exists: async () => false },
    destroyAsset: async (asset) => {
      destroyed = asset;
      return { result: "ok" };
    },
    skipConnectionCheck: true,
    limit: 1,
  });
  assert.equal(result.completed, 1);
  assert.equal(deleted, 1);
  assert.deepEqual(destroyed, { assetId: item.assetId, resourceType: item.resourceType });
});

test("ambiguous save with a referenced provisional asset preserves provisional cleanup kind", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const document = { storageKey: "private/ambiguous-save", mimeType: "application/pdf" };
  let deletedFilter;
  const restoreDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async (filter) => {
    deletedFilter = filter;
    return { deletedCount: 1 };
  });
  let destroyed = false;
  try {
    await documentService.compensateUploadedAsset(organizationId, document, {
      organizationModel: { exists: async () => true },
    });
    assert.equal(deletedFilter.kind, "PROVISIONAL");
    assert.equal(deletedFilter.assetId, document.storageKey);
    assert.equal(destroyed, false);
  } finally {
    restoreDelete();
  }
});

test("ambiguous reference check preserves provisional kind for retry", async () => {
  const organizationId = new mongoose.Types.ObjectId();
  const document = { storageKey: "private/ambiguous-reference", mimeType: "application/pdf" };
  let queuedFilter;
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => {
    queuedFilter = filter;
    return filter;
  });
  try {
    await documentService.compensateUploadedAsset(organizationId, document, {
      organizationModel: { exists: async () => { throw new Error("ambiguous save result"); } },
    });
    assert.equal(queuedFilter.kind, "PROVISIONAL");
  } finally {
    restoreQueue();
  }
});

test("concurrent replacement compensates only the losing newly uploaded asset", async () => {
  const first = makeOrg();
  const second = makeOrg({ _id: first._id });
  const firstDocument = { documentType: "CERTIFICATE_OF_INCORPORATION", storageKey: "private/winner", mimeType: "application/pdf" };
  const secondDocument = { documentType: "CERTIFICATE_OF_INCORPORATION", storageKey: "private/loser", mimeType: "application/pdf" };
  first.save = async () => first;
  second.save = async () => { throw new Error("version conflict"); };
  const restoreQueue = patchStatic(OrganizationDocumentCleanup, "findOneAndUpdate", async (filter) => filter);
  const previousDestroy = cloudinary.uploader.destroy;
  const previousEnv = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  const destroyed = [];
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.uploader.destroy = async (assetId) => {
    destroyed.push(assetId);
    return { result: "ok" };
  };
  const restoreQueueDelete = patchStatic(OrganizationDocumentCleanup, "deleteOne", async () => ({ deletedCount: 1 }));
  try {
    await documentService.persistOrganizationDocument(first, firstDocument, { organizationModel: { exists: async () => false } });
    await assert.rejects(
      () => documentService.persistOrganizationDocument(second, secondDocument, { organizationModel: { exists: async () => false } }),
      /version conflict/,
    );
    assert.deepEqual(destroyed, ["private/loser"]);
  } finally {
    cloudinary.uploader.destroy = previousDestroy;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreQueue();
    restoreQueueDelete();
  }
});

test("more-information status rejects every document upload when no exact document was requested", async () => {
  const organization = makeOrg({ status: "MORE_INFORMATION_REQUIRED", requestedInformation: { fields: [], documents: [] } });
  organization.save = async () => organization;
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } };
  try {
    await controller.organizationDocumentUpload({
      params: { organizationId: String(organization._id) },
      user: { _id: userId },
      body: { documentType: "OTHER" },
      file: { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "other.pdf" },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.value.message, /Only requested documents/);
  } finally {
    restoreOrg();
    restoreRole();
  }
});

test("admin audit exposes safe actor identity and consistent status/reason metadata", async () => {
  const previousFind = models.OrganizationAuditLog.find;
  models.OrganizationAuditLog.find = () => ({
    sort() { return this; },
    limit() { return this; },
    populate() { return { lean: async () => [{ action: "ORGANIZATION_REJECTED", actor: { _id: userId, fullName: "Ada Admin", email: "ada@example.com" }, metadata: { status: "REJECTED", reason: "Missing evidence" } }] }; },
  });
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } };
  try {
    await controller.adminAudit({ params: { id: new mongoose.Types.ObjectId() }, user: { role: "HEAD_OFFICE" } }, response);
    assert.deepEqual(response.value.audit[0].actor, { _id: userId, fullName: "Ada Admin", email: "ada@example.com" });
    assert.equal(response.value.audit[0].status, "REJECTED");
    assert.equal(response.value.audit[0].reason, "Missing evidence");
  } finally {
    models.OrganizationAuditLog.find = previousFind;
  }
});

test("document preview requires owner or admin authorization and never returns storage key", async () => {
  const organization = makeOrg();
  const restoreOrg = patchStatic(models.Organization, "findById", () => ({ select: async () => organization }));
  const previousPrivateDownloadUrl = cloudinary.utils.private_download_url;
  const previousEnv = { CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET };
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  cloudinary.utils.private_download_url = () => "https://signed.example/document";
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } });
  try {
    const ownerResponse = response();
    await controller.organizationDocumentView({ params: { organizationId: String(organization._id), documentId: String(organization.documents[0]._id) }, user: { _id: userId } }, ownerResponse);
    assert.equal(ownerResponse.statusCode, 200);
    assert.equal(ownerResponse.value.document.storageKey, undefined);
    const deniedResponse = response();
    await controller.organizationDocumentView({ params: { organizationId: String(organization._id), documentId: String(organization.documents[0]._id) }, user: { _id: otherUserId, role: "CUSTOMER" } }, deniedResponse);
    assert.equal(deniedResponse.statusCode, 403);
    const adminResponse = response();
    await controller.organizationDocumentView({ params: { organizationId: String(organization._id), documentId: String(organization.documents[0]._id) }, user: { _id: otherUserId, role: "HEAD_OFFICE" } }, adminResponse);
    assert.equal(adminResponse.statusCode, 200);
    assert.equal(adminResponse.value.document.url, "https://signed.example/document");
    cloudinary.utils.private_download_url = () => "";
    const unavailableResponse = response();
    await controller.organizationDocumentView({ params: { organizationId: String(organization._id), documentId: String(organization.documents[0]._id) }, user: { _id: userId } }, unavailableResponse);
    assert.equal(unavailableResponse.statusCode, 503);
  } finally {
    cloudinary.utils.private_download_url = previousPrivateDownloadUrl;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restoreOrg();
  }
});

test("more-information document replacement rejects an unrequested type before storage", async () => {
  const organization = makeOrg({ status: "MORE_INFORMATION_REQUIRED", requestedInformation: { reason: "Address", fields: [], documents: ["PROOF_OF_ADDRESS"] } });
  const restoreOrg = patchStatic(models.Organization, "findOne", () => query(organization));
  const restoreRole = patchStatic(models.OrganizationRole, "findOne", async () => ({ role: "OWNER" }));
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return value; } };
  try {
    await controller.organizationDocumentUpload({
      params: { organizationId: String(organization._id) },
      user: { _id: userId },
      body: { documentType: "OTHER" },
      file: { buffer: Buffer.from("%PDF-1.7"), mimetype: "application/pdf", originalname: "other.pdf" },
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.value.message, /requested documents/);
  } finally { restoreOrg(); restoreRole(); }
});