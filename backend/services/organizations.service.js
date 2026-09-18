const crypto = require("crypto");
const mongoose = require("mongoose");
const models = require("../models/organizations.models");
const User = require("../models/user.model");
const Wallet = require("../models/wallet.model");
const { postDebit } = require("./ledger.service");
const { authorizeTransaction, BIOMETRIC_OPERATIONS } = require("./biometric.service");
const { resolveState, isValidLga } = require("../data/nigeriaLocations");
const { normalizeDocumentType } = require("./organizationDocument.service");

const { Organization, OrganizationRole, OrganizationMember, OrganizationWallet, OrganizationLedger, OrganizationPayment, OrganizationAuditLog } = models;
const clean = (v, max = 200) => String(v || "").trim().slice(0, max);
const normalizeMoney = (value) => {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw Object.assign(
      new Error("Amount must be a positive NGN amount with at most two decimals."),
      { status: 400 }
    );
  }
  const minorUnits = Math.round(Number(raw) * 100);
  if (!Number.isSafeInteger(minorUnits) || minorUnits < 0 || minorUnits > 100000000000) {
    throw Object.assign(new Error("Amount is outside the supported NGN range."), {
      status: 400,
    });
  }
  return minorUnits / 100;
};
const slugify = (v) => clean(v, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
const makeCode = () => `ORG${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const actorId = (req) => String(req.user?._id || "");
const platform = (req) => [
  "SUPER_ADMIN",
  "SERVICEPAY_SUPER_ADMIN",
  "ADMIN",
  "HEAD_OFFICE",
  "HEAD_OFFICE_ADMIN",
].includes(String(req.user?.role || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_"));
const ORGANIZATION_PERMISSIONS = Object.freeze(["members.view", "members.create", "members.approve", "members.edit", "members.suspend", "payments.view", "payments.export", "fees.create", "fees.edit", "wallet.view", "wallet.withdraw", "treasury.approve", "treasury.accounts", "reports.view", "reports.export", "messages.send", "staff.manage", "branches.manage", "settings.manage", "audit.view", "cards.manage"]);
const ORGANIZATION_ROLE_CAPABILITIES = Object.freeze({
  OWNER: ORGANIZATION_PERMISSIONS,
  ADMIN: ORGANIZATION_PERMISSIONS.filter((p) => !["wallet.withdraw", "settings.manage"].includes(p)),
  TREASURER: ["payments.view", "payments.export", "fees.create", "fees.edit", "wallet.view", "wallet.withdraw", "treasury.approve", "treasury.accounts", "reports.view", "reports.export"],
  SECRETARY: ["members.view", "members.edit", "messages.send", "reports.view"],
  MEMBERSHIP_OFFICER: ["members.view", "members.create", "members.approve", "members.edit", "members.suspend", "cards.manage"],
  AUDITOR: ["payments.view", "payments.export", "reports.view", "reports.export", "audit.view"],
  BRANCH_ADMIN: ["members.view", "members.create", "members.edit", "payments.view", "reports.view"],
});
const normalizeOrganizationRole = (role) => String(role || "").toUpperCase().replace(/^ORGANIZATION_/, "");
const roleAllows = (role, permission, explicit = []) => { const defaults = ORGANIZATION_ROLE_CAPABILITIES[normalizeOrganizationRole(role)] || []; return defaults.includes(permission) && (!explicit?.length || explicit.includes(permission)); };
const resolveOrganizationRole = (roles, permission) => {
  if (!Array.isArray(roles) || roles.length !== 1) return null;
  const role = roles[0];
  return roleAllows(role.role, permission, role.permissions) ? role : null;
};
const KYB_TYPES = Object.freeze(["COMPANY", "NGO", "COOPERATIVE", "ASSOCIATION", "FOUNDATION", "CLUB", "SCHOOL", "RELIGIOUS", "GOVERNMENT", "COMMUNITY", "OTHER"]);
const KYB_STATUSES = Object.freeze(["DRAFT", "PENDING_REVIEW", "UNDER_REVIEW", "APPROVED", "REJECTED", "MORE_INFORMATION_REQUIRED", "SUSPENDED", "PENDING_VERIFICATION", "VERIFIED"]);
const KYB_FIELD_PATHS = new Set([
  "name", "organizationType", "registrationStatus", "registrationNumber", "dateEstablished", "description", "industry", "sector", "website", "organizationEmail", "organizationPhone",
  "officeAddress.address", "officeAddress.state", "officeAddress.lga", "officeAddress.city", "officeAddress.landmark",
  "representative.fullName", "representative.role", "representative.phone", "representative.email", "representative.nin",
  "representative.residentialAddress.address", "representative.residentialAddress.city",
]);
const KYB_FIELD_ALIASES = new Map([
  ["type", "organizationType"],
  ["sector", "industry"],
]);
const statusAlias = (status) => ({ PENDING_VERIFICATION: "PENDING_REVIEW", VERIFIED: "APPROVED" }[String(status || "").toUpperCase()] || String(status || "").toUpperCase());
const isOperationalStatus = (status) => ["VERIFIED", "APPROVED"].includes(String(status || "").toUpperCase());
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const phonePattern = /^\+?[0-9 ()-]{7,20}$/;
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => { result[key] = stableValue(value[key]); return result; }, {});
  return value;
};
const submissionRequestKey = (req, organization) => {
  const supplied = String(req.get?.("X-Idempotency-Key") || req.get?.("Idempotency-Key") || req.body?.submissionKey || "").trim();
  if (supplied) return supplied.slice(0, 200);
  return `body:${crypto.createHash("sha256").update(JSON.stringify(stableValue({
    organization: String(organization._id),
    declaration: req.body?.declaration,
    body: req.body || {},
  }))).digest("hex")}`;
};
const requiredDocumentsFor = (org) => {
  const type = String(org.organizationType || org.type || "").toUpperCase();
  const registered = String(org.registrationStatus || "").toUpperCase() === "REGISTERED";
  if (type === "COMPANY" && registered) return ["CERTIFICATE_OF_INCORPORATION"];
  if (["NGO", "COOPERATIVE", "ASSOCIATION", "FOUNDATION", "SCHOOL", "RELIGIOUS", "GOVERNMENT", "COMMUNITY"].includes(type)) return [registered ? "REGISTRATION_CERTIFICATE" : "GOVERNING_DOCUMENT"];
  return [];
};
const normalizeAddress = (value, required = false, residential = false) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (required) throw Object.assign(new Error("A structured office address is required."), { status: 400 });
    return undefined;
  }
  const address = {};
  const keys = residential ? ["address", "city"] : ["address", "state", "lga", "city", "landmark"];
  for (const key of keys) if (value[key] !== undefined) address[key] = clean(value[key], key === "address" ? 300 : 180);
  if (required && residential && (!address.address || !address.city)) {
    throw Object.assign(new Error("Representative residential address and city are required."), { status: 400 });
  }
  if (required && !residential && (!address.address || !address.state || !address.lga || !resolveState(address.state) || !isValidLga(address.state, address.lga))) {
    throw Object.assign(new Error("A valid Nigerian state and LGA are required for the office address."), { status: 400 });
  }
  if (!residential && ((address.state && !address.lga) || (!address.state && address.lga))) {
    throw Object.assign(new Error("State and LGA must be provided together."), { status: 400 });
  }
  if (address.state && address.lga && (!resolveState(address.state) || !isValidLga(address.state, address.lga))) {
    throw Object.assign(new Error("The selected LGA does not belong to the selected Nigerian state."), { status: 400 });
  }
  return address;
};
const normalizeKybInput = (input = {}, { submitting = false } = {}) => {
  const source = input || {};
  const type = String(source.organizationType || source.type || "").trim().toUpperCase();
  if (type && !KYB_TYPES.includes(type)) throw Object.assign(new Error("Invalid organization type."), { status: 400 });
  const registrationStatus = String(source.registrationStatus || "").trim().toUpperCase();
  if (registrationStatus && !["REGISTERED", "UNREGISTERED", "PENDING", "NOT_APPLICABLE"].includes(registrationStatus)) throw Object.assign(new Error("Invalid registration status."), { status: 400 });
  const result = {};
  if (type) { result.organizationType = type; result.type = type; }
  if (registrationStatus) result.registrationStatus = registrationStatus;
  if (source.name !== undefined) {
    result.name = clean(source.name, 180);
    if (!result.name) throw Object.assign(new Error("Organization name is required."), { status: 400 });
  }
  for (const key of ["description", "website"]) if (source[key] !== undefined) result[key] = clean(source[key], key === "description" ? 3000 : 300);
  const hasIndustry = source.industry !== undefined;
  const hasSector = source.sector !== undefined;
  const industry = hasIndustry ? clean(source.industry, 300) : "";
  const sector = hasSector ? clean(source.sector, 300) : "";
  if (submitting && industry && sector) throw Object.assign(new Error("Provide exactly one industry or sector value."), { status: 400 });
  if (hasIndustry || hasSector) result.industry = industry || sector;
  if (source.registrationNumber !== undefined) result.registrationNumber = clean(source.registrationNumber, 100);
  if (result.registrationNumber && !/^[A-Z0-9\-\/]+$/i.test(result.registrationNumber)) throw Object.assign(new Error("Registration number contains invalid characters."), { status: 400 });
  if (source.registrationNumber && registrationStatus === "UNREGISTERED") throw Object.assign(new Error("An unregistered organization cannot provide a registration number."), { status: 400 });
  if (registrationStatus === "REGISTERED" && submitting && !result.registrationNumber && !source.registrationNumber) throw Object.assign(new Error("Registration number is required for a registered organization."), { status: 400 });
  if (source.dateEstablished !== undefined) {
    const date = new Date(source.dateEstablished);
    if (Number.isNaN(date.getTime()) || date > new Date()) throw Object.assign(new Error("Date established must be a valid date in the past."), { status: 400 });
    result.dateEstablished = date;
  }
  for (const key of ["organizationEmail", "organizationPhone"]) if (source[key] !== undefined) result[key] = clean(source[key], key === "organizationEmail" ? 180 : 30);
  if (result.organizationEmail && !emailPattern.test(result.organizationEmail)) throw Object.assign(new Error("Organization email is invalid."), { status: 400 });
  if (result.organizationPhone && !phonePattern.test(result.organizationPhone)) throw Object.assign(new Error("Organization phone is invalid."), { status: 400 });
  if (result.website && !/^https?:\/\/[^\s]+$/i.test(result.website)) throw Object.assign(new Error("Website must be a valid HTTP or HTTPS URL."), { status: 400 });
  if (source.officeAddress !== undefined) result.officeAddress = normalizeAddress(source.officeAddress, submitting);
  if (source.representative !== undefined) {
    const rep = source.representative;
    if (!rep || typeof rep !== "object" || Array.isArray(rep)) throw Object.assign(new Error("Representative details are invalid."), { status: 400 });
    result.representative = {};
    for (const key of ["fullName", "role", "phone", "email", "nin"]) if (rep[key] !== undefined) result.representative[key] = clean(rep[key], key === "nin" ? 30 : 180);
    if (rep.residentialAddress !== undefined) result.representative.residentialAddress = normalizeAddress(rep.residentialAddress, submitting, true);
    if (result.representative.email && !emailPattern.test(result.representative.email)) throw Object.assign(new Error("Representative email is invalid."), { status: 400 });
    if (result.representative.phone && !phonePattern.test(result.representative.phone)) throw Object.assign(new Error("Representative phone is invalid."), { status: 400 });
    if (result.representative.nin && !/^\d{11}$/.test(result.representative.nin)) throw Object.assign(new Error("Representative NIN must contain 11 digits."), { status: 400 });
    if (submitting && (!result.representative.fullName || !result.representative.role || !result.representative.phone || !result.representative.email)) throw Object.assign(new Error("Complete representative details are required."), { status: 400 });
  }
  if (submitting) {
    if (!result.organizationType && !source.type) throw Object.assign(new Error("Organization type is required."), { status: 400 });
    if (!result.registrationStatus && !source.registrationStatus) throw Object.assign(new Error("Registration status is required."), { status: 400 });
    if (!source.officeAddress) throw Object.assign(new Error("Office address is required."), { status: 400 });
    if (!result.officeAddress?.city) throw Object.assign(new Error("Office city is required."), { status: 400 });
    if (!source.representative) throw Object.assign(new Error("Representative details are required."), { status: 400 });
    if (!result.representative?.nin) throw Object.assign(new Error("Representative NIN is required."), { status: 400 });
    if (!result.representative?.residentialAddress) throw Object.assign(new Error("Representative residential address is required."), { status: 400 });
    if (!result.description) throw Object.assign(new Error("Organization description is required."), { status: 400 });
    if (!result.industry && !result.sector) throw Object.assign(new Error("Organization industry or sector is required."), { status: 400 });
    if (result.industry && result.sector) throw Object.assign(new Error("Provide exactly one industry or sector value."), { status: 400 });
    if (!result.organizationEmail || !result.organizationPhone) throw Object.assign(new Error("Organization email and phone are required."), { status: 400 });
  }
  return result;
};
const inputLeafPaths = (value, prefix = "") => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  const paths = [];
  for (const key of Object.keys(value)) {
    if (["declaration", "submissionKey"].includes(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const child = value[key];
    if (child && typeof child === "object" && !Array.isArray(child)) paths.push(...inputLeafPaths(child, path));
    else paths.push(path);
  }
  return paths;
};
const safeOrganization = (organization, { includeDocuments = true } = {}) => {
  const value = typeof organization?.toObject === "function" ? organization.toObject() : { ...(organization || {}) };
  delete value.representative?.nin;
  if (includeDocuments && value.documents) {
    value.documents = value.documents.map((doc) => {
      const item = { ...doc };
      delete item.storageKey;
      return item;
    });
  } else {
    delete value.documents;
  }
  return value;
};

async function access(req, organizationId, roles = [], requireOperational = false) {
  if (!mongoose.isValidObjectId(organizationId)) return null;
  const organization = await Organization.findById(organizationId);
  if (!organization) return null;
  const matches = await OrganizationRole.find({ organization: organization._id, user: req.user._id, active: true, ...(roles.length ? { role: { $in: roles } } : {}) });
  if (matches.length > 1) return null;
  const role = matches[0];
   if (requireOperational && !isOperationalStatus(organization.status)) return null;
  if (role?.role === "BRANCH_ADMIN") {
    if (!role.branch) return null;
    const branch = await models.OrganizationBranch.findOne({ _id: role.branch, organization: organization._id, active: true });
    if (!branch) return null;
    req.organizationBranchId = branch._id;
  }
  return role ? organization : null;
}
async function requireOrganizationAccess(req, organizationId, permission, requireOperational = true) {
  if (!mongoose.isValidObjectId(organizationId)) return null;
  const organization = await Organization.findById(organizationId);
  if (!organization || (requireOperational && !isOperationalStatus(organization.status))) return null;
  const matches = await OrganizationRole.find({ organization: organization._id, user: req.user?._id, active: true });
  const role = resolveOrganizationRole(matches, permission);
  if (!role) return null;
  if (!role || !roleAllows(role.role, permission, role.permissions)) return null;
  if (normalizeOrganizationRole(role.role) === "BRANCH_ADMIN") {
    if (!role.branch || !await models.OrganizationBranch.findOne({ _id: role.branch, organization: organization._id, active: true })) return null;
    req.organizationBranchId = role.branch;
  }
  req.organizationAccess = { organization, role, permissions: ORGANIZATION_ROLE_CAPABILITIES[normalizeOrganizationRole(role.role)].filter((p) => !role.permissions?.length || role.permissions.includes(p)), branchScope: req.organizationBranchId || null };
  return organization;
}
const canOperateMember = (member, fee) => member?.status === "ACTIVE" || (member?.status === "PENDING" && fee?.type === "REGISTRATION");
const membershipNumber = (code, year, sequence) => `${code}/${year}/${String(sequence).padStart(5, "0")}`;
const duplicateKeyMessage = (error, fallback = "This organization membership request conflicts with an existing record.") => {
  if (error?.code !== 11000) return null;
  return Object.assign(new Error(fallback), { status: 409, code: "DUPLICATE_RESOURCE" });
};
const publicError = (error, duplicateFallback) =>
  duplicateKeyMessage(error, duplicateFallback) ||
  Object.assign(new Error(error?.status ? error.message : "Unable to complete organization request."), {
    status: error?.status || error?.statusCode || 500,
  });
async function audit(req, organization, action, entityType, entityId, metadata = {}, session) {
  const normalizedMetadata = { ...(metadata || {}) };
  if (normalizedMetadata.status === undefined && organization?.status) normalizedMetadata.status = organization.status;
  if (normalizedMetadata.reason === undefined) {
    const reason = normalizedMetadata.rejectionReason || organization?.reviewReason || organization?.rejectionReason;
    if (reason) normalizedMetadata.reason = reason;
  }
  const row = { organization: organization._id, actor: req.user?._id, action, entityType, entityId, metadata: normalizedMetadata, ip: req.ip };
  await OrganizationAuditLog.create([row], session ? { session } : undefined);
}
async function makeOrganization(req) {
  const name = clean(req.body?.name, 180);
  if (!name) throw Object.assign(new Error("Organization name is required."), { status: 400 });
  const slug = `${slugify(name)}-${crypto.randomBytes(2).toString("hex")}`;
  const session = await mongoose.startSession();
  let organization;
  try {
    await session.withTransaction(async () => {
      const normalizeOptionalMoney = (value) =>
        value === undefined || value === null || String(value).trim() === ""
          ? 0
          : normalizeMoney(value);
      const annualFee = normalizeOptionalMoney(req.body?.annualFee);
      const registrationFee = normalizeOptionalMoney(req.body?.registrationFee);
      const contact = req.body?.contact || {};
      if (typeof contact !== "object" || Array.isArray(contact) || (contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(contact.email))) || (contact.officialEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(contact.officialEmail))) || (contact.phone && !/^\+?[0-9 ()-]{7,20}$/.test(String(contact.phone)))) throw Object.assign(new Error("Official contact details are invalid."), { status: 400 });
      const logo = req.body?.logo && { url: clean(req.body.logo.url, 500), publicId: clean(req.body.logo.publicId, 200), mimeType: req.body.logo.mimeType, width: Number(req.body.logo.width), height: Number(req.body.logo.height) };
      if (logo && (!["image/png", "image/jpeg", "image/webp"].includes(logo.mimeType) || !logo.url || !/^https:\/\//.test(logo.url))) throw Object.assign(new Error("Logo must be a safe HTTPS image metadata object."), { status: 400 });
       const kyb = normalizeKybInput(req.body || {});
       const type = kyb.organizationType || clean(req.body?.type, 50).toUpperCase() || "ASSOCIATION";
       [organization] = await Organization.create([{ name, slug, code: makeCode(), ...kyb, type, description: kyb.description || clean(req.body?.description, 3000), registrationNumber: kyb.registrationNumber || clean(req.body?.registrationNumber, 100), contact: req.body?.contact || {}, country: clean(req.body?.country, 80) || "NG", state: clean(req.body?.state, 100), lga: clean(req.body?.lga, 100), annualFee, registrationFee, renewalCycle: ["ANNUAL", "MONTHLY", "NONE"].includes(req.body?.renewalCycle) ? req.body.renewalCycle : "ANNUAL", logo, createdBy: req.user._id, status: "DRAFT", membershipMode: req.body?.membershipMode === "AUTO" ? "AUTO" : "MANUAL", organizationReference: `SP-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}` }], { session });
      await OrganizationRole.create([{ organization: organization._id, user: req.user._id, role: "OWNER", assignedBy: req.user._id }], { session });
      await OrganizationWallet.create([{ organization: organization._id }], { session });
      await audit(req, organization, "ORGANIZATION_CREATED", "Organization", organization._id, {}, session);
    });
    return organization;
  } finally {
    await session.endSession();
  }
}

async function ownerOnboardingAccess(req, organizationId) {
  if (!mongoose.isValidObjectId(organizationId) || !req.user?._id) return null;
  const organization = await Organization.findOne({ _id: organizationId, createdBy: req.user._id }).select("+representative.nin +documents.storageKey +submissionRequestKey");
  if (!organization) return null;
  const owner = await OrganizationRole.findOne({ organization: organization._id, user: req.user._id, role: "OWNER", active: true });
  return owner ? organization : null;
}

async function updateOrganizationDraft(req, organizationId) {
  const organization = await ownerOnboardingAccess(req, organizationId);
  if (!organization) throw Object.assign(new Error("Organization access denied."), { status: 403 });
  if (!["DRAFT", "REJECTED", "MORE_INFORMATION_REQUIRED"].includes(organization.status)) {
    throw Object.assign(new Error("Organization cannot be edited in its current status."), { status: 409 });
  }
  const update = normalizeKybInput(req.body || {});
  for (const key of ["name", "organizationType", "type", "registrationStatus", "registrationNumber", "dateEstablished", "description", "industry", "organizationEmail", "organizationPhone", "website", "officeAddress", "representative"]) {
    if (update[key] === undefined) continue;
    if (key === "representative") organization.representative = { ...(organization.representative?.toObject?.() || organization.representative || {}), ...update[key] };
    else if (key === "officeAddress") organization.officeAddress = { ...(organization.officeAddress?.toObject?.() || organization.officeAddress || {}), ...update[key] };
    else organization[key] = update[key];
  }
  if (update.industry !== undefined) organization.sector = undefined;
  const currentIndustry = clean(organization.industry, 300);
  const currentSector = clean(organization.sector, 300);
  if (currentIndustry || currentSector) {
    organization.industry = currentIndustry || currentSector;
    organization.sector = undefined;
  }
  if (update.organizationType) organization.type = update.organizationType;
  if (req.body.contact !== undefined) organization.contact = req.body.contact;
  if (organization.status === "MORE_INFORMATION_REQUIRED") {
    const requestedFields = (organization.requestedInformation?.fields || [])
      .map((field) => KYB_FIELD_ALIASES.get(field) || field)
      .filter((field) => KYB_FIELD_PATHS.has(field));
    const allowed = new Set([...requestedFields, ...(organization.requestedInformation?.documents || [])]);
    for (const path of inputLeafPaths(req.body || {})) {
      const candidate = KYB_FIELD_ALIASES.get(path) || path;
      if (!allowed.has(candidate) && !allowed.has(path)) throw Object.assign(new Error(`Only requested information may be changed: ${path}.`), { status: 400 });
    }
  }
  await organization.save();
  await audit(req, organization, "ORGANIZATION_DRAFT_UPDATED", "Organization", organization._id, { fields: Object.keys(update) });
  return organization;
}

async function submitOrganization(req, organizationId) {
  const organization = await ownerOnboardingAccess(req, organizationId);
  if (!organization) throw Object.assign(new Error("Organization access denied."), { status: 403 });
  const requestKey = submissionRequestKey(req, organization);
  if (["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_VERIFICATION"].includes(organization.status)) {
    if (organization.submissionRequestKey === requestKey) return { organization, duplicate: true };
    throw Object.assign(new Error("A different submission is already being reviewed."), { status: 409, code: "SUBMISSION_CONFLICT" });
  }
  if (!["DRAFT", "REJECTED", "MORE_INFORMATION_REQUIRED"].includes(organization.status)) {
    throw Object.assign(new Error("Organization cannot be submitted in its current status."), { status: 409 });
  }
  const input = organization.toObject();
  const normalized = normalizeKybInput(input, { submitting: true });
  const declaration = req.body?.declaration === true || String(req.body?.declaration || "").toLowerCase() === "true";
  if (!declaration) throw Object.assign(new Error("The declaration is required before submission."), { status: 400 });
  const missing = requiredDocumentsFor(organization).filter((type) => !(organization.documents || []).some((doc) => String(doc.documentType).toUpperCase() === type));
  if (missing.length) throw Object.assign(new Error(`Required documents are missing: ${missing.join(", ")}.`), { status: 400, code: "MISSING_DOCUMENTS", missing });
  const submittedAt = organization.submittedAt || new Date();
  const set = {
    ...normalized,
    status: "PENDING_REVIEW",
    submittedAt,
    submissionRequestKey: requestKey,
    reviewReason: "",
    requestedInformation: { reason: "", fields: [], documents: [] },
  };
  const claimed = await Organization.findOneAndUpdate(
    { _id: organization._id, createdBy: req.user._id, status: organization.status },
    { $set: set },
    { new: true, runValidators: true },
  );
  if (!claimed) {
    const latest = await ownerOnboardingAccess(req, organizationId);
    if (latest && ["PENDING_REVIEW", "UNDER_REVIEW", "PENDING_VERIFICATION"].includes(latest.status) && latest.submissionRequestKey === requestKey) return { organization: latest, duplicate: true };
    throw Object.assign(new Error("Organization submission changed concurrently. Please reload and retry."), { status: 409, code: "SUBMISSION_CONFLICT" });
  }
  await audit(req, claimed, "ORGANIZATION_SUBMITTED", "Organization", claimed._id, { submittedAt });
  return { organization: claimed, duplicate: false };
}

async function reviewOrganization(req, organizationId, targetStatus, details = {}) {
  if (!mongoose.isValidObjectId(organizationId)) throw Object.assign(new Error("Invalid organization id."), { status: 400 });
  const organization = await Organization.findById(organizationId);
  if (!organization) throw Object.assign(new Error("Organization not found."), { status: 404 });
  const current = statusAlias(organization.status);
  const target = statusAlias(targetStatus);
  const graph = {
    PENDING_REVIEW: ["UNDER_REVIEW", "APPROVED", "REJECTED", "MORE_INFORMATION_REQUIRED"],
    UNDER_REVIEW: ["APPROVED", "REJECTED", "MORE_INFORMATION_REQUIRED"],
    APPROVED: ["SUSPENDED"],
    SUSPENDED: ["APPROVED"],
    REJECTED: ["PENDING_REVIEW"],
  };
  if (!graph[current]?.includes(target)) throw Object.assign(new Error("Invalid organization status transition."), { status: 409 });
  const reason = clean(details.reason || details.rejectionReason, 1000);
  if (["REJECTED", "MORE_INFORMATION_REQUIRED", "SUSPENDED"].includes(target) && !reason) throw Object.assign(new Error("A reason is required for this action."), { status: 400 });
  let requestedInformation;
  if (target === "MORE_INFORMATION_REQUIRED") {
    if (details.fields !== undefined && !Array.isArray(details.fields)) throw Object.assign(new Error("Requested fields must be an array."), { status: 400 });
    if (details.documents !== undefined && !Array.isArray(details.documents)) throw Object.assign(new Error("Requested documents must be an array."), { status: 400 });
    const fields = Array.isArray(details.fields)
      ? details.fields.map((v) => KYB_FIELD_ALIASES.get(clean(v, 100)) || clean(v, 100)).filter(Boolean)
      : [];
    const invalidFields = fields.filter((field) => !KYB_FIELD_PATHS.has(field));
    if (invalidFields.length) throw Object.assign(new Error(`Invalid requested field path: ${invalidFields[0]}.`), { status: 400 });
    const requestedDocuments = Array.isArray(details.documents) ? details.documents.map((v) => normalizeDocumentType(v)).filter(Boolean) : [];
    if (Array.isArray(details.documents) && requestedDocuments.length !== details.documents.length) throw Object.assign(new Error("Invalid requested document type."), { status: 400 });
    requestedInformation = { reason, fields: [...new Set(fields)].slice(0, 50), documents: [...new Set(requestedDocuments)].slice(0, 50) };
  }
  const before = organization.status;
  organization.status = target === "APPROVED" ? "APPROVED" : target;
  organization.reviewedAt = new Date();
  organization.reviewedBy = req.user._id;
  organization.reviewReason = reason;
  if (target === "APPROVED") { organization.approvedAt = organization.approvedAt || new Date(); organization.approvedBy = req.user._id; organization.rejectionReason = ""; }
  if (target === "REJECTED") organization.rejectionReason = reason;
  if (requestedInformation) organization.requestedInformation = requestedInformation;
  await organization.save();
  await audit(req, organization, `ORGANIZATION_${target}`, "Organization", organization._id, { before, status: target, reason: reason || undefined });
  return organization;
}
async function approveMember(req, member) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const org = await Organization.findById(member.organization).session(session);
       if (!org || !isOperationalStatus(org.status)) throw Object.assign(new Error("Organization is not verified."), { status: 409 });
      const current = await OrganizationMember.findOne({ _id: member._id, status: "PENDING" }).session(session);
      if (!current) throw Object.assign(new Error("Membership application is no longer pending."), { status: 409 });
      const validActive = current.status === "ACTIVE" && typeof current.membershipNumber === "string" && current.membershipNumber.trim();
      if (validActive) {
        await models.OrganizationMembershipCard.findOneAndUpdate(
          { member: current._id },
          { $setOnInsert: { organization: org._id, member: current._id, cardNumber: `${org.code}-${current.membershipNumber.replace(/\//g, "-")}`, active: true } },
          { upsert: true, new: true, session }
        );
        result = current;
        return;
      }
      if (current.status !== "PENDING") throw Object.assign(new Error("Membership application is no longer pending."), { status: 409 });
      const registration = await models.OrganizationFee.findOne({ organization: org._id, type: "REGISTRATION", active: true }).session(session);
      if (org.registrationFee > 0 && (!current.registrationPaidAt || !registration)) throw Object.assign(new Error("Registration fee must be paid before activation."), { status: 409 });
      const year = new Date().getFullYear();
      const updatedOrg = await Organization.findOneAndUpdate({ _id: org._id }, { $inc: { membershipNumberSequence: 1 } }, { new: true, session });
      if (current.status !== "ACTIVE") { current.year = year; current.membershipNumber = membershipNumber(org.code, year, updatedOrg.membershipNumberSequence); current.status = "ACTIVE"; current.approvedAt = new Date(); current.approvedBy = req.user._id; current.joinedAt = new Date(); }
      await current.save({ session });
      await models.OrganizationMembershipCard.findOneAndUpdate({ member: current._id }, { $setOnInsert: { organization: org._id, member: current._id, cardNumber: `${org.code}-${current.membershipNumber.replace(/\//g, "-")}`, active: true } }, { upsert: true, new: true, session });
      result = current;
      await audit(req, org, "MEMBERSHIP_APPROVED", "OrganizationMember", current._id, { membershipNumber: current.membershipNumber }, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
async function pay(req, assignment, member, amount, key) {
  amount = normalizeMoney(amount);
  const existing = await OrganizationPayment.findOne({ organization: member.organization, assignment: assignment._id, payer: req.user._id, idempotencyKey: key });
  if (existing) return { payment: existing, duplicate: true };
  const conflicting = await OrganizationPayment.findOne({ payer: req.user._id, idempotencyKey: key });
  if (conflicting) throw Object.assign(new Error("Idempotency key is already used for another payment."), { status: 409 });
  const session = await mongoose.startSession();
  try {
    await authorizeTransaction({ userId: req.user._id, body: req.body, operation: BIOMETRIC_OPERATIONS.ORGANIZATION_PAYMENT, idempotencyKey: key });
    let payment;
    await session.withTransaction(async () => {
      const claimed = await models.OrganizationFeeAssignment.findOneAndUpdate({ _id: assignment._id, status: { $in: ["ASSIGNED", "PARTIAL"] }, amount }, { $set: { status: "PAID" } }, { new: true, session });
      if (!claimed) throw Object.assign(new Error("This fee has already been paid or is no longer payable."), { status: 409 });
      const currentMember = await OrganizationMember.findOne({ _id: member._id, organization: member.organization, status: { $in: ["ACTIVE", "PENDING"] } }).session(session);
      const fee = await models.OrganizationFee.findById(claimed.fee).session(session);
       const verifiedOrg = await Organization.findOne({ _id: member.organization, status: { $in: ["VERIFIED", "APPROVED"] } }).session(session);
      if (!verifiedOrg || !currentMember || !canOperateMember(currentMember, fee)) throw Object.assign(new Error("Only registration fees may be paid while membership is pending."), { status: 409 });
      const walletUser = await User.findOneAndUpdate({ _id: req.user._id, status: "ACTIVE", walletBalance: { $gte: amount } }, { $inc: { walletBalance: -amount } }, { new: true, session });
      if (!walletUser) throw Object.assign(new Error("Insufficient wallet balance."), { status: 409 });
      const reference = `ORGPAY-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      payment = (await OrganizationPayment.create([{ organization: member.organization, member: member._id, assignment: assignment._id, payer: req.user._id, amount, reference, idempotencyKey: key, status: "SUCCESS", receiptNumber: `RCPT-${reference}` }], { session }))[0];
      claimed.payment = payment._id; claimed.paymentKey = key; claimed.paymentReference = reference; await claimed.save({ session });
      await postDebit({ userId: req.user._id, amount, openingBalance: Number(walletUser.walletBalance) + amount, closingBalance: Number(walletUser.walletBalance), service: "ORGANIZATION_FEE", reference, idempotencyKey: `organization:${key}`, narration: "Organization membership fee", session });
      const orgWallet = await OrganizationWallet.findOneAndUpdate({ organization: member.organization, status: "ACTIVE" }, { $inc: { balance: amount } }, { new: true, session });
      if (!orgWallet) throw Object.assign(new Error("Organization wallet is unavailable."), { status: 409 });
      await OrganizationLedger.create([{ organization: member.organization, type: "CREDIT", amount, balanceAfter: orgWallet.balance, reference, payment: payment._id, narration: "Membership fee received", createdBy: req.user._id }], { session });
      await audit(req, { _id: member.organization }, "FEE_PAYMENT", "OrganizationPayment", payment._id, { reference, amount }, session);
      if (currentMember.status === "PENDING" && fee?.type === "REGISTRATION") {
        const activation = verifiedOrg.membershipMode === "AUTO" ? await Organization.findOneAndUpdate({ _id: verifiedOrg._id }, { $inc: { membershipNumberSequence: 1 } }, { new: true, session }) : null;
        const activated = await OrganizationMember.findOneAndUpdate({ _id: currentMember._id, status: "PENDING" }, { $set: { registrationPaidAt: new Date(), readyForApproval: true, ...(activation ? { status: "ACTIVE", membershipNumber: membershipNumber(verifiedOrg.code, new Date().getFullYear(), activation.membershipNumberSequence), year: new Date().getFullYear(), approvedAt: new Date(), approvedBy: req.user._id, joinedAt: new Date() } : {}) } }, { new: true, session });
        if (!activated) throw Object.assign(new Error("Membership activation race detected."), { status: 409 });
        if (activation) await models.OrganizationMembershipCard.findOneAndUpdate({ member: activated._id }, { $setOnInsert: { organization: verifiedOrg._id, member: activated._id, cardNumber: `${verifiedOrg.code}-${activated.membershipNumber.replace(/\//g, "-")}`, active: true } }, { upsert: true, new: true, session });
      }
    });
    return { payment, duplicate: false };
  } finally {
    await session.endSession();
  }
}
module.exports = {
  access,
  requireOrganizationAccess,
  resolveOrganizationRole,
  roleAllows,
  ORGANIZATION_ROLE_CAPABILITIES,
  ORGANIZATION_PERMISSIONS,
  platform,
  actorId,
  clean,
  normalizeMoney,
  audit,
  makeOrganization,
  approveMember,
  pay,
  canOperateMember,
  membershipNumber,
  duplicateKeyMessage,
  publicError,
  KYB_TYPES,
  KYB_STATUSES,
  statusAlias,
  isOperationalStatus,
  normalizeKybInput,
  requiredDocumentsFor,
  safeOrganization,
  ownerOnboardingAccess,
  updateOrganizationDraft,
  submitOrganization,
  reviewOrganization,
};
