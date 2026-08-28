const crypto = require("crypto");
const mongoose = require("mongoose");
const SolarPackage = require("../models/solarPackage.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarPayment = require("../models/solarPayment.model");
const SolarSettings = require("../models/solarSettings.model");
const SolarFinance = require("../models/solarFinance.model");
const SolarRecoveryCase = require("../models/solarRecoveryCase.model");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const Transaction = require("../models/transaction.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const SolarAssignment = require("../models/solarAssignment.model");
const SolarVerification = require("../models/solarVerification.model");
const { postDebit } = require("../services/ledger.service");
const {
  createSolarOfficerCommission,
} = require("../services/solarOfficerCommission.service");
const { createCommissionForEvent } = require("../services/businessPartnerCommission.service");
const BusinessPartnerProfile = require("../models/businessPartnerProfile.model");

const money = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : null;
};
const text = (value, length = 1000) => String(value || "").trim().slice(0, length);
const id = (req) => req.user?._id || req.user?.id;
const problem = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const reference = () => `SPS-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const keyFor = (req) => text(req.get?.("idempotency-key") || req.body?.idempotencyKey, 160);
const audit = (req, action, reason, previousData, newData, session) => AdminAuditLog.create([{
  actorId: id(req), actorRole: String(req.user.role || "").toUpperCase(), actorName: req.user.fullName || "",
  action, reason: text(reason, 500) || action, previousData, newData,
  ipAddress: req.ip || "", userAgent: req.get?.("user-agent") || "", requestMethod: req.method || "", requestPath: req.originalUrl || "",
}], { session });
const pushHistory = (app, status, actor, note = "") => {
  app.status = status;
  app.statusHistory.push({ status, changedBy: actor, note: text(note), changedAt: new Date() });
};
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const SOLAR_INCOME_RANGES = new Set([
  "Below ₦50,000",
  "₦50,000 - ₦100,000",
  "₦100,001 - ₦250,000",
  "₦250,001 - ₦500,000",
  "Above ₦500,000",
]);
const SOLAR_UPFRONT_OPTIONS = new Set([
  "Standard package deposit",
  "Pay a larger upfront amount",
  "Pay in full upfront",
]);
const applicationPreferencesPayload = (body) => {
  const preferences = object(body.applicationPreferences);
  const business = object(body.business);
  const occupationBusiness = text(
    preferences.occupationBusiness ||
      body.occupationBusiness ||
      business.occupationBusiness,
    200
  );
  const monthlyIncomeRange = text(
    preferences.monthlyIncomeRange ||
      body.monthlyIncomeRange ||
      business.monthlyIncomeRange,
    100
  );
  const preferredRepaymentPeriod = text(
    preferences.preferredRepaymentPeriod ||
      body.preferredRepaymentPeriod ||
      business.preferredRepaymentPeriod,
    60
  );
  const upfrontPaymentOption = text(
    preferences.upfrontPaymentOption ||
      body.upfrontPaymentOption ||
      business.upfrontPaymentOption,
    120
  );
  const repaymentMonths = Number(preferredRepaymentPeriod);
  if (
    !occupationBusiness ||
    !SOLAR_INCOME_RANGES.has(monthlyIncomeRange) ||
    !Number.isInteger(repaymentMonths) ||
    repaymentMonths < 1 ||
    repaymentMonths > 120 ||
    !SOLAR_UPFRONT_OPTIONS.has(upfrontPaymentOption)
  ) {
    return null;
  }
  return {
    occupationBusiness,
    monthlyIncomeRange,
    preferredRepaymentPeriod: String(repaymentMonths),
    upfrontPaymentOption,
  };
};
const firstDefined = (body, ...keys) => keys.map((key) => body[key]).find((value) => value !== undefined && value !== null);
const numericInput = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const booleanInput = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim().toLowerCase() === "true") return true;
  if (typeof value === "string" && value.trim().toLowerCase() === "false") return false;
  return null;
};
const packagePayload = (body) => {
  const name = text(firstDefined(body, "name", "packageName"), 160);
  if (!name) return { error: "name is required." };
  const capacityKw = numericInput(firstDefined(body, "capacityKw", "systemCapacityKw"));
  if (capacityKw === null || capacityKw <= 0) return { error: "capacityKw must be a valid number greater than 0." };
  const cashPrice = numericInput(body.cashPrice);
  if (cashPrice === null || cashPrice < 0) return { error: "cashPrice must be a valid number greater than or equal to 0." };
  const financedRaw = firstDefined(body, "financedPrice");
  const financedPrice = numericInput(financedRaw);
  if (financedRaw !== undefined && financedRaw !== null && financedRaw !== "" &&
      (financedPrice === null || financedPrice < 0)) {
    return { error: "financedPrice must be a valid number greater than or equal to 0." };
  }
  const depositRaw = firstDefined(body, "depositPercent", "depositPercentage");
  const depositPercent = numericInput(depositRaw === undefined ? 20 : depositRaw);
  if (depositPercent === null || depositPercent < 0 || depositPercent > 100) {
    return { error: "depositPercent must be a number between 0 and 100." };
  }
  const monthsRaw = firstDefined(body, "installmentMonths", "repaymentDurationMonths");
  const installmentMonths = numericInput(monthsRaw === undefined ? 12 : monthsRaw);
  if (installmentMonths === null || !Number.isInteger(installmentMonths) ||
      installmentMonths < 1 || installmentMonths > 120) {
    return { error: "installmentMonths must be a whole number between 1 and 120." };
  }
  const interestPercent = numericInput(body.interestPercent === undefined ? 0 : body.interestPercent);
  if (interestPercent === null || interestPercent < 0 || interestPercent > 100) {
    return { error: "interestPercent must be a number between 0 and 100." };
  }
  const stockRaw = firstDefined(body, "stockQuantity", "stock");
  const stock = numericInput(stockRaw);
  if (stock === null || !Number.isInteger(stock) || stock < 0) {
    return { error: "stockQuantity must be a whole number greater than or equal to 0." };
  }
  const repaymentFrequency = text(body.repaymentFrequency || "MONTHLY", 20).toUpperCase();
  if (!["WEEKLY", "BIWEEKLY", "MONTHLY"].includes(repaymentFrequency)) {
    return { error: "repaymentFrequency must be MONTHLY, WEEKLY, or BIWEEKLY." };
  }
  const active = booleanInput(body.active, true);
  if (active === null) return { error: "active must be a boolean." };
  const rawTerms = body.terms && typeof body.terms === "object" && !Array.isArray(body.terms) ? body.terms : {};
  const gracePeriodRaw = firstDefined(body, "gracePeriodDays");
  const gracePeriodDays = numericInput(gracePeriodRaw === undefined ? rawTerms.gracePeriodDays : gracePeriodRaw);
  if (gracePeriodRaw !== undefined && gracePeriodDays === null) {
    return { error: "gracePeriodDays must be a valid number." };
  }
  const terms = {
    ...rawTerms,
    includedItems: text(firstDefined(body, "includedItems") ?? rawTerms.includedItems, 4000),
    gracePeriodDays: gracePeriodDays ?? 0,
  };
  const rawSpecifications = body.specifications && typeof body.specifications === "object" && !Array.isArray(body.specifications)
    ? body.specifications
    : {};
  const specifications = {
    ...rawSpecifications,
    ...(body.batteryCapacity !== undefined ? { batteryCapacity: text(body.batteryCapacity, 2000) } : {}),
    ...(body.inverterCapacity !== undefined ? { inverterCapacity: text(body.inverterCapacity, 2000) } : {}),
  };
  return { value: {
    name, description: text(body.description, 4000), capacityKw, cashPrice, financedPrice: financedPrice ?? null,
    depositPercent, installmentMonths, interestPercent, stock, repaymentFrequency,
    images: Array.isArray(body.images) ? body.images.map((item) => text(item, 2000)).filter(Boolean).slice(0, 12) : [],
    specifications,
    warranty: body.warranty && typeof body.warranty === "object" ? body.warranty : {},
    installmentIncluded: body.installmentIncluded !== false, minimumKycTier: text(body.minimumKycTier, 40),
    eligibilityNotes: text(body.eligibilityNotes, 2000), termsSummary: text(body.termsSummary, 2000),
    terms, active,
  } };
};
const packageFields = [
  "name", "description", "capacityKw", "cashPrice", "financedPrice",
  "depositPercent", "installmentMonths", "interestPercent",
  "repaymentFrequency", "images", "specifications", "warranty",
  "installmentIncluded", "minimumKycTier", "eligibilityNotes",
  "termsSummary", "terms", "active",
];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const serializePackage = (pack) => {
  const value = pack?.toObject ? pack.toObject() : pack;
  const base = money(value.financedPrice ?? value.cashPrice) || 0;
  const deposit = money(base * Number(value.depositPercent || 0) / 100) || 0;
  const total = money(base * (1 + Number(value.interestPercent || 0) / 100)) || 0;
  const installments = Math.max(1, Number(value.installmentMonths || 1));
  return { ...value, stockQuantity: value.stock, available: Number(value.stock || 0) > 0, calculatedDepositAmount:deposit, estimatedInstallmentAmount:money((total-deposit)/installments) };
};
const applicationView = (app, graceDays = 0) => {
  const object = app.toObject ? app.toObject() : app;
  const now = new Date();
  object.paymentSchedule = (object.paymentSchedule || []).map((row) => ({
    ...row, status: Number(row.paidAmount) >= Number(row.amount) ? "PAID" :
      new Date(row.dueDate).getTime() + graceDays * 86400000 < now.getTime() ? "OVERDUE" :
        Number(row.paidAmount) > 0 ? "PARTIAL" : "PENDING",
  }));
  object.overdue = object.paymentSchedule.some((row) => row.status === "OVERDUE");
  object.depositAmountDue = money(Number(object.depositRequired || 0) - Number(object.depositPaid || 0));
  object.depositDue = object.depositAmountDue;
  object.approvedPriceQuote = object.approvalSnapshot?.approvedPrice || null;
  object.financedPrice = object.approvalSnapshot?.approvedPrice || object.packageSnapshot?.financedPrice || null;
  object.cashPrice = object.packageSnapshot?.cashPrice || null;
  object.remainingQuote = object.outstandingBalance;
  return object;
};
const financeView = async (finance) => {
  const value = finance?.toObject ? finance.toObject() : finance;
  const application = await SolarApplication.findById(value.application).populate("package", "name").lean();
  const next = (value.paymentSchedule || []).find((row) => Number(row.paidAmount) < Number(row.amount)) || null;
  const paid = (value.paymentSchedule || []).filter((row) => Number(row.paidAmount) >= Number(row.amount)).length;
  return { ...value, packageName: application?.package?.name || application?.packageSnapshot?.name || "", depositRequired: application?.depositRequired || 0, depositPaid: application?.depositPaid || 0, depositAmountDue: money(Number(application?.depositRequired || 0)-Number(application?.depositPaid || 0)), nextInstallmentAmount: next ? money(Number(next.amount)-Number(next.paidAmount)) : 0, nextDueDate: next?.dueDate || null, installmentsPaid: paid, installmentsRemaining: Math.max(0,(value.paymentSchedule || []).length-paid) };
};

exports.listPackages = async (req, res) => {
  const packages = await SolarPackage.find({ active: true }).sort({ name: 1 }).lean();
  res.json({ success: true, packages: packages.map(serializePackage) });
};
exports.listAdminPackages = async (req, res) => {
  const includeInactive = String(req.query.includeInactive || "").toLowerCase() === "true";
  const packages = await SolarPackage.find(includeInactive ? {} : { active: true }).sort({ name: 1 }).lean();
  res.json({ success: true, packages: packages.map(serializePackage) });
};
exports.createPackage = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const parsed = packagePayload(req.body || {});
    if (parsed.error) return res.status(400).json({ success:false,message:parsed.error });
    const payload = parsed.value;
    let item;
    await session.withTransaction(async () => {
      [item] = await SolarPackage.create([{ ...payload, createdBy: id(req) }], { session });
      await audit(req, "SOLAR_PACKAGE_CREATED", "Created Solar package", null, item.toObject(), session);
    });
    res.status(201).json({ success:true, package:serializePackage(item) });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success:false,message:e.message });
  } finally {
    await session.endSession();
  }
};
exports.updatePackage = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let item;
    await session.withTransaction(async () => {
      const current = await SolarPackage.findById(req.params.packageId).session(session);
      if (!current) throw problem("Solar package not found.", 404);
      const body = req.body || {};
       const parsed = packagePayload({ ...current.toObject(), ...body });
       if (parsed.error) throw problem(parsed.error, 400);
       const payload = parsed.value;
      const updates = {};
      for (const field of packageFields) {
        if (hasOwn(body, field)) updates[field] = payload[field];
      }
      if (hasOwn(body, "stock") || hasOwn(body, "stockQuantity")) {
        updates.stock = payload.stock;
      }
      const before = current.toObject();
      item = await SolarPackage.findByIdAndUpdate(
        current._id,
        { $set: updates },
        { new:true, runValidators:true, session }
      );
      await audit(req, "SOLAR_PACKAGE_UPDATED", "Updated Solar package", before, item.toObject(), session);
    });
    res.json({success:true,package:serializePackage(item)});
  } catch(e) {
    res.status(e.statusCode || 500).json({success:false,message:e.message});
  } finally {
    await session.endSession();
  }
};
const setPackageActive = async (req, res, active) => {
  const session = await mongoose.startSession();
  try {
    let item;
    await session.withTransaction(async () => {
      const current = await SolarPackage.findById(req.params.packageId).session(session);
      if (!current) throw problem("Solar package not found.", 404);
      item = await SolarPackage.findByIdAndUpdate(
        current._id,
        { $set:{ active } },
        { new:true, runValidators:true, session }
      );
      await audit(
        req,
        active ? "SOLAR_PACKAGE_UPDATED" : "SOLAR_PACKAGE_DELETED",
        active ? "Activated Solar package" : "Deactivated Solar package",
        { active:current.active },
        { packageId:String(item._id), active:item.active },
        session
      );
    });
    return res.json({ success:true, package:serializePackage(item) });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success:false, message:e.message });
  } finally {
    await session.endSession();
  }
};
exports.activatePackage = (req, res) => setPackageActive(req, res, true);
exports.deactivatePackage = (req, res) => setPackageActive(req, res, false);
exports.deletePackage = exports.deactivatePackage;
exports.getSettings = async (req,res) => res.json({success:true,settings:await SolarSettings.findOne({key:"default"}).lean() || {overdueGraceDays:0,applicationEnabled:true}});
exports.updateSettings = async (req,res) => {
  const days=Number(req.body?.overdueGraceDays); if(!Number.isInteger(days)||days<0||days>365)return res.status(400).json({success:false,message:"overdueGraceDays must be between 0 and 365."});
  const settings=await SolarSettings.findOneAndUpdate({key:"default"},{$set:{overdueGraceDays:days,applicationEnabled:req.body.applicationEnabled!==false,updatedBy:id(req)}},{new:true,upsert:true,runValidators:true});
  await audit(req,"SOLAR_SETTINGS_UPDATED","Updated Solar settings",null,settings.toObject()); res.json({success:true,settings});
};
exports.submitApplication = async (req,res) => {
  try {
    const body = object(req.body);
    const settings=await SolarSettings.findOne({key:"default"}).lean(); if(settings && !settings.applicationEnabled)return res.status(409).json({success:false,message:"Solar applications are currently unavailable."});
    const packageId=text(body.packageId,100); const pack=await SolarPackage.findOne({_id:packageId,active:true,stock:{$gt:0}}); if(!pack)return res.status(404).json({success:false,message:"Active in-stock Solar package not found."});
    const applicationPreferences = applicationPreferencesPayload(body);
    if (!applicationPreferences) return res.status(400).json({success:false,message:"Occupation, a supported monthly income range, a repayment period from 1 to 120 months, and a supported upfront payment option are required."});
    const declarations = object(body.declarations);
    const accurate = declarations.informationAccurate === true || declarations.accepted === true;
    const termsAccepted = declarations.termsAccepted === true || declarations.accepted === true;
    const recoveryAccepted = declarations.recoveryAgreementAccepted === true || declarations.accepted === true;
    if (!accurate || !termsAccepted || !recoveryAccepted) return res.status(400).json({success:false,message:"Information accuracy, terms, and recovery agreement declarations are required."});
    const customer=await User.findById(id(req)).lean(); const kyc=await KycProfile.findOne({user:id(req)}).lean();
    if(!customer)return res.status(401).json({success:false,message:"Customer account not found."});
    const submittedProfile=object(body.profile);
    const profileSnapshot={
      fullName:text(body.fullName || submittedProfile.fullName || customer.fullName,160),
      phone:text(body.phone || submittedProfile.phone || customer.phone,40),
      email:text(body.email || submittedProfile.email || customer.email,254).toLowerCase(),
      state:text(body.state || submittedProfile.state || customer.state,120),
      lga:text(body.lga || submittedProfile.lga || customer.lga,120),
      address:text(body.residentialAddress || body.address || submittedProfile.address || customer.address,500),
    };
    if(!profileSnapshot.fullName || !profileSnapshot.phone || !profileSnapshot.state || !profileSnapshot.lga || !profileSnapshot.address)return res.status(400).json({success:false,message:"Full name, phone number, installation address, state, and local government area are required."});
    if(profileSnapshot.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileSnapshot.email))return res.status(400).json({success:false,message:"Enter a valid email address."});
    const packageSnapshot={name:pack.name,capacityKw:pack.capacityKw,cashPrice:pack.cashPrice,financedPrice:pack.financedPrice,depositPercent:pack.depositPercent,installmentMonths:pack.installmentMonths,interestPercent:pack.interestPercent,repaymentFrequency:pack.repaymentFrequency,terms:pack.terms};
    const app=await SolarApplication.create({customer:id(req),package:pack._id,packageSnapshot,profileSnapshot,kycSnapshot:kyc||null,business:object(body.business),guarantor:object(body.guarantor),applicationPreferences,declarations:{...declarations,informationAccurate:accurate,termsAccepted,recoveryAgreementAccepted:recoveryAccepted},statusHistory:[{status:"SUBMITTED",changedBy:id(req),note:"Application submitted"}]});
    res.status(201).json({success:true,application:app});
  } catch(e){res.status(500).json({success:false,message:e.message});}
};
exports.myApplications = async (req,res) => { const settings=await SolarSettings.findOne({key:"default"}).lean(); const apps=await SolarApplication.find({customer:id(req)}).sort({createdAt:-1}); res.json({success:true,applications:apps.map(a=>applicationView(a,settings?.overdueGraceDays||0))}); };
exports.getMyApplication = async (req,res) => { const app=await SolarApplication.findOne({_id:req.params.applicationId,customer:id(req)}); if(!app)return res.status(404).json({success:false,message:"Solar application not found."}); const s=await SolarSettings.findOne({key:"default"}).lean(); res.json({success:true,application:applicationView(app,s?.overdueGraceDays||0)}); };

const allowedTransitions={
  SUBMITTED:["UNDER_REVIEW","MORE_INFORMATION_REQUIRED","REJECTED","CANCELLED"],
  UNDER_REVIEW:["MORE_INFORMATION_REQUIRED","APPROVED","REJECTED"],
  MORE_INFORMATION_REQUIRED:["UNDER_REVIEW","CANCELLED"],
  APPROVED:["AWAITING_DEPOSIT","CANCELLED"],
  AWAITING_DEPOSIT:["CANCELLED"],
  DEPOSIT_PAID:["READY_FOR_INSTALLATION","CANCELLED"],
  READY_FOR_INSTALLATION:["INSTALLED","CANCELLED"],
  INSTALLED:["FINANCE_ACTIVE"],
  FINANCE_ACTIVE:["COMPLETED","OVERDUE","DEFAULT_REVIEW","RECOVERY_REQUIRED"],
  OVERDUE:["FINANCE_ACTIVE","DEFAULT_REVIEW","RECOVERY_REQUIRED"],
  DEFAULT_REVIEW:["FINANCE_ACTIVE","RECOVERY_REQUIRED"],
  RECOVERY_REQUIRED:["RECOVERED","FINANCE_ACTIVE"],
};
exports.transitionApplication = async (req,res) => {
  const status=text(req.body?.status,30).toUpperCase();
  if (status === "CANCELLED") {
    const session = await mongoose.startSession();
    try {
      let cancelled;
      await session.withTransaction(async () => {
        const now = new Date();
        cancelled = await SolarApplication.findOneAndUpdate(
          { _id:req.params.applicationId, status:{$in:["SUBMITTED","MORE_INFORMATION_REQUIRED","AWAITING_DEPOSIT","DEPOSIT_PAID","READY_FOR_INSTALLATION"]} },
          { $set:{status:"CANCELLED","stockReservation.reserved":false,"stockReservation.releasedAt":now}, $push:{statusHistory:{status:"CANCELLED",changedBy:id(req),note:text(req.body?.note),changedAt:now}} },
          { new:true, session }
        );
        if (!cancelled) throw problem("Application is already cancelled or cannot be cancelled.",409);
        if (cancelled.stockReservation?.packageId && cancelled.stockReservation?.releasedAt?.getTime()===now.getTime()) {
          await SolarPackage.updateOne({_id:cancelled.stockReservation.packageId},{$inc:{stock:1}},{session});
        }
        await audit(req,"SOLAR_APPLICATION_STATUS_UPDATED",req.body?.note||"Cancelled Solar application",null,{status:"CANCELLED",applicationId:String(cancelled._id)},session);
      });
      return res.json({success:true,application:cancelled});
    } catch(e) { return res.status(e.statusCode||500).json({success:false,message:e.message}); }
    finally { await session.endSession(); }
  }
  try { const app=await SolarApplication.findById(req.params.applicationId);
    if(!app)return res.status(404).json({success:false,message:"Solar application not found."});
    if(!allowedTransitions[app.status]?.includes(status))return res.status(409).json({success:false,message:`Cannot transition Solar application from ${app.status} to ${status}.`});
    if(status==="APPROVED")return res.status(409).json({success:false,message:"Use the approval endpoint to approve a Solar application."});
    if(status==="COMPLETED" && money(app.outstandingBalance)!==0)return res.status(409).json({success:false,message:"Solar application cannot complete with an outstanding balance."});
    const before=app.status;
    pushHistory(app,status,id(req),req.body?.note); await app.save(); await audit(req,"SOLAR_APPLICATION_STATUS_UPDATED",req.body?.note||`Changed to ${status}`,{status:before},{status,applicationId:String(app._id)}); res.json({success:true,application:app});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}
};
exports.approveApplication = async (req,res) => {
  const session = await mongoose.startSession();
  try { let result;
    await session.withTransaction(async () => {
    if(!mongoose.isValidObjectId(req.params.applicationId))throw problem("Invalid solar application ID.",400);
    const app=await SolarApplication.findById(req.params.applicationId).session(session);
    if(!app)throw problem("Solar application not found.",404);
    if(app.status!=="UNDER_REVIEW")throw problem("Only applications under review may be approved.",409);
    const quotedPrice = req.body?.approvedPrice ?? app.packageSnapshot.financedPrice ?? app.packageSnapshot.cashPrice;
    const price=money(quotedPrice); if(price===null||price<=0)throw problem("Approved price must be greater than zero.",400);
    const snap=app.packageSnapshot, deposit=money(price*snap.depositPercent/100), total=money(price*(1+snap.interestPercent/100)), remaining=money(total-deposit);
    const frequency = String(snap.repaymentFrequency || "MONTHLY").toUpperCase();
    const schedule=[]; let allocated=0; for(let n=1;n<=snap.installmentMonths;n++){const amount=n===snap.installmentMonths?money(remaining-allocated):money(remaining/snap.installmentMonths);allocated=money(allocated+amount);const due=new Date();if(frequency==="WEEKLY")due.setDate(due.getDate()+7*n);else if(frequency==="BIWEEKLY")due.setDate(due.getDate()+14*n);else due.setMonth(due.getMonth()+n);schedule.push({installmentNumber:n,dueDate:due,amount});}
    const now=new Date();
    const reserved = await SolarPackage.findOneAndUpdate({_id:app.package,active:true,stock:{$gt:0}},{$inc:{stock:-1}},{new:true,session});
    if (!reserved) throw problem("This package is no longer available in stock.");
    const approvalSnapshot={approvedPrice:price,depositPercent:snap.depositPercent,interestPercent:snap.interestPercent,installmentMonths:snap.installmentMonths,repaymentFrequency:frequency,terms:snap.terms};
    result=await SolarApplication.findOneAndUpdate({_id:app._id,status:"UNDER_REVIEW"},{$set:{status:"AWAITING_DEPOSIT",approvalSnapshot,approvedBy:id(req),approvedAt:now,depositRequired:deposit,totalPayable:total,outstandingBalance:total,paymentSchedule:schedule,stockReservation:{reserved:true,reservedStockQuantity:1,reservedAt:now,packageId:app.package,releasedAt:null}},$push:{statusHistory:{status:"AWAITING_DEPOSIT",changedBy:id(req),note:text(req.body?.note)||"Approved; package stock reserved",changedAt:now}}},{new:true,session});
    if(!result)throw problem("Application was approved concurrently.",409);
    await audit(req,"SOLAR_APPLICATION_APPROVED",req.body?.note||"Approved Solar application",null,{applicationId:String(app._id),approvedPrice:price},session);
    await Notification.create([{userId:app.customer,title:"Solar application approved",message:"Your Solar application has been approved. Pay the required deposit to activate it.",type:"SOLAR",referenceId:app._id,referenceType:"SolarApplication"}],{session});
    });
    res.json({success:true,application:result});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}
  finally{await session.endSession();}
};

exports.pay = async (req,res) => {
  const session=await mongoose.startSession();
  try {
    const paymentType=text(req.body?.type,20).toUpperCase(); const requested=money(req.body?.amount); const idem=keyFor(req);
    if(!["DEPOSIT","INSTALLMENT"].includes(paymentType)||requested===null||requested<=0||!idem) throw problem("Payment type, positive amount and Idempotency-Key are required.",400);
    let output;
    await session.withTransaction(async()=>{
      const existing=await SolarPayment.findOne({idempotencyKey:idem}).session(session);
      if(existing){if(String(existing.customer)!==String(id(req))||existing.type!==paymentType||Number(existing.amount)!==requested||String(existing.application)!==String(req.params.applicationId))throw problem("Idempotency key is already associated with a different payment."); output={payment:existing,idempotent:true};return;}
      const app=await SolarApplication.findOne({_id:req.params.applicationId,customer:id(req)}).session(session);
      if(!app)throw problem("Solar application not found.",404);
       if(paymentType==="DEPOSIT"&&(app.status==="DEPOSIT_PAID"||(money(app.depositRequired)>0&&money(app.depositPaid)>=money(app.depositRequired))))throw problem("Deposit already paid.");
      if(paymentType==="DEPOSIT" && !["APPROVED","AWAITING_DEPOSIT"].includes(app.status))throw problem("A deposit can only be paid on an approved application.");
      if(paymentType==="INSTALLMENT" && !["ACTIVE","RECOVERY"].includes(app.status))throw problem("Installments can only be paid on an active Solar application.");
       const due=paymentType==="DEPOSIT"?money(app.depositRequired-app.depositPaid):money(app.outstandingBalance); if(requested>due)throw problem("Payment exceeds the amount due.");
      const payer=await User.findById(id(req)).select("+transactionPin transactionPinSet walletBalance").session(session); if(!payer)throw problem("Customer account not found.",401);
      if(!payer.transactionPinSet||!payer.transactionPin)throw problem("Please create your transaction PIN before making this payment.",400);
      if(!await payer.compareTransactionPin(text(req.body?.transactionPin,4)))throw problem("Incorrect transaction PIN.",401);
       const updatedPayer=await User.findOneAndUpdate({_id:payer._id,walletBalance:{$gte:requested}},{$inc:{walletBalance:-requested}},{new:true,session});
       if(!updatedPayer){
         const currentPayer=await User.findById(payer._id).select("walletBalance").session(session).lean();
         if(!currentPayer||money(currentPayer.walletBalance)<requested)throw problem("Insufficient wallet balance.");
         throw problem("Wallet debit could not be completed. Please try again.");
       }
       const closing=money(updatedPayer.walletBalance); const opening=closing===null?null:money(closing+requested);
       if(opening===null||closing===null)throw problem("Wallet balance is invalid.");
      const transaction=await Transaction.create([{reference:reference(),customerId:payer._id,serviceType:paymentType==="DEPOSIT"?"SOLAR_DEPOSIT":"SOLAR_INSTALLMENT",provider:"SERVICEPAY_SOLAR",amount:requested,status:"SUCCESSFUL",providerResponse:{applicationId:String(app._id),idempotencyKey:idem}}],{session});
       const ledger=await postDebit({userId:payer._id,amount:requested,openingBalance:opening,closingBalance:closing,service:paymentType==="DEPOSIT"?"SOLAR_DEPOSIT":"SOLAR_INSTALLMENT",reference:transaction[0].reference,idempotencyKey:`solar:${idem}`,transactionId:transaction[0]._id,narration:`Solar ${paymentType.toLowerCase()} payment`,metadata:{applicationId:String(app._id)},session});
      if(ledger.duplicate)throw problem("Solar payment ledger state requires support review.");
      const allocations=[]; if(paymentType==="DEPOSIT"){app.depositPaid=money(app.depositPaid+requested);if(app.depositPaid>=app.depositRequired)pushHistory(app,"DEPOSIT_PAID",payer._id,"Required deposit paid");}
      else {let left=requested;for(const row of app.paymentSchedule){const owing=money(row.amount-row.paidAmount);if(left<=0)break;if(owing<=0)continue;const part=money(Math.min(left,owing));row.paidAmount=money(row.paidAmount+part);row.status=row.paidAmount>=row.amount?"PAID":"PARTIAL";if(row.status==="PAID")row.paidAt=new Date();left=money(left-part);allocations.push({installmentNumber:row.installmentNumber,amount:part});}}
      app.amountPaid=money(app.amountPaid+requested);app.outstandingBalance=money(app.totalPayable-app.amountPaid);if(app.outstandingBalance===0&&["ACTIVE","RECOVERY"].includes(app.status))pushHistory(app,"COMPLETED",payer._id,"All Solar payments completed");await app.save({session});
      const payment=(await SolarPayment.create([{application:app._id,customer:payer._id,type:paymentType,amount:requested,idempotencyKey:idem,transaction:transaction[0]._id,ledgerEntry:ledger.entry._id,allocations}],{session}))[0];
      if(paymentType==="DEPOSIT"&&app.depositPaid>=app.depositRequired){
        const commission=await createSolarOfficerCommission({application:app,payment,type:"SOLAR_DEPOSIT_5_PERCENT",session});
        if(commission.created){
          await audit(req,"SOLAR_OFFICER_COMMISSION_CREATED","Created confirmed Solar deposit commission",null,{applicationId:String(app._id),commissionId:String(commission.record._id),commissionType:"SOLAR_DEPOSIT_5_PERCENT",amount:commission.record.commissionAmount},session);
        }
      }
      output={payment,application:app,idempotent:false};
    });
    res.status(output.idempotent?200:201).json({success:true,...output});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{await session.endSession();}
};
exports.recovery = async (req,res) => {
  const reason=text(req.body?.reason,500),notes=text(req.body?.notes,2000);if(!reason)return res.status(400).json({success:false,message:"Recovery reason is required."});
  const app=await SolarApplication.findById(req.params.applicationId);if(!app)return res.status(404).json({success:false,message:"Solar application not found."});if(!["ACTIVE","RECOVERY"].includes(app.status))return res.status(409).json({success:false,message:"Only active applications may enter recovery."});
  app.recovery={reason,notes,recordedBy:id(req),recordedAt:new Date()};if(app.status!=="RECOVERY")pushHistory(app,"RECOVERY",id(req),reason);await app.save();await audit(req,"SOLAR_RECOVERY_RECORDED",reason,null,{applicationId:String(app._id),notes});res.json({success:true,application:app});
};
exports.adminApplications = async(req,res)=>{const filter={};if(req.query.status)filter.status=text(req.query.status,30).toUpperCase();const apps=await SolarApplication.find(filter).sort({createdAt:-1}).populate("customer","fullName phone email");const appIds=apps.map(a=>a._id);const [finances,assignments,verifications]=await Promise.all([SolarFinance.find({application:{$in:appIds}}).select("_id application reference").lean(),SolarAssignment.find({application:{$in:appIds},status:"ACTIVE"}).populate({path:"officer",populate:{path:"user",select:"fullName phone email"}}).lean(),SolarVerification.find({application:{$in:appIds}}).lean()]);const byApplication=new Map(finances.map(item=>[String(item.application),item]));const assignmentByApplication=new Map(assignments.map(item=>[String(item.application),item]));const verificationByApplication=new Map(verifications.map(item=>[String(item.application),item]));const s=await SolarSettings.findOne({key:"default"}).lean();res.json({success:true,applications:apps.map(a=>{const value=applicationView(a,s?.overdueGraceDays||0);const finance=byApplication.get(String(a._id));return {...value,financeId:finance?._id||null,financeReference:finance?.reference||null,solarOfficerAssignment:assignmentByApplication.get(String(a._id))||null,solarOfficerVerification:verificationByApplication.get(String(a._id))||null};})});};
exports.dashboard = async(req,res)=>{
  const now = new Date(), week = new Date(now.getTime() + 7 * 86400000);
  const [applications, financeRows, availableStock, deposits] = await Promise.all([
    SolarApplication.countDocuments(), SolarFinance.find().lean(),
    SolarPackage.aggregate([{ $match:{active:true} },{$group:{_id:null,total:{$sum:"$stock"}}}]),
    SolarApplication.aggregate([{$group:{_id:null,total:{$sum:"$depositPaid"}}}]),
  ]);
  const overdue = financeRows.filter((item)=>item.paymentSchedule.some((row)=>new Date(row.dueDate)<now&&row.paidAmount<row.amount));
  const sum = (field) => money(financeRows.reduce((total,item)=>total+Number(item[field]||0),0));
  const due = (until, after=now) => money(financeRows.reduce((total,item)=>total+item.paymentSchedule.filter((row)=>new Date(row.dueDate)>=after&&new Date(row.dueDate)<until).reduce((v,row)=>v+Math.max(0,row.amount-row.paidAmount),0),0));
  const dashboard={total:applications,availableStock:availableStock[0]?.total||0,depositsCollected:deposits[0]?.total||0,totalFinancedValue:sum("totalPayable"),outstanding:sum("outstandingBalance"),amountCollected:sum("amountPaid"),dueToday:due(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1),new Date(now.getFullYear(),now.getMonth(),now.getDate())),dueThisWeek:due(week),overdue:overdue.length,recoveryRequired:financeRows.filter((item)=>item.status==="RECOVERY_REQUIRED").length,active:financeRows.filter((item)=>item.status==="FINANCE_ACTIVE").length,completed:financeRows.filter((item)=>item.status==="COMPLETED").length};
  res.json({success:true,dashboard});
};
exports.reports = async(req,res)=>{const rows=await SolarFinance.aggregate([{$group:{_id:"$status",count:{$sum:1},totalFinancedValue:{$sum:"$totalPayable"},outstanding:{$sum:"$outstandingBalance"},amountCollected:{$sum:"$amountPaid"}}}]);res.json({success:true,report:rows});};

exports.getPackage = async (req, res) => {
  const pack = await SolarPackage.findOne({ _id: req.params.packageId, active: true }).lean();
  if (!pack) return res.status(404).json({ success: false, message: "Solar package not found." });
  res.json({ success: true, package: serializePackage(pack) });
};

exports.payDeposit = async (req, res) => {
  req.body = { ...(req.body || {}), type: "DEPOSIT" };
  return exports.pay(req, res);
};

exports.installApplication = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const app = await SolarApplication.findById(req.params.applicationId).session(session);
      if (!app) throw problem("Solar application not found.", 404);
      if (app.status !== "DEPOSIT_PAID") throw problem("Installation requires a fully paid deposit.");
      const handover = req.body?.handover || (req.body?.customerConfirmed === true ? {
        recipientName: req.body?.customerName || req.user?.fullName || "Customer",
        acceptedAt: req.body?.installedAt || new Date(),
        notes: "Customer confirmation recorded by administrator.",
      } : null);
      if (!handover || !text(handover.recipientName, 160) || !text(handover.acceptedAt, 80)) {
        throw problem("Installation handover recipientName and acceptedAt are required.", 400);
      }
      const installation = {
        installedAt: req.body?.installedAt ? new Date(req.body.installedAt) : new Date(),
        installerName: text(req.body?.installerName, 160),
        installationAddress: text(req.body?.installationAddress, 500),
        installationNotes: text(req.body?.installationNotes, 2000),
        handover: { recipientName: text(handover.recipientName, 160), acceptedAt: new Date(handover.acceptedAt), notes: text(handover.notes, 1000) },
        recordedBy: id(req),
      };
      if (Number.isNaN(installation.installedAt.getTime()) || Number.isNaN(installation.handover.acceptedAt.getTime())) throw problem("Invalid installation or handover date.", 400);
      pushHistory(app, "INSTALLED", id(req), "Installation and handover recorded");
      app.installation = installation;
      const finance = await SolarFinance.create([{
        reference: `SPF-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
        application: app._id, customer: app.customer, termsSnapshot: app.approvalSnapshot,
        installationSnapshot: installation, totalPayable: app.totalPayable, amountPaid: app.amountPaid,
        outstandingBalance: app.outstandingBalance, paymentSchedule: app.paymentSchedule,
        statusHistory: [{ status: "FINANCE_ACTIVE", changedBy: id(req), note: "Finance activated after installation" }],
      }], { session });
      pushHistory(app, "FINANCE_ACTIVE", id(req), "Solar finance contract activated");
      await app.save({ session });
      const commission = await createSolarOfficerCommission({
        application: app,
        type: "SOLAR_SALE_2_PERCENT",
        session,
      });
      if (commission.created) {
        await audit(
          req,
          "SOLAR_OFFICER_COMMISSION_CREATED",
          "Created delivered Solar sale commission",
          null,
          {
            applicationId: String(app._id),
            commissionId: String(commission.record._id),
            commissionType: "SOLAR_SALE_2_PERCENT",
            amount: commission.record.commissionAmount,
          },
          session
        );
      }
      // A Business Partner earns only after the installation handover has
      // activated the finance contract, never merely on application/deposit.
      if (app.businessPartner) {
        const partnerCommission = await createCommissionForEvent({
          businessPartner: app.businessPartner,
          application: app._id,
          sourceType: "SOLAR",
          sourceAmount: app.totalPayable,
          eventKey: `solar-finance-activated:${app._id}`,
          createdBy: id(req),
          session,
        });
        if (partnerCommission && !partnerCommission.idempotent) {
          const partner = await BusinessPartnerProfile.findById(app.businessPartner).session(session);
          if (partner) await Notification.create([{
            userId: partner.user, title: "Commission earned",
            message: "A solar installation commission was earned.",
            type: "BUSINESS_PARTNER", referenceId: partnerCommission.commission._id,
            referenceType: "BusinessPartnerCommission",
          }], { session });
        }
      }
      await Notification.create([{ userId: app.customer, title: "Solar installation completed", message: "Your Solar finance contract is now active.", type: "SOLAR", referenceId: app._id, referenceType: "SolarFinance" }], { session });
      result = { application: app, finance: finance[0] };
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); } finally { await session.endSession(); }
};

