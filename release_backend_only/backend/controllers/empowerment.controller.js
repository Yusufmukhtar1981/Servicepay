const crypto = require("crypto");
const mongoose = require("mongoose");

const EmpowermentOrganization = require(
  "../models/empowermentOrganization.model"
);
const EmpowermentProgram = require(
  "../models/empowermentProgram.model"
);
const EmpowermentBeneficiary = require(
  "../models/empowermentBeneficiary.model"
);
const EmpowermentFunding = require(
  "../models/empowermentFunding.model"
);
const EmpowermentDisbursement = require(
  "../models/empowermentDisbursement.model"
);
const EmpowermentPayout = require(
  "../models/empowermentPayout.model"
);
const EmpowermentAuditLog = require(
  "../models/empowermentAuditLog.model"
);
const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const { postCredit } = require(
  "../services/ledger.service"
);

const ADMIN_ROLES = new Set([
  "HEAD_OFFICE",
  "ZONAL_MANAGER",
  "STATE_MANAGER",
]);

const ORGANIZATION_TYPES = new Set([
  "GOVERNMENT",
  "NGO",
  "COMPANY",
  "COOPERATIVE",
  "FOUNDATION",
  "INDIVIDUAL",
  "POLITICIAN",
  "ASSOCIATION",
  "OTHER",
]);

const PROGRAM_STATUSES = new Set([
  "DRAFT",
  "OPEN",
  "UNDER_REVIEW",
  "APPROVED",
  "DISBURSING",
  "COMPLETED",
  "SUSPENDED",
  "CANCELLED",
]);

const BENEFICIARY_STATUSES = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
]);

const isAdmin = (user) =>
  ADMIN_ROLES.has(
    String(user?.role || "")
      .trim()
      .toUpperCase()
  );

const isHeadOffice = (user) =>
  String(user?.role || "").trim().toUpperCase() === "HEAD_OFFICE";

const organizationVerificationStatus = (organization) => {
  const legacy = String(organization?.status || "")
    .trim()
    .toUpperCase();
  const explicit = String(organization?.verificationStatus || "")
    .trim()
    .toUpperCase();
  // Mongoose supplies the new default for legacy rows even though no field was
  // persisted. An ACTIVE legacy organization is already verified and must not
  // lose program access merely because it is read through the newer schema.
  if (
    legacy === "ACTIVE" &&
    ["", "DRAFT", "PENDING_VERIFICATION"].includes(explicit)
  ) {
    return "VERIFIED";
  }
  if (explicit) return explicit;

  return (
    {
      ACTIVE: "VERIFIED",
      PENDING: "PENDING_VERIFICATION",
      REJECTED: "REJECTED",
      SUSPENDED: "SUSPENDED",
    }[legacy] || "DRAFT"
  );
};

const isProgramEligibleOrganization = (organization) =>
  organizationVerificationStatus(organization) === "VERIFIED";

const organizationStatusForVerification = (verificationStatus) =>
  ({
    DRAFT: "PENDING",
    PENDING_VERIFICATION: "PENDING",
    VERIFIED: "ACTIVE",
    REJECTED: "REJECTED",
    SUSPENDED: "SUSPENDED",
  }[verificationStatus] || "");

const actorId = (req) => String(req.user?._id || "");

// Head Office is the only global audience. Branch staff must never fall
// through to a legacy record whose branchId is null.
const staffBranchId = (req) => {
  if (!req.staffAccess || req.staffAccess.isHeadOffice) return null;
  const scope = req.staffAccess.scope;
  return scope?.type === "BRANCH" && scope.branchId ? scope.branchId : null;
};

const hasBranchAccess = (req, record) => {
  if (!req.staffAccess || req.staffAccess.isHeadOffice) return true;
  const branchId = staffBranchId(req);
  return Boolean(branchId && record?.branchId &&
    String(record.branchId) === String(branchId));
};

const branchFilterFor = (req) => {
  if (req.staffAccess && !req.staffAccess.isHeadOffice) {
    const branchId = staffBranchId(req);
    return branchId ? { branchId } : { _id: null };
  }
  if (isHeadOffice(req.user)) return {};
  return { branchId: req.user?.branchId || null };
};

const creationBranchId = (req) =>
  isHeadOffice(req.user) ? null : req.user?.branchId || null;

// Branch operational access is intentionally not PII access. Head Office has
// the explicit full-access role; branch responses keep only record identifiers
// and operational status/amount fields.
const mayViewEmpowermentPii = (req) =>
  isHeadOffice(req.user) || req.staffAccess?.isHeadOffice === true;

const normalizePhone = (value) => {
  let phone = String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()-]/g, "")
    .trim();

  if (phone.startsWith("+234")) {
    phone = `0${phone.slice(4)}`;
  } else if (phone.startsWith("234") && phone.length >= 13) {
    phone = `0${phone.slice(3)}`;
  }

  return phone;
};

const asMoney = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const programFinancials = (program) => {
  const totalBudget = Math.max(0, Number(program?.totalBudget || 0));
  const fundedAmount = Math.max(
    0,
    Number(program?.totalFunded || 0),
    Number(program?.totalFundedAmount || 0)
  );
  const totalDisbursedAmount = Math.max(
    0,
    Number(program?.totalDisbursed || 0),
    Number(program?.totalDisbursedAmount || 0)
  );
  const availableBalance = Math.max(0, fundedAmount - totalDisbursedAmount);

  return {
    totalBudget,
    fundedAmount,
    availableBalance,
    totalDisbursedAmount,
    remainingFundingCapacity: Math.max(0, totalBudget - fundedAmount),
    totalFunded: fundedAmount,
    totalDisbursed: totalDisbursedAmount,
    remainingBalance: availableBalance,
    totalFundedAmount: fundedAmount,
    totalDisbursedAmount,
    availableFundingAmount: availableBalance,
    lastFundedAt: program?.lastFundedAt || null,
    lastFundedBy: program?.lastFundedBy || null,
  };
};

const reconcileProgramFunding = async (program, session = null) => {
  const financials = programFinancials(program);
  const fields = {
    totalFunded: financials.totalFunded,
    totalFundedAmount: financials.totalFundedAmount,
    totalDisbursed: financials.totalDisbursed,
    totalDisbursedAmount: financials.totalDisbursedAmount,
    remainingBalance: financials.remainingBalance,
    availableFundingAmount: financials.availableFundingAmount,
  };
  const mismatched = Object.entries(fields).some(
    ([key, value]) => Number(program?.[key] || 0) !== value
  );

  if (mismatched) {
    await EmpowermentProgram.updateOne(
      { _id: program._id },
      { $set: fields },
      session ? { session } : undefined
    );
  }

  return financials;
};

const asPositiveInteger = (value) => {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : null;
};

const objectIdIsValid = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || ""));

const documentId = (document) => String(document?._id || document || "");

const getIdempotencyKey = (req) =>
  String(
    req.get("Idempotency-Key") ||
      req.body?.idempotencyKey ||
      ""
  ).trim();

const buildReference = (prefix) =>
  `${prefix}-${Date.now()}-${crypto
    .randomBytes(5)
    .toString("hex")
    .toUpperCase()}`;

const cleanString = (value, max = 2000) =>
  String(value || "")
    .trim()
    .slice(0, max);

const dateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const respondError = (res, status, message) =>
  res.status(status).json({ success: false, message });

const selectedBeneficiaryIds = (req) => {
  if (req.body?.beneficiaryIds === undefined) return null;
  if (!Array.isArray(req.body.beneficiaryIds)) {
    throw Object.assign(new Error("beneficiaryIds must be an array."), {
      status: 400,
    });
  }

  const ids = req.body.beneficiaryIds.map((value) => String(value || "").trim());
  if (
    !ids.length ||
    ids.length > 200 ||
    ids.some((id) => !objectIdIsValid(id)) ||
    new Set(ids).size !== ids.length
  ) {
    throw Object.assign(
      new Error("Select between 1 and 200 unique beneficiaries."),
      { status: 400 }
    );
  }
  return ids;
};

const sameIdSet = (first, second) => {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return first === second;
  }

  const normalizedFirst = first.map(String).sort();
  const normalizedSecond = second.map(String).sort();
  return (
    normalizedFirst.length === normalizedSecond.length &&
    normalizedFirst.every((value, index) => value === normalizedSecond[index])
  );
};

const sessionQuery = (query, session) => {
  if (session) query.session(session);
  return query;
};

const audit = async ({
  req,
  action,
  entityType,
  entityId,
  program = null,
  before = null,
  after = null,
  reference = "",
  metadata = {},
  branchId,
  session = null,
}) => {
  const payload = {
    actor: req.user._id,
    actorRole: String(req.user.role || "CUSTOMER").toUpperCase(),
    action,
    entityType,
    entityId,
    program,
    before,
    after,
    reference,
    metadata,
    branchId: branchId === undefined ? creationBranchId(req) : branchId,
  };

  if (session) {
    await EmpowermentAuditLog.create([payload], { session });
  } else {
    await EmpowermentAuditLog.create(payload);
  }
};

const canManageOrganization = (req, organization) =>
  isAdmin(req.user) ||
  Boolean(req.staffAccess) ||
  documentId(organization.createdBy) === actorId(req);

const canManageProgram = (req, program) =>
  isAdmin(req.user) ||
  Boolean(req.staffAccess) ||
  documentId(program.createdBy) === actorId(req);

const getManagedOrganization = async (req, id, session = null) => {
  if (!objectIdIsValid(id)) return null;

  const organization = await sessionQuery(
    EmpowermentOrganization.findById(id),
    session
  );

  if (!organization || !canManageOrganization(req, organization) ||
    !hasBranchAccess(req, organization)) {
    return null;
  }

  return organization;
};

const getManagedProgram = async (req, id, session = null) => {
  if (!objectIdIsValid(id)) return null;

  const program = await sessionQuery(
    EmpowermentProgram.findById(id),
    session
  );

  if (!program || !canManageProgram(req, program) || !hasBranchAccess(req, program)) {
    return null;
  }

  return program;
};

