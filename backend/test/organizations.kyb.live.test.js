/*
 * This test is deliberately opt-in.  It creates real, isolated records and
 * authenticated Cloudinary assets, so it must never run as part of the normal
 * backend suite.
 *
 * Required variables when RUN_LIVE_KYB_VERIFICATION=1:
 *   MONGODB_URI, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 *   CLOUDINARY_API_SECRET
 *
 * KYB_LIVE_BASE_URL defaults to the local API at http://127.0.0.1:3000.
 * The reviewer is created directly in the connected staging database and is
 * deleted by exact id in the finally block.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const models = require("../models/organizations.models");
const OrganizationDocumentCleanup = require("../models/organizationDocumentCleanup.model");
const documentService = require("../services/organizationDocument.service");
const User = require("../models/user.model");

const enabled = process.env.RUN_LIVE_KYB_VERIFICATION === "1";
const baseUrl = (
  process.env.KYB_LIVE_BASE_URL ||
  "http://127.0.0.1:3000"
).replace(/\/+$/, "");
const mongoUri = process.env.KYB_LIVE_MONGODB_URI || process.env.MONGODB_URI;

const organizationModels = [
  models.OrganizationRole,
  models.OrganizationMember,
  models.OrganizationBranch,
  models.OrganizationCustomField,
  models.OrganizationFee,
  models.OrganizationFeeAssignment,
  models.OrganizationPayment,
  models.OrganizationWallet,
  models.OrganizationLedger,
  models.OrganizationSettlementAccount,
  models.OrganizationWithdrawal,
  models.OrganizationTreasuryConfig,
  models.OrganizationWithdrawalSnapshot,
  models.OrganizationAnnouncement,
  models.OrganizationAuditLog,
  models.OrganizationMembershipCard,
];

const oid = (value) => String(value?._id || value?.id || value || "");
const randomDigits = (length) =>
  Array.from(crypto.randomBytes(length), (value) => String(value % 10)).join("");
const marker = enabled
  ? `live-kyb-${crypto.randomUUID()}-${crypto.randomBytes(16).toString("hex")}`
  : "live-kyb-disabled";
const markerEmail = `${marker.replace(/[^a-z0-9-]/gi, "")}@example.invalid`;
const ownerPhone = `080${randomDigits(8)}`;
const otherPhone = `081${randomDigits(8)}`;
const reviewerPhone = `082${randomDigits(8)}`;
const representativeNin = `1${randomDigits(10)}`;
const password = `LiveKYB-${crypto.randomBytes(18).toString("base64url")}9!`;
const reviewerPassword = `LiveHeadOffice-${crypto.randomBytes(18).toString("base64url")}9!`;
const reviewerEmail = `head-office-${marker.replace(/[^a-z0-9-]/gi, "")}@example.invalid`;
const transactionPin = "4826";

const pdfBytes = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
  "2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\ntrailer\n" +
  "<< /Root 1 0 R >>\n%%EOF\n",
  "ascii",
);
const jpegBytes = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgG" +
  "BgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAAB" +
  "AAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/" +
  "2gAIAQEAAD8AVN//2Q==",
  "base64",
);
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8A" +
  "AQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function request(path, options = {}) {
  const {
    token,
    method = "GET",
    json,
    form,
    headers: extraHeaders,
    expected,
    label = path,
  } = options;
  const headers = { ...(extraHeaders || {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (form) body = form;
  else if (json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(json);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (expected !== undefined) {
    const allowed = Array.isArray(expected) ? expected : [expected];
    assert.ok(
      allowed.includes(response.status),
      `${label} returned HTTP ${response.status}; expected ${allowed.join(", ")}`,
    );
  }
  return { response, payload, bytes: Buffer.from(text) };
}

function assertNoStorageKey(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertNoStorageKey);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.notEqual(key, "storageKey", "private storage key escaped the API");
    assertNoStorageKey(child);
  }
}

function assertDocumentSafe(document, { allowSignedUrl = false } = {}) {
  assert.ok(document?._id, "document id must be returned");
  assert.equal(document.storageKey, undefined);
  if (!allowSignedUrl) assert.equal(document.url, undefined);
}

function assertShortLivedAuthenticatedUrl(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.match(parsed.pathname, /\/(?:image|raw)\/download$/);
  assert.equal(parsed.searchParams.get("type"), "authenticated");
  assert.ok(parsed.searchParams.get("signature"), "signed URL must contain a signature");
  assert.ok(parsed.searchParams.get("api_key"), "signed URL must contain only the public API key");
  const expiresAt = Number(parsed.searchParams.get("expires_at"));
  const now = Math.floor(Date.now() / 1000);
  assert.ok(Number.isInteger(expiresAt) && expiresAt >= now + 240 && expiresAt <= now + 360, "signed URL must expire within five minutes");
  assert.doesNotMatch(value, /\/upload(?:\/|$)/);
}

async function registerCustomer(fullName, email, phone, nin) {
  const { payload } = await request("/api/auth/register", {
    method: "POST",
    json: {
      fullName,
      email,
      phone,
      password,
      nin,
      transactionPin,
      confirmTransactionPin: transactionPin,
      acceptTerms: true,
    },
    expected: 201,
    label: "isolated customer registration",
  });
  assert.equal(payload.success, true);
  assert.ok(payload.token);
  assert.ok(oid(payload.user));
  return { token: payload.token, userId: oid(payload.user) };
}

async function createAndLoginReviewer(userIds) {
  const reviewerRecord = await User.create({
    fullName: `Live KYB Head Office ${marker}`,
    phone: reviewerPhone,
    email: reviewerEmail,
    password: reviewerPassword,
    role: "HEAD_OFFICE",
    isStaff: true,
    status: "ACTIVE",
    activationPending: false,
    mustChangePassword: false,
  });
  assert.ok(reviewerRecord.password);
  assert.notEqual(reviewerRecord.password, reviewerPassword);
  const reviewerId = oid(reviewerRecord);
  userIds.push(reviewerId);

  const { payload } = await request("/api/auth/login", {
    method: "POST",
    json: { email: reviewerEmail, password: reviewerPassword },
    expected: 200,
    label: "staging reviewer login",
  });
  assert.equal(payload.success, true);
  assert.ok(payload.token);
  assert.ok(oid(payload.user));
  assert.equal(oid(payload.user), reviewerId);
  return {
    token: payload.token,
    userId: reviewerId,
    role: String(payload.user.role || "").toUpperCase(),
  };
}

async function upload(token, organizationId, documentType, name, bytes, mimeType, fileName) {
  const form = new FormData();
  form.append("documentType", documentType);
  form.append("name", name);
  form.append("document", new Blob([bytes], { type: mimeType }), fileName);
  const { payload } = await request(`/api/organizations/onboarding/${organizationId}/documents`, {
    method: "POST",
    token,
    form,
    expected: 200,
    label: `authenticated ${mimeType} upload`,
  });
  assert.equal(payload.success, true);
  assertDocumentSafe(payload.document);
  return payload.document;
}

async function organizationWithPrivateDocuments(organizationId) {
  return models.Organization.findById(organizationId)
    .select("+documents.storageKey")
    .lean();
}

async function rememberAssets(organizationId, assets) {
  const organization = await organizationWithPrivateDocuments(organizationId);
  for (const document of organization?.documents || []) {
    if (document.storageKey) {
      const resourceType = document.mimeType === "application/pdf" ? "raw" : "image";
      assets.set(String(document.storageKey), resourceType);
    }
  }
}

async function signedBytes(token, path, expectedBytes) {
  const { payload } = await request(path, {
    token,
    expected: 200,
    label: "signed document retrieval",
  });
  assertDocumentSafe(payload.document, { allowSignedUrl: true });
  assertShortLivedAuthenticatedUrl(payload.document.url);
  const signedResponse = await fetch(payload.document.url);
  assert.equal(signedResponse.status, 200);
  const bytes = Buffer.from(await signedResponse.arrayBuffer());
  assert.deepEqual(bytes, expectedBytes);
  return payload.document.url;
}

async function assertAssetDeleted(publicId, resourceType) {
  let found = false;
  try {
    await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: "authenticated",
    });
    found = true;
  } catch (error) {
    assert.ok(isCloudinaryNotFound(error), "Cloudinary did not confirm a 404/not-found result");
  }
  assert.equal(found, false, "replaced Cloudinary asset was not deleted");
}

async function drainDocumentCleanup(organizationId, { timeoutMs = 30000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await documentService.processDocumentAssetCleanup({ limit: 25 });
    const remaining = await OrganizationDocumentCleanup.countDocuments({ organization: organizationId });
    if (!remaining) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(
    await OrganizationDocumentCleanup.countDocuments({ organization: organizationId }),
    0,
    "document cleanup queue did not drain before asset verification",
  );
}

const isCloudinaryNotFound = (error) => {
  const codes = [
    error?.http_code,
    error?.statusCode,
    error?.status,
    error?.error?.http_code,
    error?.response?.status,
  ].map(Number);
  return codes.includes(404) || /(?:^|\b)(?:404|not[\s_-]*found)(?:\b|$)/i.test(String(error?.message || ""));
};

async function cleanup({ organizationId, userIds, assets }) {
  const cleanupErrors = [];
  if (organizationId && mongoose.connection.readyState === 1) {
    try {
      await rememberAssets(organizationId, assets);
    } catch (error) {
      cleanupErrors.push("mongo.organization.collect-assets");
    }
  }

  if (cloudinary.config().cloud_name) {
    for (const [publicId, resourceType] of assets) {
      try {
        const deletion = await cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
          type: "authenticated",
          invalidate: true,
        });
        const result = String(deletion?.result || "").toLowerCase();
        if (result && !["ok", "not found"].includes(result)) {
          cleanupErrors.push("cloudinary.destroy-unconfirmed");
        }
        try {
          await cloudinary.api.resource(publicId, {
            resource_type: resourceType,
            type: "authenticated",
          });
          cleanupErrors.push("cloudinary.asset-still-exists");
        } catch (error) {
          if (!isCloudinaryNotFound(error)) {
            cleanupErrors.push("cloudinary.verify-not-found");
          }
        }
      } catch {
        cleanupErrors.push("cloudinary.destroy");
      }
    }
  }

  if (mongoose.connection.readyState === 1) {
    if (organizationId) {
      for (const model of organizationModels) {
        try {
          const rows = await model.find({ organization: organizationId }).select("_id").lean();
          const ids = rows.map((row) => row._id);
          if (ids.length) await model.deleteMany({ _id: { $in: ids } });
          if (ids.length && await model.countDocuments({ _id: { $in: ids } })) {
            cleanupErrors.push(`mongo.${model.modelName}.records-remain`);
          }
        } catch {
          cleanupErrors.push(`mongo.${model.modelName}.cleanup`);
        }
      }
      try {
        await models.Organization.deleteOne({ _id: organizationId });
        if (await models.Organization.countDocuments({ _id: organizationId })) {
          cleanupErrors.push("mongo.Organization.records-remain");
        }
      } catch {
        cleanupErrors.push("mongo.Organization.cleanup");
      }
    }

    const exactUserIds = [...new Set(userIds.filter(Boolean))];
    if (exactUserIds.length) {
      try {
        await User.deleteMany({ _id: { $in: exactUserIds } });
        if (await User.countDocuments({ _id: { $in: exactUserIds } })) {
          cleanupErrors.push("mongo.User.records-remain");
        }
      } catch {
        cleanupErrors.push("mongo.User.cleanup");
      }
    }
    if (organizationId) {
      try {
        await documentService.processDocumentAssetCleanup({ limit: 25 });
        if (await OrganizationDocumentCleanup.countDocuments({ organization: organizationId })) {
          cleanupErrors.push("mongo.OrganizationDocumentCleanup.records-remain");
        }
      } catch {
        cleanupErrors.push("mongo.OrganizationDocumentCleanup.cleanup");
      }
    }
  }
  return cleanupErrors;
}

test(
  "live gated Organization KYB staging verification",
  { skip: !enabled, timeout: 180_000 },
  async () => {
    const parsedBaseUrl = new URL(baseUrl);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname),
      "live KYB verification is restricted to the local staging API",
    );
    assert.equal(parsedBaseUrl.protocol, "http:", "live KYB verification must not target HTTPS/production");
    assert.ok(mongoUri, "MONGODB_URI is required for exact cleanup verification");
    assert.ok(process.env.CLOUDINARY_CLOUD_NAME, "CLOUDINARY_CLOUD_NAME is required");
    assert.ok(process.env.CLOUDINARY_API_KEY, "CLOUDINARY_API_KEY is required");
    assert.ok(process.env.CLOUDINARY_API_SECRET, "CLOUDINARY_API_SECRET is required");

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    await mongoose.connect(mongoUri);

    const userIds = [];
    const assets = new Map();
    let organizationId = "";
    try {
      const reviewer = await createAndLoginReviewer(userIds);
      assert.ok(
        ["HEAD_OFFICE", "HEAD_OFFICE_ADMIN", "SUPER_ADMIN", "ADMIN"].includes(reviewer.role),
        "reviewer must be a Head Office/platform reviewer",
      );
      const owner = await registerCustomer(
        `Live KYB Owner ${marker}`,
        markerEmail,
        ownerPhone,
        representativeNin,
      );
      userIds.push(owner.userId);
      const unrelated = await registerCustomer(
        `Live KYB Unrelated ${marker}`,
        `unrelated-${marker.replace(/[^a-z0-9-]/gi, "")}@example.invalid`,
        otherPhone,
        `2${randomDigits(10)}`,
      );
      userIds.push(unrelated.userId);

      const created = await request("/api/organizations/onboarding", {
        method: "POST",
        token: owner.token,
        json: { name: `Live KYB ${marker}` },
        expected: 201,
        label: "isolated organization creation",
      });
      assert.equal(created.payload.success, true);
      organizationId = oid(created.payload.organization);
      assert.ok(organizationId);
      assertNoStorageKey(created.payload);
      assert.equal(created.payload.organization.status, "DRAFT");

      const fiveStepPayload = [
        {
          name: `Live KYB ${marker}`,
          organizationType: "COMPANY",
          type: "COMPANY",
          registrationStatus: "REGISTERED",
          registrationNumber: `RC${marker.replace(/[^a-z0-9]/gi, "").slice(-12).toUpperCase()}`,
          dateEstablished: "2020-01-01",
        },
        {
          description: `Isolated staging verification ${marker}`,
          industry: "Technology",
          organizationEmail: `organization-${marker.replace(/[^a-z0-9]/gi, "")}@example.invalid`,
          organizationPhone: `070${randomDigits(8)}`,
          website: "https://servicepay.ng",
        },
        {
          officeAddress: {
            address: "1 Staging Verification Road",
            state: "Lagos",
            lga: "Ikeja",
            city: "Ikeja",
          },
        },
        {
          representative: {
            fullName: `Live KYB Representative ${marker}`,
            role: "Director",
            phone: `070${randomDigits(8)}`,
            email: `representative-${marker.replace(/[^a-z0-9]/gi, "")}@example.invalid`,
            nin: representativeNin,
            residentialAddress: { address: "2 Staging Home Road", city: "Ikeja" },
          },
        },
      ];

      for (const [index, step] of fiveStepPayload.entries()) {
        const patched = await request(`/api/organizations/onboarding/${organizationId}`, {
          method: "PATCH",
          token: owner.token,
          json: step,
          expected: 200,
          label: `KYB draft step ${index + 1}`,
        });
        assert.equal(patched.payload.success, true);
        assertNoStorageKey(patched.payload);
        const persisted = await request(`/api/organizations/onboarding/${organizationId}`, {
          token: owner.token,
          expected: 200,
          label: `KYB draft persistence step ${index + 1}`,
        });
        assert.equal(persisted.payload.organization.status, "DRAFT");
      }

      const invalidLocation = await request(`/api/organizations/onboarding/${organizationId}`, {
        method: "PATCH",
        token: owner.token,
        json: { officeAddress: { address: "1 Staging Verification Road", state: "Lagos", lga: "Kano Municipal", city: "Ikeja" } },
        expected: 400,
        label: "State/LGA validation",
      });
      assert.match(String(invalidLocation.payload.message), /LGA|state/i);

      const draft = await request(`/api/organizations/onboarding/${organizationId}`, {
        token: owner.token,
        expected: 200,
        label: "complete KYB draft",
      });
      assert.equal(draft.payload.requiredDocuments.length, 1);
      assert.deepEqual(draft.payload.requiredDocuments, ["CERTIFICATE_OF_INCORPORATION"]);
      assert.equal(draft.payload.organization.officeAddress.lga, "Ikeja");

      const certificate = await upload(owner.token, organizationId, "CERTIFICATE_OF_INCORPORATION", "Certificate", pdfBytes, "application/pdf", "certificate.pdf");
      await rememberAssets(organizationId, assets);
      const proof = await upload(owner.token, organizationId, "PROOF_OF_ADDRESS", "Proof", pdfBytes, "application/pdf", "proof.pdf");
      await rememberAssets(organizationId, assets);
      const identity = await upload(owner.token, organizationId, "IDENTITY_DOCUMENT", "Identity", jpegBytes, "image/jpeg", "identity.jpg");
      await rememberAssets(organizationId, assets);
      const other = await upload(owner.token, organizationId, "OTHER", "Other", pngBytes, "image/png", "other.png");
      await rememberAssets(organizationId, assets);
      for (const document of [certificate, proof, identity, other]) assertDocumentSafe(document);

      // Exercise a crash-style retry with an isolated provisional asset:
      // Cloudinary is removed before the stale intent is claimed, so the
      // processor must treat its not-found result as terminal.
      const isolated = await documentService.uploadOrganizationDocument(
        { buffer: pdfBytes, mimetype: "application/pdf", originalname: "isolated-retry.pdf" },
        organizationId,
        { documentType: "OTHER", name: "isolated cleanup retry" },
      );
      const isolatedFilter = {
        organization: organizationId,
        assetId: isolated.storageKey,
        resourceType: "raw",
        kind: "PROVISIONAL",
      };
      await OrganizationDocumentCleanup.updateOne(
        isolatedFilter,
        { $set: { status: "PROCESSING", leaseUntil: new Date(0) } },
      );
      await cloudinary.uploader.destroy(isolated.storageKey, {
        resource_type: "raw",
        type: "authenticated",
        invalidate: true,
      });
      await drainDocumentCleanup(organizationId);
      assert.equal(await OrganizationDocumentCleanup.countDocuments(isolatedFilter), 0);

      const beforeReplacement = await organizationWithPrivateDocuments(organizationId);
      const oldCertificate = beforeReplacement.documents.find((document) => document.documentType === "CERTIFICATE_OF_INCORPORATION");
      assert.ok(oldCertificate?.storageKey);
      assets.set(String(oldCertificate.storageKey), "raw");
      const replacement = await upload(owner.token, organizationId, "CERTIFICATE_OF_INCORPORATION", "Certificate replacement", pdfBytes, "application/pdf", "certificate-replacement.pdf");
      assert.notEqual(oid(replacement), oid(certificate));
      // Upload persistence schedules an opportunistic processor pass. Drain
      // the queue after that pass as well, rather than racing its lease claim
      // and asserting while its Cloudinary destroy is still in flight.
      await drainDocumentCleanup(organizationId);
      await assertAssetDeleted(String(oldCertificate.storageKey), "raw");
      await rememberAssets(organizationId, assets);

      const submissionKey = `submission-${marker}`;
      const missingRequired = await request(`/api/organizations/onboarding/${organizationId}/submit`, {
        method: "POST",
        token: owner.token,
        json: { declaration: true },
        headers: { "X-Idempotency-Key": submissionKey },
        expected: 200,
        label: "KYB submission",
      });
      assert.equal(missingRequired.payload.duplicate, false);
      assert.equal(missingRequired.payload.organization.status, "PENDING_REVIEW");
      assert.ok(missingRequired.payload.organization.submittedAt);
      assert.ok(missingRequired.payload.submission.organizationReference);
      assertNoStorageKey(missingRequired.payload);
      // Repeating the exact request is idempotent, while a different key is
      // a conflict while the first submission is in review.
      const idempotent = await request(`/api/organizations/onboarding/${organizationId}/submit`, {
        method: "POST",
        token: owner.token,
        json: { declaration: true },
        headers: { "X-Idempotency-Key": submissionKey },
        expected: 200,
        label: "duplicate submission idempotency",
      });
      assert.equal(idempotent.payload.duplicate, true);
      assert.equal(idempotent.payload.submission.organizationReference, missingRequired.payload.submission.organizationReference);

      const differentKeyConflict = await request(`/api/organizations/onboarding/${organizationId}/submit`, {
        method: "POST",
        token: owner.token,
        json: { declaration: true },
        headers: { "X-Idempotency-Key": `${submissionKey}-different` },
        expected: 409,
        label: "different submission key",
      });
      assert.match(String(differentKeyConflict.payload.message), /different submission|review/i);

      const ownerDocument = await request(`/api/organizations/onboarding/${organizationId}/documents/${oid(replacement)}`, {
        token: owner.token,
        expected: 200,
        label: "owner document access",
      });
      assertDocumentSafe(ownerDocument.payload.document, { allowSignedUrl: true });
      assertShortLivedAuthenticatedUrl(ownerDocument.payload.document.url);
      const signedUrl = await signedBytes(
        owner.token,
        `/api/organizations/onboarding/${organizationId}/documents/${oid(replacement)}/preview`,
        pdfBytes,
      );
      assert.match(signedUrl, /^https:\/\//);
      await signedBytes(
        owner.token,
        `/api/organizations/onboarding/${organizationId}/documents/${oid(replacement)}/download`,
        pdfBytes,
      );

      const denied = await request(`/api/organizations/onboarding/${organizationId}/documents/${oid(replacement)}`, {
        token: unrelated.token,
        expected: 403,
        label: "unrelated user document denial",
      });
      assert.match(String(denied.payload.message), /access denied/i);

      const started = await request(`/api/admin/organizations/${organizationId}/start-review`, {
        method: "POST",
        token: reviewer.token,
        json: {},
        expected: 200,
        label: "Under Review transition",
      });
      assert.equal(started.payload.organization.status, "UNDER_REVIEW");

      const moreInformationReason = `Exact remediation required for ${marker}`;
      const moreInformation = await request(`/api/admin/organizations/${organizationId}/more-information`, {
        method: "POST",
        token: reviewer.token,
        json: {
          reason: moreInformationReason,
          fields: ["industry"],
          documents: ["PROOF_OF_ADDRESS"],
        },
        expected: 200,
        label: "More Information Required transition",
      });
      assert.equal(moreInformation.payload.organization.status, "MORE_INFORMATION_REQUIRED");
      assert.equal(moreInformation.payload.organization.requestedInformation.reason, moreInformationReason);
      assert.deepEqual(moreInformation.payload.organization.requestedInformation.fields, ["industry"]);
      assert.deepEqual(moreInformation.payload.organization.requestedInformation.documents, ["PROOF_OF_ADDRESS"]);

      const forbiddenRemediation = await request(`/api/organizations/onboarding/${organizationId}`, {
        method: "PATCH",
        token: owner.token,
        json: { description: "not an exact remediation field" },
        expected: 400,
        label: "exact remediation field enforcement",
      });
      assert.match(String(forbiddenRemediation.payload.message), /requested information/i);
      const updated = await request(`/api/organizations/onboarding/${organizationId}`, {
        method: "PATCH",
        token: owner.token,
        json: { industry: "Financial Technology" },
        expected: 200,
        label: "requested field remediation",
      });
      assert.equal(updated.payload.organization.industry, "Financial Technology");
      const proofReplacement = await upload(owner.token, organizationId, "PROOF_OF_ADDRESS", "Proof replacement", pdfBytes, "application/pdf", "proof-replacement.pdf");
      await rememberAssets(organizationId, assets);
      assertDocumentSafe(proofReplacement);

      const resubmitted = await request(`/api/organizations/onboarding/${organizationId}/resubmit`, {
        method: "POST",
        token: owner.token,
        json: { declaration: true },
        expected: 200,
        label: "KYB resubmission",
      });
      assert.equal(resubmitted.payload.duplicate, false);
      assert.equal(resubmitted.payload.organization.status, "PENDING_REVIEW");
      assert.ok(resubmitted.payload.organization.submittedAt);

      const approved = await request(`/api/admin/organizations/${organizationId}/approve`, {
        method: "POST",
        token: reviewer.token,
        json: {},
        expected: 200,
        label: "Approved transition",
      });
      assert.equal(approved.payload.organization.status, "APPROVED");
      assert.ok(approved.payload.organization.reviewedAt);
      assert.ok(approved.payload.organization.approvedAt);
      assertNoStorageKey(approved.payload);

      const headOfficeProfile = await request(`/api/admin/organizations/${organizationId}`, {
        token: reviewer.token,
        expected: 200,
        label: "Head Office organization access",
      });
      assertNoStorageKey(headOfficeProfile.payload);
      for (const document of headOfficeProfile.payload.organization.documents || []) assertDocumentSafe(document);
      const adminDocument = await signedBytes(
        reviewer.token,
        `/api/admin/organizations/${organizationId}/documents/${oid(replacement)}/preview`,
        pdfBytes,
      );
      assert.match(adminDocument, /^https:\/\//);

      const ownerWallet = await request(`/api/organizations/${organizationId}/wallet`, {
        token: owner.token,
        expected: 200,
        label: "organization wallet access",
      });
      assert.equal(oid(ownerWallet.payload.wallet.organization), organizationId);

      const organization = await models.Organization.findById(organizationId).select("+documents.storageKey").lean();
      assert.equal(organization.status, "APPROVED");
      assert.equal(oid(organization.createdBy), owner.userId);
      assert.ok(organization.submittedAt);
      assert.ok(organization.reviewedAt);
      assert.ok(organization.approvedAt);
      assert.equal(oid(organization.reviewedBy), reviewer.userId);
      assert.equal(oid(organization.approvedBy), reviewer.userId);
      assert.ok(await models.OrganizationWallet.exists({ _id: ownerWallet.payload.wallet._id, organization: organizationId }));
      assert.ok(await models.OrganizationRole.exists({ organization: organizationId, user: owner.userId, role: "OWNER" }));

      const audit = await request(`/api/admin/organizations/${organizationId}/audit`, {
        token: reviewer.token,
        expected: 200,
        label: "organization audit chain",
      });
      assert.ok(Array.isArray(audit.payload.audit));
      const actions = new Set(audit.payload.audit.map((entry) => entry.action));
      for (const action of [
        "ORGANIZATION_CREATED",
        "ORGANIZATION_DOCUMENT_UPLOADED",
        "ORGANIZATION_SUBMITTED",
        "ORGANIZATION_UNDER_REVIEW",
        "ORGANIZATION_MORE_INFORMATION_REQUIRED",
        "ORGANIZATION_APPROVED",
      ]) assert.ok(actions.has(action), `audit action ${action} is missing`);
      const submissionAudits = audit.payload.audit.filter((entry) => entry.action === "ORGANIZATION_SUBMITTED");
      assert.ok(submissionAudits.length >= 2, "initial submission and resubmission must be audited");
      const explicitResubmissionAudits = audit.payload.audit.filter((entry) => /RESUBMIT/i.test(entry.action || ""));
      for (const entry of explicitResubmissionAudits) {
        assert.equal(oid(entry.actor), owner.userId);
      }
      for (const entry of audit.payload.audit) {
        assert.equal(oid(entry.organization), organizationId);
        assert.ok(entry.createdAt && !Number.isNaN(Date.parse(entry.createdAt)));
        if (entry.actor) assert.ok([owner.userId, reviewer.userId].includes(oid(entry.actor)));
      }
      const createdAudit = audit.payload.audit.find((entry) => entry.action === "ORGANIZATION_CREATED");
      const approvedAudit = audit.payload.audit.find((entry) => entry.action === "ORGANIZATION_APPROVED");
      assert.equal(oid(createdAudit.actor), owner.userId);
      assert.equal(oid(approvedAudit.actor), reviewer.userId);
    } finally {
      const cleanupErrors = await cleanup({ organizationId, userIds, assets });
      await mongoose.disconnect();
      if (cleanupErrors.length) {
        const categories = [...new Set(cleanupErrors)].sort().join(", ");
        throw new Error(`Live KYB cleanup verification failed (${cleanupErrors.length} issue(s)): ${categories}.`);
      }
    }
  },
);
