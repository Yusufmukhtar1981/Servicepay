const crypto = require("crypto");
const mongoose = require("mongoose");
const models = require("../models/organizations.models");
const User = require("../models/user.model");
const Wallet = require("../models/wallet.model");
const { postDebit } = require("./ledger.service");
const { verifyTransactionPin } = require("./transactionPin.service");

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
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0 || minorUnits > 100000000000) {
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
const ORGANIZATION_PERMISSIONS = Object.freeze(["members.view", "members.create", "members.approve", "members.edit", "members.suspend", "payments.view", "payments.export", "fees.create", "fees.edit", "wallet.view", "wallet.withdraw", "reports.view", "reports.export", "messages.send", "staff.manage", "branches.manage", "settings.manage", "audit.view", "cards.manage"]);
const ORGANIZATION_ROLE_CAPABILITIES = Object.freeze({
  OWNER: ORGANIZATION_PERMISSIONS,
  ADMIN: ORGANIZATION_PERMISSIONS.filter((p) => !["wallet.withdraw", "settings.manage"].includes(p)),
  TREASURER: ["payments.view", "payments.export", "fees.create", "fees.edit", "wallet.view", "reports.view", "reports.export"],
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

async function access(req, organizationId, roles = [], requireOperational = false) {
  if (!mongoose.isValidObjectId(organizationId)) return null;
  const organization = await Organization.findById(organizationId);
  if (!organization) return null;
  const matches = await OrganizationRole.find({ organization: organization._id, user: req.user._id, active: true, ...(roles.length ? { role: { $in: roles } } : {}) });
  if (matches.length > 1) return null;
  const role = matches[0];
  if (requireOperational && organization.status !== "VERIFIED") return null;
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
  if (!organization || (requireOperational && organization.status !== "VERIFIED")) return null;
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
  const row = { organization: organization._id, actor: req.user?._id, action, entityType, entityId, metadata, ip: req.ip };
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
      const allowedTypes = ["ASSOCIATION", "COOPERATIVE", "NGO", "COMPANY", "FOUNDATION", "CLUB", "OTHER"]; const type = clean(req.body?.type, 50).toUpperCase() || "ASSOCIATION";
      if (!allowedTypes.includes(type)) throw Object.assign(new Error("Invalid organization type."), { status: 400 });
      [organization] = await Organization.create([{ name, slug, code: makeCode(), type, description: clean(req.body?.description, 3000), registrationNumber: clean(req.body?.registrationNumber, 100), contact: req.body?.contact || {}, country: clean(req.body?.country, 80) || "NG", state: clean(req.body?.state, 100), lga: clean(req.body?.lga, 100), annualFee, registrationFee, renewalCycle: ["ANNUAL", "MONTHLY", "NONE"].includes(req.body?.renewalCycle) ? req.body.renewalCycle : "ANNUAL", logo, createdBy: req.user._id, status: "DRAFT", membershipMode: req.body?.membershipMode === "AUTO" ? "AUTO" : "MANUAL" }], { session });
      await OrganizationRole.create([{ organization: organization._id, user: req.user._id, role: "OWNER", assignedBy: req.user._id }], { session });
      await OrganizationWallet.create([{ organization: organization._id }], { session });
      await audit(req, organization, "ORGANIZATION_CREATED", "Organization", organization._id, {}, session);
    });
    return organization;
  } finally {
    await session.endSession();
  }
}
async function approveMember(req, member) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const org = await Organization.findById(member.organization).session(session);
      if (!org || org.status !== "VERIFIED") throw Object.assign(new Error("Organization is not verified."), { status: 409 });
      const current = await OrganizationMember.findOne({ _id: member._id }).session(session);
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
    if (!req.body?.transactionPin) throw Object.assign(new Error("Transaction PIN is required."), { status: 400 });
    await verifyTransactionPin(req.user._id, String(req.body.transactionPin));
    let payment;
    await session.withTransaction(async () => {
      const claimed = await models.OrganizationFeeAssignment.findOneAndUpdate({ _id: assignment._id, status: { $in: ["ASSIGNED", "PARTIAL"] }, amount }, { $set: { status: "PAID" } }, { new: true, session });
      if (!claimed) throw Object.assign(new Error("This fee has already been paid or is no longer payable."), { status: 409 });
      const currentMember = await OrganizationMember.findOne({ _id: member._id, organization: member.organization, status: { $in: ["ACTIVE", "PENDING"] } }).session(session);
      const fee = await models.OrganizationFee.findById(claimed.fee).session(session);
      const verifiedOrg = await Organization.findOne({ _id: member.organization, status: "VERIFIED" }).session(session);
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
};