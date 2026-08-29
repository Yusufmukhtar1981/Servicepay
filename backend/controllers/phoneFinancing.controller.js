const mongoose = require("mongoose");
const crypto = require("crypto");
const Product = require("../models/phoneProduct.model");
const Application = require("../models/phoneApplication.model");
const Device = require("../models/phoneDevice.model");
const Finance = require("../models/phoneFinance.model");
const Payment = require("../models/phonePayment.model");
const ProviderEvent = require("../models/phoneProviderEvent.model");
const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const Transaction = require("../models/transaction.model");
const Notification = require("../models/notification.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { postDebit, postCredit } = require("../services/ledger.service");
const { requestProviderAction } = require("../services/phoneProvider.service");
const { createCommissionForEvent } = require("../services/businessPartnerCommission.service");
const BusinessPartnerProfile = require("../models/businessPartnerProfile.model");

const money = n => Number.isFinite(Number(n)) ? Math.round((Number(n) + Number.EPSILON) * 100) / 100 : null;
const text = (v, max = 500) => String(v || "").trim().slice(0, max);
const uid = req => req.user._id;
const ref = prefix => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const key = req => text(req.get("idempotency-key") || req.body.idempotencyKey, 160);
const error = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const inventoryCode = value => text(value, 160).replace(/\s+/g, "").toUpperCase();
const duplicateDeviceMessage = e => {
  const field = Object.keys(e?.keyPattern || {})[0];
  if (field === "imei1") return "IMEI 1 already exists in inventory.";
  if (field === "imei2") return "IMEI 2 already exists in inventory.";
  if (field === "serialNumber") return "Serial number already exists in inventory.";
  return "IMEI or serial number already exists in inventory.";
};
const history = (doc, status, by, note = "") => {
  doc.status = status;
  doc.statusHistory.push({ status, changedBy: by, note: text(note), changedAt: new Date() });
  // Application assignments are active authorizations, not merely a display
  // field. A terminal application must immediately lose officer access while
  // retaining its assignment snapshot/timeline for audit.
  if (doc.assignmentState === "ACTIVE" &&
      ["REJECTED", "CANCELLED", "REFUNDED", "COMPLETED"].includes(status)) {
    const version = (doc.assignmentVersion || 0) + 1;
    doc.assignmentTimeline.push({
      action: "UNASSIGNED", officer: doc.assignedOfficer,
      officerSnapshot: doc.assignmentSnapshot || null, assignedBy: by,
      note: `Assignment closed: ${status}`, changedAt: new Date(), assignmentVersion: version,
    });
    doc.assignmentState = "UNASSIGNED";
    doc.assignmentVersion = version;
  }
};
const audit = (req, action, reason, data, session) => AdminAuditLog.create([{ actorId: uid(req), actorRole: req.user.role, actorName: req.user.fullName || "", action, reason: text(reason) || action, newData: data, requestMethod: req.method, requestPath: req.originalUrl }], { session });
const productSnapshot = p => ({ sku: p.sku, name: p.name, brand: p.brand, cashPrice: p.cashPrice, financedPrice: p.financedPrice, depositPercent: p.depositPercent, interestPercent: p.interestPercent, weeklyInstallments: p.weeklyInstallments, durationOptionsWeeks:p.durationOptionsWeeks, graceDays:p.graceDays, restrictionProvider:p.restrictionProvider, restrictionEnabled:p.restrictionEnabled, terms: p.terms, specifications: p.specifications });
const transitions = { SUBMITTED:["UNDER_REVIEW","MORE_INFORMATION_REQUIRED","REJECTED","CANCELLED"], UNDER_REVIEW:["MORE_INFORMATION_REQUIRED","REJECTED"], MORE_INFORMATION_REQUIRED:["UNDER_REVIEW","CANCELLED"], AWAITING_DEPOSIT:["CANCELLED"] };
const officerPublic = officer => ({
  _id: officer._id, id: officer._id, fullName: officer.fullName, phone: officer.phone,
  email: officer.email, role: officer.role, status: officer.status, isStaff: officer.isStaff,
  staffId: officer.staffId, state: officer.state, lga: officer.lga, createdAt: officer.createdAt, updatedAt: officer.updatedAt,
});
const officerSnapshot = officer => ({
  officerId: String(officer._id), staffId: officer.staffId || "", fullName: officer.fullName,
  phone: officer.phone, email: officer.email, state: officer.state || "", lga: officer.lga || "",
});
const assignmentQuery = (applicationId, officerId) => ({
  _id: applicationId, assignedOfficer: officerId, assignmentState: "ACTIVE",
});
const phoneOfficerId = async () => {
  let n = (await User.countDocuments({ role: "PHONE_FINANCING_OFFICER" })) + 1;
  while (n < 10000000) {
    const candidate = `SP-PFO-${String(n).padStart(5, "0")}`;
    if (!await User.exists({ staffId: candidate })) return candidate;
    n++;
  }
  throw error("Unable to generate phone financing officer ID.", 500);
};

exports.validatePaymentReplay = async (req,res,next) => {
  try {
    const idem=key(req); if(!idem)return next();
    const payment=await Payment.findOne({idempotencyKey:idem}).lean();
    if(!payment)return next();
    const amount=money(req.body.amount);
    const isDeposit=Boolean(req.params.applicationId);
    const operationMatches=isDeposit
      ? payment.type==="DEPOSIT"&&String(payment.application)===String(req.params.applicationId)&&!payment.finance
      : payment.type==="INSTALLMENT"&&String(payment.finance)===String(req.params.financeId);
    const allocationMatches=isDeposit||req.body.installmentNumber===undefined||Number(req.body.installmentNumber)===Number(payment.allocation?.installmentNumber);
    if(String(payment.customer)!==String(uid(req))||money(payment.amount)!==amount||!operationMatches||!allocationMatches)return res.status(409).json({success:false,message:"Idempotency key is bound to a different payment fingerprint."});
    return next();
  } catch(e){return res.status(500).json({success:false,message:e.message});}
};
exports.validateRefundReplay = async (req,res,next) => {
  try {
    const idem=key(req);if(!idem)return next();
    const refund=await Payment.findOne({idempotencyKey:idem}).populate("originalPayment").lean();
    if(!refund)return next();
    const app=await Application.findById(req.params.applicationId).lean();
    if(refund.type!=="REFUND"||String(refund.application)!==String(app?._id)||String(refund.customer)!==String(app?.customer)||!refund.originalPayment||money(refund.amount)!==money(refund.originalPayment.amount))return res.status(409).json({success:false,message:"Idempotency key is bound to another refund."});
    return res.status(200).json({success:true,payment:refund,idempotent:true});
  }catch(e){return res.status(500).json({success:false,message:e.message});}
};

exports.listProducts = async (req, res) => {
  const q = text(req.query.q, 100); const filter = { active: true, stock: { $gt: 0 } };
  if (q) filter.$or = [{ name: new RegExp(q, "i") }, { brand: new RegExp(q, "i") }, { sku: new RegExp(q, "i") }];
  res.json({ success: true, products: await Product.find(filter).sort({ name: 1 }).lean() });
};
exports.getProduct = async (req, res) => { const product = await Product.findOne({ _id: req.params.productId, active: true, stock: { $gt: 0 } }).lean(); if (!product) return res.status(404).json({ success: false, message: "Phone product not found." }); res.json({ success: true, product }); };
exports.submit = async (req, res) => {
 try {
  const product = await Product.findOne({ _id: req.body.productId, active: true, stock: { $gt: 0 } });
  if (!product) throw error("Active in-stock phone product not found.", 404);
  const kyc = await KycProfile.findOne({ user: uid(req) }).lean();
  const tiers = ["", "TIER_1", "TIER_2", "TIER_3"];
  if (product.minimumKycTier && (!kyc || kyc.status !== "VERIFIED" || tiers.indexOf(kyc.level) < tiers.indexOf(product.minimumKycTier))) throw error("Your verified KYC tier is not eligible for this product.", 403);
  const user = await User.findById(uid(req)).lean(); if (!user) throw error("Customer account not found.", 401);
  const input={occupation:text(req.body.occupation,160),monthlyIncome:money(req.body.monthlyIncome),residentialAddress:text(req.body.residentialAddress||req.body.address,500),state:text(req.body.state||user.state,120),lga:text(req.body.lga||user.lga,120),employer:text(req.body.employer,160),preferredDurationWeeks:Number(req.body.preferredDurationWeeks),consent:req.body.consent===true};
  if(!input.consent||!input.occupation||!input.residentialAddress||!input.state||!input.lga||!input.monthlyIncome||input.monthlyIncome<=0||!Number.isInteger(input.preferredDurationWeeks)||input.preferredDurationWeeks<1)throw error("Occupation, positive monthly income, residential address, state, LGA, preferred duration, and explicit consent are required.",400);
  if(product.durationOptionsWeeks.length&&!product.durationOptionsWeeks.includes(input.preferredDurationWeeks))throw error("Selected duration is unavailable for this product.",400);
  const profileSnapshot = { fullName: text(req.body.fullName || user.fullName, 160), phone: text(req.body.phone || user.phone, 40), address: input.residentialAddress, state:input.state,lga:input.lga };
  const kycSnapshot={status:kyc?.status||"NOT_STARTED",level:kyc?.level||"TIER_1",verified:kyc?.status==="VERIFIED",capturedAt:new Date()};
  const application = await Application.create({ reference: ref("SPF-PHONE"), customer: uid(req), product: product._id, productSnapshot: productSnapshot(product), kycSnapshot, profileSnapshot,applicationInput:input, statusHistory: [{ status: "SUBMITTED", changedBy: uid(req), note: "Application submitted" }] });
  res.status(201).json({ success: true, application });
 } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.myApplications = async (req,res) => res.json({ success:true, applications: await Application.find({ customer: uid(req) }).populate("device").sort({ createdAt:-1 }) });
exports.myApplication = async (req,res) => { const application=await Application.findOne({_id:req.params.applicationId,customer:uid(req)}).populate("device"); if(!application)return res.status(404).json({success:false,message:"Phone application not found."});res.json({success:true,application}); };
exports.adminProducts = async (req,res) => res.json({success:true,products:await Product.find({}).sort({createdAt:-1})});
exports.createProduct = async (req,res) => { try { const {sku,name,brand,description,cashPrice,financedPrice,depositPercent,interestPercent,weeklyInstallments,durationOptionsWeeks,minimumKycTier,terms,specifications,images,restrictionProvider,restrictionEnabled,graceDays}=req.body;const p=await Product.create({sku:text(sku,80),name,brand,description,cashPrice,financedPrice,depositPercent,interestPercent,weeklyInstallments,durationOptionsWeeks,minimumKycTier,terms,specifications,images,restrictionProvider,restrictionEnabled,graceDays,stock:0,createdBy:uid(req)});await audit(req,"PHONE_PRODUCT_CREATED","Created phone product",{productId:String(p._id)});res.status(201).json({success:true,product:p}); } catch(e){res.status(e.code===11000?409:400).json({success:false,message:e.code===11000?"SKU already exists.":e.message});} };
exports.updateProduct = async (req,res) => { try {const allowed=["sku","name","brand","description","cashPrice","financedPrice","depositPercent","interestPercent","weeklyInstallments","durationOptionsWeeks","minimumKycTier","terms","specifications","images","restrictionProvider","restrictionEnabled","graceDays"];const changes={};for(const field of allowed)if(Object.hasOwn(req.body,field))changes[field]=req.body[field];const p=await Product.findByIdAndUpdate(req.params.productId,{$set:changes},{new:true,runValidators:true});if(!p)throw error("Phone product not found.",404);await audit(req,"PHONE_PRODUCT_UPDATED","Updated phone product",{productId:String(p._id)});res.json({success:true,product:p}); }catch(e){res.status(e.statusCode|| (e.code===11000?409:400)).json({success:false,message:e.code===11000?"SKU already exists.":e.message});} };
exports.setProductActive = async (req,res) => { try { const product=await Product.findByIdAndUpdate(req.params.productId,{$set:{active:req.body?.active === true}},{new:true});if(!product)throw error("Phone product not found.",404);await audit(req,"PHONE_PRODUCT_UPDATED",product.active?"Activated phone product":"Deactivated phone product",{productId:String(product._id),active:product.active});res.json({success:true,product}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.adminApplications = async (req,res) => {const q=text(req.query.q,100),filter={};if(req.query.status)filter.status=text(req.query.status,40).toUpperCase();let applications=await Application.find(filter).populate("customer","fullName phone email").populate("assignedOfficer","fullName phone email role").populate("product","name sku").populate("device").sort({createdAt:-1});if(q){const re=new RegExp(q,"i");applications=applications.filter(a=>re.test(a.reference)||re.test(a.customer?.fullName||"")||re.test(a.customer?.phone||"")||re.test(a.customer?.email||"")||re.test(a.device?.imei1||"")||re.test(a.device?.serialNumber||""));}res.json({success:true,applications});};
exports.adminApplication = async(req,res)=>{const application=await Application.findById(req.params.applicationId).populate("customer","fullName phone email").populate("assignedOfficer","fullName phone email role").populate("product").populate("device");if(!application)return res.status(404).json({success:false,message:"Phone application not found."});const finance=await Finance.findOne({application:application._id}).lean();res.json({success:true,application,finance,providerEvents:finance?await ProviderEvent.find({finance:finance._id}).sort({createdAt:-1}):[]});};
exports.transition = async (req,res) => { try {const app=await Application.findById(req.params.applicationId);const status=text(req.body.status,40).toUpperCase();if(!app)throw error("Phone application not found.",404);if(!transitions[app.status]?.includes(status))throw error(`Cannot transition phone application from ${app.status} to ${status}.`,409);history(app,status,uid(req),req.body.note);await app.save();if(status==="MORE_INFORMATION_REQUIRED")await Notification.create([{userId:app.customer,title:"More information required for phone financing",message:"Please provide the additional information requested to continue your phone-financing application.",type:"PHONE",referenceId:app._id,referenceType:"PhoneApplicationMoreInformation"}]);await audit(req,"PHONE_APPLICATION_STATUS_UPDATED",req.body.note,{applicationId:String(app._id),status});res.json({success:true,application:app});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.adminListOfficers = async (req, res) => {
  const filter = { role: "PHONE_FINANCING_OFFICER", isStaff: true };
  if (req.query.status && text(req.query.status, 20).toUpperCase() !== "ALL") filter.status = text(req.query.status, 20).toUpperCase();
  const q = text(req.query.q || req.query.search, 100);
  if (q) filter.$or = ["fullName", "phone", "email", "staffId"].map(field => ({ [field]: new RegExp(q, "i") }));
  const officers = await User.find(filter).select("-password -transactionPin").sort({ createdAt: -1 });
  const active = await Application.aggregate([{ $match: { assignedOfficer: { $in: officers.map(o => o._id) }, assignmentState: "ACTIVE" } }, { $group: { _id: "$assignedOfficer", count: { $sum: 1 } } }]);
  const completed = await Application.aggregate([{ $match: { "verificationReport.verifiedBy": { $in: officers.map(o => o._id) }, "verificationReport.verificationStatus": "COMPLETED" } }, { $group: { _id: "$verificationReport.verifiedBy", count: { $sum: 1 } } }]);
  const counts = new Map(active.map(row => [String(row._id), row.count]));
  const completedCounts = new Map(completed.map(row => [String(row._id), row.count]));
  res.json({ success: true, count: officers.length, officers: officers.map(o => ({ ...officerPublic(o), assignedApplications: counts.get(String(o._id)) || 0, completedVerifications: completedCounts.get(String(o._id)) || 0 })) });
};
exports.adminOfficer = async (req, res) => {
  const officer = await User.findOne({ _id: req.params.officerId, role: "PHONE_FINANCING_OFFICER", isStaff: true }).select("-password -transactionPin");
  if (!officer) return res.status(404).json({ success: false, message: "Phone financing officer not found." });
  const assignedApplications = await Application.countDocuments({ assignedOfficer: officer._id, assignmentState: "ACTIVE" });
  res.json({ success: true, officer: { ...officerPublic(officer), assignedApplications } });
};
exports.adminCreateOfficer = async (req, res) => {
  try {
    const fullName = text(req.body.fullName, 160), phone = text(req.body.phone, 40), email = text(req.body.email, 160).toLowerCase(), password = String(req.body.password || "");
    if (!fullName || !phone || !email || password.length < 6) throw error("Full name, phone, email, and a password of at least 6 characters are required.", 400);
    if (await User.exists({ $or: [{ phone }, { email }] })) throw error("An account already exists with this email or phone number.", 409);
    const officer = await User.create({ fullName, phone, email, password, role: "PHONE_FINANCING_OFFICER", isStaff: true, staffId: await phoneOfficerId(), department: "OPERATIONS", staffCreatedBy: uid(req), status: "ACTIVE", state: text(req.body.state, 120) || null, lga: text(req.body.lga, 120) || null, residentialAddress: text(req.body.address, 500) || "" });
    await audit(req, "PHONE_FINANCING_OFFICER_CREATED", "Created phone financing officer", { officerId: String(officer._id) });
    res.status(201).json({ success: true, officer: officerPublic(officer) });
  } catch (e) { res.status(e.statusCode || (e.code === 11000 ? 409 : 500)).json({ success: false, message: e.code === 11000 ? "An account already exists with this email or phone number." : e.message }); }
};
exports.adminUpdateOfficer = async (req, res) => {
  try {
    const officer = await User.findOne({ _id: req.params.officerId, role: "PHONE_FINANCING_OFFICER", isStaff: true });
    if (!officer) throw error("Phone financing officer not found.", 404);
    for (const field of ["fullName", "phone", "email", "state", "lga"]) if (Object.hasOwn(req.body, field)) officer[field] = text(req.body[field], field === "fullName" ? 160 : 120);
    if (Object.hasOwn(req.body, "address")) officer.residentialAddress = text(req.body.address, 500);
    await officer.save();
    await audit(req, "PHONE_FINANCING_OFFICER_UPDATED", "Updated phone financing officer", { officerId: String(officer._id) });
    res.json({ success: true, officer: officerPublic(officer) });
  } catch (e) { res.status(e.statusCode || (e.code === 11000 ? 409 : 500)).json({ success: false, message: e.code === 11000 ? "An account already exists with this email or phone number." : e.message }); }
};
exports.adminUpdateOfficerStatus = async (req, res) => {
  try {
    const status = text(req.body.status, 20).toUpperCase();
    if (!["ACTIVE", "SUSPENDED", "BLOCKED"].includes(status)) throw error("Status must be ACTIVE, SUSPENDED or BLOCKED.", 400);
    const officer = await User.findOne({ _id: req.params.officerId, role: "PHONE_FINANCING_OFFICER", isStaff: true });
    if (!officer) throw error("Phone financing officer not found.", 404);
    if (status !== "ACTIVE" && await Application.exists({ assignedOfficer: officer._id, assignmentState: "ACTIVE" })) throw error("Reassign or unassign all active applications before deactivating this officer.", 409);
    officer.status = status; await officer.save({ validateBeforeSave: false });
    await audit(req, "PHONE_FINANCING_OFFICER_STATUS_UPDATED", `Changed phone financing officer to ${status}`, { officerId: String(officer._id), status });
    res.json({ success: true, officer: officerPublic(officer) });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminOfficerCount = async (req, res) => {
  const [total, active, suspended, blocked] = await Promise.all([
    User.countDocuments({ role: "PHONE_FINANCING_OFFICER", isStaff: true }),
    User.countDocuments({ role: "PHONE_FINANCING_OFFICER", isStaff: true, status: "ACTIVE" }),
    User.countDocuments({ role: "PHONE_FINANCING_OFFICER", isStaff: true, status: "SUSPENDED" }),
    User.countDocuments({ role: "PHONE_FINANCING_OFFICER", isStaff: true, status: "BLOCKED" }),
  ]);
  res.json({ success: true, count: total, counts: { total, active, suspended, blocked } });
};
exports.adminDeleteOfficer = async (req, res) => {
  req.body = { ...(req.body || {}), status: "BLOCKED" };
  return exports.adminUpdateOfficerStatus(req, res);
};
exports.assignOfficer = async (req,res) => {
  const session = await mongoose.startSession();
  try {
    let application;
    await session.withTransaction(async () => {
      const officer=await User.findOne({_id:req.body.officerId,role:"PHONE_FINANCING_OFFICER",isStaff:true,status:"ACTIVE"}).session(session);
      if(!officer)throw error("An active Phone Financing Officer is required.",400);
      const app=await Application.findById(req.params.applicationId).session(session);
      if(!app)throw error("Phone application not found.",404);
      if(!["SUBMITTED","UNDER_REVIEW"].includes(app.status))throw error("Only submitted or under-review applications can be assigned or reassigned.",409);
      const previous = app.assignedOfficer ? String(app.assignedOfficer) : null;
      if(previous===String(officer._id)&&app.assignmentState==="ACTIVE") { application=app; return; }
      app.assignedOfficer=officer._id;app.assignmentState="ACTIVE";app.assignmentVersion=(app.assignmentVersion||0)+1;
      app.assignmentSnapshot={...officerSnapshot(officer),assignedBy:String(uid(req)),assignedAt:new Date(),assignmentVersion:app.assignmentVersion};
      app.assignmentTimeline.push({action:previous?"REASSIGNED":"ASSIGNED",officer:officer._id,officerSnapshot:officerSnapshot(officer),assignedBy:uid(req),note:text(req.body.note),changedAt:new Date(),assignmentVersion:app.assignmentVersion});
      if(app.status==="SUBMITTED") history(app,"UNDER_REVIEW",uid(req),"Officer assigned for review");
      await app.save({session}); application=app;
      await Notification.create([{userId:officer._id,title:"Phone financing application assigned",message:`You have been assigned application ${app.reference}.`,type:"PHONE",referenceId:app._id,referenceType:"PhoneApplicationAssignment"}],{session});
      await audit(req,"PHONE_APPLICATION_ASSIGNED",previous?"Reassigned phone financing officer":"Assigned phone financing officer",{applicationId:String(app._id),officerId:String(officer._id),previousOfficerId:previous,assignmentVersion:app.assignmentVersion},session);
    });
    res.json({success:true,application,idempotent:false});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{session.endSession();}
};
exports.officerMe = async (req, res) => {
  const officer = req.user;
  res.json({
    success: true,
    officer: {
      officerId: String(officer._id),
      status: officer.status,
      state: officer.state,
      lga: officer.lga,
      address: officer.residentialAddress,
      user: {
        fullName: officer.fullName,
        phone: officer.phone,
        email: officer.email,
      },
    },
  });
};
exports.officerApplications = async (req,res) => {
  const filter={assignedOfficer:uid(req),assignmentState:"ACTIVE"}; if(req.params.applicationId) filter._id=req.params.applicationId; if(req.query.status) filter.status=text(req.query.status,40).toUpperCase();
  const applications=await Application.find(filter).populate("customer","fullName phone email").populate("product","name sku").populate("device").sort({createdAt:-1});
  if(req.params.applicationId&&!applications.length)return res.status(404).json({success:false,message:"Assigned phone application not found."});
  const completedVerifications = applications.filter(item => item.verificationReport && Object.keys(item.verificationReport).length > 0).length;
  res.json({
    success:true, count:applications.length, applications, application:req.params.applicationId?applications[0]:undefined,
    counts:{ assigned:applications.length, completedVerifications, pendingVerifications:applications.length-completedVerifications },
  });
};
exports.officerVerification = async (req,res) => { try {
  const app=await Application.findOne(assignmentQuery(req.params.applicationId,uid(req)));if(!app)throw error("Assigned phone application not found.",404);
  if(["COMPLETED","CANCELLED","REJECTED","REFUNDED"].includes(app.status))throw error("This application cannot be verified.",409);
  const submittedReport=req.body.report && typeof req.body.report==="object" && !Array.isArray(req.body.report) ? req.body.report : {};
  const recommendation=text(submittedReport.recommendation,40).toUpperCase();
  const findings=text(submittedReport.findings,2000), incomeAssessment=text(submittedReport.incomeAssessment,1000), notes=text(submittedReport.notes,2000);
  const checklist=submittedReport.checklist;
  if(!["APPROVE","REJECT","NEED_MORE_INFORMATION"].includes(recommendation))throw error("Recommendation must be APPROVE, REJECT, or NEED_MORE_INFORMATION.",400);
  if(!checklist || typeof checklist!=="object" || Array.isArray(checklist) || !Object.keys(checklist).length || Object.values(checklist).some(value=>typeof value!=="boolean"))throw error("A completed boolean verification checklist is required.",400);
  if(!findings||!incomeAssessment||!notes)throw error("Verification findings, income assessment, and notes are required.",400);
  app.verificationReport={recommendation,checklist,findings,incomeAssessment,notes,guarantorDetails:text(submittedReport.guarantorDetails,1000),verificationStatus:"COMPLETED",verifiedBy:uid(req),verifiedAt:new Date(),assignmentVersion:app.assignmentVersion};
  if(app.status==="SUBMITTED")history(app,"UNDER_REVIEW",uid(req),"Officer verification submitted");
  await app.save();
  const heads=await User.find({role:"HEAD_OFFICE",status:"ACTIVE"}).select("_id").lean();
  await Notification.create(heads.map(head=>({userId:head._id,title:"Phone verification submitted",message:`A field verification report was submitted for ${app.reference}.`,type:"PHONE",referenceId:app._id,referenceType:"PhoneApplicationVerification"})));
  res.json({success:true,application:app});
}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.officerFollowUp = async (req,res) => { try {
  const app=await Application.findOne(assignmentQuery(req.params.applicationId,uid(req)));if(!app)throw error("Assigned phone application not found.",404);
  const note=text(req.body.note,2000);if(!note)throw error("Follow-up note is required.",400);
  const nextFollowUpAt=req.body.nextFollowUpAt ? new Date(req.body.nextFollowUpAt) : null;if(nextFollowUpAt&&Number.isNaN(nextFollowUpAt.getTime()))throw error("nextFollowUpAt must be a valid date.",400);
  app.followUps.push({note,outcome:text(req.body.outcome,160),nextFollowUpAt,createdBy:uid(req),createdAt:new Date()});await app.save();
  await Notification.create([{userId:app.customer,title:"Phone financing follow-up recorded",message:"A phone-financing officer recorded a follow-up on your application.",type:"PHONE",referenceId:app._id,referenceType:"PhoneApplicationFollowUp"}]);
  res.status(201).json({success:true,followUp:app.followUps[app.followUps.length-1],applicationId:app._id});
}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.approve = async (req,res) => {
 const session=await mongoose.startSession();try {let application;await session.withTransaction(async()=>{const app=await Application.findById(req.params.applicationId).session(session);if(!app)throw error("Phone application not found.",404);if(!["SUBMITTED","UNDER_REVIEW"].includes(app.status))throw error("Only submitted or under-review applications can be approved.");const terms=app.productSnapshot;const weeks=app.applicationInput.preferredDurationWeeks;if(terms.durationOptionsWeeks?.length&&!terms.durationOptionsWeeks.includes(weeks))throw error("Application duration is no longer valid.",409);const price=money(terms.financedPrice), deposit=money(price*terms.depositPercent/100), total=money(price*(1+terms.interestPercent/100));app.approvalSnapshot={ approvedPrice:price, depositPercent:terms.depositPercent, interestPercent:terms.interestPercent, weeklyInstallments:weeks||terms.weeklyInstallments, graceDays:terms.graceDays, restrictionProvider:terms.restrictionProvider, restrictionEnabled:terms.restrictionEnabled, terms:terms.terms };app.depositRequired=deposit;app.totalPayable=total;app.outstandingBalance=total;app.approvedBy=uid(req);app.approvedAt=new Date();history(app,"AWAITING_DEPOSIT",uid(req),req.body.note||"Approved");await app.save({session});application=app;await Notification.create([{userId:app.customer,title:"Phone financing approved",message:"Your application is approved. Pay your deposit to proceed.",type:"PHONE",referenceId:app._id,referenceType:"PhoneApplication"}],{session});await audit(req,"PHONE_APPLICATION_APPROVED","Approved phone application",{applicationId:String(app._id)},session);});res.json({success:true,application});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{session.endSession();}
};
async function debit(req, app, amount, type, session, finance = null, allocation = null) {
 const idem=key(req);if(!idem)throw error("Idempotency-Key is required.",400);const existing=await Payment.findOne({idempotencyKey:idem}).session(session);if(existing){if(String(existing.customer)!==String(uid(req))||existing.type!==type)throw error("Idempotency key is already associated with a different payment.");return {payment:existing,idempotent:true};}
 const payer=await User.findById(uid(req)).select("+transactionPin transactionPinSet walletBalance").session(session);if(!payer?.transactionPinSet||!payer.transactionPin)throw error("Please create your transaction PIN before making this payment.",400);if(!await payer.compareTransactionPin(text(req.body.transactionPin,4)))throw error("Incorrect transaction PIN.",401);
 const updated=await User.findOneAndUpdate({_id:payer._id,walletBalance:{$gte:amount}},{$inc:{walletBalance:-amount}},{new:true,session});if(!updated)throw error("Insufficient wallet balance.");const closing=money(updated.walletBalance), opening=money(closing+amount), service=type==="DEPOSIT"?"PHONE_FINANCING_DEPOSIT":"PHONE_FINANCING_INSTALLMENT";const tx=(await Transaction.create([{reference:ref("SPF-PAY"),customerId:payer._id,serviceType:service,provider:"SERVICEPAY_PHONE_FINANCING",amount,status:"SUCCESSFUL",providerResponse:{applicationId:String(app._id),financeId:finance?String(finance._id):null,idempotencyKey:idem}}],{session}))[0];const ledger=await postDebit({userId:payer._id,amount,openingBalance:opening,closingBalance:closing,service,reference:tx.reference,idempotencyKey:`phone:${idem}`,transactionId:tx._id,narration:`Phone financing ${type.toLowerCase()}`,session});if(ledger.duplicate)throw error("Duplicate ledger state requires support review.");const payment=(await Payment.create([{reference:ref("SPF-PAY"),application:app._id,finance:finance?finance._id:null,customer:payer._id,type,amount,idempotencyKey:idem,transaction:tx._id,ledgerEntry:ledger.entry._id,allocation}],{session}))[0];return {payment,idempotent:false};
}
exports.deposit = async (req,res) => {const session=await mongoose.startSession();try{let result;await session.withTransaction(async()=>{const app=await Application.findOne({_id:req.params.applicationId,customer:uid(req)}).session(session);if(!app)throw error("Phone application not found.",404);const duplicate=await Payment.findOne({idempotencyKey:key(req)}).session(session);if(duplicate){if(duplicate.type!=="DEPOSIT"||String(duplicate.customer)!==String(uid(req))||String(duplicate.application)!==String(app._id)||money(duplicate.amount)!==money(req.body.amount))throw error("Idempotency key is already associated with a different payment.");result={payment:duplicate,idempotent:true};return;}if(app.status!=="AWAITING_DEPOSIT")throw error("Deposit cannot be paid for this application.");const amount=money(app.depositRequired-app.depositPaid);if(!amount||money(req.body.amount)!==amount)throw error("Deposit amount must equal the server-calculated amount.",400);const now=new Date(),expires=new Date(now.getTime()+7*86400000);const reserved=await Device.findOneAndUpdate({product:app.product,status:"AVAILABLE"},{$set:{status:"RESERVED",reservedForApplication:app._id,reservedForCustomer:app.customer,reservedAt:now,reservationExpiresAt:expires},$push:{statusHistory:{status:"RESERVED",changedBy:uid(req),changedAt:now}}},{new:true,session});if(!reserved)throw error("No available physical device can be reserved for this product.");const product=await Product.findOneAndUpdate({_id:app.product,stock:{$gt:0}},{$inc:{stock:-1}},{new:true,session});if(!product)throw error("Product availability is inconsistent.");app.device=reserved._id;result=await debit(req,app,amount,"DEPOSIT",session);app.depositPaid=amount;app.outstandingBalance=money(app.outstandingBalance-amount);history(app,"DEPOSIT_PAID",uid(req),"Deposit paid and device reserved");await app.save({session});});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{session.endSession();}};
exports.createDevice = async (req, res) => {
  const phoneProductId = text(req.body.phoneProductId, 80);
  const imei1 = inventoryCode(req.body.imei1);
  const imei2 = inventoryCode(req.body.imei2);
  const serialNumber = inventoryCode(req.body.serialNumber);

  if (!phoneProductId) {
    return res.status(400).json({ success: false, message: "phoneProductId is required." });
  }
  if (!mongoose.isValidObjectId(phoneProductId)) {
    return res.status(400).json({ success: false, message: "phoneProductId must be a valid Phone Product ID." });
  }
  if (!imei1) {
    return res.status(400).json({ success: false, message: "imei1 is required." });
  }
  if (!serialNumber) {
    return res.status(400).json({ success: false, message: "serialNumber is required." });
  }
  if (imei2 && imei2 === imei1) {
    return res.status(409).json({ success: false, message: "IMEI 2 must be different from IMEI 1." });
  }

  const session = await mongoose.startSession();
  try {
    let device;
    await session.withTransaction(async () => {
      const product = await Product.findById(phoneProductId).session(session);
      if (!product) throw error("Phone product not found.", 404);

      const imeis = imei2 ? [imei1, imei2] : [imei1];
      const duplicate = await Device.findOne({
        $or: [
          { imei1: { $in: imeis } },
          { imei2: { $in: imeis } },
          { serialNumber },
        ],
      }).session(session);
      if (duplicate) {
        if (duplicate.serialNumber === serialNumber) {
          throw error("Serial number already exists in inventory.", 409);
        }
        if (duplicate.imei1 === imei1 || duplicate.imei2 === imei1) {
          throw error("IMEI 1 already exists in inventory.", 409);
        }
        throw error("IMEI 2 already exists in inventory.", 409);
      }

      device = (await Device.create([{
        reference: ref("SPF-DEV"),
        product: product._id,
        imei1,
        imei2: imei2 || undefined,
        serialNumber,
        status: "AVAILABLE",
        statusHistory: [{ status: "AVAILABLE", changedBy: uid(req) }],
      }], { session }))[0];
      await Product.updateOne({ _id: product._id }, { $inc: { stock: 1 } }, { session });
      await audit(req, "PHONE_DEVICE_CREATED", "Received available phone device", {
        deviceId: String(device._id),
        phoneProductId: String(product._id),
      }, session);
    });
    res.status(201).json({ success: true, device });
  } catch (e) {
    res.status(e.statusCode || (e.code === 11000 ? 409 : 400)).json({
      success: false,
      message: e.code === 11000 ? duplicateDeviceMessage(e) : e.message,
    });
  } finally {
    session.endSession();
  }
};
exports.devices = async(req,res)=>{const q=text(req.query.q,100);let devices=await Device.find({}).populate("product","name sku").populate("customer","fullName phone email").sort({createdAt:-1});if(q){const re=new RegExp(q,"i");devices=devices.filter(d=>re.test(d.reference)||re.test(d.imei1)||re.test(d.imei2||"")||re.test(d.serialNumber)||re.test(d.customer?.fullName||"")||re.test(d.customer?.phone||"")||re.test(d.customer?.email||""));}res.json({success:true,devices});};
exports.assign = async(req,res)=>{const s=await mongoose.startSession();try{let application;await s.withTransaction(async()=>{const app=await Application.findById(req.params.applicationId).session(s);if(!app)throw error("Application not found.",404);if(app.status==="DEVICE_ASSIGNED"){if(req.body.deviceId&&String(req.body.deviceId)!==String(app.device))throw error("Requested device differs from the existing reservation.");application=app;return;}if(app.status!=="DEPOSIT_PAID"||!app.device)throw error("Application has no paid device reservation.");if(req.body.deviceId&&String(req.body.deviceId)!==String(app.device))throw error("Requested device differs from the existing reservation.");const claimed=await Device.findOneAndUpdate({_id:app.device,status:"RESERVED",reservedForApplication:app._id,reservedForCustomer:app.customer},{$set:{status:"ASSIGNED",customer:app.customer,application:app._id},$unset:{reservedForApplication:1,reservedForCustomer:1,reservedAt:1,reservationExpiresAt:1},$push:{statusHistory:{status:"ASSIGNED",changedBy:uid(req),changedAt:new Date()}}},{new:true,session:s});if(!claimed)throw error("Reserved device is unavailable.");history(app,"DEVICE_ASSIGNED",uid(req),"Reserved physical device assigned");await app.save({session:s});application=app;await audit(req,"PHONE_DEVICE_ASSIGNED","Confirmed reserved phone device assignment",{applicationId:String(app._id),deviceId:String(claimed._id)},s);});res.json({success:true,application});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{s.endSession();}};
exports.handover = async(req,res)=>{const s=await mongoose.startSession();try{let finance;await s.withTransaction(async()=>{const app=await Application.findById(req.params.applicationId).session(s);if(!app||app.status!=="DEVICE_ASSIGNED"||!app.device)throw error("Assigned application required.",409);const device=await Device.findById(app.device).session(s);const terms=app.approvalSnapshot;let allocated=0;const schedule=Array.from({length:terms.weeklyInstallments},(_,i)=>{const amount=i===terms.weeklyInstallments-1?money(app.totalPayable-app.depositPaid-allocated):money((app.totalPayable-app.depositPaid)/terms.weeklyInstallments);allocated=money(allocated+amount);const due=new Date();due.setDate(due.getDate()+7*(i+1));return{installmentNumber:i+1,dueDate:due,amount};});const now=new Date();finance=(await Finance.create([{reference:ref("SPF-PHONE"),application:app._id,customer:app.customer,device:device._id,termsSnapshot:{...terms,product:app.productSnapshot},totalPayable:app.totalPayable,amountPaid:app.depositPaid,outstandingBalance:money(app.totalPayable-app.depositPaid),graceDays:terms.graceDays,paymentSchedule:schedule,statusHistory:[{status:"ACTIVE",changedBy:uid(req),note:"Handover activated"}]}],{session:s}))[0];device.status="ACTIVE_FINANCE";device.handoverAt=now;device.activatedAt=now;device.statusHistory.push({status:"ACTIVE_FINANCE",changedBy:uid(req)});await device.save({session:s});history(app,"ACTIVE",uid(req),"Handover activated");await app.save({session:s});if(app.businessPartner){const created=await createCommissionForEvent({businessPartner:app.businessPartner,application:app._id,sourceType:"PHONE",sourceAmount:app.totalPayable,eventKey:`phone-handover:${app._id}`,createdBy:uid(req),session:s});if(created&&!created.idempotent){const partner=await BusinessPartnerProfile.findById(app.businessPartner).session(s);if(partner)await Notification.create([{userId:partner.user,title:"Commission earned",message:"A phone-financing commission was earned.",type:"BUSINESS_PARTNER",referenceId:created.commission._id,referenceType:"BusinessPartnerCommission"}],{session:s});}}await audit(req,"PHONE_HANDOVER_ACTIVATED","Activated phone handover",{applicationId:String(app._id),financeId:String(finance._id)},s);});res.status(201).json({success:true,finance});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{s.endSession();}};
exports.myFinance=async(req,res)=>res.json({success:true,finance:await Finance.find({customer:uid(req)}).populate("device").sort({createdAt:-1})});
exports.finance=async(req,res)=>{const finance=await Finance.findOne({_id:req.params.financeId,customer:uid(req)}).populate("device");if(!finance)return res.status(404).json({success:false,message:"Phone finance not found."});const next=finance.paymentSchedule.find(r=>money(r.amount-r.paidAmount)>0);res.json({success:true,finance,nextPayment:next?{installmentNumber:next.installmentNumber,amount:money(next.amount-next.paidAmount),dueDate:next.dueDate,status:next.status}:null});};
exports.schedule=async(req,res)=>{const finance=await Finance.findOne({_id:req.params.financeId,customer:uid(req)}).lean();if(!finance)return res.status(404).json({success:false,message:"Phone finance not found."});res.json({success:true,financeReference:finance.reference,schedule:finance.paymentSchedule});};
exports.payments=async(req,res)=>{const finance=await Finance.findOne({_id:req.params.financeId,customer:uid(req)}).lean();if(!finance)return res.status(404).json({success:false,message:"Phone finance not found."});res.json({success:true,financeReference:finance.reference,payments:await Payment.find({finance:finance._id,type:"INSTALLMENT"}).sort({createdAt:-1})});};
exports.pay=async(req,res)=>{
  const s=await mongoose.startSession();
  try{
    let result;
    await s.withTransaction(async()=>{
      const f=await Finance.findOne({_id:req.params.financeId,customer:uid(req)}).session(s);
      if(!f)throw error("Phone finance not found.",404);
      const duplicate=await Payment.findOne({idempotencyKey:key(req)}).session(s);
      if(duplicate){
        const sameAllocation=req.body.installmentNumber===undefined||Number(req.body.installmentNumber)===Number(duplicate.allocation?.installmentNumber);
        if(duplicate.type!=="INSTALLMENT"||String(duplicate.customer)!==String(uid(req))||String(duplicate.application)!==String(f.application)||String(duplicate.finance)!==String(f._id)||money(duplicate.amount)!==money(req.body.amount)||!sameAllocation)throw error("Idempotency key is already associated with a different payment.");
        result={payment:duplicate,idempotent:true};return;
      }
      if(!["ACTIVE","OVERDUE"].includes(f.status))throw error("Finance contract cannot accept payment.",409);
      const row=f.paymentSchedule.find(r=>money(r.amount-r.paidAmount)>0);
      const amount=row&&money(row.amount-row.paidAmount);
      if(!amount||money(req.body.amount)!==amount)throw error("Payment must equal the exact next installment amount.",400);
      if(req.body.installmentNumber!==undefined&&Number(req.body.installmentNumber)!==Number(row.installmentNumber))throw error("Payment must target the exact next installment.",409);
      const app=await Application.findById(f.application).session(s);
      result=await debit(req,app,amount,"INSTALLMENT",s,f,{installmentNumber:row.installmentNumber,amount});
      row.paidAmount=amount;row.status="PAID";row.paidAt=new Date();
      f.amountPaid=money(f.amountPaid+amount);f.outstandingBalance=money(f.outstandingBalance-amount);app.outstandingBalance=money(app.outstandingBalance-amount);
      if(f.outstandingBalance===0){
        history(f,"COMPLETED",uid(req),"All installments paid");history(app,"COMPLETED",uid(req),"All installments paid");
        await Device.findByIdAndUpdate(f.device,{$set:{status:"COMPLETED"},$push:{statusHistory:{status:"COMPLETED",changedBy:uid(req),changedAt:new Date()}}},{session:s});
      }else{
        const now=Date.now();
        const delinquent=f.paymentSchedule.some(r=>r.status!=="PAID"&&new Date(r.dueDate).getTime()+f.graceDays*86400000<now);
        if(!delinquent&&f.status==="OVERDUE"){
          history(f,"ACTIVE",uid(req),"Overdue installment cured");history(app,"ACTIVE",uid(req),"Overdue installment cured");
          const prior=await ProviderEvent.findOne({finance:f._id,action:"RESTRICT"}).session(s);
          if(prior){
            const restoreKey=`overdue:${f._id}:restore`;
            await ProviderEvent.updateOne({idempotencyKey:restoreKey},{$setOnInsert:{reference:ref("SPF-PHONE"),finance:f._id,device:f.device,action:"RESTORE",provider:prior.provider,outcome:"INTEGRATION_REQUIRED",request:{automated:true,reason:"DELINQUENCY_CURED"},response:{message:"Restore integration required; no device state change was claimed."},requestedBy:uid(req)}},{upsert:true,session:s});
            f.restoreRequestRecordedAt=f.restoreRequestRecordedAt||new Date();
          }
          await Notification.updateOne({userId:f.customer,referenceId:f._id,referenceType:"PHONE_FINANCE_CURED"},{$setOnInsert:{title:"Phone financing account current",message:"Your overdue installment has been paid and your account is active.",type:"PHONE"}},{upsert:true,session:s});
        }
      }
      await app.save({session:s});await f.save({session:s});
    });
    res.status(result.idempotent?200:201).json({success:true,...result});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}
  finally{s.endSession();}
};
exports.evaluateOverdue=async(req,res)=>{const now=new Date(), contracts=await Finance.find({status:{$in:["ACTIVE","OVERDUE"]}});let changed=0;for(const f of contracts){let dirty=false;for(const row of f.paymentSchedule)if(row.status!=="PAID"&&new Date(row.dueDate).getTime()+f.graceDays*86400000<now&&row.status!=="OVERDUE"){row.status="OVERDUE";dirty=true;}const overdue=f.paymentSchedule.some(r=>r.status==="OVERDUE");if(overdue&&f.status==="ACTIVE"){history(f,"OVERDUE",uid(req),"Grace period expired");await Application.findByIdAndUpdate(f.application,{$set:{status:"OVERDUE"}});changed++;if(f.termsSnapshot.restrictionEnabled){f.restrictionRequestRecordedAt=now;history(f,"OVERDUE",uid(req),"Restriction integration required; no lock performed");await ProviderEvent.updateOne({finance:f._id,action:"RESTRICT",outcome:"REQUEST_RECORDED"},{$setOnInsert:{reference:ref("SPF-PHONE"),device:f.device,provider:f.termsSnapshot.restrictionProvider||"NONE",idempotencyKey:`overdue:${f._id}:restrict`,requestedBy:uid(req),request:{automated:true},response:{message:"Integration required; no lock performed."}}},{upsert:true});}await Notification.updateOne({userId:f.customer,referenceId:f._id,referenceType:"PhoneFinance",title:"Phone payment overdue"},{$setOnInsert:{message:"Your next phone-financing installment is overdue.",type:"PHONE"}},{upsert:true});}if(dirty||overdue&&f.status==="ACTIVE")await f.save();}res.json({success:true,evaluated:contracts.length,overdueUpdated:changed});};
exports.provider=async(req,res)=>{const s=await mongoose.startSession();try{let event,idempotent=false;await s.withTransaction(async()=>{const f=await Finance.findById(req.params.financeId).session(s);if(!f)throw error("Phone finance not found.",404);const action=text(req.body.action,20).toUpperCase(),provider=text(req.body.provider||"NONE").toUpperCase();if(!["RESTRICT","RESTORE"].includes(action))throw error("Action must be RESTRICT or RESTORE.",400);const idem=key(req);if(!idem)throw error("Idempotency-Key is required.",400);event=await ProviderEvent.findOne({idempotencyKey:idem}).session(s);if(event){if(String(event.finance)!==String(f._id)||String(event.device)!==String(f.device)||event.action!==action||event.provider!==provider||String(event.requestedBy)!==String(uid(req)))throw error("Idempotency key is bound to another provider request.");idempotent=true;return;}const device=await Device.findById(f.device).session(s);const adapter=await requestProviderAction({action,provider,device});event=(await ProviderEvent.create([{reference:ref("SPF-PHONE"),finance:f._id,device:f.device,action,provider:adapter.provider,idempotencyKey:idem,outcome:"REQUEST_RECORDED",request:{requestedProvider:provider},response:{...adapter.response,integrationStatus:"INTEGRATION_REQUIRED"},requestedBy:uid(req)}],{session:s}))[0];await audit(req,action==="RESTRICT"?"PHONE_RESTRICTION_REQUESTED":"PHONE_RESTORE_REQUESTED","Provider request recorded; integration required",{financeId:String(f._id),eventId:String(event._id)},s);});res.status(idempotent?200:201).json({success:true,event,idempotent,providerEnforcement:"DISABLED"});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{s.endSession();}};
exports.dashboard=async(req,res)=>{const [products,availableStock,pendingReview,awaitingDeposit,activeFinanced,overdue,completed,deposits,repayments,outstanding,requestRecorded]=await Promise.all([Product.countDocuments(),Product.aggregate([{$group:{_id:null,total:{$sum:"$stock"}}}]),Application.countDocuments({status:{$in:["SUBMITTED","UNDER_REVIEW","MORE_INFORMATION_REQUIRED"]}}),Application.countDocuments({status:"AWAITING_DEPOSIT"}),Finance.countDocuments({status:"ACTIVE"}),Finance.countDocuments({status:"OVERDUE"}),Finance.countDocuments({status:"COMPLETED"}),Payment.aggregate([{$match:{type:"DEPOSIT"}},{$group:{_id:null,total:{$sum:"$amount"}}}]),Payment.aggregate([{$match:{type:"INSTALLMENT"}},{$group:{_id:null,total:{$sum:"$amount"}}}]),Finance.aggregate([{$group:{_id:null,total:{$sum:"$outstandingBalance"}}}]),ProviderEvent.countDocuments({outcome:"REQUEST_RECORDED"})]);res.json({success:true,metrics:{products,availableStock:availableStock[0]?.total||0,pendingReview,awaitingDeposit,activeFinanced,overdue,restrictedOrRequestRecorded:requestRecorded,completed,depositsCollected:deposits[0]?.total||0,repaymentsCollected:repayments[0]?.total||0,outstandingPortfolio:outstanding[0]?.total||0}});};
exports.adminFinance=async(req,res)=>{const q=text(req.query.q,100),filter={};if(req.query.status)filter.status=text(req.query.status,30).toUpperCase();let finance=await Finance.find(filter).populate("customer","fullName phone email").populate("device").sort({createdAt:-1});if(q){const re=new RegExp(q,"i");finance=finance.filter(f=>re.test(f.reference)||re.test(f.customer?.fullName||"")||re.test(f.customer?.phone||"")||re.test(f.customer?.email||"")||re.test(f.device?.imei1||"")||re.test(f.device?.imei2||"")||re.test(f.device?.serialNumber||""));}const ids=finance.map(f=>f._id),events=await ProviderEvent.find({finance:{$in:ids}}).sort({createdAt:-1}).lean(),byFinance=new Map();for(const event of events){const k=String(event.finance);if(!byFinance.has(k))byFinance.set(k,[]);byFinance.get(k).push(event);}res.json({success:true,finance:finance.map(f=>({...f.toObject(),providerEvents:byFinance.get(String(f._id))||[]}))});};
exports.refundReservation=async(req,res)=>{const session=await mongoose.startSession();try{let output;await session.withTransaction(async()=>{const idem=key(req);if(!idem)throw error("Idempotency-Key is required.",400);const existing=await Payment.findOne({idempotencyKey:idem}).session(session);if(existing){const app=await Application.findById(req.params.applicationId).session(session);if(existing.type!=="REFUND"||String(existing.application)!==String(app?._id)||String(existing.customer)!==String(app?.customer)||money(existing.amount)!==money(app?.depositPaid))throw error("Idempotency key is bound to another operation.");output={payment:existing,idempotent:true};return;}const app=await Application.findById(req.params.applicationId).session(session);if(!app)throw error("Phone application not found.",404);if(app.status!=="DEPOSIT_PAID"||!app.device)throw error("Only an unassigned paid reservation can be refunded.");const device=await Device.findOne({_id:app.device,status:"RESERVED",reservedForApplication:app._id}).session(session);if(!device)throw error("Paid reservation is no longer refundable.");const original=await Payment.findOne({application:app._id,type:"DEPOSIT"}).session(session);if(!original||money(original.amount)!==money(app.depositPaid))throw error("Original deposit evidence is invalid.");const amount=money(original.amount);const customer=await User.findByIdAndUpdate(app.customer,{$inc:{walletBalance:amount}},{new:true,session});const closing=money(customer.walletBalance),opening=money(closing-amount);const transaction=(await Transaction.create([{reference:ref("SPF-PAY"),customerId:app.customer,serviceType:"PHONE_FINANCING_REFUND",provider:"SERVICEPAY_PHONE_FINANCING",amount,status:"SUCCESSFUL",providerResponse:{applicationId:String(app._id),originalPaymentId:String(original._id),idempotencyKey:idem}}],{session}))[0];const ledger=await postCredit({userId:app.customer,amount,openingBalance:opening,closingBalance:closing,service:"PHONE_FINANCING_REFUND",reference:transaction.reference,idempotencyKey:`phone:${idem}`,transactionId:transaction._id,narration:"Phone financing deposit refund",metadata:{applicationId:String(app._id),originalPaymentId:String(original._id)},session});if(ledger.duplicate)throw error("Duplicate refund ledger state requires support review.");const payment=(await Payment.create([{reference:ref("SPF-PAY"),application:app._id,customer:app.customer,type:"REFUND",amount,idempotencyKey:idem,transaction:transaction._id,ledgerEntry:ledger.entry._id,originalPayment:original._id,allocation:{originalDepositAmount:amount}}],{session}))[0];device.status="AVAILABLE";device.customer=null;device.application=null;device.reservedForApplication=null;device.reservedForCustomer=null;device.reservedAt=null;device.reservationExpiresAt=null;device.statusHistory.push({status:"AVAILABLE",changedBy:uid(req),note:"Deposit refunded; reservation released",changedAt:new Date()});await device.save({session});await Product.updateOne({_id:app.product},{$inc:{stock:1}},{session});app.depositPaid=0;app.outstandingBalance=app.totalPayable;app.refundedAt=new Date();app.refundPayment=payment._id;history(app,"REFUNDED",uid(req),req.body.reason||"Deposit refunded and reservation released");await app.save({session});await Notification.create([{userId:app.customer,title:"Phone deposit refunded",message:"Your phone-financing deposit has been returned to your wallet.",type:"PHONE",referenceId:app._id,referenceType:"PhoneApplicationRefund"}],{session});await audit(req,"PHONE_DEPOSIT_REFUNDED",req.body.reason||"Refunded unfulfilled phone reservation",{applicationId:String(app._id),paymentId:String(payment._id),amount},session);output={payment,application:app,idempotent:false};});res.status(output.idempotent?200:201).json({success:true,...output});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{session.endSession();}};
exports.evaluateReservationExpiry=async(req,res)=>{const now=new Date();const devices=await Device.find({status:"RESERVED",reservationExpiresAt:{$lte:now}}).populate("reservedForApplication");const paid=[];for(const device of devices){const app=device.reservedForApplication;if(app?.depositPaid>0){paid.push({deviceId:device._id,applicationId:app._id,customerId:app.customer,reservationExpiresAt:device.reservationExpiresAt,amount:app.depositPaid});if(!app.reservationRecoveryRequiredAt){app.reservationRecoveryRequiredAt=now;app.statusHistory.push({status:app.status,changedBy:uid(req),note:"Expired paid reservation requires admin refund resolution",changedAt:now});await app.save();await Notification.create({userId:app.customer,title:"Phone reservation requires attention",message:"Your paid phone reservation requires administrative resolution; no funds or device were released automatically.",type:"PHONE",referenceId:app._id,referenceType:"PhoneReservationExpiry"});await audit(req,"PHONE_RESERVATION_EXPIRY_RECORDED","Expired paid reservation flagged for refund resolution",{applicationId:String(app._id),deviceId:String(device._id)});}}}res.json({success:true,evaluated:devices.length,expiredPaidReservations:paid});};