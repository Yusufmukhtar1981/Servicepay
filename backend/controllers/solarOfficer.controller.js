const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const SolarOfficer = require("../models/solarOfficer.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarFinance = require("../models/solarFinance.model");
const SolarPayment = require("../models/solarPayment.model");
const SolarVerification = require("../models/solarVerification.model");
const SolarFollowUp = require("../models/solarFollowUp.model");
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const SolarOfficerWithdrawal = require("../models/solarOfficerWithdrawal.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const {
  createSolarOfficerCommission,
  roundMoney,
} = require("../services/solarOfficerCommission.service");

const text = (value, length = 1000) => String(value || "").trim().slice(0, length);
const actorId = (req) => req.user?._id || req.user?.id;
const problem = (message, statusCode = 409) =>
  Object.assign(new Error(message), { statusCode });
const reference = () =>
  `SSW-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const staffBranchFilter = (req) => req.staffAccess?.scope?.type === "BRANCH"
  ? { branchId: req.staffAccess.scope.branchId } : {};

const audit = (req, action, reason, previousData = null, newData = null, session) =>
  AdminAuditLog.create(
    [
      {
        actorId: actorId(req),
        actorRole: String(req.user?.role || "").toUpperCase(),
        actorName: req.user?.fullName || "",
        action,
        reason: text(reason, 500) || action,
        previousData,
        newData,
        ipAddress: req.ip || "",
        userAgent: req.get?.("user-agent") || "",
        requestMethod: req.method || "",
        requestPath: req.originalUrl || "",
      },
    ],
    { session }
  );

const safeUser = (user) => {
  const value = user?.toObject ? user.toObject() : user || {};
  delete value.password;
  delete value.transactionPin;
  delete value.transactionPinHash;
  return value;
};

const profileForRequest = async (req, session) => {
  const profile = await SolarOfficer.findOne({
    user: actorId(req),
    status: "ACTIVE",
  }).session(session || null);
  if (!profile) throw problem("Your Solar Officer account is not active.", 403);
  if (req.user?.branchId && (!profile.branchId || String(profile.branchId) !== String(req.user.branchId))) {
    throw problem("Your Solar Officer branch assignment is invalid.", 403);
  }
  return profile;
};

const activeAssignment = async (officerId, applicationId, session) =>
  SolarAssignment.findOne({
    officer: officerId,
    application: applicationId,
    status: "ACTIVE",
  }).session(session || null);

const lockActiveAssignment = async (officerId, applicationId, session) =>
  SolarAssignment.findOneAndUpdate(
    {
      officer: officerId,
      application: applicationId,
      status: "ACTIVE",
    },
    { $inc: { authorizationVersion: 1 } },
    { new: true, session }
  );

const serializeAssignment = (assignment) => {
  const value = assignment?.toObject ? assignment.toObject() : assignment;
  return value
    ? {
        ...value,
        officer: value.officer?.toObject
          ? value.officer.toObject()
          : value.officer,
        customer: value.customer?.toObject
          ? safeUser(value.customer)
          : value.customer,
      }
    : null;
};

const paymentStatus = (finance) => {
  if (!finance) return "PENDING";
  if (finance.status === "COMPLETED" || Number(finance.outstandingBalance) <= 0) {
    return "COMPLETED";
  }
  const now = Date.now();
  const next = (finance.paymentSchedule || []).find(
    (row) => Number(row.paidAmount || 0) < Number(row.amount || 0)
  );
  if (next && new Date(next.dueDate).getTime() < now) return "OVERDUE";
  if (next && new Date(next.dueDate).getTime() < now + 7 * 86400000) {
    return "DUE_SOON";
  }
  return "CURRENT";
};

const serializeAssignedApplication = (application, assignment, verification, finance) => {
  const value = application?.toObject ? application.toObject() : application;
  return {
    ...value,
    customer: value.customer?.toObject ? safeUser(value.customer) : value.customer,
    assignment: serializeAssignment(assignment),
    verification: verification?.toObject ? verification.toObject() : verification || null,
    finance: finance?.toObject ? finance.toObject() : finance || null,
    paymentStatus: paymentStatus(finance),
    remainingBalance: roundMoney(finance?.outstandingBalance ?? value.outstandingBalance),
    nextPaymentDate:
      (finance?.paymentSchedule || []).find(
        (row) => Number(row.paidAmount || 0) < Number(row.amount || 0)
      )?.dueDate || null,
  };
};

const getOfficerApplications = async (officerId, applicationId = null, branchId = null) => {
  const assignmentFilter = { officer: officerId, status: "ACTIVE", ...(branchId ? { branchId } : {}) };
  if (applicationId) assignmentFilter.application = applicationId;
  const assignments = await SolarAssignment.find(assignmentFilter)
    .sort({ assignedAt: -1 })
    .populate("customer", "fullName phone email state lga address")
    .populate("officer");
  const applications = await SolarApplication.find({
    _id: { $in: assignments.map((item) => item.application) },
    ...(branchId ? { branchId } : {}),
  })
    .sort({ createdAt: -1 })
    .populate("customer", "fullName phone email state lga address");
  const applicationMap = new Map(applications.map((item) => [String(item._id), item]));
  const verifications = await SolarVerification.find({
    application: { $in: applications.map((item) => item._id) },
  }).lean();
  const verificationMap = new Map(
    verifications.map((item) => [String(item.application), item])
  );
  const finances = await SolarFinance.find({
    application: { $in: applications.map((item) => item._id) },
  }).lean();
  const financeMap = new Map(finances.map((item) => [String(item.application), item]));
  return assignments
    .map((assignment) => {
      const application = applicationMap.get(String(assignment.application));
      return application
        ? serializeAssignedApplication(
            application,
            assignment,
            verificationMap.get(String(application._id)),
            financeMap.get(String(application._id))
          )
        : null;
    })
    .filter(Boolean);
};

const generateOfficerId = async () => {
  let sequence = (await SolarOfficer.countDocuments()) + 1;
  while (sequence < 10000000) {
    const candidate = `SSO-${String(sequence).padStart(6, "0")}`;
    if (!(await SolarOfficer.exists({ officerId: candidate }))) return candidate;
    sequence += 1;
  }
  throw new Error("Unable to generate a Solar Officer ID.");
};

exports.adminListOfficers = async (req, res) => {
  const profiles = await SolarOfficer.find(staffBranchFilter(req))
    .sort({ createdAt: -1 })
    .populate("user", "fullName phone email status state lga address");
  const assignments = await SolarAssignment.aggregate([
    { $match: { status: "ACTIVE", ...staffBranchFilter(req) } },
    { $group: { _id: "$officer", assignedCustomers: { $sum: 1 } } },
  ]);
  const countMap = new Map(assignments.map((item) => [String(item._id), item.assignedCustomers]));
  res.json({
    success: true,
    officers: profiles.map((profile) => ({
      ...profile.toObject(),
      user: safeUser(profile.user),
      assignedCustomers: countMap.get(String(profile._id)) || 0,
    })),
  });
};

exports.adminCreateOfficer = async (req, res) => {
  const fullName = text(req.body?.fullName, 160);
  const phone = text(req.body?.phone, 40);
  const email = text(req.body?.email, 160).toLowerCase();
  const password = String(req.body?.password || "");
  const state = text(req.body?.state, 80);
  const lga = text(req.body?.lga, 80);
  const address = text(req.body?.address, 500);
  if (!fullName || !phone || !email || password.length < 6 || !state || !lga || !address) {
    return res.status(400).json({
      success: false,
      message: "Full name, phone, email, password, state, LGA, and address are required.",
    });
  }

  const session = await mongoose.startSession();
  try {
    let profile;
    await session.withTransaction(async () => {
      const officerId = await generateOfficerId();
      const users = await User.create(
        [
          {
            fullName,
            phone,
            email,
            password,
            role: "SOLAR_OFFICER",
            isStaff: true,
            staffId: officerId,
            department: "OPERATIONS",
            staffCreatedBy: actorId(req),
            state,
            lga,
            address,
            status: "ACTIVE",
            branchId: req.user.branchId || null,
          },
        ],
        { session }
      );
      profile = (
        await SolarOfficer.create(
          [
            {
              user: users[0]._id,
              officerId,
              state,
              lga,
              address,
              status: "ACTIVE",
              dateJoined: req.body?.dateJoined
                ? new Date(req.body.dateJoined)
                : new Date(),
              createdBy: actorId(req),
              branchId: req.user.branchId || null,
            },
          ],
          { session }
        )
      )[0];
      await SolarOfficerWallet.create(
        [{ officer: profile._id }],
        { session }
      );
      await audit(
        req,
        "SOLAR_OFFICER_CREATED",
        "Created ServicePay Solar Officer",
        null,
        { officerId: String(profile._id), generatedOfficerId: officerId },
        session
      );
    });
    const createdUser = await User.findById(profile.user).select("-password");
    res.status(201).json({
      success: true,
      officer: { ...profile.toObject(), user: safeUser(createdUser) },
    });
  } catch (error) {
    res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({
      success: false,
      message:
        error.code === 11000
          ? "An officer with that phone, email, or staff ID already exists."
          : error.message,
    });
  } finally {
    await session.endSession();
  }
};

exports.adminUpdateOfficerStatus = async (req, res) => {
  const status = text(req.body?.status, 20).toUpperCase();
  if (!["ACTIVE", "SUSPENDED", "INACTIVE"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid Solar Officer status." });
  }
  const session = await mongoose.startSession();
  try {
    let profile;
    await session.withTransaction(async () => {
      profile = await SolarOfficer.findOne({
        _id: req.params.officerId, ...staffBranchFilter(req),
      }).session(session);
      if (!profile) throw problem("Solar Officer not found.", 404);
      const previous = profile.status;
      profile.status = status;
      await profile.save({ session });
      await User.updateOne(
        { _id: profile.user },
        { $set: { status: status === "ACTIVE" ? "ACTIVE" : status === "SUSPENDED" ? "SUSPENDED" : "BLOCKED" } },
        { session }
      );
      await audit(
        req,
        "SOLAR_OFFICER_STATUS_UPDATED",
        `Changed Solar Officer status to ${status}`,
        { status: previous, officerId: String(profile._id) },
        { status, officerId: String(profile._id) },
        session
      );
    });
    res.json({ success: true, officer: profile });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.adminListAssignments = async (req, res) => {
  const filter = {
    ...staffBranchFilter(req),
    ...(req.query.status ? { status: text(req.query.status, 20).toUpperCase() } : {}),
  };
  const assignments = await SolarAssignment.find(filter)
    .sort({ assignedAt: -1 })
    .populate("officer")
    .populate("customer", "fullName phone email state lga address")
    .populate("application", "status packageSnapshot approvalSnapshot createdAt");
  res.json({ success: true, assignments: assignments.map(serializeAssignment) });
};

exports.adminAssignApplication = async (req, res) => {
  const officerId = text(req.body?.officerId, 80);
  if (!mongoose.Types.ObjectId.isValid(officerId)) {
    return res.status(400).json({ success: false, message: "A valid Solar Officer is required." });
  }
  const session = await mongoose.startSession();
  try {
    let assignment;
    await session.withTransaction(async () => {
      const application = await SolarApplication.findOne({
        _id: req.params.applicationId,
        ...staffBranchFilter(req),
      }).session(session);
      if (!application) throw problem("Solar application not found.", 404);
      const officer = await SolarOfficer.findOne({
        _id: officerId, status: "ACTIVE", ...staffBranchFilter(req),
      }).session(session);
      if (!officer) throw problem("Active Solar Officer not found.", 404);
      if (String(officer.branchId || "") !== String(application.branchId || "")) {
        throw problem("Solar Officer and application must belong to the same branch.", 409);
      }
      const current = await SolarAssignment.findOne({
        application: application._id,
        status: "ACTIVE",
      }).session(session);
      if (current && String(current.officer) === String(officer._id)) {
        assignment = current;
        return;
      }
      if (current) {
        current.status = "REASSIGNED";
        current.endedAt = new Date();
        await current.save({ session });
      }
      assignment = (
        await SolarAssignment.create(
          [
            {
              application: application._id,
              customer: application.customer,
              officer: officer._id,
              branchId: application.branchId || null,
              assignedBy: actorId(req),
              note: text(req.body?.note, 500),
            },
          ],
          { session }
        )
      )[0];
      await audit(
        req,
        current ? "SOLAR_CUSTOMER_REASSIGNED" : "SOLAR_CUSTOMER_ASSIGNED",
        current ? "Reassigned Solar application" : "Assigned Solar application",
        current ? { officer: String(current.officer) } : null,
        { application: String(application._id), officer: String(officer._id) },
        session
      );
    });
    res.status(201).json({ success: true, assignment });
  } catch (error) {
    res.status(error.statusCode || (error.code === 11000 ? 409 : 500)).json({
      success: false,
      message: error.message,
    });
  } finally {
    await session.endSession();
  }
};

exports.adminOfficerDashboard = async (req, res) => {
  const [profiles, activeAssignments, commissions, withdrawals] = await Promise.all([
    SolarOfficer.countDocuments(staffBranchFilter(req)),
    SolarAssignment.countDocuments({ status: "ACTIVE", ...staffBranchFilter(req) }),
    SolarOfficerCommission.aggregate([
      { $group: { _id: "$status", total: { $sum: "$commissionAmount" }, count: { $sum: 1 } } },
    ]),
    SolarOfficerWithdrawal.aggregate([
      { $group: { _id: "$status", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
  ]);
  const statusCounts = await SolarOfficer.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  res.json({
    success: true,
    dashboard: {
      totalOfficers: profiles,
      activeOfficers: statusCounts.find((row) => row._id === "ACTIVE")?.count || 0,
      suspendedOfficers: statusCounts.find((row) => row._id === "SUSPENDED")?.count || 0,
      customersAssigned: activeAssignments,
      commissions,
      withdrawals,
    },
  });
};

exports.adminListWithdrawals = async (req, res) => {
  const filter = {
    ...staffBranchFilter(req),
    ...(req.query.status ? { status: text(req.query.status, 20).toUpperCase() } : {}),
  };
  const withdrawals = await SolarOfficerWithdrawal.find(filter)
    .sort({ requestedAt: -1 })
    .populate({ path: "officer", populate: { path: "user", select: "fullName phone email" } });
  res.json({ success: true, withdrawals });
};

// Withdrawals predate branch stamping, so do not trust a stored branch alone.
// The officer profile is the authoritative branch relationship. A null legacy
// withdrawal therefore cannot be reached by a branch-scoped staff member.
const scopedWithdrawal = async (req, withdrawalId, session) => {
  const withdrawal = await SolarOfficerWithdrawal.findOne({
    _id: withdrawalId,
    ...staffBranchFilter(req),
  }).session(session);
  if (!withdrawal) throw problem("Withdrawal request not found.", 404);
  const officer = await SolarOfficer.findOne({
    _id: withdrawal.officer,
    ...staffBranchFilter(req),
  }).select("_id branchId").session(session);
  if (!officer) throw problem("Withdrawal request not found.", 404);
  return withdrawal;
};

const mutateWithdrawal = async (req, res, action) => {
  const session = await mongoose.startSession();
  try {
    let withdrawal;
    await session.withTransaction(async () => {
      withdrawal = await scopedWithdrawal(req, req.params.withdrawalId, session);
      if (action === "APPROVE") {
        if (withdrawal.status !== "PENDING") throw problem("Only pending withdrawals can be approved.");
        withdrawal.status = "APPROVED";
        withdrawal.approvedAt = new Date();
        withdrawal.approvedBy = actorId(req);
        withdrawal.adminNote = text(req.body?.note, 500);
        await withdrawal.save({ session });
        await audit(req, "SOLAR_OFFICER_WITHDRAWAL_APPROVED", "Approved Solar Officer withdrawal", null, { withdrawalId: String(withdrawal._id) }, session);
      } else if (action === "REJECT") {
        if (!["PENDING", "APPROVED"].includes(withdrawal.status)) throw problem("This withdrawal is already final.");
        const wallet = await SolarOfficerWallet.findOneAndUpdate(
          { officer: withdrawal.officer, lockedBalance: { $gte: withdrawal.amount } },
          { $inc: { lockedBalance: -withdrawal.amount, availableBalance: withdrawal.amount } },
          { new: true, session }
        );
        if (!wallet) throw problem("Commission wallet could not release the locked funds.");
        for (const allocation of withdrawal.allocations || []) {
          await SolarOfficerCommission.updateOne(
            { _id: allocation.commission, ...staffBranchFilter(req), lockedAmount: { $gte: allocation.amount } },
            { $inc: { lockedAmount: -allocation.amount } },
            { session }
          );
        }
        withdrawal.status = "REJECTED";
        withdrawal.rejectedAt = new Date();
        withdrawal.rejectedBy = actorId(req);
        withdrawal.rejectionReason = text(req.body?.reason, 500) || "Withdrawal rejected by Admin.";
        withdrawal.fundsLocked = false;
        withdrawal.fundsReturned = true;
        await withdrawal.save({ session });
        await audit(req, "SOLAR_OFFICER_WITHDRAWAL_REJECTED", withdrawal.rejectionReason, null, { withdrawalId: String(withdrawal._id) }, session);
      } else if (action === "PAID") {
        if (!["APPROVED", "PROCESSING"].includes(withdrawal.status)) throw problem("Only approved withdrawals can be marked paid.");
        const wallet = await SolarOfficerWallet.findOneAndUpdate(
          { officer: withdrawal.officer, lockedBalance: { $gte: withdrawal.amount } },
          { $inc: { lockedBalance: -withdrawal.amount, totalWithdrawn: withdrawal.amount } },
          { new: true, session }
        );
        if (!wallet) throw problem("Commission wallet could not settle the locked funds.");
        for (const allocation of withdrawal.allocations || []) {
          const commission = await SolarOfficerCommission.findOneAndUpdate(
            { _id: allocation.commission, ...staffBranchFilter(req), lockedAmount: { $gte: allocation.amount } },
            {
              $inc: { lockedAmount: -allocation.amount, paidAmount: allocation.amount },
            },
            { new: true, session }
          );
          if (!commission) throw problem("A commission allocation is no longer available.");
          if (roundMoney(commission.paidAmount) >= roundMoney(commission.commissionAmount)) {
            await SolarOfficerCommission.updateOne(
              { _id: commission._id, ...staffBranchFilter(req) },
              { $set: { status: "PAID" } },
              { session }
            );
          }
        }
        withdrawal.status = "PAID";
        withdrawal.paidAt = new Date();
        withdrawal.fundsLocked = false;
        await withdrawal.save({ session });
        await audit(req, "SOLAR_OFFICER_WITHDRAWAL_PAID", "Marked Solar Officer withdrawal paid", null, { withdrawalId: String(withdrawal._id) }, session);
      }
    });
    res.json({ success: true, withdrawal });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.adminApproveWithdrawal = (req, res) => mutateWithdrawal(req, res, "APPROVE");
exports.adminRejectWithdrawal = (req, res) => mutateWithdrawal(req, res, "REJECT");
exports.adminPayWithdrawal = (req, res) => mutateWithdrawal(req, res, "PAID");

exports.officerMe = async (req, res) => {
  const profile = await profileForRequest(req);
  const user = await User.findById(profile.user).select("-password");
  const wallet = await SolarOfficerWallet.findOne({ officer: profile._id }).lean();
  res.json({ success: true, officer: { ...profile.toObject(), user: safeUser(user), wallet: wallet || {} } });
};

exports.officerDashboard = async (req, res) => {
  const profile = await profileForRequest(req);
  const applications = await getOfficerApplications(profile._id, null, profile.branchId);
  const commissions = await SolarOfficerWallet.findOne({ officer: profile._id }).lean();
  const count = (predicate) => applications.filter(predicate).length;
  const sales = applications
    .filter((item) => ["INSTALLED", "FINANCE_ACTIVE", "COMPLETED", "OVERDUE", "RECOVERY_REQUIRED", "RECOVERED"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.approvalSnapshot?.approvedPrice || item.packageSnapshot?.financedPrice || 0), 0);
  res.json({
    success: true,
    dashboard: {
      assignedCustomers: applications.length,
      newApplications: count((item) => ["SUBMITTED", "UNDER_REVIEW"].includes(item.status)),
      pendingVerification: count((item) => !item.verification),
      verifiedCustomers: count((item) => item.verification?.recommendation === "VERIFIED_RECOMMENDED"),
      recommended: count((item) => item.verification?.recommendation === "VERIFIED_RECOMMENDED"),
      notRecommended: count((item) => item.verification?.recommendation === "NOT_RECOMMENDED"),
      approvedApplications: count((item) => ["AWAITING_DEPOSIT", "DEPOSIT_PAID", "READY_FOR_INSTALLATION", "INSTALLED", "FINANCE_ACTIVE", "COMPLETED", "OVERDUE", "RECOVERY_REQUIRED", "RECOVERED"].includes(item.status)),
      solarDelivered: count((item) => Boolean(item.installation)),
      activeInstallments: count((item) => item.finance && item.finance.status !== "COMPLETED"),
      paymentsDue: count((item) => ["DUE", "DUE_SOON"].includes(item.paymentStatus)),
      overdueAccounts: count((item) => item.paymentStatus === "OVERDUE"),
      totalSolarSales: roundMoney(sales),
      pendingCommission: roundMoney(commissions?.pendingBalance),
      availableCommission: roundMoney(commissions?.availableBalance),
      totalCommissionEarned: roundMoney(commissions?.totalEarned),
      withdrawnCommission: roundMoney(commissions?.totalWithdrawn),
    },
  });
};

exports.officerApplications = async (req, res) => {
  const profile = await profileForRequest(req);
  const applications = await getOfficerApplications(profile._id, req.params.applicationId, profile.branchId);
  if (req.params.applicationId && !applications.length) {
    return res.status(404).json({ success: false, message: "Assigned Solar application not found." });
  }
  res.json({
    success: true,
    applications: req.params.applicationId ? undefined : applications,
    application: req.params.applicationId ? applications[0] : undefined,
  });
};

exports.officerVerifyApplication = async (req, res) => {
  const recommendations = ["VERIFIED_RECOMMENDED", "NOT_RECOMMENDED", "NEEDS_REVIEW"];
  const recommendation = text(req.body?.recommendation, 40).toUpperCase();
  if (!recommendations.includes(recommendation)) return res.status(400).json({ success: false, message: "A valid verification recommendation is required." });
  const checklist = req.body?.checklist && typeof req.body.checklist === "object" ? req.body.checklist : {};
  const cleanChecklist = {
    identityConfirmed: checklist.identityConfirmed === true,
    phoneConfirmed: checklist.phoneConfirmed === true,
    addressConfirmed: checklist.addressConfirmed === true,
    locationConfirmed: checklist.locationConfirmed === true,
    customerContacted: checklist.customerContacted === true,
    requirementConfirmed: checklist.requirementConfirmed === true,
    repaymentAssessed: checklist.repaymentAssessed === true,
    kycReviewed: checklist.kycReviewed === true,
  };
  const session = await mongoose.startSession();
  try {
    let verification;
    await session.withTransaction(async () => {
      const profile = await profileForRequest(req, session);
      const assignment = await lockActiveAssignment(
        profile._id,
        req.params.applicationId,
        session
      );
      if (!assignment) {
        throw problem("Solar application is not assigned to you.", 404);
      }
      const application = await SolarApplication.findOne({
        _id: req.params.applicationId, branchId: profile.branchId || null,
      }).session(session);
      if (!application) throw problem("Solar application not found.", 404);
      verification = await SolarVerification.findOneAndUpdate(
        { application: application._id },
        {
          $set: {
            branchId: application.branchId || null,
            customer: application.customer,
            officer: profile._id,
            checklist: cleanChecklist,
            notes: text(req.body?.notes, 3000),
            fieldVisitNotes: text(req.body?.fieldVisitNotes, 3000),
            evidenceUrls: Array.isArray(req.body?.evidenceUrls)
              ? req.body.evidenceUrls
                  .map((value) => text(value, 2000))
                  .filter(Boolean)
                  .slice(0, 12)
              : [],
            verifiedAt: req.body?.verificationDate
              ? new Date(req.body.verificationDate)
              : new Date(),
            recommendation,
          },
        },
        { new: true, upsert: true, runValidators: true, session }
      );
      if (application.status === "SUBMITTED") {
        application.status = "UNDER_REVIEW";
        application.statusHistory.push({
          status: "UNDER_REVIEW",
          changedBy: actorId(req),
          note: "Solar Officer verification started.",
        });
        await application.save({ session });
      }
      await audit(
        req,
        "SOLAR_OFFICER_VERIFICATION_RECORDED",
        "Recorded Solar Officer field verification",
        null,
        { applicationId: String(application._id), recommendation },
        session
      );
      await audit(
        req,
        "SOLAR_OFFICER_RECOMMENDATION_RECORDED",
        `Solar Officer recommendation: ${recommendation}`,
        null,
        { applicationId: String(application._id), recommendation },
        session
      );
    });
    res.status(201).json({ success: true, verification });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.officerHandover = async (req, res) => {
  const installedAt = req.body?.installationDate ? new Date(req.body.installationDate) : new Date();
  if (Number.isNaN(installedAt.getTime())) return res.status(400).json({ success: false, message: "Invalid installation date." });
  const session = await mongoose.startSession();
  try {
    let application;
    await session.withTransaction(async () => {
      const profile = await profileForRequest(req, session);
      const assignment = await lockActiveAssignment(
        profile._id,
        req.params.applicationId,
        session
      );
      if (!assignment) {
        throw problem("Solar application is not assigned to you.", 404);
      }
      application = await SolarApplication.findOne({
        _id: req.params.applicationId, branchId: profile.branchId || null,
      }).session(session);
      if (!application) throw problem("Solar application not found.", 404);
      if (!["DEPOSIT_PAID", "READY_FOR_INSTALLATION"].includes(application.status)) {
        throw problem(
          "Field handover can only be recorded after the deposit is paid."
        );
      }
      application.fieldHandover = {
        status: "HANDOVER_REPORTED",
        installationDate: installedAt,
        handoverNotes: text(req.body?.handoverNotes, 3000),
        evidenceUrls: Array.isArray(req.body?.evidenceUrls)
          ? req.body.evidenceUrls
              .map((value) => text(value, 2000))
              .filter(Boolean)
              .slice(0, 12)
          : [],
        recordedBy: actorId(req),
        recordedAt: new Date(),
      };
      await application.save({ session });
      await audit(
        req,
        "SOLAR_OFFICER_HANDOVER_RECORDED",
        "Recorded Solar Officer field handover",
        null,
        { applicationId: String(application._id) },
        session
      );
    });
    res.status(201).json({ success: true, application });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.officerRepayments = async (req, res) => {
  const profile = await profileForRequest(req);
  const applications = await getOfficerApplications(profile._id, null, profile.branchId);
  res.json({
    success: true,
    repayments: applications.filter((item) => item.finance).map((item) => ({
      applicationId: item._id,
      customer: item.customer,
      package: item.packageSnapshot,
      totalSolarPrice: item.finance.totalPayable,
      depositRequired: item.depositRequired,
      depositPaid: item.depositPaid,
      outstandingBalance: item.finance.outstandingBalance,
      installmentAmount: item.finance.paymentSchedule?.[0]?.amount || 0,
      nextPaymentDate: item.nextPaymentDate,
      amountPaidSoFar: item.finance.amountPaid,
      remainingBalance: item.remainingBalance,
      paymentStatus: item.paymentStatus,
    })),
  });
};

exports.officerOverdue = async (req, res) => {
  const profile = await profileForRequest(req);
  const applications = await getOfficerApplications(profile._id, null, profile.branchId);
  const overdue = applications.filter((item) => item.paymentStatus === "OVERDUE").map((item) => {
    const dueRows = (item.finance?.paymentSchedule || []).filter((row) => Number(row.paidAmount || 0) < Number(row.amount || 0) && new Date(row.dueDate).getTime() < Date.now());
    const oldestDue = dueRows.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
    return {
      applicationId: item._id,
      customer: item.customer,
      package: item.packageSnapshot,
      amountDue: dueRows.reduce((sum, row) => sum + Math.max(0, Number(row.amount) - Number(row.paidAmount || 0)), 0),
      daysOverdue: oldestDue ? Math.max(0, Math.floor((Date.now() - new Date(oldestDue.dueDate).getTime()) / 86400000)) : 0,
      totalOutstanding: item.finance?.outstandingBalance || 0,
      lastPayment: null,
    };
  });
  res.json({ success: true, overdue });
};

exports.officerFollowUp = async (req, res) => {
  const contactMethod = text(req.body?.contactMethod, 20).toUpperCase();
  const outcome = text(req.body?.outcome, 40).toUpperCase() || "CONTACTED";
  if (!["PHONE", "SMS", "WHATSAPP", "VISIT", "OTHER"].includes(contactMethod) || !text(req.body?.notes, 3000)) {
    return res.status(400).json({ success: false, message: "Contact method and follow-up notes are required." });
  }
  const session = await mongoose.startSession();
  try {
    let followUp;
    await session.withTransaction(async () => {
      const profile = await profileForRequest(req, session);
      const assignment = await lockActiveAssignment(
        profile._id,
        req.params.applicationId,
        session
      );
      if (!assignment) {
        throw problem("Solar application is not assigned to you.", 404);
      }
      const application = await SolarApplication.findOne({
        _id: req.params.applicationId, branchId: profile.branchId || null,
      }).session(session);
      if (!application) throw problem("Solar application not found.", 404);
      const finance = await SolarFinance.findOne({
        application: application._id,
      })
        .select("_id")
        .session(session);
      followUp = (
        await SolarFollowUp.create(
          [
            {
              branchId: application.branchId || null,
              application: application._id,
              finance: finance?._id || null,
              customer: application.customer,
              branchId: profile.branchId || null,
              officer: profile._id,
              followUpDate: req.body?.followUpDate
                ? new Date(req.body.followUpDate)
                : new Date(),
              contactMethod,
              notes: text(req.body.notes, 3000),
              promiseToPayDate: req.body?.promiseToPayDate
                ? new Date(req.body.promiseToPayDate)
                : null,
              customerResponse: text(req.body?.customerResponse, 2000),
              outcome: [
                "CONTACTED",
                "PROMISE_TO_PAY",
                "UNABLE_TO_CONTACT",
                "ADDRESS_VISIT",
                "RECOVERY_RECOMMENDED",
                "REPOSSESSION_RECOMMENDED",
                "OTHER",
              ].includes(outcome)
                ? outcome
                : "OTHER",
            },
          ],
          { session }
        )
      )[0];
      await audit(
        req,
        "SOLAR_OFFICER_FOLLOW_UP_RECORDED",
        "Recorded Solar repayment follow-up",
        null,
        {
          applicationId: String(application._id),
          followUpId: String(followUp._id),
        },
        session
      );
      if (["RECOVERY_RECOMMENDED", "REPOSSESSION_RECOMMENDED"].includes(outcome)) {
        await audit(
          req,
          "SOLAR_OFFICER_RECOVERY_RECOMMENDATION",
          `Recorded ${outcome}`,
          null,
          {
            applicationId: String(application._id),
            followUpId: String(followUp._id),
          },
          session
        );
      }
    });
    res.status(201).json({ success: true, followUp });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

exports.officerCommissions = async (req, res) => {
  const profile = await profileForRequest(req);
  const [wallet, commissions] = await Promise.all([
    SolarOfficerWallet.findOne({ officer: profile._id }).lean(),
    SolarOfficerCommission.find({ officer: profile._id }).sort({ createdAt: -1 }).populate("customer", "fullName phone").populate("application", "packageSnapshot"),
  ]);
  res.json({ success: true, wallet: wallet || {}, commissions });
};

exports.officerWithdrawals = async (req, res) => {
  const profile = await profileForRequest(req);
  const withdrawals = await SolarOfficerWithdrawal.find({ officer: profile._id }).sort({ requestedAt: -1 });
  res.json({ success: true, withdrawals });
};

exports.officerCreateWithdrawal = async (req, res) => {
  const profile = await profileForRequest(req);
  const amount = roundMoney(req.body?.amount);
  const bankCode = text(req.body?.bankCode, 40);
  const bankName = text(req.body?.bankName, 120);
  const accountNumber = text(req.body?.accountNumber, 30);
  const accountName = text(req.body?.accountName, 160);
  if (amount <= 0 || !bankCode || !bankName || !accountNumber || !accountName) {
    return res.status(400).json({ success: false, message: "A positive amount and complete bank details are required." });
  }
  const session = await mongoose.startSession();
  try {
    let withdrawal;
    await session.withTransaction(async () => {
      const wallet = await SolarOfficerWallet.findOneAndUpdate(
        { officer: profile._id, availableBalance: { $gte: amount } },
        { $inc: { availableBalance: -amount, lockedBalance: amount } },
        { new: true, session }
      );
      if (!wallet) throw problem("Withdrawal amount exceeds your available commission.");
      const commissions = await SolarOfficerCommission.find({
        officer: profile._id,
        status: "AVAILABLE",
        $expr: { $lt: [{ $add: ["$lockedAmount", "$paidAmount"] }, "$commissionAmount"] },
      }).sort({ createdAt: 1 }).session(session);
      let remaining = amount;
      const allocations = [];
      for (const commission of commissions) {
        if (remaining <= 0) break;
        const available = roundMoney(Number(commission.commissionAmount) - Number(commission.lockedAmount || 0) - Number(commission.paidAmount || 0));
        if (available <= 0) continue;
        const allocated = roundMoney(Math.min(remaining, available));
        allocations.push({ commission: commission._id, amount: allocated });
        remaining = roundMoney(remaining - allocated);
      }
      if (remaining > 0) throw problem("Commission ledger could not allocate this withdrawal.");
      withdrawal = (
        await SolarOfficerWithdrawal.create(
          [
            {
              officer: profile._id,
              reference: reference(),
              amount,
              bankCode,
              bankName,
              accountNumber,
              accountName,
              allocations,
            },
          ],
          { session }
        )
      )[0];
      for (const allocation of allocations) {
        await SolarOfficerCommission.updateOne(
          { _id: allocation.commission },
          { $inc: { lockedAmount: allocation.amount } },
          { session }
        );
      }
      await audit(req, "SOLAR_OFFICER_WITHDRAWAL_REQUESTED", "Requested Solar Officer commission withdrawal", null, { withdrawalId: String(withdrawal._id), amount }, session);
    });
    res.status(201).json({ success: true, withdrawal });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    await session.endSession();
  }
};

const performanceForOfficer = async (profileId) => {
  const profile = await SolarOfficer.findById(profileId).select("branchId").lean();
  const applications = await getOfficerApplications(profileId, null, profile?.branchId);
  const followUps = await SolarFollowUp.countDocuments({ officer: profileId });
  const customersVerified = applications.filter((item) => item.verification).length;
  const approved = applications.filter((item) => ["AWAITING_DEPOSIT", "DEPOSIT_PAID", "READY_FOR_INSTALLATION", "INSTALLED", "FINANCE_ACTIVE", "COMPLETED", "OVERDUE", "RECOVERY_REQUIRED", "RECOVERED"].includes(item.status)).length;
  return {
    customersAssigned: applications.length,
    customersVerified,
    approvalConversion: customersVerified ? roundMoney((approved / customersVerified) * 100) : 0,
    solarUnitsSold: applications.filter((item) => Boolean(item.installation)).length,
    totalSalesValue: roundMoney(applications.reduce((sum, item) => sum + Number(item.approvalSnapshot?.approvedPrice || 0), 0)),
    activeRepaymentAccounts: applications.filter((item) => item.finance && item.finance.status !== "COMPLETED").length,
    onTimeRepaymentRate: 0,
    overdueAccounts: applications.filter((item) => item.paymentStatus === "OVERDUE").length,
    recoveryFollowUps: followUps,
  };
};

exports.officerPerformance = async (req, res) => {
  const profile = await profileForRequest(req);
  res.json({
    success: true,
    performance: await performanceForOfficer(profile._id),
  });
};

exports.adminOfficerPerformance = async (req, res) => {
  const profile = await SolarOfficer.findOne({
    _id: req.params.officerId, ...staffBranchFilter(req),
  }).populate(
    "user",
    "fullName phone email"
  );
  if (!profile) {
    return res
      .status(404)
      .json({ success: false, message: "Solar Officer not found." });
  }
  res.json({
    success: true,
    officer: { ...profile.toObject(), user: safeUser(profile.user) },
    performance: await performanceForOfficer(profile._id),
  });
};

exports.createDepositCommission = async (application, payment, session) =>
  createSolarOfficerCommission({
    application,
    payment,
    type: "SOLAR_DEPOSIT_5_PERCENT",
    session,
  });

exports.createSaleCommission = async (application, session) =>
  createSolarOfficerCommission({
    application,
    type: "SOLAR_SALE_2_PERCENT",
    session,
  });