const mongoose = require("mongoose");
const { Schema } = mongoose;
const oid = (ref, required = false) => ({ type: Schema.Types.ObjectId, ref, required, index: true });
const timestamps = { timestamps: true };
const isMoney = (value) => {
  if (!Number.isFinite(value) || value < 0 || value > 1000000000) return false;
  const minorUnits = Math.round(value * 100);
  return Number.isSafeInteger(minorUnits) &&
    Math.abs(value - minorUnits / 100) < Number.EPSILON * Math.max(1, Math.abs(value)) * 8;
};
const money = {
  type: Number,
  min: 0,
  validate: {
    validator: isMoney,
    message: "Amount must be a finite NGN value with at most two decimals.",
  },
};

const organizationSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 180 },
  slug: { type: String, required: true, unique: true, index: true, immutable: true },
  code: { type: String, required: true, unique: true, index: true, immutable: true },
  description: { type: String, default: "", maxlength: 3000 },
  type: { type: String, default: "ASSOCIATION", trim: true },
  registrationNumber: { type: String, default: "" },
  contact: { name: String, email: String, phone: String, address: String, officialName: String, officialEmail: String, officialPhone: String },
  createdBy: oid("User", true),
  status: { type: String, enum: ["DRAFT", "PENDING_VERIFICATION", "VERIFIED", "REJECTED", "SUSPENDED"], default: "DRAFT", index: true },
  approvedAt: Date, approvedBy: oid("User"), rejectionReason: String,
  membershipMode: { type: String, enum: ["MANUAL", "AUTO"], default: "MANUAL" },
  country: { type: String, default: "NG" }, state: String, lga: String,
  annualFee: { ...money, default: 0 },
  registrationFee: { ...money, default: 0 },
  renewalCycle: { type: String, enum: ["ANNUAL", "MONTHLY", "NONE"], default: "ANNUAL" },
  documents: [{ name: String, storageKey: String, mimeType: String, size: Number }],
  logo: { url: String, publicId: String, mimeType: { type: String, enum: ["image/png", "image/jpeg", "image/webp"] }, width: Number, height: Number },
  membershipNumberSequence: { type: Number, default: 0, min: 0 },
}, timestamps);
organizationSchema.index({ status: 1, createdAt: -1 });

const memberSchema = new Schema({
  organization: oid("Organization", true), user: oid("User", true),
  // Numbers are assigned only when membership becomes ACTIVE.  In particular,
  // do not materialize null here: the partial unique index below must ignore
  // pending members.
  membershipNumber: { type: String },
  year: { type: Number, default: null }, applicationData: { type: Schema.Types.Mixed, default: {} },
  branch: oid("OrganizationBranch"), category: { type: String, default: "" },
  status: { type: String, enum: ["PENDING", "ACTIVE", "REJECTED", "SUSPENDED", "EXPIRED"], default: "PENDING", index: true },
  approvedAt: Date, approvedBy: oid("User"), joinedAt: Date, registrationPaidAt: Date, readyForApproval: { type: Boolean, default: false },
}, timestamps);
// Membership indexes are reconciled explicitly during startup migration. This
// prevents Mongoose's model initialization from racing that operation.
memberSchema.set("autoIndex", false);
memberSchema.index({ organization: 1, user: 1 }, { unique: true });
memberSchema.index(
  { organization: 1, membershipNumber: 1 },
  {
    name: "organization_membership_number_unique",
    unique: true,
    partialFilterExpression: {
      membershipNumber: { $type: "string", $gt: "" },
    },
  }
);

const roleSchema = new Schema({
  organization: oid("Organization", true), user: oid("User", true), role: { type: String, enum: ["OWNER", "ADMIN", "TREASURER", "SECRETARY", "MEMBERSHIP_OFFICER", "AUDITOR", "BRANCH_ADMIN"], required: true }, permissions: { type: [String], enum: ["members.view", "members.create", "members.approve", "members.edit", "members.suspend", "payments.view", "payments.export", "fees.create", "fees.edit", "wallet.view", "wallet.withdraw", "treasury.approve", "treasury.accounts", "reports.view", "reports.export", "messages.send", "staff.manage", "branches.manage", "settings.manage", "audit.view", "cards.manage"], default: [] },
  branch: oid("OrganizationBranch"), active: { type: Boolean, default: true, index: true }, assignedBy: oid("User"),
}, timestamps);
roleSchema.index({ organization: 1, user: 1 }, { unique: true });

