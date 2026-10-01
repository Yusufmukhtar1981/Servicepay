const mongoose = require("mongoose");
const User = require("../models/user.model");
const School = require("../models/edupaySchool.model");
const SchoolRequest = require("../models/edupaySchoolRequest.model");
const EmpowermentOrganization = require("../models/empowermentOrganization.model");
const EmpowermentProgram = require("../models/empowermentProgram.model");
const { Organization } = require("../models/organizations.models");
const {
  getManagedRecordScope,
  managedRecordFilter,
} = require("../services/aggregatorRecordScope.service");

const MAX_SEARCH_LENGTH = 120;
const MAX_STATUS_LENGTH = 60;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const objectId = (value) => mongoose.Types.ObjectId.isValid(value);

function combine(...filters) {
  const meaningful = filters.filter((filter) => filter && Object.keys(filter).length);
  if (!meaningful.length) return {};
  if (meaningful.length === 1) return meaningful[0];
  return { $and: meaningful };
}

function queryOptions(req) {
  const query = req.query || {};
  const rawSearch = String(query.search || "").trim();
  const rawStatus = String(query.status || "").trim();
  if (rawSearch.length > MAX_SEARCH_LENGTH || rawStatus.length > MAX_STATUS_LENGTH) {
    return { error: "Search and status filters exceed the supported length." };
  }
  const search = rawSearch ? new RegExp(escapeRegex(rawSearch), "i") : null;
  const status = rawStatus ? rawStatus.toUpperCase() : null;
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 20));
  return { search, status, page, limit };
}

function ownershipFilter(scope, options = {}) {
  const role = String(scope?.actor?.role || "").trim().toUpperCase();
  return managedRecordFilter(scope, {
    includeLegacyCustomers: true,
    includeLegacyStateManagers: role !== "AGENT",
    stateManagerField: "stateManagerId",
    ...options,
    // Agents never inherit their parent State Manager's legacy records.
    includeLegacyStateManagers:
      role !== "AGENT" && options.includeLegacyStateManagers !== false,
  });
}

const creatorPopulate = {
  path: "createdBy",
  select: "_id fullName role agentId",
};
const schoolSelect = "_id name schoolCode schoolType registrationNumber address state lga contactPerson phone email status active createdBy createdByRole createdAt aggregatorId stateManagerId";
const requestSelect = "_id schoolName schoolType registrationNumber state lga location contactPerson contactPhone email status parent createdBy createdByRole createdAt aggregatorId stateManagerId school";
const sponsorSelect = "_id name organizationType registrationNumber state lga description status verificationStatus createdBy createdAt aggregatorId";
const programSelect = "_id organization name description programType targetGroup eligibilityRequirements state lga ward targetBeneficiaries status createdBy createdAt aggregatorId";
const organizationSelect = "_id name slug code description type status organizationType registrationStatus country state lga registrationNumber industry sector createdBy createdAt aggregatorId";

function schoolRequestFilter(scope) {
  const byCreator = ownershipFilter(scope, {
    creatorField: "createdBy",
  });
  const byParent = ownershipFilter(scope, {
    creatorField: "parent",
  });
  return combine({ $or: [byCreator, byParent] });
}

function searchFilter(regex, fields) {
  return regex ? { $or: fields.map((field) => ({ [field]: regex })) } : {};
}

async function loadSchoolRows(scope, filters = {}, { deduplicateApprovedRequests = true } = {}) {
  const schoolOwnership = ownershipFilter(scope, {
  });
  const [schools, allScopedSchools, requests] = await Promise.all([
    School.find(combine(
      schoolOwnership,
      filters.status ? { status: filters.status } : {},
      searchFilter(filters.search, ["name", "schoolCode", "state", "lga"]),
    )).select(schoolSelect).populate(creatorPopulate).lean(),
    School.find(schoolOwnership).select("_id").lean(),
    SchoolRequest.find(combine(
      schoolRequestFilter(scope),
      filters.status ? { status: filters.status } : {},
      searchFilter(filters.search, ["schoolName", "state", "location", "status"]),
    )).select(requestSelect).populate(creatorPopulate).lean(),
  ]);

  const linkedSchools = new Set(allScopedSchools.map((row) => String(row._id)));
  const requestRows = requests
    .filter((row) => !deduplicateApprovedRequests || row.status !== "APPROVED" ||
      !row.school || !linkedSchools.has(String(row.school)))
    .map((row) => ({ ...row, name: row.schoolName }));
  return [
    ...schools.map((row) => ({ ...row, kind: "school" })),
    ...requestRows.map((row) => ({ ...row, kind: "school-request" })),
  ];
}

