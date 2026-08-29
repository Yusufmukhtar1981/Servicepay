const mongoose = require("mongoose");
const User = require("../models/user.model");
const Profile = require("../models/businessPartnerProfile.model");
const SolarOfficer = require("../models/solarOfficer.model");
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const SolarApplication = require("../models/solarApplication.model");
const SolarAssignment = require("../models/solarAssignment.model");
const PhoneApplication = require("../models/phoneApplication.model");
const SolarPayment = require("../models/solarPayment.model");
const PhonePayment = require("../models/phonePayment.model");
const Commission = require("../models/businessPartnerCommission.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");
const { createCommission, reverseCommission } = require("../services/businessPartnerCommission.service");
const {
  mergeBusinessPartnerViewPermissions,
  hasOnlyBusinessPartnerPermissions,
  hasOnlyBusinessPartnerServices,
  normalizeBusinessPartnerPermissions,
  normalizeBusinessPartnerServices,
  permissionsForBusinessPartnerServices,
} = require("../config/businessPartnerPermissions");
const text = (v, n = 500) => String(v || "").trim().slice(0, n);
const id = req => req.user._id;
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const isId = value => mongoose.Types.ObjectId.isValid(value);
const publicUser = value => {
  const user = value?.toObject ? value.toObject() : value;
  if (!user) return user;
  return { _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, state: user.state, lga: user.lga, status: user.status };
};
const safeCustomer = user => user ? {
  id: user._id, servicePayId: user._id, fullName: user.fullName,
  phone: user.phone,
} : null;
const solarDto = app => ({
  id: app._id, reference: app.reference || String(app._id), service: "SOLAR",
  status: app.status, customer: safeCustomer(app.customer),
  package: { id: app.package?._id || app.package, name: app.package?.name || app.packageSnapshot?.name || app.packageSnapshot?.packageName || "" },
  amounts: { totalPayable: app.totalPayable, amountPaid: app.amountPaid, outstandingBalance: app.outstandingBalance, depositPaid: app.depositPaid },
  nextPaymentDate: (app.paymentSchedule || []).find(row => Number(row.paidAmount || 0) < Number(row.amount || 0))?.dueDate || null,
  verification: app.partnerVerificationReview ? { status: app.partnerVerificationReview.decision || "", recommendation: app.partnerVerificationReview.decision || "" } : null,
  createdAt: app.createdAt, updatedAt: app.updatedAt,
});
const phoneDto = app => ({
  id: app._id, reference: app.reference, service: "PHONE_FINANCING",
  status: app.status, customer: safeCustomer(app.customer),
  product: { id: app.product?._id || app.product, name: app.product?.name || app.productSnapshot?.name || "", sku: app.product?.sku || app.productSnapshot?.sku || "" },
  amounts: { totalPayable: app.totalPayable, amountPaid: Math.max(0, Number(app.totalPayable || 0) - Number(app.outstandingBalance || 0)), outstandingBalance: app.outstandingBalance, depositPaid: app.depositPaid },
  assignedOfficer: app.assignedOfficer ? { id: app.assignedOfficer._id || app.assignedOfficer, fullName: app.assignedOfficer.fullName || "", staffId: app.assignedOfficer.staffId || "" } : null,
  verification: app.verificationReport ? { status: app.verificationReport.verificationStatus || "", recommendation: app.verificationReport.recommendation || "" } : null,
  createdAt: app.createdAt, updatedAt: app.updatedAt,
});
async function audit(req, action, reason, newData, session) {
  return Audit.create([{ actorId: id(req), actorRole: req.user.role, actorName: req.user.fullName || "", action, reason, newData, requestMethod: req.method, requestPath: req.originalUrl }], { session });
}
async function ownProfile(req, permission) {
  const profile = req.businessPartnerProfile || await Profile.findOne({ _id: req.user.businessPartnerProfile, user: id(req), status: "ACTIVE" });
  if (!profile) throw fail("Business Partner account is inactive.", 403);
  if (permission && !profile.permissions.includes(permission)) throw fail("Business Partner permission denied.", 403);
  return profile;
}
function partnerServiceApproved(profile, type) {
  const permission =
    type === "SOLAR" ? "SOLAR_ASSIGNMENT" : "PHONE_ASSIGNMENT";
  return (
    ["SOLAR", "PHONE"].includes(type) &&
    Array.isArray(profile.services) &&
    profile.services.includes(type) &&
    profile.permissions.includes(permission)
  );
}
function requirePartnerService(profile, type) {
  if (!["SOLAR", "PHONE"].includes(type)) {
    throw fail("Type must be SOLAR or PHONE.", 400);
  }
  if (!partnerServiceApproved(profile, type)) {
    throw fail(
      `This Business Partner is not approved for ${
        type === "SOLAR" ? "Solar" : "Phone Financing"
      }.`,
      403
    );
  }
}
const officerTerritoryAllowed = (profile, state, lga) =>
  !!state && !!lga &&
  (!profile.territory?.states?.length || profile.territory.states.includes(state)) &&
  (!profile.territory?.lgas?.length || profile.territory.lgas.includes(lga));