const pagination = (req) => {
  const page = Math.max(1, Number(req.query?.page || 1));
  const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 30)));
  return { page, limit, skip: (page - 1) * limit };
};

const requireActiveOrganization = async (program, session = null) => {
  const organization = await sessionQuery(
    EmpowermentOrganization.findById(program.organization),
    session
  );
  if (!organization || !isProgramEligibleOrganization(organization)) {
    throw Object.assign(
      new Error("The program organization is not active for this operation."),
      { status: 409 }
    );
  }
  return organization;
};

const reserveBeneficiaryCapacity = async ({
  program,
  quantity,
  session,
}) => {
  if (quantity < 1) {
    throw Object.assign(new Error("At least one beneficiary is required."), {
      status: 400,
    });
  }

  /*
   * Programs created before beneficiaryCount existed are initialized once
   * from their authoritative beneficiary rows. The conditional write means
   * competing first requests cannot both reserve those same slots.
   */
  const existingCount = await EmpowermentBeneficiary.countDocuments({
    program: program._id,
  }).session(session);
  const legacyReservation = await EmpowermentProgram.findOneAndUpdate(
    {
      _id: program._id,
      beneficiaryCount: { $exists: false },
      $expr: {
        $lte: [
          existingCount + quantity,
          "$targetBeneficiaries",
        ],
      },
    },
    { $set: { beneficiaryCount: existingCount + quantity } },
    { new: true, session }
  );
  if (legacyReservation) return legacyReservation;

  const reservation = await EmpowermentProgram.findOneAndUpdate(
    {
      _id: program._id,
      beneficiaryCount: {
        $lte: Number(program.targetBeneficiaries) - quantity,
      },
    },
    { $inc: { beneficiaryCount: quantity } },
    { new: true, session }
  );
  if (!reservation) {
    throw Object.assign(
      new Error("Program beneficiary capacity has been reached."),
      { status: 409 }
    );
  }
  return reservation;
};

const organizationPayload = (body) => ({
  name: cleanString(body?.name, 180),
  organizationType: cleanString(
    body?.organizationType,
    60
  ).toUpperCase(),
  registrationNumber: cleanString(body?.registrationNumber, 120),
  contactName: cleanString(
    body?.contactName || body?.contactPerson,
    180
  ),
  phone: normalizePhone(body?.phone),
  email: cleanString(body?.email, 180).toLowerCase(),
  address: cleanString(body?.address, 500),
  state: cleanString(body?.state, 100),
  lga: cleanString(body?.lga, 100),
  description: cleanString(body?.description, 2000),
});

const createOrganization = async (req, res) => {
  try {
    const values = organizationPayload(req.body);

    if (
      !values.name ||
      !ORGANIZATION_TYPES.has(values.organizationType) ||
      !values.contactName ||
      !values.phone ||
      !values.email ||
      !values.address ||
      !values.state
    ) {
      return respondError(
        res,
        400,
        "Name, type, contact person, phone, email, address and state are required."
      );
    }

    if (
      !["INDIVIDUAL", "OTHER"].includes(values.organizationType) &&
      !values.registrationNumber
    ) {
      return respondError(
        res,
        400,
        "A registration number is required for this organization type."
      );
    }

    const organization = await EmpowermentOrganization.create({
      ...values,
      createdBy: req.user._id,
      branchId: creationBranchId(req),
      status: "PENDING",
      verificationStatus: "PENDING_VERIFICATION",
    });

    await audit({
      req,
      action: "ORGANIZATION_CREATED",
      entityType: "ORGANIZATION",
      entityId: organization._id,
      branchId: organization.branchId,
      after: { status: organization.status, name: organization.name },
    });

    return res.status(201).json({
      success: true,
      message: "Organization submitted for verification.",
      organization,
    });
  } catch (error) {
    console.error("CREATE EMPOWERMENT ORGANIZATION ERROR:", error);
    return respondError(res, 500, "Unable to create organization.");
  }
};

const listOrganizations = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = cleanString(req.query?.search, 100);
    const filter = isAdmin(req.user)
      ? branchFilterFor(req)
      : { createdBy: req.user._id, ...branchFilterFor(req) };

    const eligibleOnly =
      String(req.query?.eligible || "").toLowerCase() === "true" ||
      String(req.query?.purpose || "").toLowerCase() === "program";

    const eligibilityFilter = eligibleOnly
      ? {
          $or: [
        { status: "ACTIVE" },
        { verificationStatus: "VERIFIED" },
          ],
        }
      : null;
    if (eligibilityFilter) {
      filter.$and = [eligibilityFilter];
    } else if (req.query?.status) {
      filter.status = cleanString(req.query.status, 30).toUpperCase();
    }

    if (search) {
      const searchFilter = {
        $or: [
        { name: new RegExp(search, "i") },
        { contactName: new RegExp(search, "i") },
        { registrationNumber: new RegExp(search, "i") },
        ],
      };
      if (eligibilityFilter) {
        filter.$and.push(searchFilter);
      } else {
        filter.$or = searchFilter.$or;
      }
    }

    const [organizations, total] = await Promise.all([
      EmpowermentOrganization.find(filter)
        .populate("createdBy", "fullName phone email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EmpowermentOrganization.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      organizations: organizations.map((organization) => ({
        ...organization.toObject(),
        sponsorVerificationStatus: organizationVerificationStatus(organization),
      })),
      pagination: { page, limit, total },
    });
  } catch (error) {
    console.error("LIST EMPOWERMENT ORGANIZATIONS ERROR:", error);
    return respondError(res, 500, "Unable to load organizations.");
  }
};

const getOrganization = async (req, res) => {
  try {
    const organization = await getManagedOrganization(req, req.params.id);
    if (!organization) {
      return respondError(res, 404, "Organization was not found.");
    }

    await organization.populate([
      { path: "createdBy", select: "fullName phone email role state" },
      { path: "verification.verifiedBy", select: "fullName phone email role" },
    ]);

    return res.status(200).json({ success: true, organization });
  } catch (error) {
    console.error("GET EMPOWERMENT ORGANIZATION ERROR:", error);
    return respondError(res, 500, "Unable to load organization details.");
  }
};

const updateOrganization = async (req, res) => {
  try {
    const organization = await getManagedOrganization(req, req.params.id);

    if (!organization) {
      return respondError(res, 404, "Organization was not found.");
    }

    if (organization.status === "SUSPENDED") {
      return respondError(res, 409, "Suspended organizations cannot be edited.");
    }

    const before = {
      name: organization.name,
      status: organization.status,
    };
    const values = organizationPayload(req.body);

    for (const [key, value] of Object.entries(values)) {
      if (value) organization[key] = value;
    }

    await organization.save();
    await audit({
      req,
      action: "ORGANIZATION_UPDATED",
      entityType: "ORGANIZATION",
      entityId: organization._id,
      branchId: organization.branchId,
      before,
      after: { name: organization.name, status: organization.status },
    });

    return res.status(200).json({ success: true, organization });
  } catch (error) {
    console.error("UPDATE EMPOWERMENT ORGANIZATION ERROR:", error);
    return respondError(res, 500, "Unable to update organization.");
  }
};

const updateOrganizationStatus = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return respondError(res, 403, "Administrator access is required.");
    }

    const rawStatus = cleanString(req.body?.status, 30).toUpperCase();
    const verificationStatus =
      {
        PENDING: "PENDING_VERIFICATION",
        ACTIVE: "VERIFIED",
        DRAFT: "DRAFT",
        PENDING_VERIFICATION: "PENDING_VERIFICATION",
        VERIFIED: "VERIFIED",
        SUSPENDED: "SUSPENDED",
        REJECTED: "REJECTED",
      }[rawStatus] || "";
    const status = organizationStatusForVerification(verificationStatus);
    if (!status) {
      return respondError(res, 400, "Invalid organization status.");
    }

    const organization = await EmpowermentOrganization.findOne({
      _id: req.params.id,
      ...branchFilterFor(req),
    });
    if (!organization) {
      return respondError(res, 404, "Organization was not found.");
    }

    const before = {
      status: organization.status,
      verificationStatus: organizationVerificationStatus(organization),
    };
    organization.status = status;
    organization.verificationStatus = verificationStatus;
    organization.verification = {
      verifiedBy: req.user._id,
      verifiedAt: new Date(),
      rejectionReason:
        verificationStatus === "REJECTED"
          ? cleanString(req.body?.rejectionReason, 500)
          : "",
    };
    await organization.save();
    if (["SUSPENDED", "REJECTED"].includes(verificationStatus)) {
      await EmpowermentProgram.updateMany(
        {
          organization: organization._id,
          branchId: organization.branchId,
          status: { $nin: ["COMPLETED", "CANCELLED"] },
        },
        { $set: { status: "SUSPENDED" } }
      );
    }
    await audit({
      req,
      action: "ORGANIZATION_STATUS_UPDATED",
      entityType: "ORGANIZATION",
      entityId: organization._id,
      branchId: organization.branchId,
      before,
      after: { status, verificationStatus },
    });

    return res.status(200).json({
      success: true,
      organization: {
        ...organization.toObject(),
        sponsorVerificationStatus: organizationVerificationStatus(organization),
      },
    });
  } catch (error) {
    console.error("UPDATE EMPOWERMENT ORGANIZATION STATUS ERROR:", error);
    return respondError(res, 500, "Unable to update organization status.");
  }
};

const programPayload = (body) => {
  const amountPerBeneficiary = asMoney(body?.amountPerBeneficiary);
  const targetBeneficiaries = asPositiveInteger(body?.targetBeneficiaries);
  const applicationStartDate = dateOrNull(
    body?.applicationStartDate || body?.startDate
  );
  const applicationDeadline = dateOrNull(
    body?.applicationDeadline || body?.endDate
  );
  const disbursementDate = dateOrNull(body?.disbursementDate);

  return {
    name: cleanString(body?.name || body?.title, 200),
    description: cleanString(body?.description, 4000),
    programType: cleanString(body?.programType, 60).toUpperCase() || "CASH_GRANT",
    targetGroup: cleanString(
      body?.targetGroup || body?.targetBeneficiariesGroup,
      60
    ).toUpperCase() || "GENERAL",
    eligibilityRequirements: cleanString(body?.eligibilityRequirements, 4000),
    state: cleanString(body?.state, 100),
    lga: cleanString(body?.lga, 100),
    ward: cleanString(body?.ward, 100),
    amountPerBeneficiary,
    targetBeneficiaries,
    startDate: applicationStartDate,
    endDate: applicationDeadline,
    disbursementDate,
    publicApplicationEnabled: body?.publicApplicationEnabled === true,
    publicTransparencyEnabled: body?.publicTransparencyEnabled === true,
  };
};