exports.myFinance = async (req, res) => {
  const finance = await SolarFinance.find({ customer: id(req) }).sort({ createdAt: -1 });
  res.json({ success: true, finance: await Promise.all(finance.map(financeView)) });
};
exports.getFinance = async (req, res) => {
  const finance = await SolarFinance.findOne({ _id: req.params.financeId, customer: id(req) });
  if (!finance) return res.status(404).json({ success: false, message: "Solar finance contract not found." });
  const dto = await financeView(finance);
  res.json({ success: true, finance: dto, financeReference: finance.reference, packageName: dto.packageName, nextDueInstallment: dto.nextDueDate ? { amount:dto.nextInstallmentAmount,dueDate:dto.nextDueDate } : null });
};
exports.financeSchedule = async (req, res) => {
  const finance = await SolarFinance.findOne({ _id: req.params.financeId, customer: id(req) }).lean();
  if (!finance) return res.status(404).json({ success: false, message: "Solar finance contract not found." });
  res.json({ success: true, schedule: finance.paymentSchedule });
};
exports.financePayments = async (req, res) => {
  const finance = await SolarFinance.findOne({ _id: req.params.financeId, customer: id(req) });
  if (!finance) return res.status(404).json({ success: false, message: "Solar finance contract not found." });
  const payments = await SolarPayment.find({ application: finance.application, type: "INSTALLMENT" }).sort({ createdAt: -1 });
  res.json({ success: true, payments });
};
exports.payFinance = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const requestedAmount = money(req.body?.amount), idem = keyFor(req);
    if (requestedAmount === null || requestedAmount <= 0 || !idem) throw problem("A positive amount and Idempotency-Key are required.", 400);
    let result;
    await session.withTransaction(async () => {
      const duplicate = await SolarPayment.findOne({ idempotencyKey: idem }).session(session);
      if (duplicate) {
        const requestedFinance = await SolarFinance.findOne({ _id:req.params.financeId, customer:id(req) }).session(session);
        if (!requestedFinance || String(duplicate.customer)!==String(id(req)) || duplicate.type!=="INSTALLMENT" || Number(duplicate.amount)!==requestedAmount || String(duplicate.application)!==String(requestedFinance.application)) throw problem("Idempotency key is already associated with a different payment.");
        result = { payment: duplicate, idempotent: true }; return;
      }
      const finance = await SolarFinance.findOne({ _id: req.params.financeId, customer: id(req) }).session(session);
      if (!finance) throw problem("Solar finance contract not found.", 404);
      if (!["FINANCE_ACTIVE", "OVERDUE", "DEFAULT_REVIEW", "RECOVERY_REQUIRED"].includes(finance.status)) throw problem("This finance contract cannot accept payments.");
      const nextInstallment = finance.paymentSchedule.find((row) => money(row.amount - row.paidAmount) > 0);
      if (!nextInstallment || money(finance.outstandingBalance) <= 0) throw problem("All installments are already paid.");
      const amount = money(nextInstallment.amount - nextInstallment.paidAmount);
      if (amount === null || amount <= 0) throw problem("The next installment amount is invalid.");
      if (requestedAmount !== amount) throw problem("Payment amount must equal the next installment amount.");
      const outstanding = money(finance.outstandingBalance);
      if (outstanding === null || amount > outstanding) throw problem("Payment exceeds outstanding balance.");
      const payer = await User.findById(id(req)).select("+transactionPin transactionPinSet walletBalance").session(session);
      if (!payer?.transactionPinSet || !payer.transactionPin) throw problem("Please create your transaction PIN before making this payment.", 400);
      if (!await payer.compareTransactionPin(text(req.body?.transactionPin, 4))) throw problem("Incorrect transaction PIN.", 401);
      const updatedPayer = await User.findOneAndUpdate(
        { _id: payer._id, walletBalance: { $gte: amount } },
        { $inc: { walletBalance: -amount } },
        { new: true, session },
      );
      if (!updatedPayer) {
        const currentPayer = await User.findById(payer._id).select("walletBalance").session(session).lean();
        if (!currentPayer || money(currentPayer.walletBalance) < amount) throw problem("Insufficient wallet balance.");
        throw problem("Wallet debit could not be completed. Please try again.");
      }
      const closing = money(updatedPayer.walletBalance);
      const opening = closing === null ? null : money(closing + amount);
      if (opening === null || closing === null) throw problem("Wallet balance is invalid.");
      const tx = (await Transaction.create([{ reference: reference(), customerId: payer._id, serviceType: "SOLAR_INSTALLMENT", provider: "SERVICEPAY_SOLAR", amount, status: "SUCCESSFUL", providerResponse: { financeId: String(finance._id), idempotencyKey: idem } }], { session }))[0];
      const ledger = await postDebit({ userId: payer._id, amount, openingBalance: opening, closingBalance: closing, service: "SOLAR_INSTALLMENT", reference: tx.reference, idempotencyKey: `solar-finance:${idem}`, transactionId: tx._id, narration: "Solar finance installment", metadata: { financeId: String(finance._id) }, session });
      if (ledger.duplicate) throw problem("Solar payment ledger state requires support review.");
      nextInstallment.paidAmount = money(nextInstallment.paidAmount + amount);
      nextInstallment.status = "PAID";
      nextInstallment.paidAt = new Date();
      const allocations = [{ installmentNumber: nextInstallment.installmentNumber, amount }];
      finance.amountPaid = money(finance.amountPaid + amount); finance.outstandingBalance = money(finance.totalPayable - finance.amountPaid);
      if (finance.outstandingBalance === 0) { finance.status = "COMPLETED"; finance.statusHistory.push({ status: "COMPLETED", changedBy: payer._id, note: "Paid in full" }); await SolarApplication.updateOne({ _id: finance.application }, { $set: { status: "COMPLETED", outstandingBalance: 0 }, $push: { statusHistory: { status: "COMPLETED", changedBy: payer._id, note: "Finance paid in full", changedAt: new Date() } } }, { session }); }
      await finance.save({ session });
      const payment = (await SolarPayment.create([{ application: finance.application, customer: payer._id, type: "INSTALLMENT", amount, idempotencyKey: idem, transaction: tx._id, ledgerEntry: ledger.entry._id, allocations }], { session }))[0];
      await Notification.create([{ userId: payer._id, title: "Solar payment received", message: `Your Solar finance payment of ₦${amount.toFixed(2)} was received.`, type: "SOLAR", referenceId: finance._id, referenceType: "SolarFinance" }], { session });
      const app = await SolarApplication.findById(finance.application).populate("package", "name").session(session);
      const nextDueInstallment = finance.paymentSchedule.find((row) => row.paidAmount < row.amount) || null;
      result = { payment, finance, financeReference: finance.reference, packageName: app?.package?.name || app?.packageSnapshot?.name || "", nextDueInstallment, idempotent: false };
    });
    res.status(result.idempotent ? 200 : 201).json({ success: true, ...result });
  } catch (error) { res.status(error.statusCode || 500).json({ success: false, message: error.message }); } finally { await session.endSession(); }
};