const branchSchema = new Schema({ organization: oid("Organization", true), name: { type: String, required: true, trim: true }, code: { type: String, required: true, trim: true }, address: String, active: { type: Boolean, default: true } }, timestamps);
branchSchema.index({ organization: 1, code: 1 }, { unique: true });
const customFieldSchema = new Schema({ organization: oid("Organization", true), key: { type: String, required: true, match: /^[a-z][a-z0-9_]{1,48}$/ }, label: { type: String, required: true }, type: { type: String, enum: ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTISELECT", "FILE", "PHONE", "EMAIL"], required: true }, required: { type: Boolean, default: false }, options: [String], active: { type: Boolean, default: true } }, timestamps);
customFieldSchema.pre("validate", function prohibitRequiredFileField() {
  if (this.type === "FILE" && this.required === true) {
    this.invalidate(
      "required",
      "Required file fields are unavailable until secure document upload is enabled."
    );
  }
});
customFieldSchema.index({ organization: 1, key: 1 }, { unique: true });

const feeSchema = new Schema({ organization: oid("Organization", true), name: { type: String, required: true }, type: { type: String, enum: ["REGISTRATION", "ANNUAL", "OTHER"], default: "OTHER", index: true }, description: String, amount: { ...money, required: true, min: 0.01 }, currency: { type: String, default: "NGN" }, frequency: { type: String, enum: ["ONCE", "ANNUAL", "MONTHLY"], default: "ANNUAL" }, dueDate: Date, active: { type: Boolean, default: true, index: true } }, timestamps);
feeSchema.index({ organization: 1, active: 1, createdAt: -1 });
const assignmentSchema = new Schema({ organization: oid("Organization", true), fee: oid("OrganizationFee", true), member: oid("OrganizationMember", true), amount: { ...money, required: true, min: 0.01 }, billingPeriod: { type: String, required: true, default: "LIFETIME" }, dueDate: Date, status: { type: String, enum: ["ASSIGNED", "PARTIAL", "PAID", "CANCELLED"], default: "ASSIGNED", index: true }, payment: oid("OrganizationPayment"), paymentKey: String, paymentReference: String, assignedBy: oid("User") }, timestamps);
assignmentSchema.index({ organization: 1, member: 1, fee: 1, billingPeriod: 1 }, { unique: true });

const paymentSchema = new Schema({ organization: oid("Organization", true), member: oid("OrganizationMember", true), assignment: oid("OrganizationFeeAssignment", true), payer: oid("User", true), amount: { ...money, required: true, min: 0.01 }, reference: { type: String, required: true, unique: true, index: true }, idempotencyKey: { type: String, required: true }, status: { type: String, enum: ["PENDING", "SUCCESS", "FAILED"], default: "PENDING", index: true }, receiptNumber: { type: String, unique: true, sparse: true }, ledgerEntry: oid("LedgerEntry"), createdAt: { type: Date, default: Date.now } });
paymentSchema.index({ organization: 1, assignment: 1, payer: 1, idempotencyKey: 1 }, { unique: true });
const walletSchema = new Schema({ organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true }, balance: { ...money, default: 0 }, heldBalance: { ...money, default: 0 }, totalMoneyIn: { ...money, default: 0 }, totalWithdrawn: { ...money, default: 0 }, totalFees: { ...money, default: 0 }, currency: { type: String, default: "NGN" }, status: { type: String, enum: ["ACTIVE", "FROZEN"], default: "ACTIVE" } }, timestamps);
walletSchema.index({ organization: 1 }, { unique: true });
const ledgerSchema = new Schema({ organization: oid("Organization", true), type: { type: String, enum: ["CREDIT", "DEBIT", "HOLD", "RELEASE", "FEE"], required: true }, amount: { ...money, required: true, min: 0.01 }, balanceAfter: { ...money, required: true }, reference: { type: String, required: true, unique: true }, payment: oid("OrganizationPayment"), withdrawal: oid("OrganizationWithdrawal"), narration: String, createdBy: oid("User") }, timestamps);
ledgerSchema.index({ organization: 1, createdAt: -1 });
const settlementAccountSchema = new Schema({ organization: oid("Organization", true), bankCode: { type: String, required: true }, bankName: { type: String, required: true }, accountNumber: { type: String, required: true, select: false }, accountNumberLast4: String, accountName: { type: String, required: true }, accountType: String, primary: { type: Boolean, default: false }, status: { type: String, enum: ["PENDING", "VERIFIED", "REJECTED", "DISABLED"], default: "PENDING", index: true }, provider: { type: String, default: "SQUAD" }, rejectionReason: String, reviewedBy: oid("User"), reviewedAt: Date, coolingOffUntil: Date }, timestamps);
settlementAccountSchema.index({ organization: 1, bankCode: 1, accountNumber: 1 }, { unique: true });
settlementAccountSchema.index({ organization: 1, status: 1, createdAt: -1 });
const withdrawalSchema = new Schema({ organization: oid("Organization", true), requestedBy: oid("User", true), approvedBy: oid("User"), approvals: [{ user: oid("User"), role: String, decision: { type: String, enum: ["APPROVE", "REJECT"] }, at: { type: Date, default: Date.now }, reason: String }], settlementAccount: oid("OrganizationSettlementAccount", true), amount: { ...money, required: true }, fee: { ...money, default: 0 }, totalDebit: { ...money, required: true }, currency: { type: String, default: "NGN" }, reference: { type: String }, idempotencyKey: { type: String }, narration: { type: String, maxlength: 200 }, destinationSnapshot: { bankCode: String, bankName: String, accountName: String, accountNumberLast4: String }, status: { type: String, enum: ["INITIATED", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "SUCCESS", "REJECTED", "FAILED", "REVERSED", "CANCELLED", "PENDING_REVIEW"], default: "INITIATED", index: true }, provider: { type: String, default: "SQUAD" }, providerReference: String, providerTransactionId: String, failureReason: String, rejectionReason: String, recoveryDebt: { amount: Number, reason: String, detectedAt: Date }, holdReleasedAt: Date, debitFinalizedAt: Date, requeryLeaseUntil: Date, requeryAttempts: { type: Number, default: 0 }, lastRequeryAt: Date, snapshot: Schema.Types.Mixed }, timestamps);
withdrawalSchema.index({ organization: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } });
withdrawalSchema.index({ organization: 1, reference: 1 }, { unique: true, partialFilterExpression: { reference: { $type: "string" } } });
withdrawalSchema.index({ organization: 1, status: 1, createdAt: -1 });
withdrawalSchema.index({ providerReference: 1 }, { sparse: true });
const treasuryConfigSchema = new Schema({ organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true, unique: true }, authorizationMode: { type: String, enum: ["OWNER_ONLY", "OWNER_AND_TREASURER", "TWO_AUTHORIZED_OFFICERS", "ADMIN_REVIEW"], default: "OWNER_ONLY" }, minimumWithdrawal: { ...money, default: 100 }, maximumWithdrawal: { ...money, default: 50000 }, dailyLimit: { ...money, default: 100000 }, monthlyLimit: { ...money, default: 1000000 }, fee: { ...money, default: 0 }, dailyReserved: { ...money, default: 0 }, monthlyReserved: { ...money, default: 0 }, dailyPeriod: String, monthlyPeriod: String, updatedBy: oid("User") }, timestamps);
const withdrawalSnapshotSchema = new Schema({ withdrawal: oid("OrganizationWithdrawal", true), organization: oid("Organization", true), event: { type: String, required: true }, fromStatus: String, toStatus: String, actor: oid("User"), providerReference: String, metadata: Schema.Types.Mixed }, timestamps);
withdrawalSnapshotSchema.index({ withdrawal: 1, createdAt: 1 });
const announcementSchema = new Schema({ organization: oid("Organization", true), title: { type: String, required: true }, body: { type: String, required: true }, audience: { type: String, enum: ["ALL", "MEMBERS", "STAFF", "BRANCH"], default: "ALL" }, branch: oid("OrganizationBranch"), published: { type: Boolean, default: false }, publishedAt: Date, createdBy: oid("User", true) }, timestamps);
const auditSchema = new Schema({ organization: oid("Organization", true), actor: oid("User"), action: { type: String, required: true }, entityType: String, entityId: Schema.Types.ObjectId, metadata: Schema.Types.Mixed, ip: String }, { timestamps });
auditSchema.index({ organization: 1, createdAt: -1 });
const cardSchema = new Schema({ organization: oid("Organization", true), member: oid("OrganizationMember", true), cardNumber: { type: String, required: true, unique: true, index: true }, issuedAt: { type: Date, default: Date.now }, active: { type: Boolean, default: true } }, timestamps);