const validateProgramValues = (values) => {
  if (
    !values.name ||
    !values.amountPerBeneficiary ||
    !values.targetBeneficiaries ||
    !values.state
  ) {
    return "Program name, state, amount per beneficiary and beneficiary target are required.";
  }

  if (
    values.startDate &&
    values.endDate &&
    values.endDate < values.startDate
  ) {
    return "The application deadline cannot be before the start date.";
  }

  return "";
};

const createProgram = async (req, res) => {
  try {
    const organizationId = req.body?.organizationId;
    const organization = await getManagedOrganization(req, organizationId);
    if (!organization) {
      return respondError(
        res,
        403,
        "You do not have permission to create a program for this organization."
      );
    }

    if (!isProgramEligibleOrganization(organization)) {
      return respondError(
        res,
        409,
        "The organization must be verified before creating a program."
      );
    }

    const values = programPayload(req.body);
    const error = validateProgramValues(values);
    if (error) return respondError(res, 400, error);

    const program = await EmpowermentProgram.create({
      ...values,
      organization: organization._id,
      createdBy: req.user._id,
      branchId: organization.branchId,
      totalBudget:
        values.amountPerBeneficiary * values.targetBeneficiaries,
      beneficiaryCount: 0,
      status: "DRAFT",
    });

    await audit({
      req,
      action: "PROGRAM_CREATED",
      entityType: "PROGRAM",
      entityId: program._id,
      program: program._id,
      branchId: program.branchId,
      after: { status: program.status, totalBudget: program.totalBudget },
    });

    return res.status(201).json({
      success: true,
      message: "Empowerment program created as a draft.",
      program,
    });
  } catch (error) {
    console.error("CREATE EMPOWERMENT PROGRAM ERROR:", error);
    return respondError(res, 500, "Unable to create empowerment program.");
  }
};

const listPrograms = async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const filter = isAdmin(req.user)
      ? branchFilterFor(req)
      : { createdBy: req.user._id, ...branchFilterFor(req) };
    const search = cleanString(req.query?.search, 100);

    if (req.query?.status) {
      filter.status = cleanString(req.query.status, 30).toUpperCase();
    }
    if (search) {
      filter.$or = [
        { name: new RegExp(search, "i") },
        { state: new RegExp(search, "i") },
      ];
    }

    const [programs, total] = await Promise.all([
      EmpowermentProgram.find(filter)
        .populate("organization", "name status")
        .populate("createdBy", "fullName phone")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EmpowermentProgram.countDocuments(filter),
    ]);
    const beneficiaryCounts = programs.length
      ? await EmpowermentBeneficiary.aggregate([
          { $match: { program: { $in: programs.map((program) => program._id) } } },
          {
            $group: {
              _id: "$program",
              total: { $sum: 1 },
              approved: {
                $sum: {
                  $cond: [{ $eq: ["$applicationStatus", "APPROVED"] }, 1, 0],
                },
              },
              paid: {
                $sum: {
                  $cond: [{ $eq: ["$applicationStatus", "PAID"] }, 1, 0],
                },
              },
            },
          },
        ])
      : [];
    const countsByProgramId = new Map(
      beneficiaryCounts.map((counts) => [
        String(counts._id),
        {
          total: Number(counts.total || 0),
          approved: Number(counts.approved || 0),
          paid: Number(counts.paid || 0),
        },
      ])
    );

    return res.status(200).json({
      success: true,
      programs: programs.map((program) => ({
        ...program.toObject(),
        financials: programFinancials(program),
        beneficiaryCounts: countsByProgramId.get(String(program._id)) || {
          total: 0,
          approved: 0,
          paid: 0,
        },
      })),
      pagination: { page, limit, total },
    });
  } catch (error) {
    console.error("LIST EMPOWERMENT PROGRAMS ERROR:", error);
    return respondError(res, 500, "Unable to load empowerment programs.");
  }
};

const getSponsorDashboard = async (req, res) => {
  try {
    const organizations = await EmpowermentOrganization.find({
      createdBy: req.user._id,
      ...branchFilterFor(req),
    })
      .sort({ createdAt: -1 })
      .lean();
    const organizationIds = organizations.map((organization) => organization._id);
    const programs = organizationIds.length
      ? await EmpowermentProgram.find({
          organization: { $in: organizationIds },
          createdBy: req.user._id,
          ...branchFilterFor(req),
        })
          .populate("organization", "name status verificationStatus state")
          .sort({ createdAt: -1 })
          .lean()
      : [];
    const programIds = programs.map((program) => program._id);
    const beneficiaryRows = programIds.length
      ? await EmpowermentBeneficiary.aggregate([
          { $match: { program: { $in: programIds } } },
          {
            $group: {
              _id: "$program",
              applications: { $sum: 1 },
              beneficiaries: { $sum: 1 },
              approved: {
                $sum: {
                  $cond: [{ $eq: ["$applicationStatus", "APPROVED"] }, 1, 0],
                },
              },
              paid: {
                $sum: {
                  $cond: [{ $eq: ["$applicationStatus", "PAID"] }, 1, 0],
                },
              },
            },
          },
        ])
      : [];
    const countsByProgram = new Map(
      beneficiaryRows.map((row) => [String(row._id), row])
    );
    const summary = programs.reduce(
      (total, program) => {
        const financials = programFinancials(program);
        const counts = countsByProgram.get(String(program._id)) || {};
        total.totalFunded += financials.totalFunded;
        total.totalDisbursed += financials.totalDisbursed;
        total.remainingFunds += financials.remainingBalance;
        total.applications += Number(counts.applications || 0);
        total.beneficiaries += Number(counts.beneficiaries || 0);
        return total;
      },
      {
        totalFunded: 0,
        totalDisbursed: 0,
        remainingFunds: 0,
        applications: 0,
        beneficiaries: 0,
      }
    );

    return res.status(200).json({
      success: true,
      organizations: organizations.map((organization) => ({
        ...organization,
        sponsorVerificationStatus: organizationVerificationStatus(organization),
      })),
      programs: programs.map((program) => {
        const counts = countsByProgram.get(String(program._id)) || {};
        return {
          ...program,
          financials: programFinancials(program),
          activity: {
            applications: Number(counts.applications || 0),
            beneficiaries: Number(counts.beneficiaries || 0),
            approved: Number(counts.approved || 0),
            paid: Number(counts.paid || 0),
          },
        };
      }),
      summary,
    });
  } catch (error) {
    console.error("GET PROGRAM SPONSOR DASHBOARD ERROR:", error);
    return respondError(res, 500, "Unable to load the Program Sponsor dashboard.");
  }
};

const getProgram = async (req, res) => {
  try {
    const program = await EmpowermentProgram.findOne({
      _id: req.params.programId,
      ...branchFilterFor(req),
    })
      .populate("organization", "name status state")
      .populate("createdBy", "fullName phone");

    if (!program) {
      return respondError(res, 404, "Empowerment program was not found.");
    }

    const accessible =
      canManageProgram(req, program) ||
      (program.publicTransparencyEnabled &&
        program.organization?.status === "ACTIVE" &&
        ["OPEN", "APPROVED", "DISBURSING", "COMPLETED"].includes(
          program.status
        ));

    if (!accessible) {
      return respondError(res, 403, "You cannot view this private program.");
    }

    return res.status(200).json({
      success: true,
      program,
      financials: programFinancials(program),
    });
  } catch (error) {
    console.error("GET EMPOWERMENT PROGRAM ERROR:", error);
    return respondError(res, 500, "Unable to load empowerment program.");
  }
};

const updateProgram = async (req, res) => {
  try {
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) {
      return respondError(res, 404, "Program was not found.");
    }
    if (
      !isAdmin(req.user) &&
      !["DRAFT", "UNDER_REVIEW"].includes(program.status)
    ) {
      return respondError(
        res,
        403,
        "Sponsors can only edit draft or submitted programs they own."
      );
    }

    if (
      Number(program.totalFundedAmount || 0) > 0 ||
      Number(program.beneficiaryCount || 0) > 0
    ) {
      return respondError(
        res,
        409,
        "Program capacity and financial fields cannot be changed after beneficiaries or funding exist."
      );
    }

    if (!["DRAFT", "OPEN", "UNDER_REVIEW"].includes(program.status)) {
      return respondError(res, 409, "This program can no longer be edited.");
    }

    const values = programPayload({ ...program.toObject(), ...req.body });
    const error = validateProgramValues(values);
    if (error) return respondError(res, 400, error);

    const before = {
      status: program.status,
      totalBudget: program.totalBudget,
    };
    Object.assign(program, values);
    program.totalBudget =
      values.amountPerBeneficiary * values.targetBeneficiaries;
    await program.save();
    await audit({
      req,
      action: "PROGRAM_UPDATED",
      entityType: "PROGRAM",
      entityId: program._id,
      program: program._id,
      branchId: program.branchId,
      before,
      after: { totalBudget: program.totalBudget, status: program.status },
    });

    return res.status(200).json({ success: true, program });
  } catch (error) {
    console.error("UPDATE EMPOWERMENT PROGRAM ERROR:", error);
    return respondError(res, 500, "Unable to update program.");
  }
};

