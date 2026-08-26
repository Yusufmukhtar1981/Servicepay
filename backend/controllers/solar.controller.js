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
const { postDebit } = require("../services/ledger.service");

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
const packagePayload = (body) => {
  const name = text(body.name, 160), capacityKw = Number(body.capacityKw), cashPrice = money(body.cashPrice);
  const depositPercent = Number(body.depositPercent ?? 20), installmentMonths = Number(body.installmentMonths ?? 12), interestPercent = Number(body.interestPercent || 0);
  if (!name || !Number.isFinite(capacityKw) || capacityKw <= 0 || cashPrice === null || cashPrice < 0 ||
    !Number.isFinite(depositPercent) || depositPercent < 0 || depositPercent > 100 ||
    !Number.isInteger(installmentMonths) || installmentMonths < 1 || installmentMonths > 120 ||
    !Number.isFinite(interestPercent) || interestPercent < 0 || interestPercent > 100) return null;
  const stock = Number(body.stockQuantity ?? body.stock);
  if (!Number.isInteger(stock) || stock < 0) return null;
  const financedPrice = body.financedPrice === undefined ? null : money(body.financedPrice);
  if (body.financedPrice !== undefined && (financedPrice === null || financedPrice < 0)) return null;
  const repaymentFrequency = text(body.repaymentFrequency || "MONTHLY", 20).toUpperCase();
  if (!["WEEKLY", "BIWEEKLY", "MONTHLY"].includes(repaymentFrequency)) return null;
  return { name, description: text(body.description, 4000), capacityKw, cashPrice, financedPrice, depositPercent, installmentMonths, interestPercent, stock,
    repaymentFrequency, images: Array.isArray(body.images) ? body.images.map((item) => text(item, 2000)).filter(Boolean).slice(0, 12) : [],
    specifications: body.specifications && typeof body.specifications === "object" ? body.specifications : {},
    warranty: body.warranty && typeof body.warranty === "object" ? body.warranty : {},
    installmentIncluded: body.installmentIncluded !== false, minimumKycTier: text(body.minimumKycTier, 40),
    eligibilityNotes: text(body.eligibilityNotes, 2000), termsSummary: text(body.termsSummary, 2000),
    terms: body.terms && typeof body.terms === "object" ? body.terms : {}, active: body.active !== false };
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
    const payload = packagePayload(req.body || {});
    if (!payload) return res.status(400).json({ success:false,message:"Invalid Solar package details." });
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
      const payload = packagePayload({ ...current.toObject(), ...body });
      if (!payload) throw problem("Invalid Solar package details.", 400);
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
    const settings=await SolarSettings.findOne({key:"default"}).lean(); if(settings && !settings.applicationEnabled)return res.status(409).json({success:false,message:"Solar applications are currently unavailable."});
    const packageId=text(req.body?.packageId,100); const pack=await SolarPackage.findOne({_id:packageId,active:true,stock:{$gt:0}}); if(!pack)return res.status(404).json({success:false,message:"Active in-stock Solar package not found."});
    const declarations = req.body?.declarations || {};
    const accurate = declarations.informationAccurate === true || declarations.accepted === true;
    const termsAccepted = declarations.termsAccepted === true || declarations.accepted === true;
    const recoveryAccepted = declarations.recoveryAgreementAccepted === true || declarations.accepted === true;
    if (!accurate || !termsAccepted || !recoveryAccepted) return res.status(400).json({success:false,message:"Information accuracy, terms, and recovery agreement declarations are required."});
    const customer=await User.findById(id(req)).lean(); const kyc=await KycProfile.findOne({user:id(req)}).lean();
    if(!customer)return res.status(401).json({success:false,message:"Customer account not found."});
    const profileSnapshot={fullName:customer.fullName,phone:customer.phone,email:customer.email,state:customer.state,lga:customer.lga,address:customer.address};
    const packageSnapshot={name:pack.name,capacityKw:pack.capacityKw,cashPrice:pack.cashPrice,financedPrice:pack.financedPrice,depositPercent:pack.depositPercent,installmentMonths:pack.installmentMonths,interestPercent:pack.interestPercent,repaymentFrequency:pack.repaymentFrequency,terms:pack.terms};
    const app=await SolarApplication.create({customer:id(req),package:pack._id,packageSnapshot,profileSnapshot,kycSnapshot:kyc||null,business:req.body.business||{},guarantor:req.body.guarantor||{},declarations:{...declarations,informationAccurate:accurate,termsAccepted,recoveryAgreementAccepted:recoveryAccepted},statusHistory:[{status:"SUBMITTED",changedBy:id(req),note:"Application submitted"}]});
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
    const app=await SolarApplication.findOne({_id:req.params.applicationId,status:"UNDER_REVIEW"}).session(session); if(!app)throw problem("Only applications under review may be approved.",409);
    if(app.status!=="UNDER_REVIEW")return res.status(409).json({success:false,message:"Only applications under review may be approved."});
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
      if(paymentType==="DEPOSIT" && !["APPROVED","AWAITING_DEPOSIT"].includes(app.status))throw problem("A deposit can only be paid on an approved application.");
      if(paymentType==="INSTALLMENT" && !["ACTIVE","RECOVERY"].includes(app.status))throw problem("Installments can only be paid on an active Solar application.");
      const due=paymentType==="DEPOSIT"?money(app.depositRequired-app.depositPaid):money(app.outstandingBalance); if(requested>due)throw problem("Payment exceeds the amount due.");
      const payer=await User.findById(id(req)).select("+transactionPin transactionPinSet walletBalance").session(session); if(!payer)throw problem("Customer account not found.",401);
      if(!payer.transactionPinSet||!payer.transactionPin)throw problem("Please create your transaction PIN before making this payment.",400);
      if(!await payer.compareTransactionPin(text(req.body?.transactionPin,4)))throw problem("Incorrect transaction PIN.",401);
      const opening=money(payer.walletBalance); if(opening===null||opening<requested)throw problem("Insufficient wallet balance.");
      const transaction=await Transaction.create([{reference:reference(),customerId:payer._id,serviceType:paymentType==="DEPOSIT"?"SOLAR_DEPOSIT":"SOLAR_INSTALLMENT",provider:"SERVICEPAY_SOLAR",amount:requested,status:"SUCCESSFUL",providerResponse:{applicationId:String(app._id),idempotencyKey:idem}}],{session});
      const ledger=await postDebit({userId:payer._id,amount:requested,openingBalance:opening,closingBalance:money(opening-requested),service:paymentType==="DEPOSIT"?"SOLAR_DEPOSIT":"SOLAR_INSTALLMENT",reference:transaction[0].reference,idempotencyKey:`solar:${idem}`,transactionId:transaction[0]._id,narration:`Solar ${paymentType.toLowerCase()} payment`,metadata:{applicationId:String(app._id)},session});
      if(ledger.duplicate)throw problem("Solar payment ledger state requires support review.");
      const updated=await User.findOneAndUpdate({_id:payer._id,walletBalance:opening},{$inc:{walletBalance:-requested}},{new:true,session}); if(!updated)throw problem("Wallet balance changed before payment could be completed.");
      const allocations=[]; if(paymentType==="DEPOSIT"){app.depositPaid=money(app.depositPaid+requested);if(app.depositPaid>=app.depositRequired)pushHistory(app,"DEPOSIT_PAID",payer._id,"Required deposit paid");}
      else {let left=requested;for(const row of app.paymentSchedule){const owing=money(row.amount-row.paidAmount);if(left<=0)break;if(owing<=0)continue;const part=money(Math.min(left,owing));row.paidAmount=money(row.paidAmount+part);row.status=row.paidAmount>=row.amount?"PAID":"PARTIAL";if(row.status==="PAID")row.paidAt=new Date();left=money(left-part);allocations.push({installmentNumber:row.installmentNumber,amount:part});}}
      app.amountPaid=money(app.amountPaid+requested);app.outstandingBalance=money(app.totalPayable-app.amountPaid);if(app.outstandingBalance===0&&["ACTIVE","RECOVERY"].includes(app.status))pushHistory(app,"COMPLETED",payer._id,"All Solar payments completed");await app.save({session});
      const payment=(await SolarPayment.create([{application:app._id,customer:payer._id,type:paymentType,amount:requested,idempotencyKey:idem,transaction:transaction[0]._id,ledgerEntry:ledger.entry._id,allocations}],{session}))[0];output={payment,application:app,idempotent:false};
    });
    res.status(output.idempotent?200:201).json({success:true,...output});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{await session.endSession();}
};
exports.recovery = async (req,res) => {
  const reason=text(req.body?.reason,500),notes=text(req.body?.notes,2000);if(!reason)return res.status(400).json({success:false,message:"Recovery reason is required."});
  const app=await SolarApplication.findById(req.params.applicationId);if(!app)return res.status(404).json({success:false,message:"Solar application not found."});if(!["ACTIVE","RECOVERY"].includes(app.status))return res.status(409).json({success:false,message:"Only active applications may enter recovery."});
  app.recovery={reason,notes,recordedBy:id(req),recordedAt:new Date()};if(app.status!=="RECOVERY")pushHistory(app,"RECOVERY",id(req),reason);await app.save();await audit(req,"SOLAR_RECOVERY_RECORDED",reason,null,{applicationId:String(app._id),notes});res.json({success:true,application:app});
};
exports.adminApplications = async(req,res)=>{const filter={};if(req.query.status)filter.status=text(req.query.status,30).toUpperCase();const apps=await SolarApplication.find(filter).sort({createdAt:-1}).populate("customer","fullName phone email");const finances=await SolarFinance.find({application:{$in:apps.map(a=>a._id)}}).select("_id application reference").lean();const byApplication=new Map(finances.map(item=>[String(item.application),item]));const s=await SolarSettings.findOne({key:"default"}).lean();res.json({success:true,applications:apps.map(a=>{const value=applicationView(a,s?.overdueGraceDays||0);const finance=byApplication.get(String(a._id));return {...value,financeId:finance?._id||null,financeReference:finance?.reference||null};})});};
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
    const amount = money(req.body?.amount), idem = keyFor(req);
    if (amount === null || amount <= 0 || !idem) throw problem("A positive amount and Idempotency-Key are required.", 400);
    let result;
    await session.withTransaction(async () => {
      const duplicate = await SolarPayment.findOne({ idempotencyKey: idem }).session(session);
      if (duplicate) {
        const requestedFinance = await SolarFinance.findOne({ _id:req.params.financeId, customer:id(req) }).session(session);
        if (!requestedFinance || String(duplicate.customer)!==String(id(req)) || duplicate.type!=="INSTALLMENT" || Number(duplicate.amount)!==amount || String(duplicate.application)!==String(requestedFinance.application)) throw problem("Idempotency key is already associated with a different payment.");
        result = { payment: duplicate, idempotent: true }; return;
      }
      const finance = await SolarFinance.findOne({ _id: req.params.financeId, customer: id(req) }).session(session);
      if (!finance) throw problem("Solar finance contract not found.", 404);
      if (!["FINANCE_ACTIVE", "OVERDUE", "DEFAULT_REVIEW", "RECOVERY_REQUIRED"].includes(finance.status)) throw problem("This finance contract cannot accept payments.");
      if (amount > money(finance.outstandingBalance)) throw problem("Payment exceeds outstanding balance.");
      const payer = await User.findById(id(req)).select("+transactionPin transactionPinSet walletBalance").session(session);
      if (!payer?.transactionPinSet || !payer.transactionPin) throw problem("Please create your transaction PIN before making this payment.", 400);
      if (!await payer.compareTransactionPin(text(req.body?.transactionPin, 4))) throw problem("Incorrect transaction PIN.", 401);
      const opening = money(payer.walletBalance); if (opening < amount) throw problem("Insufficient wallet balance.");
      const tx = (await Transaction.create([{ reference: reference(), customerId: payer._id, serviceType: "SOLAR_INSTALLMENT", provider: "SERVICEPAY_SOLAR", amount, status: "SUCCESSFUL", providerResponse: { financeId: String(finance._id), idempotencyKey: idem } }], { session }))[0];
      const ledger = await postDebit({ userId: payer._id, amount, openingBalance: opening, closingBalance: money(opening - amount), service: "SOLAR_INSTALLMENT", reference: tx.reference, idempotencyKey: `solar-finance:${idem}`, transactionId: tx._id, narration: "Solar finance installment", metadata: { financeId: String(finance._id) }, session });
      if (ledger.duplicate) throw problem("Solar payment ledger state requires support review.");
      const updated = await User.findOneAndUpdate({ _id: payer._id, walletBalance: opening }, { $inc: { walletBalance: -amount } }, { new: true, session });
      if (!updated) throw problem("Wallet balance changed before payment could be completed.");
      let left = amount; const allocations = [];
      for (const row of finance.paymentSchedule) { const due = money(row.amount - row.paidAmount); if (left <= 0) break; if (due <= 0) continue; const part = money(Math.min(left, due)); row.paidAmount = money(row.paidAmount + part); row.status = row.paidAmount === row.amount ? "PAID" : "PARTIAL"; if (row.status === "PAID") row.paidAt = new Date(); left = money(left - part); allocations.push({ installmentNumber: row.installmentNumber, amount: part }); }
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