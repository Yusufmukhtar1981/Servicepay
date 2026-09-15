const { uploadOne, validateFile, createDocumentPublicId, destroyOne, buildSignedUrl, MAX_DOCUMENT_BYTES } = require("./amanaDocument.service");
const mongoose = require("mongoose");
const OrganizationDocumentCleanup = require("../models/organizationDocumentCleanup.model");
const { Organization } = require("../models/organizations.models");

const allowedDocumentTypes = new Set([
  "CERTIFICATE_OF_INCORPORATION",
  "REGISTRATION_CERTIFICATE",
  "GOVERNING_DOCUMENT",
  "TAX_REGISTRATION",
  "PROOF_OF_ADDRESS",
  "IDENTITY_DOCUMENT",
  "OTHER",
]);

const normalizeDocumentType = (value) => {
  const type = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return allowedDocumentTypes.has(type) ? type : "";
};

const uploadOrganizationDocument = async (file, organizationId, metadata = {}) => {
  const documentType = normalizeDocumentType(metadata.documentType);
  if (!documentType) {
    const error = new Error("Invalid organization document type.");
    error.code = "INVALID_DOCUMENT_TYPE";
    error.status = 400;
    throw error;
  }
  validateFile(file);
  const folder = `servicepay/organizations/${organizationId}`;
  const publicId = createDocumentPublicId(folder);
  const provisionalDocument = {
    storageKey: publicId,
    mimeType: String(file?.mimetype || "").toLowerCase(),
  };
  await enqueueDocumentAssetCleanup(organizationId, provisionalDocument, { kind: "PROVISIONAL" });
  let stored;
  try {
    stored = await uploadOne(file, folder, {
      publicId,
      uploadedBy: metadata.uploadedBy,
      requestReference: String(organizationId),
    });
  } catch (error) {
    await releaseDocumentAssetCleanup(organizationId, provisionalDocument, {
      kind: "PROVISIONAL",
      errorCategory: "upload-failed",
    }).catch(() => {});
    setImmediate(() => {
      processDocumentAssetCleanup({ limit: 5 }).catch(() => {});
    });
    throw error;
  }
  if (stored.assetId !== publicId) {
    const error = Object.assign(new Error("Document storage returned an unexpected asset identifier."), {
      code: "STORAGE_UPLOAD_MISMATCH",
    });
    await releaseDocumentAssetCleanup(organizationId, provisionalDocument, {
      kind: "PROVISIONAL",
      errorCategory: "upload-identifier-mismatch",
    }).catch(() => {});
    setImmediate(() => {
      processDocumentAssetCleanup({ limit: 5 }).catch(() => {});
    });
    throw error;
  }
  return {
    name: String(metadata.name || file.originalname || documentType).slice(0, 180),
    documentType,
    originalName: String(file.originalname || documentType).slice(0, 180),
    storageKey: stored.assetId,
    mimeType: stored.mimeType,
    size: file.buffer.length,
    uploadedBy: metadata.uploadedBy,
    uploadedAt: new Date(),
  };
};

const signedDocumentUrl = (document) => buildSignedUrl({
  assetId: document?.storageKey,
  resourceType: document?.mimeType === "application/pdf" ? "raw" : "image",
  format: document?.mimeType === "application/pdf"
    ? "pdf"
    : document?.mimeType === "image/png" ? "png" : "jpg",
});

const deleteOrganizationDocumentAsset = (document) => destroyOne({
  assetId: document?.storageKey,
  resourceType: document?.mimeType === "application/pdf" ? "raw" : "image",
});

const CLEANUP_LEASE_MS = 60 * 1000;
const PROVISIONAL_LEASE_MS = 5 * 60 * 1000;
const CLEANUP_RETRY_BASE_MS = 15 * 1000;
const CLEANUP_RETRY_MAX_MS = 60 * 60 * 1000;

const cleanupResourceType = (document) => document?.mimeType === "application/pdf" ? "raw" : "image";

const cleanupFilter = (organizationId, document, kind = "RETIREMENT") => ({
  organization: organizationId,
  assetId: String(document?.storageKey || ""),
  resourceType: cleanupResourceType(document),
  kind,
});