exports.openRecoveryCase = async (req, res) => {
  const reason = text(req.body?.reason, 500);
  if (!reason) return res.status(400).json({ success: false, message: "Recovery reason is required." });
  const finance = await SolarFinance.findById(req.params.financeId);
  if (!finance) return res.status(404).json({ success: false, message: "Solar finance contract not found." });
  if (finance.status === "COMPLETED") return res.status(409).json({ success: false, message: "Completed finance cannot enter recovery." });
  const recovery = await SolarRecoveryCase.create({
    finance: finance._id, application: finance.application, customer: finance.customer, reason,
    notes: text(req.body?.notes, 3000), contactAttempts: Array.isArray(req.body?.contactAttempts) ? req.body.contactAttempts.slice(0, 50) : [],
    openedBy: id(req),
  });
  finance.status = "RECOVERY_REQUIRED";
  finance.statusHistory.push({ status: "RECOVERY_REQUIRED", changedBy: id(req), note: reason });
  await finance.save();
  await SolarApplication.updateOne({ _id: finance.application }, { $set: { status: "RECOVERY_REQUIRED" } });
  await audit(req, "SOLAR_RECOVERY_RECORDED", reason, null, { financeId: String(finance._id), recoveryId: String(recovery._id) });
  res.status(201).json({ success: true, recovery, finance });
};
exports.adminFinance = async (req,res) => {
  const filter = req.query.status ? { status:text(req.query.status,30).toUpperCase() } : {};
  const finance = await SolarFinance.find(filter).sort({createdAt:-1}).populate("customer","fullName phone email");
  res.json({success:true,finance});
};
exports.adminFinanceDetail = async (req,res) => {
  const finance = await SolarFinance.findById(req.params.financeId).populate("customer","fullName phone email");
  if(!finance)return res.status(404).json({success:false,message:"Solar finance contract not found."});
  res.json({success:true,finance});
};
exports.adminRepayments = async (req,res) => {
  const payments = await SolarPayment.find({type:"INSTALLMENT"}).sort({createdAt:-1}).populate("customer","fullName phone").populate("application","packageSnapshot");
  res.json({success:true,payments});
};
exports.adminOverdue = async (req,res) => {
  const now=new Date();
  const finance=(await SolarFinance.find({status:{$ne:"COMPLETED"}})).filter(item=>item.paymentSchedule.some(row=>new Date(row.dueDate)<now&&row.paidAmount<row.amount));
  res.json({success:true,finance});
};