async function loadEmpowermentRows(scope, filters = {}) {
  const ownership = ownershipFilter(scope, { includeLegacyCustomers: true });
  const [sponsors, programs] = await Promise.all([
    EmpowermentOrganization.find(combine(
      ownership,
      filters.status ? { status: filters.status } : {},
      searchFilter(filters.search, ["name", "state", "organizationType", "registrationNumber"]),
    )).select(sponsorSelect).populate(creatorPopulate).lean(),
    EmpowermentProgram.find(combine(
      ownership,
      filters.status ? { status: filters.status } : {},
      searchFilter(filters.search, ["name", "state", "programType", "targetGroup"]),
    )).select(programSelect).populate(creatorPopulate).lean(),
  ]);
  return [
    ...sponsors.map((row) => ({ ...row, kind: "sponsor" })),
    ...programs.map((row) => ({ ...row, kind: "program" })),
  ];
}

async function loadOrganizationRows(scope, filters = {}) {
  const ownership = ownershipFilter(scope, { includeLegacyCustomers: true });
  const rows = await Organization.find(combine(
    ownership,
    filters.status ? { status: filters.status } : {},
    searchFilter(filters.search, ["name", "slug", "code", "type", "state", "organizationType"]),
  )).select(organizationSelect).populate(creatorPopulate).lean();
  return rows.map((row) => ({ ...row, kind: "organization" }));
}

async function loadSection(scope, section, filters = {}, options = {}) {
  if (section === "schools") return loadSchoolRows(scope, filters, options);
  if (section === "empowerment") return loadEmpowermentRows(scope, filters);
  if (section === "organizations") return loadOrganizationRows(scope, filters);
  return null;
}

function safeDetails(row) {
  switch (row.kind) {
    case "school":
      return {
        schoolCode: row.schoolCode || null,
        schoolType: row.schoolType || null,
        registrationNumber: row.registrationNumber || null,
        address: row.address || null,
        state: row.state || null,
        lga: row.lga || null,
        contactPerson: row.contactPerson || null,
        phone: row.phone || null,
        email: row.email || null,
        active: row.active === true,
      };
    case "school-request":
      return {
        schoolType: row.schoolType || null,
        registrationNumber: row.registrationNumber || null,
        location: row.location || null,
        state: row.state || null,
        lga: row.lga || null,
        contactPerson: row.contactPerson || null,
        contactPhone: row.contactPhone || null,
        email: row.email || null,
      };
    case "sponsor":
      return {
        organizationType: row.organizationType || null,
        registrationNumber: row.registrationNumber || null,
        state: row.state || null,
        lga: row.lga || null,
        description: row.description || null,
        verificationStatus: row.verificationStatus || null,
      };
    case "program":
      return {
        programType: row.programType || null,
        targetGroup: row.targetGroup || null,
        eligibilityRequirements: row.eligibilityRequirements || null,
        state: row.state || null,
        lga: row.lga || null,
        ward: row.ward || null,
        targetBeneficiaries: row.targetBeneficiaries || null,
        organization: row.organization || null,
      };
    case "organization":
      return {
        slug: row.slug || null,
        code: row.code || null,
        type: row.type || null,
        description: row.description || "",
        organizationType: row.organizationType || null,
        registrationStatus: row.registrationStatus || null,
        country: row.country || null,
        state: row.state || null,
        lga: row.lga || null,
        registrationNumber: row.registrationNumber || null,
        industry: row.industry || null,
        sector: row.sector || null,
      };
    default:
      return {};
  }
}

async function aggregatorMap(rows, scope) {
  const allowed = new Set((scope.aggregatorIds || []).map(String));
  const candidates = new Set();
  for (const row of rows) {
    const creator = row.createdBy;
    if (row.aggregatorId) candidates.add(String(row.aggregatorId));
    if (creator && String(creator.role || "").toUpperCase() === "AGENT") candidates.add(String(creator._id));
    if (creator?.agentId) candidates.add(String(creator.agentId));
  }
  const ids = [...candidates].filter((value) => objectId(value) && (scope.global || allowed.has(value)));
  if (!ids.length) return new Map();
  const users = await User.find({
    _id: { $in: ids },
    role: "AGENT",
    isDeleted: { $ne: true },
  }).select("_id fullName").lean();
  return new Map(users.map((user) => [String(user._id), { _id: user._id, fullName: user.fullName }]));
}