const enqueueDocumentAssetCleanup = async (organizationId, document, { kind = "RETIREMENT" } = {}) => {
  const filter = cleanupFilter(organizationId, document, kind);
  if (!filter.organization || !filter.assetId) return null;
  const now = new Date();
  const provisionalLeaseUntil = new Date(now.getTime() + PROVISIONAL_LEASE_MS);
  const initialState = kind === "PROVISIONAL"
    ? {
      status: "PROCESSING",
      attempts: 0,
      nextAttemptAt: provisionalLeaseUntil,
      leaseUntil: provisionalLeaseUntil,
    }
    : {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
    };
  return OrganizationDocumentCleanup.findOneAndUpdate(
    filter,
    {
      $setOnInsert: {
        ...filter,
        ...initialState,
        lastErrorCategory: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const releaseDocumentAssetCleanup = async (organizationId, document, { kind = "PROVISIONAL", errorCategory = null } = {}) => {
  const filter = cleanupFilter(organizationId, document, kind);
  if (!filter.organization || !filter.assetId) return null;
  return OrganizationDocumentCleanup.findOneAndUpdate(
    filter,
    {
      $set: {
        status: "PENDING",
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastErrorCategory: errorCategory,
      },
    },
    { new: true },
  );
};

const cleanupBackoff = (attempts) => {
  const multiplier = Math.min(Math.max(Number(attempts || 1) - 1, 0), 8);
  return Math.min(CLEANUP_RETRY_MAX_MS, CLEANUP_RETRY_BASE_MS * (2 ** multiplier));
};

const isTerminalDestroyResult = (result) => {
  const value = String(result?.result || "").toLowerCase();
  return value === "ok" || value === "not found";
};

const processDocumentAssetCleanup = async ({
  limit = 10,
  now = new Date(),
  cleanupModel = OrganizationDocumentCleanup,
  organizationModel = Organization,
  destroyAsset = destroyOne,
  skipConnectionCheck = false,
} = {}) => {
  if (!skipConnectionCheck && mongoose.connection.readyState !== 1) return { processed: 0, completed: 0, deferred: 0, failed: 0 };
  const boundedLimit = Math.max(1, Math.min(Number(limit) || 1, 25));
  const summary = { processed: 0, completed: 0, deferred: 0, failed: 0 };
  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = cleanupModel.findOneAndUpdate(
      {
        $or: [
          { status: "PENDING", nextAttemptAt: { $lte: now } },
          { status: "PROCESSING", leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: "PROCESSING",
          leaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS),
        },
        $inc: { attempts: 1 },
      },
      {
        sort: { nextAttemptAt: 1, createdAt: 1 },
        new: true,
      },
    );
    const item = await (typeof claim?.lean === "function" ? claim.lean() : claim);
    if (!item) break;
    summary.processed += 1;
    let referenced;
    try {
      referenced = await organizationModel.exists({
        "documents.storageKey": item.assetId,
      });
    } catch {
      await cleanupModel.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "PENDING",
            nextAttemptAt: new Date(now.getTime() + cleanupBackoff(item.attempts)),
            leaseUntil: null,
            lastErrorCategory: "reference-check-failed",
          },
        },
      );
      summary.failed += 1;
      continue;
    }
    if (referenced) {
      if (item.kind === "PROVISIONAL") {
        await cleanupModel.deleteOne({ _id: item._id });
        summary.completed += 1;
        continue;
      }
      await cleanupModel.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "PENDING",
            nextAttemptAt: new Date(now.getTime() + CLEANUP_RETRY_BASE_MS),
            leaseUntil: null,
            lastErrorCategory: "asset-still-referenced",
          },
        },
      );
      summary.deferred += 1;
      continue;
    }
    try {
      const result = await destroyAsset({ assetId: item.assetId, resourceType: item.resourceType });
      if (!isTerminalDestroyResult(result)) throw Object.assign(new Error("non-terminal asset deletion result"), { code: "NON_TERMINAL_DESTROY" });
      await cleanupModel.deleteOne({ _id: item._id });
      summary.completed += 1;
    } catch (error) {
      const attempts = Number(item.attempts || 1);
      await cleanupModel.updateOne(
        { _id: item._id },
        {
          $set: {
            status: "PENDING",
            nextAttemptAt: new Date(now.getTime() + cleanupBackoff(attempts)),
            leaseUntil: null,
            lastErrorCategory: error?.code === "NON_TERMINAL_DESTROY" ? "non-terminal-destroy" : "destroy-failed",
          },
        },
      );
      summary.failed += 1;
    }
  }
  return summary;
};

const compensateUploadedAsset = async (organizationId, document, { organizationModel = Organization } = {}) => {
  if (!document?.storageKey) return;
  try {
    if (await organizationModel.exists({ "documents.storageKey": document.storageKey })) {
      await OrganizationDocumentCleanup.deleteOne(cleanupFilter(organizationId, document, "PROVISIONAL"));
      return;
    }
  } catch {
    await releaseDocumentAssetCleanup(organizationId, document, {
      kind: "PROVISIONAL",
      errorCategory: "ambiguous-reference",
    });
    return;
  }
  try {
    const result = await deleteOrganizationDocumentAsset(document);
    if (isTerminalDestroyResult(result)) {
      await OrganizationDocumentCleanup.deleteOne({
        ...cleanupFilter(organizationId, document, "PROVISIONAL"),
      });
      return;
    }
  } catch {
    // Preserve the cleanup intent below when immediate compensation is unavailable.
  }
  await releaseDocumentAssetCleanup(organizationId, document, {
    kind: "PROVISIONAL",
    errorCategory: "compensation-failed",
  });
};

const persistOrganizationDocument = async (organization, document, { organizationModel = Organization } = {}) => {
  const replaced = (organization.documents || []).find((item) => item.documentType === document.documentType);
  if (replaced?.storageKey && replaced.storageKey !== document.storageKey) {
    // Create this intent before changing the document array. A process crash
    // between persistence and the processor cannot lose the old asset key.
    try {
      await enqueueDocumentAssetCleanup(organization._id, replaced, { kind: "RETIREMENT" });
    } catch (error) {
      await compensateUploadedAsset(organization._id, document, { organizationModel });
      throw error;
    }
  }
  organization.documents = (organization.documents || []).filter((item) => item.documentType !== document.documentType);
  organization.documents.push(document);
  try {
    await organization.save();
  } catch (error) {
    await compensateUploadedAsset(organization._id, document, { organizationModel });
    throw error;
  }
  try {
    await OrganizationDocumentCleanup.deleteOne(cleanupFilter(organization._id, document, "PROVISIONAL"));
  } catch {
    // The processor will resolve the referenced provisional intent safely.
  }
  setImmediate(() => {
    processDocumentAssetCleanup({ limit: 5 }).catch(() => {});
  });
  return { organization, replaced };
};

module.exports = {
  allowedDocumentTypes,
  MAX_DOCUMENT_BYTES,
  normalizeDocumentType,
  uploadOrganizationDocument,
  deleteOrganizationDocumentAsset,
  enqueueDocumentAssetCleanup,
  processDocumentAssetCleanup,
  persistOrganizationDocument,
  compensateUploadedAsset,
  signedDocumentUrl,
};