const updateProgramStatus = async (req, res) => {
  try {
    const program = await getManagedProgram(req, req.params.id);
    const status = cleanString(req.body?.status, 30).toUpperCase();

    if (!program) return respondError(res, 404, "Program was not found.");
    if (!PROGRAM_STATUSES.has(status)) {
      return respondError(res, 400, "Invalid program status.");
    }
    if (!isAdmin(req.user)) {
      const sponsorMaySubmit =
        program.status === "DRAFT" && status === "UNDER_REVIEW";
      if (!sponsorMaySubmit) {
        return respondError(
          res,
          403,
          "Sponsors can only submit their own draft program for administrative review."
        );
      }
    }
    if (["OPEN", "UNDER_REVIEW"].includes(status)) {
      try {
        await requireActiveOrganization(program);
      } catch (error) {
        return respondError(res, error.status || 409, error.message);
      }
    }

    const before = { status: program.status };
    program.status = status;
    await program.save();
    await audit({
      req,
      action: "PROGRAM_STATUS_UPDATED",
      entityType: "PROGRAM",
      entityId: program._id,
      program: program._id,
      branchId: program.branchId,
      before,
      after: { status },
    });

    return res.status(200).json({ success: true, program });
  } catch (error) {
    console.error("UPDATE EMPOWERMENT PROGRAM STATUS ERROR:", error);
    return respondError(res, 500, "Unable to update program status.");
  }
};

const buildBeneficiaryPayload = async (program, values, session = null) => {
  const phone = normalizePhone(values?.phone);
  const email = cleanString(values?.email, 180).toLowerCase();
  const user = phone || email
    ? await sessionQuery(User.findOne({
        $or: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      }), session)
    : null;
  const kyc = user
    ? await sessionQuery(KycProfile.findOne({ user: user._id }), session)
    : null;
  const kycStatus = String(kyc?.status || "NOT_STARTED").toUpperCase();

  return {
    program: program._id,
    branchId: program.branchId,
    user: user?._id || null,
    fullName: cleanString(values?.fullName || user?.fullName, 200),
    phone,
    normalizedPhone: phone,
    email: email || cleanString(user?.email, 180).toLowerCase(),
    state: cleanString(values?.state || user?.state, 100),
    lga: cleanString(values?.lga || user?.lga, 100),
    ward: cleanString(values?.ward, 100),
    gender: cleanString(values?.gender, 30).toUpperCase(),
    dateOfBirth: dateOrNull(values?.dateOfBirth),
    address: cleanString(values?.address, 1000),
    kycReference: kyc?._id ? String(kyc._id) : "",
    kycStatus,
    verificationStatus: kycStatus === "VERIFIED" ? "VERIFIED" : "PENDING",
    amount: Number(program.amountPerBeneficiary),
  };
};

const addBeneficiary = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let beneficiary = null;
    await session.withTransaction(async () => {
      const program = await getManagedProgram(
        req,
        req.body?.programId,
        session
      );
      if (!program) {
        throw Object.assign(new Error("You cannot manage this program."), {
          status: 403,
        });
      }
      if (["SUSPENDED", "CANCELLED", "COMPLETED"].includes(program.status)) {
        throw Object.assign(
          new Error("This program is not accepting beneficiaries."),
          { status: 409 }
        );
      }
      await requireActiveOrganization(program, session);

      const payload = await buildBeneficiaryPayload(program, req.body, session);
      if (!payload.fullName || !payload.normalizedPhone || !payload.state) {
        throw Object.assign(
          new Error("Full name, phone and state are required for a beneficiary."),
          { status: 400 }
        );
      }
      await reserveBeneficiaryCapacity({ program, quantity: 1, session });
      beneficiary = (
        await EmpowermentBeneficiary.create(
          [
            {
              ...payload,
              branchId: program.branchId,
              metadata: { source: "OWNER_ADDED" },
            },
          ],
          { session }
        )
      )[0];
      await audit({
        req,
        action: "BENEFICIARY_ADDED",
        entityType: "BENEFICIARY",
        entityId: beneficiary._id,
        program: program._id,
        branchId: program.branchId,
        after: { applicationStatus: beneficiary.applicationStatus },
        session,
      });
    });

    return res.status(201).json({ success: true, beneficiary });
  } catch (error) {
    if (error?.code === 11000) {
      return respondError(res, 409, "This beneficiary already exists in the program.");
    }
    console.error("ADD EMPOWERMENT BENEFICIARY ERROR:", error);
    return respondError(res, error.status || 500, error.message || "Unable to add beneficiary.");
  } finally {
    await session.endSession();
  }
};

const listBeneficiaries = async (req, res) => {
  try {
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) {
      return respondError(res, 403, "You cannot view this program's beneficiaries.");
    }

    const { page, limit, skip } = pagination(req);
    const filter = { program: program._id };
    const search = cleanString(req.query?.search, 100);
    if (req.query?.status) {
      filter.applicationStatus = cleanString(req.query.status, 30).toUpperCase();
    }
    if (req.query?.verificationStatus) {
      filter.verificationStatus = cleanString(
        req.query.verificationStatus,
        30
      ).toUpperCase();
    }
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const [beneficiaries, total] = await Promise.all([
      EmpowermentBeneficiary.find(filter)
        .populate("user", "fullName phone email status")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EmpowermentBeneficiary.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      beneficiaries,
      pagination: { page, limit, total },
    });
  } catch (error) {
    console.error("LIST EMPOWERMENT BENEFICIARIES ERROR:", error);
    return respondError(res, 500, "Unable to load beneficiaries.");
  }
};

const listEligibleBeneficiaries = async (req, res) => {
  try {
    if (!isHeadOffice(req.user)) {
      return respondError(
        res,
        403,
        "Only Head Office can select beneficiaries for bulk disbursement."
      );
    }

    const program = await getManagedProgram(req, req.params.programId);
    if (!program) {
      return respondError(res, 403, "You cannot view this program's beneficiaries.");
    }
    await requireActiveOrganization(program);

    const limit = Math.min(
      200,
      Math.max(1, Number(req.query?.limit || 200))
    );
    const candidates = await EmpowermentBeneficiary.find({
      program: program._id,
      applicationStatus: "APPROVED",
      verificationStatus: "VERIFIED",
      user: { $ne: null },
      paymentReference: { $in: [null, ""] },
      paidAt: null,
    })
      .populate({
        path: "user",
        select: "fullName phone email status walletBalance",
        match: { status: "ACTIVE", walletBalance: { $gte: 0 } },
      })
      .sort({ createdAt: 1 })
      .limit(limit);

    const linkedCandidates = candidates.filter((beneficiary) => beneficiary.user);
    const paidPayouts = await EmpowermentPayout.find({
      program: program._id,
      beneficiary: { $in: linkedCandidates.map((beneficiary) => beneficiary._id) },
    }).select("beneficiary");
    const paidIds = new Set(paidPayouts.map((payout) => String(payout.beneficiary)));
    const beneficiaries = linkedCandidates.filter(
      (beneficiary) => !paidIds.has(String(beneficiary._id))
    );

    return res.status(200).json({
      success: true,
      beneficiaries,
      eligibility: {
        eligibleCount: beneficiaries.length,
        amountPerBeneficiary: Number(program.amountPerBeneficiary || 0),
        financials: programFinancials(program),
      },
    });
  } catch (error) {
    console.error("LIST BULK DISBURSEMENT ELIGIBILITY ERROR:", error);
    return respondError(res, 500, "Unable to load eligible beneficiaries.");
  }
};

const verifyBeneficiary = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return respondError(
        res,
        403,
        "Only an authorized administrator can verify a beneficiary."
      );
    }

    const beneficiary = await EmpowermentBeneficiary.findById(req.params.id);
    if (!beneficiary) {
      return respondError(res, 404, "Beneficiary was not found.");
    }

    const program = await getManagedProgram(req, beneficiary.program);
    if (!program) {
      return respondError(res, 403, "You cannot manage this beneficiary.");
    }
    if (["PAID", "PAYMENT_PENDING", "FAILED", "REVERSED"].includes(
      beneficiary.applicationStatus
    )) {
      return respondError(res, 409, "This beneficiary can no longer be verified.");
    }
    if (beneficiary.applicationStatus !== "UNDER_REVIEW") {
      return respondError(
        res,
        409,
        "Only beneficiaries under review can be verified."
      );
    }

    const verificationStatus = cleanString(
      req.body?.verificationStatus,
      30
    ).toUpperCase();
    if (!["VERIFIED", "REJECTED"].includes(verificationStatus)) {
      return respondError(
        res,
        400,
        "Verification status must be VERIFIED or REJECTED."
      );
    }

    if (
      beneficiary.verificationStatus === verificationStatus &&
      verificationStatus === "VERIFIED"
    ) {
      return res.status(200).json({ success: true, beneficiary });
    }
    if (
      beneficiary.verificationStatus === "VERIFIED" &&
      verificationStatus === "REJECTED"
    ) {
      return respondError(
        res,
        409,
        "A verified beneficiary cannot be rejected."
      );
    }

    const before = {
      applicationStatus: beneficiary.applicationStatus,
      verificationStatus: beneficiary.verificationStatus,
    };
    if (verificationStatus === "VERIFIED") {
      if (!beneficiary.user) {
        return respondError(
          res,
          409,
          "Only a linked ServicePay account can be verified."
        );
      }

      const [account, verifiedKyc] = await Promise.all([
        User.findOne({ _id: beneficiary.user, status: "ACTIVE" }).select(
          "_id status"
        ),
        KycProfile.findOne({
          user: beneficiary.user,
          status: "VERIFIED",
        }),
      ]);
      if (!account) {
        return respondError(
          res,
          409,
          "A beneficiary must have an active ServicePay account."
        );
      }
      if (!verifiedKyc) {
        return respondError(
          res,
          409,
          "A beneficiary can only be verified after ServicePay KYC is verified."
        );
      }

      beneficiary.kycReference = String(verifiedKyc._id);
      beneficiary.kycStatus = "VERIFIED";
      beneficiary.verificationStatus = "VERIFIED";
      beneficiary.verifiedBy = req.user._id;
      beneficiary.verifiedAt = new Date();
      beneficiary.rejectionReason = "";
    } else {
      const rejectionReason = cleanString(req.body?.rejectionReason, 500);
      if (!rejectionReason) {
        return respondError(res, 400, "A rejection reason is required.");
      }
      beneficiary.verificationStatus = "REJECTED";
      beneficiary.kycStatus = "REJECTED";
      beneficiary.verifiedBy = null;
      beneficiary.verifiedAt = null;
      beneficiary.rejectionReason = rejectionReason;
    }

    await beneficiary.save();
    await audit({
      req,
      action: "BENEFICIARY_VERIFICATION_UPDATED",
      entityType: "BENEFICIARY",
      entityId: beneficiary._id,
      program: program._id,
      branchId: program.branchId,
      before,
      after: {
        applicationStatus: beneficiary.applicationStatus,
        verificationStatus: beneficiary.verificationStatus,
      },
    });

    return res.status(200).json({ success: true, beneficiary });
  } catch (error) {
    console.error("VERIFY EMPOWERMENT BENEFICIARY ERROR:", error);
    return respondError(res, 500, "Unable to verify beneficiary.");
  }
};