async function toDtos(rows, scope) {
  const byAggregator = await aggregatorMap(rows, scope);
  return rows.map((row) => {
    const creator = row.createdBy;
    const candidates = [
      row.aggregatorId && String(row.aggregatorId),
      creator && String(creator.role || "").toUpperCase() === "AGENT" && String(creator._id),
      creator?.agentId && String(creator.agentId),
    ].filter(Boolean);
    const aggregator = candidates.map((id) => byAggregator.get(id)).find(Boolean) || null;
    return {
      _id: row._id,
      kind: row.kind,
      name: row.kind === "school-request" ? row.schoolName : row.name,
      status: row.status || null,
      createdAt: row.createdAt || null,
      aggregator,
      details: safeDetails(row),
    };
  });
}

function isAllowedScope(scope) {
  const role = String(scope.actor?.role || "").toUpperCase();
  return Boolean(scope.actor && (scope.global || ["ZONAL_MANAGER", "STATE_MANAGER", "AGENT"].includes(role)));
}

async function getScope(req, res) {
  const scope = await getManagedRecordScope(req.user);
  if (!isAllowedScope(scope)) {
    res.status(403).json({ success: false, message: "Managed-record access is not available to this account." });
    return null;
  }
  return scope;
}

exports.summary = async (req, res, next) => {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const [schools, empowerment, organizations] = await Promise.all([
      loadSection(scope, "schools"),
      loadSection(scope, "empowerment"),
      loadSection(scope, "organizations"),
    ]);
    return res.json({
      success: true,
      counts: {
        schools: schools.length,
        empowerment: empowerment.length,
        organizations: organizations.length,
      },
    });
  } catch (error) { return next(error); }
};

exports.list = async (req, res, next) => {
  try {
    const scope = await getScope(req, res);
    if (!scope) return;
    const filters = queryOptions(req);
    if (filters.error) return res.status(400).json({ success: false, message: filters.error });
    const rows = await loadSection(scope, req.params.section, filters);
    if (!rows) return res.status(404).json({ success: false, message: "Unknown managed-record section." });
    const items = await toDtos(rows, scope);
    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
      String(b._id).localeCompare(String(a._id)));
    const total = items.length;
    return res.json({
      success: true,
      items: items.slice((filters.page - 1) * filters.limit, filters.page * filters.limit),
      total,
      page: filters.page,
      limit: filters.limit,
    });
  } catch (error) { return next(error); }
};

const kindToSection = {
  school: "schools",
  "school-request": "schools",
  sponsor: "empowerment",
  program: "empowerment",
  organization: "organizations",
};

async function recordExists(id) {
  const models = [School, SchoolRequest, EmpowermentOrganization, EmpowermentProgram, Organization];
  return Boolean(await Promise.all(models.map((model) => model.exists({ _id: id }))).then((rows) => rows.some(Boolean)));
}

exports.detail = async (req, res, next) => {
  try {
    if (!objectId(req.params.id)) return res.status(404).json({ success: false, message: "Record not found." });
    const kind = String(req.query.kind || "").trim().toLowerCase();
    const section = kind ? kindToSection[kind] : req.params.section;
    if (!section || !["schools", "empowerment", "organizations"].includes(section)) {
      return res.status(404).json({ success: false, message: "Unknown managed-record section." });
    }
    if (kind && kindToSection[kind] !== req.params.section) {
      return res.status(404).json({ success: false, message: "Record not found." });
    }
    const scope = await getScope(req, res);
    if (!scope) return;
    const rows = await loadSection(scope, section, {}, {
      // Combined lists omit an approved request only when its linked School
      // is also currently visible. An explicit request detail remains
      // available to its owner so the request status is never hidden.
      deduplicateApprovedRequests: kind !== "school-request",
    });
    const dtoRows = await toDtos(rows, scope);
    const index = rows.findIndex((row) => String(row._id) === String(req.params.id) &&
      (!kind || row.kind === kind));
    if (index >= 0) return res.json({ success: true, item: dtoRows[index] });
    if (await recordExists(req.params.id)) {
      return res.status(403).json({ success: false, message: "Record is outside your managed-record scope." });
    }
    return res.status(404).json({ success: false, message: "Record not found." });
  } catch (error) { return next(error); }
};