const solarOfficerCode = async session => {
  let n = (await SolarOfficer.countDocuments({}, { session })) + 1;
  while (n < 10000000) {
    const code = `SSO-${String(n++).padStart(6, "0")}`;
    if (!await SolarOfficer.exists({ officerId: code }).session(session)) return code;
  }
  throw fail("Unable to generate a Solar Officer ID.", 500);
};
const phoneOfficerCode = async session => {
  let n = (await User.countDocuments({ role: "PHONE_FINANCING_OFFICER" }, { session })) + 1;
  while (n < 10000000) {
    const code = `SP-PFO-${String(n++).padStart(5, "0")}`;
    if (!await User.exists({ staffId: code }).session(session)) return code;
  }
  throw fail("Unable to generate a Phone Financing Officer ID.", 500);
};
async function officerMetrics(type, officer) {
  if (type === "PHONE") {
    const rows = await PhoneApplication.find({ assignedOfficer: officer._id }).select("customer status").lean();
    return { assignedApplications: rows.length, assignedCustomers: new Set(rows.map(x => String(x.customer))).size, completedWork: rows.filter(x => x.status === "COMPLETED").length };
  }
  const assignments = await SolarAssignment.find({ officer: officer._id }).select("application customer").lean();
  const apps = assignments.length ? await SolarApplication.find({ _id: { $in: assignments.map(x => x.application) } }).select("status").lean() : [];
  const commissions = await SolarOfficerCommission.aggregate([{ $match: { officer: officer._id, status: { $ne: "REVERSED" } } }, { $group: { _id: null, total: { $sum: "$commissionAmount" } } }]);
  return { assignedApplications: assignments.length, assignedCustomers: new Set(assignments.map(x => String(x.customer))).size, completedWork: apps.filter(x => x.status === "COMPLETED").length, commissionTotal: commissions[0]?.total || 0 };
}
async function officerDto(type, record) {
  const solar = type === "SOLAR";
  const user = solar ? record.user : record;
  return {
    id: record._id, type, officerCode: solar ? record.officerId : (record.staffId || ""),
    fullName: user.fullName, phone: user.phone, email: user.email,
    state: solar ? record.state : user.state, lga: solar ? record.lga : user.lga,
    address: solar ? record.address : user.residentialAddress, status: solar ? record.status : user.status,
    createdAt: record.createdAt, metrics: await officerMetrics(type, record),
  };
}
async function ownedOfficer(profile, type, officerId, session) {
  if (!isId(officerId)) throw fail("Valid officer ID required.", 400);
  if (type === "SOLAR") {
    const officer = await SolarOfficer.findOne({ _id: officerId, businessPartner: profile._id }).populate("user", "fullName phone email state lga residentialAddress status").session(session || null);
    if (!officer) throw fail("Officer not found.", 404);
    return officer;
  }
  if (type === "PHONE") {
    const officer = await User.findOne({ _id: officerId, role: "PHONE_FINANCING_OFFICER", businessPartnerId: profile._id }).session(session || null);
    if (!officer) throw fail("Officer not found.", 404);
    return officer;
  }
  throw fail("Type must be SOLAR or PHONE.", 400);
}
async function partnerId(session) {
  let n = (await Profile.countDocuments({}, { session })) + 1;
  while (n < 10000000) { const candidate = `SP-BP-${String(n++).padStart(6, "0")}`; if (!await Profile.exists({ partnerId: candidate }).session(session)) return candidate; }
  throw fail("Unable to generate Business Partner ID.", 500);
}
exports.adminList = async (req, res) => { const filter={};const status=text(req.query.status,20).toUpperCase();if(status&&status!=="ALL")filter.status=status;const q=text(req.query.q||req.query.search,100);let partners=await Profile.find(filter).populate("user","fullName phone email status").sort({createdAt:-1});if(q){const re=new RegExp(q,"i");partners=partners.filter(p=>re.test(p.partnerId)||re.test(p.businessName)||re.test(p.user?.fullName||"")||re.test(p.user?.email||""));}res.json({success:true,count:partners.length,partners});};
exports.adminCreate = async (req, res) => {
  try {
    const fullName = text(req.body.fullName, 160), phone = text(req.body.phone, 40), email = text(req.body.email, 160).toLowerCase(), password = String(req.body.password || ""), businessName = text(req.body.businessName, 160);
    if (!fullName || !phone || !email || password.length < 6 || !businessName) throw fail("Full name, phone, email, business name, and a 6-character password are required.", 400);
    const permissions=req.body.permissions===undefined?undefined:req.body.permissions;
    const services=req.body.services===undefined?[]:req.body.services;
    if(permissions!==undefined&&!hasOnlyBusinessPartnerPermissions(permissions))throw fail("Invalid Business Partner permissions.",400);
    if(!hasOnlyBusinessPartnerServices(services))throw fail("Invalid Business Partner services.",400);
    const normalizedServices=normalizeBusinessPartnerServices(services);
    const grantedPermissions=permissionsForBusinessPartnerServices(normalizedServices,permissions);
    const territory=req.body.territory||{};
    if(territory&&typeof territory!=="object"||!Array.isArray(territory.states||[])||!Array.isArray(territory.lgas||[])||[...(territory.states||[]),...(territory.lgas||[])].some(v=>!text(v,120)))throw fail("Territory states and LGAs must be non-empty string arrays.",400);
    let user,profile,profileId,lastError;
    // Unique partnerId is the allocation lock. Retrying the whole transaction
    // means no user/profile/audit fragment survives a contested ID allocation.
    for(let attempt=0;attempt<4;attempt++){const session=await mongoose.startSession();try{await session.withTransaction(async()=>{profileId=await partnerId(session);user=(await User.create([{fullName,phone,email,password,role:"BUSINESS_PARTNER",status:"ACTIVE"}],{session}))[0];profile=(await Profile.create([{user:user._id,partnerId:profileId,businessName,contactName:text(req.body.contactName,160)||fullName,territory,services:normalizedServices,permissions:grantedPermissions,createdBy:id(req)}],{session}))[0];user.businessPartnerProfile=profile._id;user.businessPartnerId=profile._id;await user.save({session});await audit(req,"BUSINESS_PARTNER_CREATED","Created Business Partner",{partnerId:String(profile._id),generatedPartnerId:profileId},session);await Notification.create([{userId:user._id,title:"Business Partner account created",message:`Your Business Partner ID is ${profileId}.`,type:"BUSINESS_PARTNER",referenceId:profile._id,referenceType:"BusinessPartnerProfile"}],{session});});lastError=null;break;}catch(error){lastError=error;if(error.code!==11000||attempt===3)break;}finally{await session.endSession();}}
    if(lastError)throw lastError;
    res.status(201).json({ success: true, partner: profile, user: publicUser(user) });
  } catch (e) { res.status(e.statusCode || (e.code === 11000 ? 409 : 500)).json({ success: false, message: e.code === 11000 ? "A user with that phone or email already exists." : e.message }); }
};
exports.adminUpdate = async (req, res) => {
  try { const p = await Profile.findById(req.params.partnerId); if (!p) throw fail("Business Partner not found.", 404);
    for (const key of ["businessName", "contactName", "territory"]) if (Object.hasOwn(req.body || {}, key)) p[key] = req.body[key];
    if (Object.hasOwn(req.body || {}, "permissions")) {
      if (!hasOnlyBusinessPartnerPermissions(req.body.permissions)) throw fail("Invalid Business Partner permissions.", 400);
      p.permissions = normalizeBusinessPartnerPermissions(req.body.permissions);
    }
    if (Object.hasOwn(req.body || {}, "services")) {
      if (!hasOnlyBusinessPartnerServices(req.body.services)) throw fail("Invalid Business Partner services.", 400);
      p.services = normalizeBusinessPartnerServices(req.body.services);
    }
    p.permissions = permissionsForBusinessPartnerServices(p.services, p.permissions);
    await p.save(); await audit(req, "BUSINESS_PARTNER_UPDATED", "Updated Business Partner profile", { partnerId: String(p._id) }); res.json({ success: true, partner: p });
  } catch (e) { res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
};
exports.adminStatus = async (req, res) => {
  try { const status = text(req.body.status, 20).toUpperCase(); if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) throw fail("Invalid Business Partner status.", 400);
    const p = await Profile.findById(req.params.partnerId); if (!p) throw fail("Business Partner not found.", 404);
    p.status = status; p.statusChangedBy = id(req); p.statusChangedAt = new Date();
    if (status === "ACTIVE") p.permissions = mergeBusinessPartnerViewPermissions(p.permissions);
    await p.save();
    await User.updateOne({ _id: p.user }, { $set: { status: status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" } });
    await audit(req, "BUSINESS_PARTNER_STATUS_UPDATED", `Changed status to ${status}`, { partnerId: String(p._id), status }); await Notification.create({ userId: p.user, title: "Business Partner status updated", message: `Your account is now ${status}.`, type: "BUSINESS_PARTNER", referenceId: p._id, referenceType: "BusinessPartnerStatus" });
    res.json({ success: true, partner: p });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminReset = async (req, res) => {
  try { const password = String(req.body.password || ""); if (password.length < 6) throw fail("A temporary password of at least 6 characters is required.", 400);
    const p = await Profile.findById(req.params.partnerId); if (!p) throw fail("Business Partner not found.", 404);
    const user = await User.findById(p.user).select("+password"); user.password = password; user.mustChangePassword = true; await user.save();
    await audit(req, "BUSINESS_PARTNER_PASSWORD_RESET", "Reset Business Partner password", { partnerId: String(p._id) }); res.json({ success: true, message: "Password reset. The partner must change it at next login." });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.me = async (req,res) => { try { const p = await ownProfile(req); res.json({ success:true, partner:p }); } catch(e) { res.status(e.statusCode || 500).json({success:false,message:e.message}); } };
exports.dashboard = async (req,res) => { try { const p=await ownProfile(req,"DASHBOARD"),solarApproved=partnerServiceApproved(p,"SOLAR"),phoneApproved=partnerServiceApproved(p,"PHONE"),sourceTypes=[...(solarApproved?["SOLAR"]:[]),...(phoneApproved?["PHONE"]:[])]; const [solar, phone, commissions] = await Promise.all([solarApproved?SolarApplication.countDocuments({businessPartner:p._id}):0,phoneApproved?PhoneApplication.countDocuments({businessPartner:p._id}):0,sourceTypes.length?Commission.aggregate([{$match:{businessPartner:p._id,sourceType:{$in:sourceTypes}}},{$group:{_id:"$status",amount:{$sum:"$amount"},count:{$sum:1}}}]):[]]); res.json({success:true,dashboard:{solarApplications:solar,phoneApplications:phone,commissions,permissions:p.permissions,availableModules:p.permissions}}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.officers = async (req,res) => { try { const p=await ownProfile(req,"OFFICERS"); const solarApproved=p.services.includes("SOLAR")&&p.permissions.includes("SOLAR_ASSIGNMENT"),phoneApproved=p.services.includes("PHONE")&&p.permissions.includes("PHONE_ASSIGNMENT"); const [solar, phone]=await Promise.all([solarApproved?SolarOfficer.find({businessPartner:p._id}).populate("user","fullName phone email status state lga residentialAddress"):[],phoneApproved?User.find({businessPartnerId:p._id,role:"PHONE_FINANCING_OFFICER"}):[]]);res.json({success:true,officers:{solar:await Promise.all(solar.map(x=>officerDto("SOLAR",x))),phone:await Promise.all(phone.map(x=>officerDto("PHONE",x)))}}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.createOfficer = async (req, res) => {
  const type=text(req.body?.type,10).toUpperCase(), fullName=text(req.body?.fullName,160), phone=text(req.body?.phone,40), email=text(req.body?.email,160).toLowerCase(), password=String(req.body?.password||""), state=text(req.body?.state,120), lga=text(req.body?.lga,120), address=text(req.body?.address,500);
  let session;
  try {
    const p=await ownProfile(req,"OFFICER_MANAGEMENT");
    requirePartnerService(p,type);
    if (!fullName||!phone||!email||password.length<6||!state||!lga||!address) throw fail("Full name, phone, email, password, state, LGA, and address are required.",400);
    if (!officerTerritoryAllowed(p,state,lga)) throw fail("Officer territory does not match partner territory.",409);
    if (await User.exists({$or:[{phone},{email}]})) throw fail("An account already exists with this email or phone number.",409);
    session=await mongoose.startSession(); let officer;
    await session.withTransaction(async()=>{
      if(type==="SOLAR"){
        const code=await solarOfficerCode(session);
        const user=(await User.create([{fullName,phone,email,password,role:"SOLAR_OFFICER",isStaff:true,staffId:code,department:"OPERATIONS",staffCreatedBy:id(req),businessPartnerId:p._id,state,lga,residentialAddress:address,status:"ACTIVE",mustChangePassword:true}],{session}))[0];
        officer=(await SolarOfficer.create([{user:user._id,officerId:code,state,lga,address,status:"ACTIVE",createdBy:id(req),businessPartner:p._id}],{session}))[0];
        await SolarOfficerWallet.create([{officer:officer._id}],{session});
        officer.user=user;
      }else{
        const code=await phoneOfficerCode(session);
        officer=(await User.create([{fullName,phone,email,password,role:"PHONE_FINANCING_OFFICER",isStaff:true,staffId:code,department:"OPERATIONS",staffCreatedBy:id(req),businessPartnerId:p._id,state,lga,residentialAddress:address,status:"ACTIVE",mustChangePassword:true}],{session}))[0];
      }
      await audit(req,"BUSINESS_PARTNER_OFFICER_CREATED","Created Business Partner officer",{partnerId:String(p._id),officerId:String(officer._id),type},session);
    });
    res.status(201).json({success:true,officer:await officerDto(type,officer)});
  }catch(e){res.status(e.statusCode||(e.code===11000?409:500)).json({success:false,message:e.code===11000?"An account already exists with this email or phone number.":e.message});}finally{if(session)await session.endSession();}
};
exports.officerDetail = async (req,res) => { try { const p=await ownProfile(req,"OFFICERS"), type=text(req.params.type,10).toUpperCase(); requirePartnerService(p,type); const officer=await ownedOfficer(p,type,req.params.officerId);res.json({success:true,officer:await officerDto(type,officer)}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.updateOfficer = async (req,res) => {
  let session;
  try { const p=await ownProfile(req,"OFFICER_MANAGEMENT"),type=text(req.params.type,10).toUpperCase();requirePartnerService(p,type);session=await mongoose.startSession();let officer;
    await session.withTransaction(async()=>{officer=await ownedOfficer(p,type,req.params.officerId,session);const user=type==="SOLAR"?officer.user:officer;
      for(const field of ["fullName","phone","email","state","lga"])if(Object.hasOwn(req.body||{},field))user[field]=text(req.body[field],field==="fullName"?160:120);
      if(Object.hasOwn(req.body||{},"address")){const address=text(req.body.address,500);if(!address)throw fail("Address is required.",400);user.residentialAddress=address;if(type==="SOLAR")officer.address=address;}
      if(!user.fullName||!user.phone||!user.email||!user.state||!user.lga||!officerTerritoryAllowed(p,user.state,user.lga))throw fail("Officer details must remain within partner territory.",409);
      if(type==="SOLAR"){officer.state=user.state;officer.lga=user.lga;await user.save({session});await officer.save({session});}else await user.save({session});
      await audit(req,"BUSINESS_PARTNER_OFFICER_UPDATED","Updated Business Partner officer",{partnerId:String(p._id),officerId:String(officer._id),type},session);
    });res.json({success:true,officer:await officerDto(type,officer)});
  }catch(e){res.status(e.statusCode||(e.code===11000?409:500)).json({success:false,message:e.code===11000?"An account already exists with this email or phone number.":e.message});}finally{if(session)await session.endSession();}
};
exports.officerStatus = async (req,res) => {
  let session;
  try {const p=await ownProfile(req,"OFFICER_MANAGEMENT"),type=text(req.params.type,10).toUpperCase(),status=text(req.body?.status,20).toUpperCase();requirePartnerService(p,type);if(!["ACTIVE","SUSPENDED"].includes(status))throw fail("Status must be ACTIVE or SUSPENDED.",400);session=await mongoose.startSession();let officer;
    await session.withTransaction(async()=>{officer=await ownedOfficer(p,type,req.params.officerId,session);if(status==="SUSPENDED"){const active=type==="SOLAR"?await SolarAssignment.exists({officer:officer._id,status:"ACTIVE"}).session(session):await PhoneApplication.exists({assignedOfficer:officer._id,assignmentState:"ACTIVE"}).session(session);if(active)throw fail("Reassign or unassign all active applications before suspending this officer.",409);}
      if(type==="SOLAR"){officer.status=status;await officer.save({session});await User.updateOne({_id:officer.user._id},{$set:{status}},{session});officer.user.status=status;}else{officer.status=status;await officer.save({session});}
      await audit(req,"BUSINESS_PARTNER_OFFICER_STATUS_UPDATED",`Changed officer status to ${status}`,{partnerId:String(p._id),officerId:String(officer._id),type,status},session);
    });res.json({success:true,officer:await officerDto(type,officer)});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{if(session)await session.endSession();}
};
exports.resetOfficerAccess = async (req,res) => {
  let session;
  try {const p=await ownProfile(req,"OFFICER_MANAGEMENT"),type=text(req.params.type,10).toUpperCase(),password=String(req.body?.password||"");requirePartnerService(p,type);if(password.length<6)throw fail("A temporary password of at least 6 characters is required.",400);session=await mongoose.startSession();
    await session.withTransaction(async()=>{const officer=await ownedOfficer(p,type,req.params.officerId,session),user=type==="SOLAR"?officer.user:officer;user.password=password;user.mustChangePassword=true;await user.save({session});await audit(req,"BUSINESS_PARTNER_OFFICER_PASSWORD_RESET","Reset Business Partner officer password",{partnerId:String(p._id),officerId:String(officer._id),type},session);});
    res.json({success:true,message:"Password reset. The officer must change it at next login."});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{if(session)await session.endSession();}
};
exports.linkOfficer = async (req,res) => { try { const p=await ownProfile(req,"OFFICERS"); const type=text(req.body.type,10).toUpperCase(), officerId=req.body.officerId;if(!isId(officerId))throw fail("Valid officer ID required.",400);
  if(type==="SOLAR"){const o=await SolarOfficer.findById(officerId);if(!o)throw fail("Solar Officer not found.",404);if(o.businessPartner&&String(o.businessPartner)!==String(p._id))throw fail("Officer belongs to another Business Partner.",403);o.businessPartner=p._id;await o.save();await User.updateOne({_id:o.user},{$set:{businessPartnerId:p._id}});}
  else if(type==="PHONE"){const o=await User.findOne({_id:officerId,role:"PHONE_FINANCING_OFFICER"});if(!o)throw fail("Phone Financing Officer not found.",404);if(o.businessPartnerId&&String(o.businessPartnerId)!==String(p._id))throw fail("Officer belongs to another Business Partner.",403);o.businessPartnerId=p._id;await o.save();} else throw fail("Officer type must be SOLAR or PHONE.",400);
  await audit(req,"BUSINESS_PARTNER_OFFICER_ASSIGNED","Linked officer to Business Partner",{partnerId:String(p._id),officerId,type});res.json({success:true});
 }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.applications = async (req,res) => { try { const p=await ownProfile(req,"APPLICATIONS"),solarApproved=partnerServiceApproved(p,"SOLAR"),phoneApproved=partnerServiceApproved(p,"PHONE"); const [solar,phone]=await Promise.all([solarApproved?SolarApplication.find({businessPartner:p._id}).populate("customer","fullName phone").populate("package","name"):[],phoneApproved?PhoneApplication.find({businessPartner:p._id}).populate("customer","fullName phone").populate("product","name sku").populate("assignedOfficer","fullName staffId"):[]]);res.json({success:true,applications:{solar:solar.map(solarDto),phone:phone.map(phoneDto)}}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.customers = async (req,res) => { try { const p=await ownProfile(req,"CUSTOMERS"),solarApproved=partnerServiceApproved(p,"SOLAR"),phoneApproved=partnerServiceApproved(p,"PHONE");const [solar,phone]=await Promise.all([solarApproved?SolarApplication.find({businessPartner:p._id}).distinct("customer"):[],phoneApproved?PhoneApplication.find({businessPartner:p._id}).distinct("customer"):[]]);const customers=await User.find({_id:{$in:[...new Set([...solar,...phone].map(String))]}}).select("fullName phone email state lga status");res.json({success:true,customers}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.repayments = async (req,res) => { try { const p=await ownProfile(req,"REPAYMENTS"),solarApproved=partnerServiceApproved(p,"SOLAR"),phoneApproved=partnerServiceApproved(p,"PHONE"); const solarApps=solarApproved?await SolarApplication.find({businessPartner:p._id}).select("_id customer status totalPayable amountPaid outstandingBalance"):[];const phoneApps=phoneApproved?await PhoneApplication.find({businessPartner:p._id}).select("_id customer status totalPayable outstandingBalance"):[];const [solarPayments,phonePayments]=await Promise.all([solarApproved?SolarPayment.find({application:{$in:solarApps.map(x=>x._id)}}).select("application customer type amount createdAt"):[],phoneApproved?PhonePayment.find({application:{$in:phoneApps.map(x=>x._id)}}).select("application customer type amount createdAt"):[]]);res.json({success:true,repayments:{solar:solarPayments,phone:phonePayments}}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.assignApplication = async (req,res) => {
  let session;
  try {
    const type=text(req.body.type,10).toUpperCase();
    if(!["SOLAR","PHONE"].includes(type))throw fail("Type must be SOLAR or PHONE.",400);
    const p=await ownProfile(req,type==="SOLAR"?"SOLAR_ASSIGNMENT":"PHONE_ASSIGNMENT"), applicationId=req.params.applicationId, officerId=req.body.officerId;
    requirePartnerService(p,type);
    if(!isId(applicationId)||!isId(officerId))throw fail("Valid application and officer IDs are required.",400);
    session=await mongoose.startSession();
    await session.withTransaction(async()=>{
      if(type==="PHONE"){
        // Touching the officer document makes assignment and suspension conflict;
        // a transaction retry then observes either the active assignment or suspension.
        const officer=await User.findOneAndUpdate({_id:officerId,role:"PHONE_FINANCING_OFFICER",businessPartnerId:p._id,status:"ACTIVE"},{$set:{updatedAt:new Date()}},{new:true,session});
        const app=await PhoneApplication.findOne({_id:applicationId,businessPartner:p._id}).session(session);
        if(!officer||!app)throw fail("Application or active owned officer not found.",404);
        if(!["SUBMITTED","UNDER_REVIEW"].includes(app.status))throw fail("This phone application cannot be assigned.",409);
        app.assignedOfficer=officer._id;app.assignmentState="ACTIVE";app.assignmentVersion=(app.assignmentVersion||0)+1;await app.save({session});
        await Notification.create([{userId:officer._id,title:"Partner application assigned",message:`You have been assigned ${app.reference}.`,type:"BUSINESS_PARTNER",referenceId:app._id,referenceType:"BusinessPartnerPhoneAssignment"}],{session});
      }else{
        const officer=await SolarOfficer.findOneAndUpdate({_id:officerId,businessPartner:p._id,status:"ACTIVE"},{$set:{updatedAt:new Date()}},{new:true,session});
        const app=await SolarApplication.findOne({_id:applicationId,businessPartner:p._id}).session(session);
        if(!officer||!app)throw fail("Application or active owned officer not found.",404);
        const current=await SolarAssignment.findOne({application:app._id,status:"ACTIVE"}).session(session);
        if(current){current.status="REASSIGNED";current.endedAt=new Date();await current.save({session});}
        await SolarAssignment.create([{application:app._id,customer:app.customer,officer:officer._id,assignedBy:id(req),note:text(req.body.note)}],{session});
        await Notification.create([{userId:officer.user,title:"Partner solar application assigned",message:"You have a new solar application assignment.",type:"BUSINESS_PARTNER",referenceId:app._id,referenceType:"BusinessPartnerSolarAssignment"}],{session});
      }
      await audit(req,"BUSINESS_PARTNER_APPLICATION_ASSIGNED","Assigned application within partner scope",{partnerId:String(p._id),applicationId,type,officerId},session);
    });
    res.json({success:true});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{if(session)await session.endSession();}
};
exports.reviewVerification = async (req,res) => { try {const p=await ownProfile(req,"VERIFICATION_REVIEW"),type=text(req.body.type,10).toUpperCase();requirePartnerService(p,type);let app;if(type==="PHONE")app=await PhoneApplication.findOne({_id:req.params.applicationId,businessPartner:p._id});else app=await SolarApplication.findOne({_id:req.params.applicationId,businessPartner:p._id});if(!app)throw fail("Partner application not found.",404);const review={decision:text(req.body.decision,30).toUpperCase(),note:text(req.body.note,1000),reviewedBy:id(req),reviewedAt:new Date()};if(!["ACCEPTED","RETURNED"].includes(review.decision))throw fail("Decision must be ACCEPTED or RETURNED.",400);app.partnerVerificationReview=review;await app.save();await audit(req,"BUSINESS_PARTNER_VERIFICATION_REVIEWED","Reviewed field verification",{partnerId:String(p._id),applicationId:String(app._id),type,decision:review.decision});res.json({success:true,review});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.performance = async (req,res) => { try { const p=await ownProfile(req,"REPORTS"),solarApproved=partnerServiceApproved(p,"SOLAR"),phoneApproved=partnerServiceApproved(p,"PHONE"),sourceTypes=[...(solarApproved?["SOLAR"]:[]),...(phoneApproved?["PHONE"]:[])];const [solar,phone,payments]=await Promise.all([solarApproved?SolarApplication.aggregate([{$match:{businessPartner:p._id}},{$group:{_id:"$status",count:{$sum:1},outstanding:{$sum:"$outstandingBalance"}}}]):[],phoneApproved?PhoneApplication.aggregate([{$match:{businessPartner:p._id}},{$group:{_id:"$status",count:{$sum:1},outstanding:{$sum:"$outstandingBalance"}}}]):[],sourceTypes.length?Commission.aggregate([{$match:{businessPartner:p._id,sourceType:{$in:sourceTypes}}},{$group:{_id:"$status",amount:{$sum:"$amount"}}}]):[]]);res.json({success:true,performance:{solar,phone,commissions:payments}});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.commissions = async(req,res)=>{try{const p=await ownProfile(req,"REPORTS"),sourceTypes=[...(partnerServiceApproved(p,"SOLAR")?["SOLAR"]:[]),...(partnerServiceApproved(p,"PHONE")?["PHONE"]:[])];res.json({success:true,commissions:sourceTypes.length?await Commission.find({businessPartner:p._id,sourceType:{$in:sourceTypes}}).sort({createdAt:-1}):[]});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.notifications = async(req,res)=>{try{await ownProfile(req);res.json({success:true,notifications:await Notification.find({userId:id(req),type:"BUSINESS_PARTNER"}).sort({createdAt:-1})});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.activity = async(req,res)=>{try{await ownProfile(req);res.json({success:true,activity:await Audit.find({actorId:id(req),action:/^BUSINESS_PARTNER_/}).sort({createdAt:-1})});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminCreateCommission = async(req,res)=>{try{const p=await Profile.findById(req.params.partnerId);if(!p)throw fail("Business Partner not found.",404);const result=await createCommission({businessPartner:p._id,application:req.body.applicationId,sourceType:text(req.body.sourceType,10).toUpperCase(),amount:req.body.amount,eventKey:text(req.body.eventKey,160),createdBy:id(req),status:"PENDING"});await audit(req,"BUSINESS_PARTNER_COMMISSION_CREATED","Recorded derived commission",{commissionId:String(result.commission._id),partnerId:String(p._id)});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminCount = async (req,res) => { const rows=await Profile.aggregate([{$group:{_id:"$status",count:{$sum:1}}}]), n=s=>rows.find(x=>x._id===s)?.count||0;res.json({success:true,count:rows.reduce((a,x)=>a+x.count,0),counts:{active:n("ACTIVE"),suspended:n("SUSPENDED"),disabled:n("DISABLED")}}); };
exports.adminDetail = async(req,res)=>{const partner=await Profile.findById(req.params.partnerId).populate("user","fullName phone email role status");if(!partner)return res.status(404).json({success:false,message:"Business Partner not found."});const [solarOfficers,phoneOfficers,solarApps,phoneApps,commissions,activity]=await Promise.all([SolarOfficer.find({businessPartner:partner._id}).populate("user","fullName phone email status"),User.find({businessPartnerId:partner._id,role:"PHONE_FINANCING_OFFICER"}).select("fullName phone email status staffId state lga"),SolarApplication.find({businessPartner:partner._id}).populate("customer","fullName phone").populate("package","name"),PhoneApplication.find({businessPartner:partner._id}).populate("customer","fullName phone").populate("product","name sku").populate("assignedOfficer","fullName staffId"),Commission.find({businessPartner:partner._id}).sort({createdAt:-1}),Audit.find({"newData.partnerId":String(partner._id)}).select("actorId actorName action reason createdAt").sort({createdAt:-1})]);const solar=solarApps.map(solarDto),phone=phoneApps.map(phoneDto),net=commissions.reduce((sum,row)=>sum+Number(row.amount),0);res.json({success:true,partner,officers:{solar:solarOfficers.map(o=>({id:o._id,officerId:o.officerId,status:o.status,user:publicUser(o.user)})),phone:phoneOfficers.map(publicUser)},applications:{solar,phone},repayments:{solar:solar.map(x=>({application:x.id,...x.amounts,nextPaymentDate:x.nextPaymentDate})),phone:phone.map(x=>({application:x.id,...x.amounts}))},commissions,performance:{netCommission:net,solarApplications:solar.length,phoneApplications:phone.length},activity});};
exports.adminLinkOfficer = async(req,res)=>{try{const p=await Profile.findById(req.params.partnerId), type=text(req.body.type,10).toUpperCase(), officerId=req.body.officerId;if(!p||!isId(officerId))throw fail("Business Partner and valid officer are required.",400);const allowed=(state,lga)=>!(!state||!lga||!p.territory?.states?.length||!p.territory.states.includes(state)||(p.territory.lgas?.length&&!p.territory.lgas.includes(lga)));if(type==="PHONE"){const u=await User.findOne({_id:officerId,role:"PHONE_FINANCING_OFFICER"});if(!u)throw fail("Phone Financing Officer not found.",404);if(u.businessPartnerId&&String(u.businessPartnerId)!==String(p._id))throw fail("Officer belongs to another Business Partner; use transfer.",409);if(!allowed(u.state,u.lga))throw fail("Officer territory does not match partner territory.",409);u.businessPartnerId=p._id;await u.save();}else if(type==="SOLAR"){const o=await SolarOfficer.findById(officerId);if(!o)throw fail("Solar Officer not found.",404);if(o.businessPartner&&String(o.businessPartner)!==String(p._id))throw fail("Officer belongs to another Business Partner; use transfer.",409);if(!allowed(o.state,o.lga))throw fail("Officer territory does not match partner territory.",409);o.businessPartner=p._id;await o.save();await User.updateOne({_id:o.user},{$set:{businessPartnerId:p._id}});}else throw fail("Type must be SOLAR or PHONE.",400);await audit(req,"BUSINESS_PARTNER_OFFICER_ASSIGNED","Head Office linked officer",{partnerId:String(p._id),officerId,type});res.json({success:true});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminRules = async(req,res)=>res.json({success:true,rules:await Rule.find().sort({sourceType:1,version:-1})});
exports.adminCreateRule = async(req,res)=>{try{const sourceType=text(req.body.sourceType,30).toUpperCase(),calculation=text(req.body.calculation,20).toUpperCase();if(!["SOLAR","PHONE_FINANCING"].includes(sourceType)||!["PERCENT","FIXED"].includes(calculation)||Number(req.body.value)<0)throw fail("Valid sourceType, calculation, and non-negative value are required.",400);const latest=await Rule.findOne({sourceType}).sort({version:-1});const rule=await Rule.create({sourceType,calculation,value:Number(req.body.value),version:(latest?.version||0)+1,createdBy:id(req)});res.status(201).json({success:true,rule});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminRuleStatus = async(req,res)=>{try{const status=text(req.body.status,20).toUpperCase();if(!["ACTIVE","DISABLED"].includes(status))throw fail("Status must be ACTIVE or DISABLED.",400);const rule=await Rule.findByIdAndUpdate(req.params.ruleId,{$set:{status}},{new:true});if(!rule)throw fail("Commission rule not found.",404);res.json({success:true,rule});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminAssignApplication = async (req,res) => { try { const p=await Profile.findById(req.params.partnerId);const type=text(req.body.type,10).toUpperCase();if(!p)throw fail("Business Partner not found.",404);requirePartnerService(p,type);if(type==="PHONE"){const app=await PhoneApplication.findById(req.params.applicationId);if(!app)throw fail("Phone application not found.",404);if(app.businessPartner&&String(app.businessPartner)!==String(p._id))throw fail("Application belongs to another Business Partner.",409);app.businessPartner=p._id;await app.save();}else{const app=await SolarApplication.findById(req.params.applicationId);if(!app)throw fail("Solar application not found.",404);if(app.businessPartner&&String(app.businessPartner)!==String(p._id))throw fail("Application belongs to another Business Partner.",409);app.businessPartner=p._id;await app.save();}await audit(req,"BUSINESS_PARTNER_APPLICATION_ASSIGNED","Assigned application to Business Partner",{partnerId:String(p._id),applicationId:req.params.applicationId,type});await Notification.create({userId:p.user,title:"New partner application",message:"A new application was assigned to your organisation.",type:"BUSINESS_PARTNER",referenceId:p._id,referenceType:"BusinessPartnerAssignment"});res.json({success:true}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.adminReverseCommission = async(req,res)=>{try{const result=await reverseCommission({commissionId:req.params.commissionId,eventKey:text(req.body.eventKey,160),createdBy:id(req),reason:req.body.reason});if(!result.idempotent){const partner=await Profile.findById(result.commission.businessPartner);if(partner)await Notification.create({userId:partner.user,title:"Commission reversed",message:"A Business Partner commission has been reversed.",type:"BUSINESS_PARTNER",referenceId:result.commission._id,referenceType:"BusinessPartnerCommissionReversal"});}await audit(req,"BUSINESS_PARTNER_COMMISSION_REVERSED","Recorded commission reversal",{commissionId:req.params.commissionId});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};