const updateBeneficiaryStatus = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return respondError(
        res,
        403,
        "Only an authorized administrator can review Empowerment applications."
      );
    }
    const beneficiary = await EmpowermentBeneficiary.findById(req.params.id);
    if (!beneficiary) return respondError(res, 404, "Beneficiary was not found.");

    const program = await getManagedProgram(req, beneficiary.program);
    if (!program) return respondError(res, 403, "You cannot manage this beneficiary.");

    const requestedStatus = cleanString(req.body?.status, 30).toUpperCase();
    const verificationStatus = cleanString(
      req.body?.verificationStatus,
      30
    ).toUpperCase();
    const rejectionReason = cleanString(req.body?.rejectionReason, 500);

    if (!BENEFICIARY_STATUSES.has(requestedStatus)) {
      return respondError(
        res,
        400,
        "Beneficiary status must be submitted, under review, approved or rejected."
      );
    }
    if (beneficiary.applicationStatus === "PAID") {
      return respondError(res, 409, "Paid beneficiaries cannot be modified.");
    }
    if (requestedStatus === "REJECTED" && !rejectionReason) {
      return respondError(res, 400, "A rejection reason is required.");
    }

    if (verificationStatus) {
      if (!isAdmin(req.user)) {
        return respondError(
          res,
          403,
          "Only an authorized administrator can verify a beneficiary."
        );
      }
      if (!["PENDING", "VERIFIED", "REJECTED"].includes(verificationStatus)) {
        return respondError(res, 400, "Invalid verification status.");
      }
      if (verificationStatus === "VERIFIED") {
        const verifiedKyc = beneficiary.user
          ? await KycProfile.findOne({
              user: beneficiary.user,
              status: "VERIFIED",
            })
          : null;
        if (!verifiedKyc) {
          return respondError(
            res,
            409,
            "A beneficiary can only be verified after ServicePay KYC is verified."
          );
        }
        beneficiary.kycReference = String(verifiedKyc._id);
        beneficiary.kycStatus = "VERIFIED";
      }
      beneficiary.verificationStatus = verificationStatus;
      beneficiary.verifiedBy =
        verificationStatus === "VERIFIED" ? req.user._id : null;
      beneficiary.verifiedAt =
        verificationStatus === "VERIFIED" ? new Date() : null;
    }

    if (requestedStatus === "APPROVED") {
      const verifiedKyc = beneficiary.user
        ? await KycProfile.findOne({
            user: beneficiary.user,
            status: "VERIFIED",
          })
        : null;
      if (beneficiary.verificationStatus !== "VERIFIED") {
        return respondError(
          res,
          409,
          "Verify the beneficiary before approval."
        );
      }
      if (!beneficiary.user) {
        return respondError(
          res,
          409,
          "Only a linked ServicePay account can be approved for wallet disbursement."
        );
      }
      if (!verifiedKyc) {
        return respondError(
          res,
          409,
          "ServicePay KYC must be verified before beneficiary approval."
        );
      }
      beneficiary.kycReference = String(verifiedKyc._id);
      beneficiary.kycStatus = "VERIFIED";
    }

    const before = {
      applicationStatus: beneficiary.applicationStatus,
      verificationStatus: beneficiary.verificationStatus,
    };
    beneficiary.applicationStatus = requestedStatus;
    beneficiary.rejectionReason =
      requestedStatus === "REJECTED" ? rejectionReason : "";
    await beneficiary.save();

    const approvedCount = await EmpowermentBeneficiary.countDocuments({
      program: program._id,
      applicationStatus: "APPROVED",
    });
    await EmpowermentProgram.updateOne(
      { _id: program._id },
      { $set: { totalApproved: approvedCount } }
    );
    await audit({
      req,
      action: "BENEFICIARY_STATUS_UPDATED",
      entityType: "BENEFICIARY",
      entityId: beneficiary._id,
      program: program._id,
      branchId: program.branchId,
      before,
      after: {
        applicationStatus: beneficiary.applicationStatus,
        verificationStatus: beneficiary.verificationStatus,
      },
    });

    return res.status(200).json({ success: true, beneficiary });
  } catch (error) {
    console.error("UPDATE EMPOWERMENT BENEFICIARY STATUS ERROR:", error);
    return respondError(res, 500, "Unable to update beneficiary status.");
  }
};

const applyForProgram = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let beneficiary = null;
    await session.withTransaction(async () => {
      const program = await EmpowermentProgram.findOne({
        _id: req.params.programId,
        ...branchFilterFor(req),
      }).session(session);
      if (!program) {
        throw Object.assign(new Error("Empowerment program was not found."), {
          status: 404,
        });
      }
      const now = new Date();
      if (
        !program.publicApplicationEnabled ||
        !["OPEN", "APPROVED"].includes(program.status) ||
        (program.startDate && program.startDate > now) ||
        (program.endDate && program.endDate < now)
      ) {
        throw Object.assign(
          new Error("This program is not accepting applications."),
          { status: 409 }
        );
      }
      await requireActiveOrganization(program, session);

      const payload = await buildBeneficiaryPayload(
        program,
        {
          ...req.body,
          fullName: req.user.fullName,
          phone: req.user.phone,
          email: req.user.email,
          state: req.body?.state || req.user.state,
          lga: req.body?.lga || req.user.lga,
        },
        session
      );
      if (!payload.fullName || !payload.normalizedPhone || !payload.state) {
        throw Object.assign(
          new Error(
            "State and your verified ServicePay profile details are required."
          ),
          { status: 400 }
        );
      }
      await reserveBeneficiaryCapacity({ program, quantity: 1, session });
      beneficiary = (
        await EmpowermentBeneficiary.create(
          [
            {
              ...payload,
              user: req.user._id,
              branchId: program.branchId,
              metadata: {
                source: "SELF_APPLICATION",
                eligibilityDeclaration: cleanString(
                  req.body?.eligibilityDeclaration,
                  1000
                ),
              },
            },
          ],
          { session }
        )
      )[0];
      await audit({
        req,
        action: "BENEFICIARY_APPLIED",
        entityType: "BENEFICIARY",
        entityId: beneficiary._id,
        program: program._id,
        branchId: program.branchId,
        after: { applicationStatus: beneficiary.applicationStatus },
        session,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Empowerment application submitted for review.",
      beneficiary,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return respondError(res, 409, "You have already applied for this program.");
    }
    console.error("EMPOWERMENT SELF APPLICATION ERROR:", error);
    return respondError(
      res,
      error.status || 500,
      error.message || "Unable to submit empowerment application."
    );
  } finally {
    await session.endSession();
  }
};

const getMyApplications = async (req, res) => {
  try {
    const applications = await EmpowermentBeneficiary.find({
      user: req.user._id,
      ...branchFilterFor(req),
    })
      .populate({
        path: "program",
        populate: { path: "organization", select: "name status" },
      })
      .sort({ createdAt: -1 });
    return res.status(200).json({ success: true, applications });
  } catch (error) {
    console.error("GET MY EMPOWERMENT APPLICATIONS ERROR:", error);
    return respondError(res, 500, "Unable to load your applications.");
  }
};

const listAvailablePrograms = async (req, res) => {
  try {
    const now = new Date();
    const allPrograms = await EmpowermentProgram.find({
      ...branchFilterFor(req),
      publicApplicationEnabled: true,
      status: { $in: ["OPEN", "APPROVED"] },
      $and: [
        { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
      ],
    })
      .populate("organization", "name status state")
      .sort({ createdAt: -1 });
    const programs = allPrograms.filter(
      (program) => isProgramEligibleOrganization(program.organization)
    );

    return res.status(200).json({ success: true, programs });
  } catch (error) {
    console.error("LIST AVAILABLE EMPOWERMENT PROGRAMS ERROR:", error);
    return respondError(res, 500, "Unable to load available programs.");
  }
};

const bulkAddBeneficiaries = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const rows = Array.isArray(req.body?.beneficiaries)
      ? req.body.beneficiaries
      : [];

    if (!rows.length || rows.length > 200) {
      return respondError(res, 400, "Submit between 1 and 200 beneficiaries.");
    }
    let beneficiaries = [];
    await session.withTransaction(async () => {
      const program = await getManagedProgram(req, req.params.programId, session);
      if (!program) {
        throw Object.assign(new Error("You cannot manage this program."), {
          status: 403,
        });
      }
      if (["SUSPENDED", "CANCELLED", "COMPLETED"].includes(program.status)) {
        throw Object.assign(
          new Error("This program is not accepting beneficiaries."),
          { status: 409 }
        );
      }
      await requireActiveOrganization(program, session);

      const seen = new Set();
      const records = [];
      for (const row of rows) {
        const phone = normalizePhone(row?.phone);
        if (!phone || !cleanString(row?.fullName) || seen.has(phone)) {
          throw Object.assign(
            new Error(
              "Every uploaded beneficiary needs a unique full name and phone."
            ),
            { status: 400 }
          );
        }
        seen.add(phone);
        records.push(await buildBeneficiaryPayload(program, row, session));
      }

      await reserveBeneficiaryCapacity({
        program,
        quantity: records.length,
        session,
      });
      beneficiaries = await EmpowermentBeneficiary.insertMany(
        records.map((record, index) => ({
          ...record,
          branchId: program.branchId,
          metadata: { source: "BULK_UPLOAD", rowNumber: index + 1 },
        })),
        { ordered: true, session }
      );
      await audit({
        req,
        action: "BENEFICIARIES_BULK_ADDED",
        entityType: "PROGRAM",
        entityId: program._id,
        program: program._id,
        branchId: program.branchId,
        after: { count: beneficiaries.length },
        session,
      });
    });

    return res.status(201).json({
      success: true,
      added: beneficiaries.length,
      beneficiaries,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return respondError(res, 409, "One or more beneficiaries already exist.");
    }
    console.error("BULK EMPOWERMENT BENEFICIARY ERROR:", error);
    return respondError(
      res,
      error.status || 500,
      error.message || "Unable to add beneficiaries."
    );
  } finally {
    await session.endSession();
  }
};

const getProgramStatistics = async (req, res) => {
  try {
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) return respondError(res, 403, "You cannot view this program.");

    const rows = await EmpowermentBeneficiary.aggregate([
      { $match: { program: program._id } },
      { $group: { _id: "$applicationStatus", count: { $sum: 1 } } },
    ]);
    const counts = {
      pending: 0,
      approved: 0,
      rejected: 0,
      paid: 0,
      failed: 0,
      total: 0,
    };
    for (const row of rows) {
      const count = Number(row.count || 0);
      counts.total += count;
      if (row._id === "APPROVED") counts.approved = count;
      if (row._id === "REJECTED") counts.rejected = count;
      if (row._id === "PAID") counts.paid = count;
      if (row._id === "FAILED") counts.failed = count;
      if (["SUBMITTED", "UNDER_REVIEW", "PAYMENT_PENDING"].includes(row._id)) {
        counts.pending += count;
      }
    }

    const financials = programFinancials(program);
    return res.status(200).json({
      success: true,
      program,
      statistics: {
        ...counts,
        ...financials,
        totalFunded: financials.totalFunded,
        totalDisbursed: financials.totalDisbursed,
        remainingProgramFunding: financials.remainingBalance,
      },
    });
  } catch (error) {
    console.error("EMPOWERMENT PROGRAM STATS ERROR:", error);
    return respondError(res, 500, "Unable to load program statistics.");
  }
};