const models = {
  Organization: [organizationSchema, "Organization"], OrganizationMember: [memberSchema, "OrganizationMember"],
  OrganizationRole: [roleSchema, "OrganizationRole"], OrganizationBranch: [branchSchema, "OrganizationBranch"],
  OrganizationCustomField: [customFieldSchema, "OrganizationCustomField"], OrganizationFee: [feeSchema, "OrganizationFee"],
  OrganizationFeeAssignment: [assignmentSchema, "OrganizationFeeAssignment"], OrganizationPayment: [paymentSchema, "OrganizationPayment"],
  OrganizationWallet: [walletSchema, "OrganizationWallet"], OrganizationLedger: [ledgerSchema, "OrganizationLedger"],
  OrganizationSettlementAccount: [settlementAccountSchema, "OrganizationSettlementAccount"], OrganizationWithdrawal: [withdrawalSchema, "OrganizationWithdrawal"], OrganizationTreasuryConfig: [treasuryConfigSchema, "OrganizationTreasuryConfig"], OrganizationWithdrawalSnapshot: [withdrawalSnapshotSchema, "OrganizationWithdrawalSnapshot"], OrganizationAnnouncement: [announcementSchema, "OrganizationAnnouncement"],
  OrganizationAuditLog: [auditSchema, "OrganizationAuditLog"], OrganizationMembershipCard: [cardSchema, "OrganizationMembershipCard"],
};
for (const [key, [schema, name]] of Object.entries(models)) models[key] = mongoose.models[name] || mongoose.model(name, schema);
module.exports = models;