const fundProgram = async (req, res) => {
  const session = await mongoose.startSession();
  let idempotencyKey = "";
  let requestedAmount = null;
  try {
    if (!isHeadOffice(req.user)) {
      return respondError(
        res,
        403,
        "Only Head Office can fund or top up Empowerment programs."
      );
    }

    const amount = asMoney(req.body?.amount);
    requestedAmount = amount;
    idempotencyKey = getIdempotencyKey(req);
    if (!amount || !idempotencyKey || idempotencyKey.length < 12) {
      return respondError(
        res,
        400,
        "A positive amount and an Idempotency-Key of at least 12 characters are required."
      );
    }
    const note = String(req.body?.note || "").trim();
    const sourceReference = String(req.body?.reference || "").trim();
    if (note.length > 1000 || sourceReference.length > 200) {
      return respondError(res, 400, "Funding reference or note is too long.");
    }

    let duplicate = null;
    let funding = null;
    let financials = null;
    await session.withTransaction(async () => {
      const existing = await EmpowermentFunding.findOne({ idempotencyKey }).session(
        session
      );
      if (existing) {
        if (documentId(existing.fundedBy) !== actorId(req) ||
          !hasBranchAccess(req, existing)) {
          throw Object.assign(new Error("Idempotency key is already in use."), {
            status: 409,
          });
        }
        if (
          documentId(existing.program) !== String(req.params.programId) ||
          Number(existing.amount) !== amount
        ) {
          throw Object.assign(
            new Error(
              "Idempotency key belongs to a different program funding request."
            ),
            { status: 409 }
          );
        }
        duplicate = existing;
        const existingProgram = await EmpowermentProgram.findById(
          existing.program
        ).session(session);
        financials = programFinancials(existingProgram);
        return;
      }

      const program = await getManagedProgram(req, req.params.programId, session);
      if (!program) {
        throw Object.assign(new Error("You cannot fund this program."), { status: 403 });
      }
      if (!["APPROVED", "DISBURSING"].includes(program.status)) {
        throw Object.assign(
          new Error("Program must be approved before it can receive funding."),
          { status: 409 }
        );
      }
      await requireActiveOrganization(program, session);

      const reference = buildReference("EMPF");
      const before = programFinancials(program);
      const fundedAmount = Number((before.fundedAmount + amount).toFixed(2));
      const remainingBalance = Number(
        (fundedAmount - before.totalDisbursedAmount).toFixed(2)
      );

      const updatedProgram = await EmpowermentProgram.findOneAndUpdate(
        {
          _id: program._id,
        },
        {
          $set: {
            totalFunded: fundedAmount,
            totalFundedAmount: fundedAmount,
            totalDisbursed: before.totalDisbursedAmount,
            totalDisbursedAmount: before.totalDisbursedAmount,
            remainingBalance,
            availableFundingAmount: remainingBalance,
            lastFundedAt: new Date(),
            lastFundedBy: req.user._id,
          },
        },
        { new: true, session }
      );
      if (!updatedProgram) {
        throw new Error("Program funding balance changed. Please retry safely.");
      }

      funding = (
        await EmpowermentFunding.create(
          [
            {
              organization: program.organization,
              program: program._id,
          branchId: program.branchId,
              fundedBy: req.user._id,
              amount,
              reference,
              idempotencyKey,
              sourceReference,
              note,
            },
          ],
          { session }
        )
      )[0];
      financials = programFinancials(updatedProgram);

      await audit({
        req,
        action: "PROGRAM_FUNDED",
        entityType: "FUNDING",
        entityId: funding._id,
        program: program._id,
        branchId: program.branchId,
        reference,
        after: programFinancials(updatedProgram),
        metadata: {
          amount,
          fundingReference: sourceReference,
          note,
          fundingType: "PROGRAM_LEDGER_CREDIT",
        },
        session,
      });
    });

    return res.status(duplicate ? 200 : 201).json({
      success: true,
      idempotent: Boolean(duplicate),
      funding: duplicate || funding,
      financials,
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await EmpowermentFunding.findOne({ idempotencyKey });
      if (existing) {
        if (
          documentId(existing.fundedBy) !== actorId(req) ||
          documentId(existing.program) !== String(req.params.programId) ||
          Number(existing.amount) !== requestedAmount
        ) {
          return respondError(
            res,
            409,
            "Idempotency key is already in use for a different funding request."
          );
        }
        const program = await EmpowermentProgram.findById(existing.program);
        return res.status(200).json({
          success: true,
          idempotent: true,
          funding: existing,
          financials: programFinancials(program),
        });
      }
    }
    console.error("FUND EMPOWERMENT PROGRAM ERROR:", error);
    return respondError(res, error.status || 500, error.message || "Unable to fund program.");
  } finally {
    await session.endSession();
  }
};

const listProgramFunding = async (req, res) => {
  try {
    if (!isHeadOffice(req.user) && !req.staffAccess) {
      return respondError(res, 403, "Only authorized staff can view program funding history.");
    }
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) return respondError(res, 403, "You cannot view this program.");

    const funding = await EmpowermentFunding.find({
      program: program._id,
      ...branchFilterFor(req),
    })
      .populate(
        "fundedBy",
        mayViewEmpowermentPii(req) ? "fullName phone role" : "_id"
      )
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Math.max(1, Number(req.query?.limit || 50))));

    return res.status(200).json({
      success: true,
      financials: programFinancials(program),
      funding,
    });
  } catch (error) {
    console.error("LIST EMPOWERMENT FUNDING ERROR:", error);
    return respondError(res, 500, "Unable to load program funding history.");
  }
};

const createDisbursementPreview = async (req, res) => {
  try {
    if (!isHeadOffice(req.user)) {
      return respondError(
        res,
        403,
        "Only Head Office can prepare Empowerment disbursement previews."
      );
    }
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) return respondError(res, 403, "You cannot view this program.");
    await requireActiveOrganization(program);

    const beneficiaries = await EmpowermentBeneficiary.find({
      program: program._id,
      applicationStatus: "APPROVED",
      verificationStatus: "VERIFIED",
      user: { $ne: null },
    }).select("_id user amount");
    const totalAmount =
      beneficiaries.length * Number(program.amountPerBeneficiary || 0);
    const payable = beneficiaries.length > 0 &&
      totalAmount > 0 &&
      Number(program.availableFundingAmount || 0) >= totalAmount;

    return res.status(200).json({
      success: true,
      preview: {
        approvedVerifiedBeneficiaries: beneficiaries.length,
        amountPerBeneficiary: Number(program.amountPerBeneficiary || 0),
        totalAmount,
        availableFunding: Number(program.availableFundingAmount || 0),
        financials: programFinancials(program),
        payable,
      },
    });
  } catch (error) {
    console.error("EMPOWERMENT DISBURSEMENT PREVIEW ERROR:", error);
    return respondError(res, 500, "Unable to prepare disbursement preview.");
  }
};

const disburseProgram = async (req, res) => {
  const session = await mongoose.startSession();
  let idempotencyKey = "";
  let requestedSelection = null;
  const bulkDisbursement = req.body?.bulkDisbursement === true;
  try {
    if (!isHeadOffice(req.user)) {
      return respondError(
        res,
        403,
        "Only Head Office can disburse Empowerment funds."
      );
    }

    const beneficiaryIds = selectedBeneficiaryIds(req);
    requestedSelection = beneficiaryIds ? [...beneficiaryIds].sort() : null;
    idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey || idempotencyKey.length < 12) {
      return respondError(
        res,
        400,
        "An Idempotency-Key of at least 12 characters is required."
      );
    }

    let duplicate = null;
    let batch = null;
    await session.withTransaction(async () => {
      const existing = await EmpowermentDisbursement.findOne({
        idempotencyKey,
      }).session(session);
      if (existing) {
        if (documentId(existing.createdBy) !== actorId(req) ||
          !hasBranchAccess(req, existing)) {
          throw Object.assign(new Error("Idempotency key is already in use."), {
            status: 409,
          });
        }
        const recordedSelection = Array.isArray(
          existing.metadata?.selectedBeneficiaryIds
        )
          ? existing.metadata.selectedBeneficiaryIds
          : null;
        const selectionMatches =
          requestedSelection === null
            ? recordedSelection === null
            : sameIdSet(recordedSelection || existing.beneficiaryIds, requestedSelection);
        if (
          documentId(existing.program) !== String(req.params.programId) ||
          !selectionMatches
        ) {
          throw Object.assign(
            new Error(
              "Idempotency key belongs to a different Empowerment disbursement request."
            ),
            { status: 409 }
          );
        }
        duplicate = existing;
        return;
      }

      const program = await getManagedProgram(req, req.params.programId, session);
      if (!program) {
        throw Object.assign(new Error("You cannot disburse this program."), {
          status: 403,
        });
      }
      const normalizedProgramStatus = String(program.status || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
      if (!["APPROVED", "DISBURSING"].includes(normalizedProgramStatus)) {
        throw Object.assign(new Error("Program must be approved before disbursement."), {
          status: 409,
        });
      }
      await requireActiveOrganization(program, session);
      await reconcileProgramFunding(program, session);

      const beneficiaryFilter = {
        program: program._id,
        applicationStatus: "APPROVED",
        verificationStatus: "VERIFIED",
        user: { $ne: null },
        paymentReference: { $in: [null, ""] },
        paidAt: null,
      };
      if (beneficiaryIds) {
        beneficiaryFilter._id = { $in: beneficiaryIds };
      }

      const beneficiaries = await EmpowermentBeneficiary.find(beneficiaryFilter)
        .sort({ createdAt: 1 })
        .session(session);
      if (!beneficiaries.length) {
        throw Object.assign(new Error("No verified approved beneficiaries are payable."), {
          status: 409,
        });
      }
      if (beneficiaryIds && beneficiaries.length !== beneficiaryIds.length) {
        throw Object.assign(
          new Error(
            "Every selected beneficiary must be approved, verified, linked to this program, and unpaid."
          ),
          { status: 409 }
        );
      }

      const existingPayout = await EmpowermentPayout.findOne({
        program: program._id,
        beneficiary: { $in: beneficiaries.map((beneficiary) => beneficiary._id) },
      }).session(session);
      if (existingPayout) {
        throw Object.assign(
          new Error("A beneficiary in this batch has already been paid."),
          { status: 409 }
        );
      }

      const amount = Number(program.amountPerBeneficiary || 0);
      const totalAmount = Math.round((amount * beneficiaries.length + Number.EPSILON) * 100) / 100;
      if (!amount || !totalAmount) {
        throw Object.assign(new Error("Program disbursement amount is invalid."), {
          status: 409,
        });
      }

      const recipients = await User.find({
        _id: { $in: beneficiaries.map((beneficiary) => beneficiary.user) },
        status: "ACTIVE",
        walletBalance: { $gte: 0 },
      }).session(session);
      if (recipients.length !== beneficiaries.length) {
        throw Object.assign(
          new Error("Every approved beneficiary must have an active ServicePay wallet."),
          { status: 409 }
        );
      }

      const batchReference = buildReference("EMPD");
      batch = (
        await EmpowermentDisbursement.create(
          [
            {
              organization: program.organization,
              program: program._id,
              branchId: program.branchId,
              batchReference,
              idempotencyKey,
              beneficiaryCount: beneficiaries.length,
              amountPerBeneficiary: amount,
              totalAmount,
              status: "PROCESSING",
              beneficiaryIds: beneficiaries.map((beneficiary) => beneficiary._id),
              createdBy: req.user._id,
              metadata: {
                selectedBeneficiaryIds: requestedSelection,
                disbursementType: bulkDisbursement ? "BULK" : "SINGLE",
              },
            },
          ],
          { session }
        )
      )[0];

      const fundedProgram = await EmpowermentProgram.findOneAndUpdate(
        {
          _id: program._id,
          remainingBalance: { $gte: totalAmount },
        },
        {
          $set: {
            totalFunded: programFinancials(program).fundedAmount,
            totalFundedAmount: programFinancials(program).fundedAmount,
            totalDisbursed: Number(
              (programFinancials(program).totalDisbursedAmount + totalAmount).toFixed(2)
            ),
            totalDisbursedAmount: Number(
              (programFinancials(program).totalDisbursedAmount + totalAmount).toFixed(2)
            ),
            remainingBalance: Number(
              (programFinancials(program).availableBalance - totalAmount).toFixed(2)
            ),
            availableFundingAmount: Number(
              (programFinancials(program).availableBalance - totalAmount).toFixed(2)
            ),
            status: "DISBURSING",
          },
          $inc: {
            totalPaid: beneficiaries.length,
          },
        },
        { new: true, session }
      );
      if (!fundedProgram) {
        throw Object.assign(new Error("Program funding is insufficient."), {
          status: 409,
        });
      }

      const recipientsById = new Map(
        recipients.map((recipient) => [String(recipient._id), recipient])
      );
      const results = [];
      for (let index = 0; index < beneficiaries.length; index += 1) {
        const beneficiary = beneficiaries[index];
        const recipient = recipientsById.get(String(beneficiary.user));
        const credited = await User.findOneAndUpdate(
          { _id: recipient._id, status: "ACTIVE" },
          { $inc: { walletBalance: amount, totalTransactions: 1 } },
          { new: true, session, runValidators: true }
        );
        if (!credited) throw new Error("Unable to credit a beneficiary wallet.");

        const reference = `${batchReference}-${String(index + 1).padStart(3, "0")}`;
        const transaction = (
          await Transaction.create(
            [
              {
                reference,
                customerId: credited._id,
                serviceType: "EMPOWERMENT_DISBURSEMENT",
                provider: "SERVICEPAY",
                phone: credited.phone,
                amount,
                status: "SUCCESSFUL",
                providerResponse: {
                  transactionDirection: "CREDIT",
                  narration: "ServicePay Empowerment Disbursement",
                  organizationId: String(program.organization),
                  programId: String(program._id),
                  beneficiaryId: String(beneficiary._id),
                  batchReference,
                  payer: String(req.user._id),
                  walletBalanceBefore: Number(
                    (Number(credited.walletBalance) - amount).toFixed(2)
                  ),
                  walletBalanceAfter: Number(credited.walletBalance),
                },
              },
            ],
            { session }
          )
        )[0];

        await postCredit({
          userId: credited._id,
          amount,
          openingBalance: Number((Number(credited.walletBalance) - amount).toFixed(2)),
          closingBalance: Number(credited.walletBalance),
          service: "EMPOWERMENT_DISBURSEMENT",
          reference,
          idempotencyKey: `EMPOWERMENT:${batch._id}:${beneficiary._id}:CREDIT`,
          transactionId: transaction._id,
          relatedUser: req.user._id,
          narration: `Empowerment disbursement for ${program.name}`,
          metadata: {
            programId: String(program._id),
            beneficiaryId: String(beneficiary._id),
            batchReference,
          },
          session,
        });

        await EmpowermentPayout.create(
          [
            {
              program: program._id,
              disbursement: batch._id,
              branchId: program.branchId,
              beneficiary: beneficiary._id,
              recipient: credited._id,
              amount,
              walletBalanceBefore: Number(
                (Number(credited.walletBalance) - amount).toFixed(2)
              ),
              walletBalanceAfter: Number(credited.walletBalance),
              reference,
              transaction: transaction._id,
            },
          ],
          { session }
        );
        results.push({
          beneficiary: beneficiary._id,
          recipient: credited._id,
          amount,
          walletBalanceBefore: Number(
            (Number(credited.walletBalance) - amount).toFixed(2)
          ),
          walletBalanceAfter: Number(credited.walletBalance),
          transactionReference: reference,
          status: "SUCCESSFUL",
        });
      }

      await EmpowermentBeneficiary.updateMany(
        {
          _id: { $in: beneficiaries.map((beneficiary) => beneficiary._id) },
          applicationStatus: "APPROVED",
        },
        {
          $set: {
            applicationStatus: "PAID",
            paidAt: new Date(),
            paymentReference: batchReference,
          },
        },
        { session }
      );

      batch.status = "COMPLETED";
      batch.results = results;
      await batch.save({ session });
      await audit({
        req,
        action: "PROGRAM_DISBURSED",
        entityType: "DISBURSEMENT",
        entityId: batch._id,
        program: program._id,
        branchId: program.branchId,
        reference: batchReference,
        after: {
          beneficiaryCount: beneficiaries.length,
          totalAmount,
          status: "COMPLETED",
        },
        session,
      });
    });

    const currentProgram = await EmpowermentProgram.findById(
      req.params.programId
    );
    const results = Array.isArray((duplicate || batch)?.results)
      ? (duplicate || batch).results
      : [];
    const successful = results.filter(
      (result) => String(result?.status || "").toUpperCase() === "SUCCESSFUL"
    );
    const failed = results.filter(
      (result) => String(result?.status || "").toUpperCase() === "FAILED"
    );

    return res.status(duplicate ? 200 : 201).json({
      success: true,
      idempotent: Boolean(duplicate),
      batch: duplicate || batch,
      financials: programFinancials(currentProgram),
      resultSummary: {
        successful,
        skipped: [],
        failed,
        totalAmountPaid: successful.reduce(
          (total, result) => total + Number(result?.amount || 0),
          0
        ),
        remainingProgramBalance: programFinancials(currentProgram)
          .remainingBalance,
      },
    });
  } catch (error) {
    if (error?.code === 11000 && idempotencyKey) {
      const existing = await EmpowermentDisbursement.findOne({
        idempotencyKey,
      });
      if (existing) {
        const recordedSelection = Array.isArray(
          existing.metadata?.selectedBeneficiaryIds
        )
          ? existing.metadata.selectedBeneficiaryIds
          : null;
        const selectionMatches =
          requestedSelection === null
            ? recordedSelection === null
            : sameIdSet(recordedSelection || existing.beneficiaryIds, requestedSelection);
        if (
          documentId(existing.createdBy) !== actorId(req) ||
          documentId(existing.program) !== String(req.params.programId) ||
          !selectionMatches
        ) {
          return respondError(
            res,
            409,
            "Idempotency key is already in use for a different disbursement request."
          );
        }
        return res.status(200).json({
          success: true,
          idempotent: true,
          batch: existing,
          financials: programFinancials(
            await EmpowermentProgram.findById(existing.program)
          ),
          resultSummary: {
            successful: Array.isArray(existing.results)
              ? existing.results.filter(
                  (result) =>
                    String(result?.status || "").toUpperCase() ===
                    "SUCCESSFUL"
                )
              : [],
            skipped: [],
            failed: Array.isArray(existing.results)
              ? existing.results.filter(
                  (result) =>
                    String(result?.status || "").toUpperCase() === "FAILED"
                )
              : [],
            totalAmountPaid: Array.isArray(existing.results)
              ? existing.results
                  .filter(
                    (result) =>
                      String(result?.status || "").toUpperCase() ===
                      "SUCCESSFUL"
                  )
                  .reduce(
                    (total, result) => total + Number(result?.amount || 0),
                    0
                  )
              : 0,
            remainingProgramBalance: programFinancials(
              await EmpowermentProgram.findById(existing.program)
            ).remainingBalance,
          },
        });
      }
    }
    console.error("EMPOWERMENT DISBURSEMENT ERROR:", error);
    return respondError(
      res,
      error.status || (error?.code === 11000 ? 409 : 500),
      error.message || "Disbursement could not be completed safely."
    );
  } finally {
    await session.endSession();
  }
};

const disburseBeneficiary = async (req, res) => {
  req.body = {
    ...(req.body || {}),
    beneficiaryIds: [req.params.beneficiaryId],
  };
  return disburseProgram(req, res);
};

const bulkDisburseProgram = async (req, res) => {
  let beneficiaryIds;
  try {
    beneficiaryIds = selectedBeneficiaryIds(req);
  } catch (error) {
    return respondError(res, error.status || 400, error.message);
  }

  if (!beneficiaryIds) {
    return respondError(
      res,
      400,
      "Select at least one beneficiary for bulk disbursement."
    );
  }

  req.body = {
    ...(req.body || {}),
    beneficiaryIds,
    bulkDisbursement: true,
  };
  return disburseProgram(req, res);
};

const prepareDisbursementBatch = async (req, res) =>
  respondError(
    res,
    410,
    "Preview batches are retired. Use the secured program disbursement endpoint."
  );

const listDisbursementBatches = async (req, res) => {
  try {
    if (!isHeadOffice(req.user) && !req.staffAccess) {
      return respondError(
        res,
        403,
        "Only authorized staff can view Empowerment disbursement history."
      );
    }
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) return respondError(res, 403, "You cannot view this program.");
    const [batches, statusTotals] = await Promise.all([
      EmpowermentDisbursement.find({
        program: program._id,
        ...branchFilterFor(req),
      })
        .populate("organization", "name status")
        .populate(
          "createdBy",
          mayViewEmpowermentPii(req) ? "fullName phone" : "_id"
        )
        .populate(
          "results.beneficiary",
          mayViewEmpowermentPii(req)
            ? "fullName phone applicationStatus verificationStatus"
            : "_id applicationStatus verificationStatus"
        )
        .populate(
          "results.recipient",
          mayViewEmpowermentPii(req) ? "fullName phone email" : "_id"
        )
        .sort({ createdAt: -1 }),
      EmpowermentDisbursement.aggregate([
        { $match: { program: program._id, ...branchFilterFor(req) } },
        { $unwind: "$results" },
        {
          $group: {
            _id: "$results.status",
            count: { $sum: 1 },
            amount: { $sum: "$results.amount" },
          },
        },
      ]),
    ]);
    const totals = Object.fromEntries(
      statusTotals.map((row) => [
        String(row._id || "").toUpperCase(),
        { count: Number(row.count || 0), amount: Number(row.amount || 0) },
      ])
    );
    const successful = totals.SUCCESSFUL || { count: 0, amount: 0 };
    const failed = totals.FAILED || { count: 0, amount: 0 };
    const pending = totals.PENDING || { count: 0, amount: 0 };
    const financials = programFinancials(program);
    return res.status(200).json({
      success: true,
      batches,
      summary: {
        totalDisbursed: successful.amount,
        successfulCount: successful.count,
        failedCount: failed.count,
        pendingCount: pending.count,
        remainingProgramFunding: financials.remainingBalance,
        remainingProgramBudget: financials.remainingBalance,
      },
    });
  } catch (error) {
    console.error("LIST EMPOWERMENT DISBURSEMENTS ERROR:", error);
    return respondError(res, 500, "Unable to load disbursements.");
  }
};

const getProgramReport = async (req, res) => {
  try {
    const program = await getManagedProgram(req, req.params.programId);
    if (!program) return respondError(res, 403, "You cannot view this report.");

    const [statistics, fundings, disbursements] = await Promise.all([
      EmpowermentBeneficiary.aggregate([
        { $match: { program: program._id, ...branchFilterFor(req) } },
        { $group: { _id: "$applicationStatus", count: { $sum: 1 } } },
      ]),
      EmpowermentFunding.find({ program: program._id, ...branchFilterFor(req) })
        .populate(
          "fundedBy",
          mayViewEmpowermentPii(req) ? "fullName phone" : "_id"
        )
        .sort({ createdAt: -1 }),
      EmpowermentDisbursement.find({ program: program._id, ...branchFilterFor(req) })
        .populate(
          "createdBy",
          mayViewEmpowermentPii(req) ? "fullName phone" : "_id"
        )
        .sort({ createdAt: -1 }),
    ]);

    const financials = programFinancials(program);
    return res.status(200).json({
      success: true,
      report: {
        generatedAt: new Date().toISOString(),
        program,
        financials: {
          ...financials,
          remainingProgramFunding: financials.remainingBalance,
        },
        beneficiaryStatusCounts: statistics,
        fundings,
        disbursements,
      },
    });
  } catch (error) {
    console.error("EMPOWERMENT PROGRAM REPORT ERROR:", error);
    return respondError(res, 500, "Unable to create program report.");
  }
};

const getEmpowermentDashboardSummary = async (req, res) => {
  try {
    if (!isHeadOffice(req.user) && !req.staffAccess) {
      return respondError(res, 403, "Only Head Office can view Empowerment audit records.");
    }
    const [
      organizations,
      programs,
      beneficiaries,
      programFinancialRows,
      payouts,
    ] =
      await Promise.all([
        EmpowermentOrganization.countDocuments(branchFilterFor(req)),
        EmpowermentProgram.countDocuments(branchFilterFor(req)),
        EmpowermentBeneficiary.aggregate([
          { $match: branchFilterFor(req) },
          { $group: { _id: "$applicationStatus", count: { $sum: 1 } } },
        ]),
        EmpowermentProgram.aggregate([
          { $match: branchFilterFor(req) },
          {
            $group: {
              _id: null,
              totalBudget: { $sum: "$totalBudget" },
              totalFundedAmount: { $sum: "$totalFundedAmount" },
              availableFundingAmount: { $sum: "$availableFundingAmount" },
              totalDisbursedAmount: { $sum: "$totalDisbursedAmount" },
            },
          },
        ]),
        EmpowermentPayout.aggregate([
          { $match: branchFilterFor(req) },
          { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
        ]),
      ]);
    const beneficiaryCount = beneficiaries.reduce(
      (total, row) => total + Number(row.count || 0),
      0
    );
    const financials = programFinancials(programFinancialRows[0]);

    return res.status(200).json({
      success: true,
      summary: {
        organizations,
        programs,
        beneficiaries,
        beneficiaryCount,
        financials,
        totalBudget: financials.totalBudget,
        totalFunded: financials.fundedAmount,
        availableBalance: financials.availableBalance,
        totalDisbursed: financials.totalDisbursedAmount,
        paidBeneficiaries: Number(payouts[0]?.count || 0),
      },
    });
  } catch (error) {
    console.error("EMPOWERMENT DASHBOARD SUMMARY ERROR:", error);
    return respondError(res, 500, "Unable to load Empowerment dashboard.");
  }
};

const getEmpowermentAuditTrail = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return respondError(res, 403, "Administrator access is required.");
    }
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 50)));
    const activity = await EmpowermentAuditLog.find(branchFilterFor(req))
      .populate("actor", "fullName phone role")
      .populate("program", "name")
      .sort({ createdAt: -1 })
      .limit(limit);
    return res.status(200).json({ success: true, activity });
  } catch (error) {
    console.error("EMPOWERMENT AUDIT TRAIL ERROR:", error);
    return respondError(res, 500, "Unable to load Empowerment audit trail.");
  }
};

module.exports = {
  listOrganizations,
  getOrganization,
  createOrganization,
  updateOrganization,
  createProgram,
  listPrograms,
  getSponsorDashboard,
  getProgram,
  updateProgram,
  addBeneficiary,
  listBeneficiaries,
  listEligibleBeneficiaries,
  verifyBeneficiary,
  updateOrganizationStatus,
  updateProgramStatus,
  updateBeneficiaryStatus,
  applyForProgram,
  getMyApplications,
  listAvailablePrograms,
  bulkAddBeneficiaries,
  getProgramStatistics,
  fundProgram,
  listProgramFunding,
  createDisbursementPreview,
  disburseProgram,
  disburseBeneficiary,
  bulkDisburseProgram,
  prepareDisbursementBatch,
  listDisbursementBatches,
  getProgramReport,
  getEmpowermentDashboardSummary,
  getEmpowermentAuditTrail,
  normalizePhone,
  asMoney,
  isAdmin,
  isProgramEligibleOrganization,
};