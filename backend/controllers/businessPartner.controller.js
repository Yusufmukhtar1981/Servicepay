const mongoose = require("mongoose");
const crypto = require("crypto");
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
const Transaction = require("../models/transaction.model");
const Commission = require("../models/businessPartnerCommission.model");
const Rule = require("../models/businessPartnerCommissionRule.model");
const BonusRule = require("../models/businessPartnerBonusRule.model");
const Target = require("../models/businessPartnerTarget.model");
const Notification = require("../models/notification.model");
const Audit = require("../models/adminAuditLog.model");
const { createCommission, reverseCommission, recordCommissionRecovery, reconcileCommissionWallet, evaluateBonusRule } = require("../services/businessPartnerCommission.service");
const {
  mergeBusinessPartnerViewPermissions,
  hasOnlyBusinessPartnerPermissions,
  hasOnlyBusinessPartnerServices,
  normalizeBusinessPartnerPermissions,
  normalizeBusinessPartnerServices,
  permissionsForBusinessPartnerServices,
} = require("../config/businessPartnerPermissions");
const { STAFF_PERMISSIONS: STAFF_P } = require("../config/staffPermissions");
const SUPPORTED_COMMISSION_SOURCES = new Set(["SOLAR", "PHONE", "PHONE_FINANCING"]);
const text = (v, n = 500) => String(v || "").trim().slice(0, n);
const id = req => req.user._id;
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const isId = value => mongoose.Types.ObjectId.isValid(value);
const publicUser = value => {
  const user = value?.toObject ? value.toObject() : value;
  if (!user) return user;
  return { _id: user._id, fullName: user.fullName, phone: user.phone, email: user.email, role: user.role, state: user.state, lga: user.lga, status: user.status };
};
const maskedPartnerUser = value => value ? {
  id: value._id,
  fullName: value.fullName,
  phone: maskPhone(value.phone),
  email: maskEmail(value.email),
  role: value.role,
  status: value.status,
} : null;
const safeCustomer = user => user ? {
  id: user._id, servicePayId: user._id, fullName: user.fullName,
  phone: maskPhone(user.phone),
} : null;
const maskPhone = value => {
  const raw = String(value || "");
  return raw.length < 7 ? "***" : `${raw.slice(0, 3)}****${raw.slice(-2)}`;
};
const maskEmail = value => {
  const raw = String(value || "");
  const [name, domain] = raw.split("@");
  return !domain ? (raw ? "***" : "") : `${(name || "").slice(0, 1)}***@${domain}`;
};
const partnerCustomerDto = (user, { includeWallet = true, includeKyc = true } = {}) => {
  if (!user) return null;
  const value = user.toObject ? user.toObject() : user;
  return {
    id: value._id,
    servicePayId: value._id,
    fullName: value.fullName,
    phone: maskPhone(value.phone),
    email: maskEmail(value.email),
    status: value.status,
    kyc: includeKyc ? {
      verified: value.kycVerified === true,
      ninStatus: value.ninVerificationStatus || "PENDING",
      nin: value.ninNumberMasked || null,
    } : undefined,
    // Application-attributed legacy visibility is an application summary only;
    // never expose the customer's wallet unless canonical ownership matches.
    walletBalance: includeWallet ? Number(value.walletBalance || 0) : undefined,
    officerId: includeKyc ? (value.officerId || null) : null,
    joinedAt: value.createdAt,
    lastActivityAt: value.updatedAt || value.createdAt,
    acquisitionChannel: includeKyc ? (value.acquisitionChannel || "") : "APPLICATION",
  };
};
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
async function partnerCustomerIds(profile, session) {
  // Canonical ownership is deliberately only the customer profile's
  // businessPartnerId. An application assignment is not an ownership
  // transfer and must never grant access to the customer's wallet or
  // general transaction history.
  const owned = await User.find({
    role: "CUSTOMER",
    businessPartnerId: profile._id,
  }).select("_id").session(session || null).lean();
  return owned.map(row => row._id);
}
async function partnerApplicationCustomerIds(profile, session) {
  const [solar, phone] = await Promise.all([
    partnerServiceApproved(profile, "SOLAR")
      ? SolarApplication.find({ businessPartner: profile._id }).distinct("customer").session(session || null)
      : [],
    partnerServiceApproved(profile, "PHONE")
      ? PhoneApplication.find({ businessPartner: profile._id }).distinct("customer").session(session || null)
      : [],
  ]);
  return [...new Set([...solar.map(String), ...phone.map(String)])]
    .filter(isId).map(value => new mongoose.Types.ObjectId(value));
}
function dateFilter(query, field = "createdAt") {
  const from = query.dateFrom || query.from || query.startDate;
  const to = query.dateTo || query.to || query.endDate;
  const result = {};
  if (from && !Number.isNaN(Date.parse(from))) result.$gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) result.$lte = new Date(to);
  return Object.keys(result).length ? { [field]: result } : {};
}
async function partnerOwnedCustomer(profile, customerId, session) {
  if (!isId(customerId)) throw fail("Valid customer ID required.", 400);
  // Detail, wallet, commissions, and transaction history require canonical
  // ownership; an application-only relationship is not sufficient.
  const query = User.findOne({ _id: customerId, role: "CUSTOMER", businessPartnerId: profile._id }).session(session || null);
  const customer = await query;
  if (!customer) throw fail("Customer is outside this Business Partner network.", 404);
  return customer;
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
exports.adminList = async (req, res) => { try { const filter={};const access=req.staffAccess||{};const scope=access.scope||{};const scopeType=String(scope.type||"GLOBAL").toUpperCase();if(!access.isHeadOffice&&scopeType!=="GLOBAL"){if(scopeType==="BUSINESS_PARTNER"&&isId(scope.businessPartnerId))filter._id=scope.businessPartnerId;else if(scopeType==="STATE"&&scope.state)filter["territory.states"]=scope.state;else throw fail("Business Partner scope cannot be resolved for this role.",403);}const status=text(req.query.status,20).toUpperCase();if(status&&status!=="ALL")filter.status=status;const q=text(req.query.q||req.query.search,100);let partners=await Profile.find(filter).populate("user","fullName phone email status").sort({createdAt:-1});if(q){const re=new RegExp(q,"i");partners=partners.filter(p=>re.test(p.partnerId)||re.test(p.businessName)||re.test(p.user?.fullName||"")||re.test(p.user?.email||""));}res.json({success:true,count:partners.length,partners:partners.map(partner=>({...partner.toObject(),user:maskedPartnerUser(partner.user)}))});} catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
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
    if (!(req.staffAccess?.isHeadOffice || actorScopeType(req) === "GLOBAL")) {
      throw fail("Only global administrators may create Business Partners until scoped capability administration is explicitly configured.", 403);
    }
    let user,profile,profileId,lastError;
    // Unique partnerId is the allocation lock. Retrying the whole transaction
    // means no user/profile/audit fragment survives a contested ID allocation.
    for(let attempt=0;attempt<4;attempt++){const session=await mongoose.startSession();try{await session.withTransaction(async()=>{profileId=await partnerId(session);user=(await User.create([{fullName,phone,email,password,role:"BUSINESS_PARTNER",status:"ACTIVE"}],{session}))[0];profile=(await Profile.create([{user:user._id,partnerId:profileId,businessName,contactName:text(req.body.contactName,160)||fullName,territory,services:normalizedServices,permissions:grantedPermissions,createdBy:id(req)}],{session}))[0];user.businessPartnerProfile=profile._id;user.businessPartnerId=profile._id;await user.save({session});await audit(req,"BUSINESS_PARTNER_CREATED","Created Business Partner",{partnerId:String(profile._id),generatedPartnerId:profileId},session);await Notification.create([{userId:user._id,title:"Business Partner account created",message:`Your Business Partner ID is ${profileId}.`,type:"BUSINESS_PARTNER",referenceId:profile._id,referenceType:"BusinessPartnerProfile"}],{session});});lastError=null;break;}catch(error){lastError=error;if(error.code!==11000||attempt===3)break;}finally{await session.endSession();}}
    if(lastError)throw lastError;
    res.status(201).json({ success: true, partner: profile, user: publicUser(user) });
  } catch (e) { res.status(e.statusCode || (e.code === 11000 ? 409 : 500)).json({ success: false, message: e.code === 11000 ? "A user with that phone or email already exists." : e.message }); }
};
exports.adminUpdate = async (req, res) => {
  try { const p = await adminPartner(req);
    const originalTerritory = {
      states: [...(p.territory?.states || [])],
      lgas: [...(p.territory?.lgas || [])],
    };
    const originalServices = [...(p.services || [])];
    const originalPermissions = [...(p.permissions || [])];
    const capabilityMutation = Object.hasOwn(req.body || {}, "services") || Object.hasOwn(req.body || {}, "permissions");
    for (const key of ["businessName", "contactName", "territory"]) if (Object.hasOwn(req.body || {}, key)) p[key] = req.body[key];
    if (Object.hasOwn(req.body || {}, "permissions")) {
      if (!hasOnlyBusinessPartnerPermissions(req.body.permissions)) throw fail("Invalid Business Partner permissions.", 400);
      p.permissions = normalizeBusinessPartnerPermissions(req.body.permissions);
    }
    if (Object.hasOwn(req.body || {}, "services")) {
      if (!hasOnlyBusinessPartnerServices(req.body.services)) throw fail("Invalid Business Partner services.", 400);
      p.services = normalizeBusinessPartnerServices(req.body.services);
    }
    if (capabilityMutation) p.permissions = permissionsForBusinessPartnerServices(p.services, p.permissions);
    assertTerritoryScope(req, p.territory, { preserve: originalTerritory });
    if (!(req.staffAccess?.isHeadOffice || actorScopeType(req) === "GLOBAL")) {
      const changedServices = JSON.stringify([...(p.services || [])].sort()) !== JSON.stringify([...originalServices].sort());
      const changedPermissions = JSON.stringify([...(p.permissions || [])].sort()) !== JSON.stringify([...originalPermissions].sort());
      if (changedServices || changedPermissions) {
        throw fail("Scoped administrators cannot change Business Partner services or permissions until scoped capability administration is explicitly configured.", 403);
      }
    }
    await p.save(); await audit(req, "BUSINESS_PARTNER_UPDATED", "Updated Business Partner profile", { partnerId: String(p._id) }); res.json({ success: true, partner: p });
  } catch (e) { res.status(e.statusCode || 400).json({ success: false, message: e.message }); }
};
exports.adminStatus = async (req, res) => {
  try { const status = text(req.body.status, 20).toUpperCase(); if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(status)) throw fail("Invalid Business Partner status.", 400);
    const p = await adminPartner(req);
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
    const p = await adminPartner(req);
    const user = await User.findById(p.user).select("+password"); user.password = password; user.mustChangePassword = true; await user.save();
    await audit(req, "BUSINESS_PARTNER_PASSWORD_RESET", "Reset Business Partner password", { partnerId: String(p._id) }); res.json({ success: true, message: "Password reset. The partner must change it at next login." });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.me = async (req,res) => { try { const p = await ownProfile(req); res.json({ success:true, partner:p }); } catch(e) { res.status(e.statusCode || 500).json({success:false,message:e.message}); } };
exports.dashboard = async (req,res) => {
  try {
    const p = await ownProfile(req, "DASHBOARD");
    const solarApproved = partnerServiceApproved(p, "SOLAR");
    const phoneApproved = partnerServiceApproved(p, "PHONE");
    const ids = await partnerCustomerIds(p);
    const customerFilter = { role: "CUSTOMER", _id: { $in: ids } };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const txFilter = { customerId: { $in: ids } };
    const [customers, officers, todayTx, monthTx, commissions, monthCommissionsRows, wallet, recentTransactions, recentCustomers, solar, phone, transactionChartRows, commissionChartRows, officerRows] = await Promise.all([
      User.countDocuments(customerFilter), User.countDocuments({ $or: [
        ...(solarApproved ? [{ businessPartnerId: p._id, role: "SOLAR_OFFICER" }] : []),
        ...(phoneApproved ? [{ businessPartnerId: p._id, role: "PHONE_FINANCING_OFFICER" }] : []),
      ] }),
      Transaction.aggregate([{ $match: { ...txFilter, createdAt: { $gte: today } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$amount" } } }]),
      Transaction.aggregate([{ $match: { ...txFilter, createdAt: { $gte: month } } }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$amount" } } }]),
      Commission.aggregate([{ $match: { businessPartner: p._id } }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
      Commission.aggregate([{ $match: { businessPartner: p._id, createdAt: { $gte: month }, status: { $ne: "PENDING" } } }, { $group: { _id: null, value: { $sum: "$amount" } } }]),
      reconcileCommissionWallet({ businessPartner: p._id }),
      Transaction.find(txFilter).select("reference customerId serviceType amount status createdAt agentId").populate("customerId", "fullName").sort({ createdAt: -1 }).limit(10).lean(),
      User.find(customerFilter).select("fullName phone email status kycVerified ninNumberMasked createdAt updatedAt officerId").sort({ createdAt: -1 }).limit(10).lean(),
      solarApproved ? SolarApplication.countDocuments({ businessPartner: p._id }) : 0,
      phoneApproved ? PhoneApplication.countDocuments({ businessPartner: p._id }) : 0,
      Transaction.aggregate([{ $match: { ...txFilter, createdAt: { $gte: month } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: "$amount" } } }, { $sort: { "_id": 1 } }]),
      Commission.aggregate([{ $match: { businessPartner: p._id, createdAt: { $gte: month }, status: { $ne: "PENDING" } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, value: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { "_id": 1 } }]),
      Commission.aggregate([{ $match: { businessPartner: p._id, createdAt: { $gte: month }, officerId: { $ne: null } } }, { $group: { _id: "$officerId", value: { $sum: "$amount" }, count: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 10 }]),
    ]);
    const monthCommissionValue = Number(monthCommissionsRows[0]?.value || 0);
    const dayCommission = await Commission.aggregate([{ $match: { businessPartner: p._id, createdAt: { $gte: today } } }, { $group: { _id: null, value: { $sum: "$amount" } } }]);
    const topOfficerUsers = await User.find({ _id: { $in: officerRows.map(row => row._id) } }).select("fullName phone email role").lean();
    const topOfficerMap = new Map(topOfficerUsers.map(user => [String(user._id), user]));
    res.json({ success: true, dashboard: {
      totalCustomers: customers, activeCustomers: await User.countDocuments({ ...customerFilter, status: "ACTIVE" }),
       totalOfficers: officers, activeOfficers: await User.countDocuments({ $or: [
         ...(solarApproved ? [{ businessPartnerId: p._id, role: "SOLAR_OFFICER" }] : []),
         ...(phoneApproved ? [{ businessPartnerId: p._id, role: "PHONE_FINANCING_OFFICER" }] : []),
       ], status: "ACTIVE" }),
      transactionsToday: todayTx[0]?.count || 0, transactionsThisMonth: monthTx[0]?.count || 0,
      transactionValueToday: todayTx[0]?.value || 0, transactionValueThisMonth: monthTx[0]?.value || 0,
      commissionToday: dayCommission[0]?.value || 0, commissionThisMonth: monthCommissionValue,
      availableCommission: wallet?.available || 0, pendingCommission: wallet?.pending || 0,
      paidCommission: wallet?.paid || 0, lifetimeCommission: wallet?.lifetime || 0,
      recentTransactions, recentCustomers: recentCustomers.map(partnerCustomerDto),
      topPerformingOfficers: officerRows.map(row => ({ officer: topOfficerMap.get(String(row._id)) ? partnerCustomerDto(topOfficerMap.get(String(row._id)), { includeWallet: false, includeKyc: false }) : { id: row._id }, value: row.value, count: row.count })),
      transactionChart: transactionChartRows, commissionChart: commissionChartRows,
      solarApplications: solar, phoneApplications: phone, commissions,
      permissions: p.permissions, availableModules: p.permissions,
    }});
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.officers = async (req,res) => { try { const p=await ownProfile(req,"OFFICERS"); const solarApproved=p.services.includes("SOLAR")&&p.permissions.includes("SOLAR_ASSIGNMENT"),phoneApproved=p.services.includes("PHONE")&&p.permissions.includes("PHONE_ASSIGNMENT"); const [solar, phone]=await Promise.all([solarApproved?SolarOfficer.find({businessPartner:p._id}).populate("user","fullName phone email status state lga residentialAddress"):[],phoneApproved?User.find({businessPartnerId:p._id,role:"PHONE_FINANCING_OFFICER"}):[]]);res.json({success:true,officers:{solar:await Promise.all(solar.map(x=>officerDto("SOLAR",x))),phone:await Promise.all(phone.map(x=>officerDto("PHONE",x)))}}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.createOfficer = async (req, res) => {
  const type=text(req.body?.type,10).toUpperCase(), fullName=text(req.body?.fullName,160), phone=text(req.body?.phone,40), email=text(req.body?.email,160).toLowerCase(), password=String(req.body?.password||""), state=text(req.body?.state,120), lga=text(req.body?.lga,120), address=text(req.body?.address,500);
  let session;
  try {
     // Service approval is the authoritative officer-management capability.
     // Keep OFFICER_MANAGEMENT as a legacy/catalog value for compatibility,
     // but do not require it for valid existing service-enabled profiles.
     const p=await ownProfile(req,"OFFICERS");
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
   try { const p=await ownProfile(req,"OFFICERS"),type=text(req.params.type,10).toUpperCase();requirePartnerService(p,type);session=await mongoose.startSession();let officer;
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
   try {const p=await ownProfile(req,"OFFICERS"),type=text(req.params.type,10).toUpperCase(),status=text(req.body?.status,20).toUpperCase();requirePartnerService(p,type);if(!["ACTIVE","SUSPENDED"].includes(status))throw fail("Status must be ACTIVE or SUSPENDED.",400);session=await mongoose.startSession();let officer;
    await session.withTransaction(async()=>{officer=await ownedOfficer(p,type,req.params.officerId,session);if(status==="SUSPENDED"){const active=type==="SOLAR"?await SolarAssignment.exists({officer:officer._id,status:"ACTIVE"}).session(session):await PhoneApplication.exists({assignedOfficer:officer._id,assignmentState:"ACTIVE"}).session(session);if(active)throw fail("Reassign or unassign all active applications before suspending this officer.",409);}
      if(type==="SOLAR"){officer.status=status;await officer.save({session});await User.updateOne({_id:officer.user._id},{$set:{status}},{session});officer.user.status=status;}else{officer.status=status;await officer.save({session});}
      await audit(req,"BUSINESS_PARTNER_OFFICER_STATUS_UPDATED",`Changed officer status to ${status}`,{partnerId:String(p._id),officerId:String(officer._id),type,status},session);
    });res.json({success:true,officer:await officerDto(type,officer)});
  }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}finally{if(session)await session.endSession();}
};
exports.resetOfficerAccess = async (req,res) => {
  let session;
   try {const p=await ownProfile(req,"OFFICERS"),type=text(req.params.type,10).toUpperCase(),password=String(req.body?.password||"");requirePartnerService(p,type);if(password.length<6)throw fail("A temporary password of at least 6 characters is required.",400);session=await mongoose.startSession();
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
exports.createCustomer = async (req, res) => {
  let session;
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const fullName = text(req.body?.fullName, 160);
    const phone = text(req.body?.phone, 40);
    const email = text(req.body?.email, 160).toLowerCase();
    // Never accept a partner-supplied customer credential. The random value
    // is stored only long enough for the normal password hashing middleware;
    // it is never returned or disclosed to the partner.
    const serverCredential = crypto.randomBytes(48).toString("base64url");
    if (!fullName || !phone) throw fail("Full name and phone are required.", 400);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail("A valid email is required.", 400);
    const duplicate = await User.exists({ $or: [{ phone }, ...(email ? [{ email }] : [])] });
    if (duplicate) throw fail("An account already exists with this phone number or email.", 409);
    let officerId = req.body.officerId || null;
    if (officerId) {
      if (!isId(officerId)) throw fail("Valid officer ID required.", 400);
      const owned = await User.exists({ _id: officerId, role: { $in: ["SOLAR_OFFICER", "PHONE_FINANCING_OFFICER"] }, businessPartnerId: p._id });
      const solarOwned = await SolarOfficer.findOne({ _id: officerId, businessPartner: p._id }).select("user").lean();
      if (!owned && !solarOwned) throw fail("Officer is outside this Business Partner network.", 403);
      // User.officerId is a User reference even when the caller supplied the
      // SolarOfficer record ID.
      if (!owned && solarOwned) officerId = solarOwned.user;
    }
    const nin = String(req.body?.nin || req.body?.ninNumber || "").replace(/\D/g, "");
    session = await mongoose.startSession();
    let customer;
    await session.withTransaction(async () => {
      customer = (await User.create([{
         fullName, phone, email: email || undefined, password: serverCredential, role: "CUSTOMER", status: "PENDING",
        state: text(req.body?.state, 120) || undefined, lga: text(req.body?.lga, 120) || undefined,
        residentialAddress: text(req.body?.residentialAddress || req.body?.address, 500),
        businessPartnerId: p._id, officerId, acquiredBy: id(req), createdByUserId: id(req),
        createdByPartner: true, acquisitionChannel: officerId ? "BUSINESS_PARTNER_OFFICER" : "BUSINESS_PARTNER",
        ninNumberMasked: nin.length === 11 ? `*******${nin.slice(-4)}` : undefined,
        ninVerificationStatus: nin.length === 11 ? "PENDING" : undefined,
        // Partner provisioning is a credential handoff, not customer consent.
        // The customer must complete the normal password/onboarding flow.
         onboardingSource: "BUSINESS_PARTNER", mustChangePassword: true,
         activationPending: true, activationRequestedAt: new Date(),
      }], { session }))[0];
      await audit(req, "BUSINESS_PARTNER_CUSTOMER_CREATED", "Created customer in partner network", { partnerId: String(p._id), customerId: String(customer._id), officerId }, session);
    });
    res.status(201).json({
      success: true,
      customer: partnerCustomerDto(customer),
      activation: {
        status: "PENDING",
        message: "Customer must complete the phone or email password-reset activation flow before signing in.",
        channels: { phone: Boolean(phone), email: Boolean(email) },
      },
    });
  } catch (e) { res.status(e.statusCode || (e.code === 11000 ? 409 : 500)).json({ success: false, message: e.code === 11000 ? "An account already exists with this phone number or email." : e.message }); }
  finally { if (session) await session.endSession(); }
};
exports.customers = async (req,res) => {
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const [canonicalIds, attributedIds] = await Promise.all([
      partnerCustomerIds(p),
      partnerApplicationCustomerIds(p),
    ]);
    const ids = [...new Set([...canonicalIds, ...attributedIds].map(String))]
      .filter(isId).map(value => new mongoose.Types.ObjectId(value));
    const canonicalSet = new Set(canonicalIds.map(value => String(value)));
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = { role: "CUSTOMER", _id: { $in: ids }, ...dateFilter(req.query) };
    const status = text(req.query.status, 20).toUpperCase();
    if (status && status !== "ALL") filter.status = status;
    if (req.query.kyc !== undefined) filter.kycVerified = String(req.query.kyc) === "true";
    if (req.query.officerId && isId(req.query.officerId)) filter.officerId = req.query.officerId;
    const q = text(req.query.q || req.query.search, 100);
    if (q) filter.$or = [{ fullName: { $regex: q, $options: "i" } }, { phone: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
    const [total, records] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter).select("fullName phone email status kycVerified ninNumberMasked ninVerificationStatus createdAt updatedAt officerId").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ]);
    const customers = await Promise.all(records.map(async record => {
      const canonical = canonicalSet.has(String(record._id));
      const dto = partnerCustomerDto(record, { includeWallet: canonical, includeKyc: canonical });
      const [tx, value, commissions] = await Promise.all([
        canonical ? Transaction.countDocuments({ customerId: record._id }) : 0,
        canonical ? Transaction.aggregate([{ $match: { customerId: record._id } }, { $group: { _id: null, value: { $sum: "$amount" } } }]) : [],
        canonical ? Commission.aggregate([{ $match: { businessPartner: p._id, customerId: record._id } }, { $group: { _id: null, value: { $sum: "$amount" } } }]) : [],
      ]);
      return { ...dto, transactionCount: tx, transactionValue: value[0]?.value || 0, commissionGenerated: commissions[0]?.value || 0 };
    }));
    res.json({ success: true, customers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch(e) { res.status(e.statusCode||500).json({success:false,message:e.message}); }
};
exports.customerDetail = async (req, res) => {
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const customer = await partnerOwnedCustomer(p, req.params.customerId);
    const [transactions, commissions] = await Promise.all([
      Transaction.find({ customerId: customer._id }).select("reference serviceType amount status createdAt agentId").sort({ createdAt: -1 }).limit(25).lean(),
      Commission.find({ businessPartner: p._id, customerId: customer._id }).select("eventKey amount status commissionType createdAt settledAt").sort({ createdAt: -1 }).limit(25).lean(),
    ]);
    res.json({ success: true, customer: partnerCustomerDto(customer), transactions, commissions });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.customerTransactions = async (req, res) => {
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const customer = await partnerOwnedCustomer(p, req.params.customerId);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = { customerId: customer._id, ...dateFilter(req.query) };
    if (req.query.status) filter.status = text(req.query.status, 30).toUpperCase();
    if (req.query.serviceType || req.query.service) filter.serviceType = text(req.query.serviceType || req.query.service, 40).toUpperCase();
    const [total, transactions] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter).select("reference customerId serviceType amount status createdAt agentId provider providerReference").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, customer: partnerCustomerDto(customer), transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.transactions = async (req, res) => {
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const ids = await partnerCustomerIds(p);
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = { customerId: { $in: ids }, ...dateFilter(req.query) };
    if (req.query.status) filter.status = text(req.query.status, 30).toUpperCase();
    if (req.query.serviceType || req.query.service) filter.serviceType = text(req.query.serviceType || req.query.service, 40).toUpperCase();
    if (req.query.officerId && isId(req.query.officerId)) filter.agentId = req.query.officerId;
    const q = text(req.query.q || req.query.search, 100);
    if (q) filter.reference = { $regex: q, $options: "i" };
    const [total, rows] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter).select("reference customerId serviceType amount status createdAt agentId").populate("customerId", "fullName").populate("agentId", "fullName staffId").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const commissions = await Commission.find({ businessPartner: p._id, transactionId: { $in: rows.map(row => row._id) } }).select("transactionId amount status officerId commissionType").lean();
    const commissionMap = new Map();
    commissions.forEach(row => {
      const existing = commissionMap.get(String(row.transactionId)) || [];
      existing.push(row); commissionMap.set(String(row.transactionId), existing);
    });
    const transactions = rows.map(row => ({ ...row, commission: commissionMap.get(String(row._id)) || [] }));
    res.json({ success: true, transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.transactionDetail = async (req, res) => {
  try {
    const p = await ownProfile(req, "CUSTOMERS");
    const ids = await partnerCustomerIds(p);
    const transactionKey = text(req.params.transactionId, 160);
    if (!transactionKey) throw fail("Transaction reference or ID is required.", 400);
    const identifier = isId(transactionKey)
      ? { $or: [{ _id: transactionKey }, { reference: transactionKey }] }
      : { reference: transactionKey };
    const transaction = await Transaction.findOne({ ...identifier, customerId: { $in: ids } }).select("reference customerId serviceType amount status createdAt agentId provider providerReference providerMessage").populate("customerId", "fullName").populate("agentId", "fullName staffId").lean();
    if (!transaction) throw fail("Transaction not found.", 404);
    const commission = await Commission.find({ businessPartner: p._id, transactionId: transaction._id }).select("amount status commissionType officerId createdAt settledAt").lean();
    res.json({ success: true, transaction: { ...transaction, commission } });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.commissionWallet = async (req, res) => {
  try {
    const p = await ownProfile(req, "REPORTS");
    const wallet = (await reconcileCommissionWallet({ businessPartner: p._id })).toObject();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const [total, ledger] = await Promise.all([
      Commission.countDocuments({ businessPartner: p._id }),
      Commission.find({ businessPartner: p._id }).select("eventKey transactionId transactionReference amount status commissionType commissionRate createdAt settledAt reversalOf").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, wallet, ledger, pagination: { page, limit, total, pages: Math.ceil(total / limit) }, withdrawals: { enabled: false, message: "Commission withdrawals require a separate approved finance workflow." } });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.targets = async (req, res) => {
  try {
    const p = await ownProfile(req, "DASHBOARD");
    const targets = await Target.find({ businessPartner: p._id, status: "ACTIVE" }).sort({ effectiveFrom: -1 }).lean();
    res.json({ success: true, targets });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
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
exports.adminCreateCommission = async(req,res)=>{try{const p=await Profile.findById(req.params.partnerId);if(!p)throw fail("Business Partner not found.",404);const sourceType=text(req.body.sourceType,30).toUpperCase()==="PHONE_FINANCING"?"PHONE":text(req.body.sourceType,30).toUpperCase();if(!SUPPORTED_COMMISSION_SOURCES.has(sourceType))throw fail("Unsupported commission sourceType.",400);const result=await createCommission({businessPartner:p._id,application:req.body.applicationId||null,transactionId:req.body.transactionId||null,transactionReference:text(req.body.transactionReference,160),customerId:req.body.customerId||null,officerId:req.body.officerId||null,sourceType,amount:req.body.amount,eventKey:text(req.body.eventKey,160),createdBy:id(req),status:text(req.body.status,20).toUpperCase()||"PENDING"});await audit(req,"BUSINESS_PARTNER_COMMISSION_CREATED","Recorded derived commission",{commissionId:String(result.commission._id),partnerId:String(p._id)});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminCount = async (req,res) => { try { const access=req.staffAccess||{},scope=access.scope||{},type=String(scope.type||"").toUpperCase();const match=access.isHeadOffice||type==="GLOBAL"?{}:type==="BUSINESS_PARTNER"&&isId(scope.businessPartnerId)?{_id:new mongoose.Types.ObjectId(scope.businessPartnerId)}:type==="STATE"&&scope.state?{"territory.states":scope.state}:null;if(!match)throw fail("Business Partner scope cannot be resolved for this role.",403);const rows=await Profile.aggregate([{$match:match},{$group:{_id:"$status",count:{$sum:1}}}]), n=s=>rows.find(x=>x._id===s)?.count||0;res.json({success:true,count:rows.reduce((a,x)=>a+x.count,0),counts:{active:n("ACTIVE"),suspended:n("SUSPENDED"),disabled:n("DISABLED")}});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.adminDetail = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    await partner.populate("user", "fullName phone email role status");
    if (!partner) return res.status(404).json({ success: false, message: "Business Partner not found." });
    const access = req.staffAccess || {};
    const allowed = permission => access.isHeadOffice || (access.permissions || []).includes(permission);
    const partnerDto = partner.toObject();
    partnerDto.user = maskedPartnerUser(partner.user);
    // VIEW is intentionally a base profile response. Each sensitive/granular
    // collection has its own permission and endpoint.
    const result = { success: true, partner: partnerDto };
    if (allowed(STAFF_P.BUSINESS_PARTNERS_OFFICERS_VIEW)) {
      const [solarOfficers, phoneOfficers] = await Promise.all([
        SolarOfficer.find({ businessPartner: partner._id }).populate("user", "fullName phone email status"),
        User.find({ businessPartnerId: partner._id, role: "PHONE_FINANCING_OFFICER" }).select("fullName phone email status staffId state lga"),
      ]);
      result.officers = {
        solar: solarOfficers.map(o => ({ id: o._id, officerId: o.officerId, status: o.status, user: maskedPartnerUser(o.user) })),
        phone: phoneOfficers.map(maskedPartnerUser),
      };
    }
    if (allowed(STAFF_P.BUSINESS_PARTNERS_TRANSACTIONS_VIEW)) {
      const [solarApps, phoneApps] = await Promise.all([
        SolarApplication.find({ businessPartner: partner._id }).populate("customer", "fullName phone").populate("package", "name"),
        PhoneApplication.find({ businessPartner: partner._id }).populate("customer", "fullName phone").populate("product", "name sku").populate("assignedOfficer", "fullName staffId"),
      ]);
      const solar = solarApps.map(solarDto), phone = phoneApps.map(phoneDto);
      result.applications = { solar, phone };
      result.repayments = { solar: solar.map(x => ({ application: x.id, ...x.amounts, nextPaymentDate: x.nextPaymentDate })), phone: phone.map(x => ({ application: x.id, ...x.amounts })) };
    }
    if (allowed(STAFF_P.BUSINESS_PARTNERS_COMMISSIONS_VIEW)) {
      const commissions = await Commission.find({ businessPartner: partner._id }).sort({ createdAt: -1 });
      result.commissions = commissions;
      result.performance = { netCommission: commissions.reduce((sum, row) => sum + Number(row.amount), 0) };
    }
    if (allowed(STAFF_P.BUSINESS_PARTNERS_AUDIT_VIEW)) {
      result.activity = await Audit.find({ "newData.partnerId": String(partner._id) })
        .select("actorId actorName action reason createdAt").sort({ createdAt: -1 });
    }
    return res.json(result);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, message: e.message });
  }
};
exports.adminLinkOfficer = async(req,res)=>{try{const p=await adminPartner(req), type=text(req.body.type,10).toUpperCase(), officerId=req.body.officerId;if(!p||!isId(officerId))throw fail("Business Partner and valid officer are required.",400);requirePartnerService(p,type);const allowed=(state,lga)=>!(!state||!lga||!p.territory?.states?.length||!p.territory.states.includes(state)||(p.territory.lgas?.length&&!p.territory.lgas.includes(lga)));if(type==="PHONE"){const u=await User.findOne({_id:officerId,role:"PHONE_FINANCING_OFFICER"});if(!u)throw fail("Phone Financing Officer not found.",404);if(u.businessPartnerId&&String(u.businessPartnerId)!==String(p._id))throw fail("Officer belongs to another Business Partner; use transfer.",409);if(!allowed(u.state,u.lga))throw fail("Officer territory does not match partner territory.",409);u.businessPartnerId=p._id;await u.save();}else{const o=await SolarOfficer.findById(officerId);if(!o)throw fail("Solar Officer not found.",404);if(o.businessPartner&&String(o.businessPartner)!==String(p._id))throw fail("Officer belongs to another Business Partner; use transfer.",409);if(!allowed(o.state,o.lga))throw fail("Officer territory does not match partner territory.",409);o.businessPartner=p._id;await o.save();await User.updateOne({_id:o.user},{$set:{businessPartnerId:p._id}});}await audit(req,"BUSINESS_PARTNER_OFFICER_ASSIGNED","Head Office linked officer",{partnerId:String(p._id),officerId,type});res.json({success:true});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminRules = async(req,res)=>{try{assertGlobalAdminScope(req);res.json({success:true,rules:await Rule.find().sort({sourceType:1,version:-1})});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminCustomers = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const scope = { ...partner.toObject(), services: ["SOLAR", "PHONE"], permissions: ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"] };
    const [canonicalIds, attributedIds] = await Promise.all([
      partnerCustomerIds(scope),
      partnerApplicationCustomerIds(scope),
    ]);
    const ids = [...new Set([...canonicalIds, ...attributedIds].map(String))]
      .filter(isId).map(value => new mongoose.Types.ObjectId(value));
    const canonicalSet = new Set(canonicalIds.map(value => String(value)));
    const { page, limit } = adminPage(req.query);
    const filter = { role: "CUSTOMER", _id: { $in: ids }, ...dateFilter(req.query) };
    const status = text(req.query.status, 20).toUpperCase();
    if (status && status !== "ALL") filter.status = status;
    const q = text(req.query.q || req.query.search, 100);
    if (q) filter.$or = [{ fullName: { $regex: q, $options: "i" } }, { phone: { $regex: q, $options: "i" } }, { email: { $regex: q, $options: "i" } }];
    const [total, customers] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
      .select("fullName phone email status kycVerified ninNumberMasked ninVerificationStatus businessPartnerId officerId createdAt updatedAt")
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    ]);
    res.json({
      success: true,
      customers: customers.map(customer => {
        const canonical = canonicalSet.has(String(customer._id));
        return partnerCustomerDto(customer, { includeWallet: canonical, includeKyc: canonical });
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch(e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
async function adminPartner(req) {
  if (!isId(req.params.partnerId)) throw fail("Valid Business Partner ID required.", 400);
  const partner = await Profile.findById(req.params.partnerId);
  if (!partner) throw fail("Business Partner not found.", 404);
  assertPartnerScope(req, partner);
  return partner;
}
function assertPartnerScope(req, partner) {
  const access = req.staffAccess || {};
  if (access.isHeadOffice || String(access.scope?.type || "").toUpperCase() === "GLOBAL") return true;
  const scope = access.scope || {};
  const type = String(scope.type || "").toUpperCase();
  if (type === "BUSINESS_PARTNER") {
    if (String(scope.businessPartnerId || "") === String(partner._id)) return true;
    throw fail("Business Partner is outside your administrative scope.", 403);
  }
  if (type === "STATE") {
    if (scope.state && Array.isArray(partner.territory?.states) && partner.territory.states.includes(scope.state)) return true;
    throw fail("Business Partner is outside your administrative scope.", 403);
  }
  // Branch and zone cannot be mapped to Business Partner profiles in the
  // current schema. Deny rather than silently widening access.
  throw fail("Business Partner scope cannot be resolved for this role.", 403);
}
function actorScopeType(req) {
  return String(req.staffAccess?.scope?.type || "").toUpperCase();
}
function assertTerritoryScope(req, territory, { preserve = null } = {}) {
  const access = req.staffAccess || {};
  if (access.isHeadOffice || actorScopeType(req) === "GLOBAL") return;
  const type = actorScopeType(req);
  if (type === "BUSINESS_PARTNER") {
    if (!preserve || JSON.stringify((territory?.states || []).map(String).sort()) !== JSON.stringify((preserve.states || []).map(String).sort()) ||
        JSON.stringify((territory?.lgas || []).map(String).sort()) !== JSON.stringify((preserve.lgas || []).map(String).sort())) {
      throw fail("Business Partner scope cannot relocate or broaden territory.", 403);
    }
    return;
  }
  if (type === "STATE" && access.scope?.state) {
    const state = String(access.scope.state).trim().toLowerCase();
    const states = Array.isArray(territory?.states) ? territory.states.map(value => String(value).trim().toLowerCase()) : [];
    if (states.length > 0 && states.every(value => value === state)) return;
    throw fail("Territory is outside your administrative scope.", 403);
  }
  throw fail("Business Partner scope cannot be resolved for this role.", 403);
}
async function assertApplicationScope(req, application, destination) {
  const access = req.staffAccess || {};
  const type = actorScopeType(req);
  if (access.isHeadOffice || type === "GLOBAL") return;
  if (type === "BRANCH" || type === "ZONE" || !["STATE", "BUSINESS_PARTNER"].includes(type)) {
    throw fail("Application scope cannot be resolved for this role.", 403);
  }
  const customer = await User.findById(application.customer).select("businessPartnerId state lga branchId").lean();
  if (!customer) throw fail("Application customer is outside your administrative scope.", 403);
  if (type === "STATE") {
    const authoritativeState = String(customer.state || "").trim().toLowerCase();
    const snapshotState = String(application.profileSnapshot?.state || application.applicationInput?.state || "").trim().toLowerCase();
    if (!authoritativeState || (snapshotState && snapshotState !== authoritativeState) ||
        !access.scope?.state || authoritativeState !== String(access.scope.state).trim().toLowerCase()) {
      throw fail("Application is outside your administrative scope.", 403);
    }
    return;
  }
  if (!destination || String(customer.businessPartnerId || "") !== String(destination._id)) {
    throw fail("Application customer is outside your Business Partner scope.", 403);
  }
}
async function assertOfficerScope(req, officerId, type, destination) {
  const actorType = actorScopeType(req);
  if (req.staffAccess?.isHeadOffice || actorType === "GLOBAL") return;
  if (actorType === "BRANCH" || actorType === "ZONE" || !["STATE", "BUSINESS_PARTNER"].includes(actorType)) {
    throw fail("Officer scope cannot be resolved for this role.", 403);
  }
  if (!isId(officerId)) throw fail("Valid officer ID required.", 400);
  let officer;
  if (type === "PHONE") {
    officer = await User.findOne({ _id: officerId, role: "PHONE_FINANCING_OFFICER" }).select("state businessPartnerId").lean();
  } else {
    officer = await SolarOfficer.findOne({ _id: officerId }).select("state businessPartner").lean();
  }
  if (!officer) throw fail("Officer not found.", 404);
  if (actorType === "STATE" && String(officer.state || "").trim().toLowerCase() !== String(req.staffAccess.scope?.state || "").trim().toLowerCase()) {
    throw fail("Officer is outside your administrative scope.", 403);
  }
  if (actorType === "BUSINESS_PARTNER" && (!destination || String(officer.businessPartnerId || officer.businessPartner || "") !== String(destination._id))) {
    throw fail("Officer is outside your Business Partner scope.", 403);
  }
}
function assertGlobalAdminScope(req) {
  const access = req.staffAccess || {};
  if (access.isHeadOffice || String(access.scope?.type || "").toUpperCase() === "GLOBAL") return;
  throw fail("This administrative operation requires global Business Partner scope.", 403);
}
exports.adminGlobalScopeGuard = (req, res, next) => {
  try {
    assertGlobalAdminScope(req);
    return next();
  } catch (e) {
    return res.status(e.statusCode || 403).json({ success: false, message: e.message });
  }
};
exports.adminCommissionScopeGuard = async (req, res, next) => {
  try {
    const commissionId = req.params.commissionId || req.params.reversalId;
    const row = await Commission.findById(commissionId).select("businessPartner reversalOf");
    if (!row) throw fail("Commission record not found.", 404);
    const partnerId = row.businessPartner;
    const partner = await Profile.findById(partnerId);
    if (!partner) throw fail("Business Partner not found.", 404);
    assertPartnerScope(req, partner);
    return next();
  } catch (e) {
    return res.status(e.statusCode || 403).json({ success: false, message: e.message });
  }
};
exports.adminPartnerScopeGuard = async (req, res, next) => {
  try {
    if (!isId(req.params.partnerId)) throw fail("Valid Business Partner ID required.", 400);
    const partner = await Profile.findById(req.params.partnerId);
    if (!partner) throw fail("Business Partner not found.", 404);
    assertPartnerScope(req, partner);
    if (req.params.applicationId) {
      const type = text(req.body?.type, 10).toUpperCase();
      const Application = type === "PHONE" ? PhoneApplication : SolarApplication;
      const application = await Application.findById(req.params.applicationId).select("customer branchId businessPartner profileSnapshot applicationInput");
      if (!application) throw fail("Application not found.", 404);
      await assertApplicationScope(req, application, partner);
    }
    if (req.originalUrl?.includes("/officers/link")) {
      await assertOfficerScope(req, req.body?.officerId, text(req.body?.type, 10).toUpperCase(), partner);
    }
    return next();
  } catch (e) {
    return res.status(e.statusCode || 403).json({ success: false, message: e.message });
  }
};
exports.adminCollectionScopeGuard = (req, res, next) => {
  try {
    const access = req.staffAccess || {};
    const type = String(access.scope?.type || "").toUpperCase();
    if (access.isHeadOffice || type === "GLOBAL") return next();
    if (type === "BUSINESS_PARTNER" && isId(access.scope?.businessPartnerId)) return next();
    if (type === "STATE" && access.scope?.state) return next();
    throw fail("Business Partner scope cannot be resolved for this role.", 403);
  } catch (e) {
    return res.status(e.statusCode || 403).json({ success: false, message: e.message });
  }
};
async function scopedPartnerId(req, suppliedId, { required = false } = {}) {
  if (suppliedId && !isId(suppliedId)) throw fail("Valid Business Partner ID required.", 400);
  if (req.staffAccess?.isHeadOffice || String(req.staffAccess?.scope?.type || "").toUpperCase() === "GLOBAL") {
    if (required && !suppliedId) throw fail("Business Partner ID is required.", 400);
    return suppliedId || null;
  }
  const scope = req.staffAccess?.scope || {};
  if (String(scope.type || "").toUpperCase() !== "BUSINESS_PARTNER") throw fail("Business Partner scope cannot be resolved for this role.", 403);
  const own = String(scope.businessPartnerId || "");
  if (!own || (suppliedId && String(suppliedId) !== own)) throw fail("Business Partner is outside your administrative scope.", 403);
  return own;
}
const adminPage = query => ({
  page: Math.max(1, Number.parseInt(query.page, 10) || 1),
  limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25)),
});
function bonusHistoryDto(row) {
  const value = row?.toObject ? row.toObject() : row;
  const rule = value?.bonusRule && typeof value.bonusRule === "object" ? value.bonusRule : null;
  return {
    id: value._id,
    partnerId: value.businessPartner,
    metric: value.bonusMetric || rule?.metric || null,
    sourceType: value.bonusSourceType || rule?.sourceType || null,
    periodStart: value.bonusPeriodStart || null,
    periodEnd: value.bonusPeriodEnd || null,
    commissionType: value.commissionType,
    type: value.commissionType,
    amount: value.amount,
    status: value.status,
    rule: rule ? { id: rule._id, name: rule.name, metric: rule.metric, sourceType: rule.sourceType, period: rule.period } : (value.bonusRule || null),
    eventKey: value.eventKey,
    reversalOf: value.reversalOf || null,
    createdAt: value.createdAt,
  };
}
const maskedStaff = user => user ? {
  id: user._id, fullName: user.fullName, phone: maskPhone(user.phone),
  email: maskEmail(user.email), status: user.status, state: user.state, lga: user.lga,
  staffId: user.staffId || "", role: user.role, createdAt: user.createdAt,
} : null;
exports.adminOfficers = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const { page, limit } = adminPage(req.query);
    const status = text(req.query.status, 20).toUpperCase();
    const q = text(req.query.q || req.query.search, 100);
    const [solarRecords, phoneUsers] = await Promise.all([
      SolarOfficer.find({ businessPartner: partner._id }).populate("user", "fullName phone email status state lga staffId role createdAt").lean(),
      User.find({ businessPartnerId: partner._id, role: "PHONE_FINANCING_OFFICER" }).select("fullName phone email status state lga staffId role createdAt").lean(),
    ]);
    let officers = [
      ...solarRecords.filter(row => row.user).map(row => ({ ...maskedStaff(row.user), type: "SOLAR", officerCode: row.officerId || row.user.staffId || "", officerStatus: row.status || row.user.status })),
      ...phoneUsers.map(user => ({ ...maskedStaff(user), type: "PHONE", officerCode: user.staffId || "", officerStatus: user.status })),
    ];
    if (status && status !== "ALL") officers = officers.filter(row => String(row.officerStatus).toUpperCase() === status);
    if (q) { const needle = q.toLowerCase(); officers = officers.filter(row => [row.fullName, row.phone, row.email, row.staffId, row.officerCode].some(value => String(value || "").toLowerCase().includes(needle))); }
    officers.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const total = officers.length;
    officers = officers.slice((page - 1) * limit, page * limit);
    res.json({ success: true, officers, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminTransactions = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const ids = await partnerCustomerIds({ ...partner.toObject(), services: ["SOLAR", "PHONE"], permissions: ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"] });
    const { page, limit } = adminPage(req.query);
    const filter = { customerId: { $in: ids }, ...dateFilter(req.query) };
    if (req.query.status) filter.status = text(req.query.status, 30).toUpperCase();
    if (req.query.serviceType || req.query.service) filter.serviceType = text(req.query.serviceType || req.query.service, 40).toUpperCase();
    if (req.query.officerId && isId(req.query.officerId)) filter.agentId = req.query.officerId;
    const q = text(req.query.q || req.query.search, 100);
    if (q) filter.reference = { $regex: q, $options: "i" };
    const [total, rows] = await Promise.all([
      Transaction.countDocuments(filter),
      Transaction.find(filter).select("reference customerId serviceType amount status createdAt agentId").populate("customerId", "fullName phone email").populate("agentId", "fullName staffId").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const transactions = rows.map(row => ({
      ...row,
      customerId: row.customerId ? { id: row.customerId._id, fullName: row.customerId.fullName, phone: maskPhone(row.customerId.phone), email: maskEmail(row.customerId.email) } : null,
      officer: maskedStaff(row.agentId),
    }));
    res.json({ success: true, transactions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminTransactionVolume = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const ids = await partnerCustomerIds({ ...partner.toObject(), services: ["SOLAR", "PHONE"], permissions: ["SOLAR_ASSIGNMENT", "PHONE_ASSIGNMENT"] });
    const range = dateFilter(req.query);
    const match = { customerId: { $in: ids }, ...range };
    const [summary, series] = await Promise.all([
      Transaction.aggregate([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$amount" } } }]),
      Transaction.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, value: { $sum: "$amount" } } }, { $sort: { _id: 1 } }]),
    ]);
    res.json({ success: true, summary: { count: summary[0]?.count || 0, value: summary[0]?.value || 0 }, series, volume: series });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminCommissions = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const { page, limit } = adminPage(req.query);
    const filter = { businessPartner: partner._id, ...dateFilter(req.query) };
    if (req.query.status) filter.status = text(req.query.status, 20).toUpperCase();
    if (req.query.sourceType) filter.sourceType = text(req.query.sourceType, 40).toUpperCase();
    const q = text(req.query.q || req.query.search, 100);
    if (q) filter.$or = [{ eventKey: { $regex: q, $options: "i" } }, { transactionReference: { $regex: q, $options: "i" } }];
    const [total, rows, summary] = await Promise.all([
      Commission.countDocuments(filter),
      Commission.find(filter).select("eventKey transactionId transactionReference customerId officerId sourceType amount status commissionType commissionRate createdAt settledAt reversalOf").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Commission.aggregate([{ $match: filter }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]),
    ]);
    res.json({ success: true, commissions: rows, summary, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminPartnerTargets = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const { page, limit } = adminPage(req.query);
    const filter = { businessPartner: partner._id };
    const [total, targets] = await Promise.all([
      Target.countDocuments(filter),
      Target.find(filter).sort({ effectiveFrom: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, targets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminPartnerBonuses = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const { page, limit } = adminPage(req.query);
    const filter = { businessPartner: partner._id, commissionType: { $in: ["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"] } };
    const [total, bonuses] = await Promise.all([
      Commission.countDocuments(filter),
      Commission.find(filter).populate("bonusRule", "name metric sourceType period").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const history = bonuses.map(bonusHistoryDto);
    res.json({ success: true, configured: true, partnerId: partner._id, history, bonuses: history, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.partnerBonuses = async (req, res) => {
  try {
    const partner = await ownProfile(req);
    const { page, limit } = adminPage(req.query);
    const filter = { businessPartner: partner._id, commissionType: { $in: ["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"] } };
    const [total, bonuses] = await Promise.all([
      Commission.countDocuments(filter),
      Commission.find(filter).populate("bonusRule", "name metric sourceType period").select("eventKey amount status commissionType transactionAmount createdAt reversalOf businessPartner bonusRule bonusMetric bonusSourceType bonusPeriodStart bonusPeriodEnd").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    const history = bonuses.map(bonusHistoryDto);
    res.json({ success: true, configured: true, history, bonuses: history, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminPartnerLiabilities = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const rows = await Commission.aggregate([{ $match: { businessPartner: partner._id, status: { $in: ["PENDING", "AVAILABLE", "EARNED"] } } }, { $group: { _id: "$status", amount: { $sum: "$amount" }, count: { $sum: 1 } } }]);
    const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    res.json({ success: true, partnerId: partner._id, liabilities: rows, total, asOf: new Date().toISOString() });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminPartnerAudit = async (req, res) => {
  try {
    const partner = await adminPartner(req);
    const { page, limit } = adminPage(req.query);
    const filter = { $or: [{ "newData.partnerId": String(partner._id) }, { "newData.partnerId": partner._id }] };
    const [total, activity] = await Promise.all([
      Audit.countDocuments(filter),
      Audit.find(filter).select("actorId actorRole actorName action reason newData createdAt requestMethod requestPath").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);
    res.json({ success: true, activity, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminBonusRules = async (req, res) => {
  try {
    const filter = {};
    const access = req.staffAccess || {};
    const scope = access.scope || {};
    const scopeType = String(scope.type || "").toUpperCase();
    if (access.isHeadOffice || scopeType === "GLOBAL") {
      if (req.query.partnerId && isId(req.query.partnerId)) filter.businessPartner = req.query.partnerId;
    } else if (scopeType === "BUSINESS_PARTNER" && isId(scope.businessPartnerId)) {
      filter.businessPartner = scope.businessPartnerId;
    } else if (scopeType === "STATE" && scope.state) {
      const partners = await Profile.find({ "territory.states": scope.state }).select("_id").lean();
      filter.businessPartner = { $in: partners.map(row => row._id) };
    } else throw fail("Business Partner scope cannot be resolved for this role.", 403);
    const rules = await BonusRule.find(filter).populate("businessPartner", "partnerId businessName").sort({ effectiveFrom: -1 }).lean();
    res.json({ success: true, rules });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminCreateBonusRule = async (req, res) => {
  try {
    const scopedBusinessPartnerId = req.body.businessPartnerId || null;
    if (!(req.staffAccess?.isHeadOffice || String(req.staffAccess?.scope?.type || "").toUpperCase() === "GLOBAL") && !scopedBusinessPartnerId) {
      throw fail("Scoped administrators must create a partner-scoped rule.", 403);
    }
    if (scopedBusinessPartnerId) {
      if (!isId(scopedBusinessPartnerId)) throw fail("Valid Business Partner is required.", 400);
      const scopedPartner = await Profile.findById(scopedBusinessPartnerId);
      if (!scopedPartner) throw fail("Business Partner not found.", 404);
      assertPartnerScope(req, scopedPartner);
    }
    const metric = text(req.body.metric, 40).toUpperCase();
    const period = text(req.body.period, 20).toUpperCase();
    const commissionType = text(req.body.commissionType || "PERFORMANCE_BONUS", 40).toUpperCase();
    const sourceType = req.body.sourceType === undefined || req.body.sourceType === null || req.body.sourceType === ""
      ? null
      : text(req.body.sourceType, 40).toUpperCase() === "PHONE"
        ? "PHONE_FINANCING"
        : text(req.body.sourceType, 40).toUpperCase();
    const threshold = Number(req.body.threshold);
    const bonusAmount = Number(req.body.bonusAmount);
    const availableMargin = Number(req.body.availableMargin);
    const name = text(req.body.name, 160);
    const effectiveFrom = req.body.effectiveFrom && !Number.isNaN(Date.parse(req.body.effectiveFrom)) ? new Date(req.body.effectiveFrom) : new Date();
    const effectiveTo = req.body.effectiveTo && !Number.isNaN(Date.parse(req.body.effectiveTo)) ? new Date(req.body.effectiveTo) : null;
    if ((req.body.effectiveFrom && Number.isNaN(Date.parse(req.body.effectiveFrom))) ||
        (req.body.effectiveTo && Number.isNaN(Date.parse(req.body.effectiveTo)))) throw fail("effectiveFrom/effectiveTo must be valid dates.", 400);
    if (!["ACTIVE_CUSTOMERS", "TRANSACTION_COUNT", "TRANSACTION_VALUE"].includes(metric) ||
        !["DAILY", "WEEKLY", "MONTHLY"].includes(period) ||
        !["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"].includes(commissionType) ||
        (sourceType !== null && !["SOLAR", "PHONE", "PHONE_FINANCING"].includes(sourceType)) ||
        !Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(bonusAmount) || bonusAmount <= 0 ||
        !Number.isFinite(availableMargin) || availableMargin < bonusAmount || !name ||
        (effectiveTo && effectiveTo <= effectiveFrom)) {
      throw fail("Valid metric, period, positive threshold/bonusAmount, and sufficient availableMargin are required.", 400);
    }
    if (scopedBusinessPartnerId && !isId(scopedBusinessPartnerId)) throw fail("Valid Business Partner is required.", 400);
    const rule = await BonusRule.create({
      name, metric, period, threshold, bonusAmount, availableMargin,
      commissionType, sourceType, businessPartner: scopedBusinessPartnerId,
      effectiveFrom, effectiveTo,
      createdBy: id(req),
    });
    await audit(req, "BUSINESS_PARTNER_BONUS_RULE_CREATED", "Created effective-dated bonus rule", { ruleId: String(rule._id), partnerId: rule.businessPartner ? String(rule.businessPartner) : null });
    res.status(201).json({ success: true, rule });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminUpdateBonusRule = async (req, res) => {
  try {
    if (!isId(req.params.ruleId)) throw fail("Valid bonus rule ID required.", 400);
    const rule = await BonusRule.findById(req.params.ruleId);
    if (!rule) throw fail("Bonus rule not found.", 404);
    if (rule.businessPartner) assertPartnerScope(req, await Profile.findById(rule.businessPartner));
    else assertGlobalAdminScope(req);
    const patch = {};
    if (req.body.name !== undefined) {
      patch.name = text(req.body.name, 160);
      if (!patch.name) throw fail("Rule name is required.", 400);
    }
    if (req.body.metric !== undefined) {
      patch.metric = text(req.body.metric, 40).toUpperCase();
      if (!["ACTIVE_CUSTOMERS", "TRANSACTION_COUNT", "TRANSACTION_VALUE"].includes(patch.metric)) throw fail("Unsupported bonus metric.", 400);
    }
    if (req.body.period !== undefined) {
      patch.period = text(req.body.period, 20).toUpperCase();
      if (!["DAILY", "WEEKLY", "MONTHLY"].includes(patch.period)) throw fail("Unsupported bonus period.", 400);
    }
    if (req.body.sourceType !== undefined) {
      const source = text(req.body.sourceType, 40).toUpperCase();
      patch.sourceType = source === "PHONE" ? "PHONE_FINANCING" : source;
      if (!["SOLAR", "PHONE", "PHONE_FINANCING"].includes(patch.sourceType)) throw fail("Unsupported bonus source.", 400);
    }
    for (const field of ["threshold", "bonusAmount"]) {
      if (req.body[field] !== undefined) {
        patch[field] = Number(req.body[field]);
        if (!Number.isFinite(patch[field]) || patch[field] <= 0) throw fail(`${field} must be positive.`, 400);
      }
    }
    if (req.body.availableMargin !== undefined) {
      patch.availableMargin = Number(req.body.availableMargin);
      if (!Number.isFinite(patch.availableMargin) || patch.availableMargin < 0) throw fail("availableMargin must be non-negative.", 400);
    }
    if (patch.availableMargin !== undefined && patch.availableMargin < rule.allocatedMargin) throw fail("availableMargin cannot be below already allocated margin.", 400);
    if (patch.bonusAmount !== undefined && patch.availableMargin === undefined && patch.bonusAmount > rule.availableMargin) throw fail("Bonus payout cannot exceed available margin.", 400);
    if (patch.bonusAmount !== undefined && patch.availableMargin !== undefined && patch.bonusAmount > patch.availableMargin) throw fail("Bonus payout cannot exceed available margin.", 400);
    if (req.body.effectiveFrom !== undefined || req.body.effectiveTo !== undefined) {
      const from = req.body.effectiveFrom === undefined ? rule.effectiveFrom : new Date(req.body.effectiveFrom);
      const to = req.body.effectiveTo === undefined ? rule.effectiveTo : (req.body.effectiveTo ? new Date(req.body.effectiveTo) : null);
      if (Number.isNaN(from.getTime()) || (to && Number.isNaN(to.getTime())) || (to && to <= from)) throw fail("Invalid effective dates.", 400);
      patch.effectiveFrom = from; patch.effectiveTo = to;
    }
    if (req.body.businessPartnerId !== undefined) {
      if (req.body.businessPartnerId && !isId(req.body.businessPartnerId)) throw fail("Valid Business Partner is required.", 400);
      if (req.body.businessPartnerId) {
        const targetPartner = await Profile.findById(req.body.businessPartnerId);
        if (!targetPartner) throw fail("Business Partner not found.", 404);
        assertPartnerScope(req, targetPartner);
      } else assertGlobalAdminScope(req);
      patch.businessPartner = req.body.businessPartnerId || null;
    }
    if (req.body.commissionType !== undefined) {
      patch.commissionType = text(req.body.commissionType, 40).toUpperCase();
      if (!["PERFORMANCE_BONUS", "CAMPAIGN_BONUS"].includes(patch.commissionType)) throw fail("Unsupported bonus commission type.", 400);
    }
    Object.assign(rule, patch);
    await rule.save();
    await audit(req, "BUSINESS_PARTNER_BONUS_RULE_UPDATED", "Updated bonus rule", { ruleId: String(rule._id), changedFields: Object.keys(patch) });
    res.json({ success: true, rule });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminEvaluateBonusRule = async (req, res) => {
  try {
    if (!isId(req.params.ruleId)) throw fail("Valid bonus rule ID required.", 400);
    const evaluationRule = await BonusRule.findById(req.params.ruleId).lean();
    if (!evaluationRule) throw fail("Bonus rule not found.", 404);
    if (evaluationRule.businessPartner) assertPartnerScope(req, await Profile.findById(evaluationRule.businessPartner));
    else assertGlobalAdminScope(req);
    if (req.body.businessPartnerId || req.query.partnerId) {
      const targetPartner = await Profile.findById(req.body.businessPartnerId || req.query.partnerId);
      if (!targetPartner) throw fail("Business Partner not found.", 404);
      assertPartnerScope(req, targetPartner);
    }
    if (req.body.periodStart || req.body.periodEnd || req.query.periodStart || req.query.periodEnd) throw fail("Use one evaluation anchor; arbitrary period ranges are not accepted.", 400);
    const anchor = req.body.evaluationAnchor || req.query.evaluationAnchor || new Date();
    const result = await evaluateBonusRule({ ruleId: req.params.ruleId, businessPartner: req.body.businessPartnerId || req.query.partnerId || null, evaluationAnchor: anchor, createdBy: id(req) });
    await audit(req, "BUSINESS_PARTNER_BONUS_EVALUATED", "Evaluated bonus rule", { ruleId: req.params.ruleId, partnerId: result.commission?.businessPartner ? String(result.commission.businessPartner) : req.body.businessPartnerId || req.query.partnerId || null, result: result.qualified ? "QUALIFIED" : "NOT_QUALIFIED" });
    res.json({ success: true, ...result });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminBonusRuleStatus = async (req, res) => {
  try {
    const status = text(req.body.status, 20).toUpperCase();
    if (!["ACTIVE", "SUSPENDED"].includes(status)) throw fail("Status must be ACTIVE or SUSPENDED.", 400);
    const current = await BonusRule.findById(req.params.ruleId);
    if (!current) throw fail("Bonus rule not found.", 404);
    if (current.businessPartner) assertPartnerScope(req, await Profile.findById(current.businessPartner));
    else assertGlobalAdminScope(req);
    const rule = await BonusRule.findByIdAndUpdate(req.params.ruleId, { $set: { status } }, { new: true });
    if (!rule) throw fail("Bonus rule not found.", 404);
    await audit(req, "BUSINESS_PARTNER_BONUS_RULE_STATUS_UPDATED", `Changed bonus rule to ${status}`, { ruleId: String(rule._id), status });
    res.json({ success: true, rule });
  } catch (e) { res.status(e.statusCode || 500).json({ success: false, message: e.message }); }
};
exports.adminCreateRule = async(req,res)=>{try{let sourceType=text(req.body.sourceType,30).toUpperCase();if(sourceType==="PHONE")sourceType="PHONE_FINANCING";const calculation=text(req.body.calculation,20).toUpperCase();const availableMargin=Number(req.body.availableMargin);const rates=["value","partnerRate","officerRate","partnerOverrideRate"].map(field=>req.body[field]).filter(value=>value!==undefined&&value!==null).map(Number);if(!SUPPORTED_COMMISSION_SOURCES.has(sourceType)||!["PERCENT","FIXED"].includes(calculation)||!Number.isFinite(Number(req.body.value))||Number(req.body.value)<0||!Number.isFinite(availableMargin)||availableMargin<=0||rates.some(value=>!Number.isFinite(value)||value<0))throw fail("Valid supported sourceType, calculation, non-negative rates, and positive availableMargin are required.",400);if(calculation==="PERCENT"&&rates.some(value=>value>100))throw fail("Percentage commission rates cannot exceed 100%.",400);const latest=await Rule.findOne({sourceType}).sort({version:-1});const effectiveFrom=req.body.effectiveFrom&& !Number.isNaN(Date.parse(req.body.effectiveFrom))?new Date(req.body.effectiveFrom):new Date();const rule=await Rule.create({sourceType,calculation,value:Number(req.body.value),availableMargin,allocatedMargin:0,minimumTransactionAmount:Math.max(0,Number(req.body.minimumTransactionAmount||0)),maximumCommission:req.body.maximumCommission===undefined?null:Math.max(0,Number(req.body.maximumCommission)),partnerRate:req.body.partnerRate===undefined?null:Math.max(0,Number(req.body.partnerRate)),officerRate:req.body.officerRate===undefined?null:Math.max(0,Number(req.body.officerRate)),partnerOverrideRate:req.body.partnerOverrideRate===undefined?null:Math.max(0,Number(req.body.partnerOverrideRate)),effectiveFrom,version:(latest?.version||0)+1,createdBy:id(req)});await audit(req,"BUSINESS_PARTNER_COMMISSION_RULE_CREATED","Created effective-dated commission rule",{ruleId:String(rule._id),sourceType,version:rule.version,availableMargin});res.status(201).json({success:true,rule});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminUpdateRule = async(req,res)=>{try{if(!isId(req.params.ruleId))throw fail("Valid commission rule ID required.",400);const rule=await Rule.findById(req.params.ruleId);if(!rule)throw fail("Commission rule not found.",404);for(const field of ["calculation","value","minimumTransactionAmount","maximumCommission","partnerRate","officerRate","partnerOverrideRate","availableMargin","effectiveFrom","status"]){if(!Object.hasOwn(req.body||{},field))continue;if(field==="calculation"){const value=text(req.body[field],20).toUpperCase();if(!["PERCENT","FIXED"].includes(value))throw fail("Calculation must be PERCENT or FIXED.",400);rule[field]=value;}else if(field==="effectiveFrom"){if(Number.isNaN(Date.parse(req.body[field])))throw fail("effectiveFrom must be a valid date.",400);rule[field]=new Date(req.body[field]);}else if(field==="status"){const value=text(req.body[field],20).toUpperCase();if(!["ACTIVE","DISABLED"].includes(value))throw fail("Status must be ACTIVE or DISABLED.",400);rule[field]=value;}else{const value=Number(req.body[field]);if(req.body[field]!==null&&!Number.isFinite(value))throw fail(`Invalid ${field}.`,400);if(["value","minimumTransactionAmount","availableMargin"].includes(field)&&value<0)throw fail(`${field} cannot be negative.`,400);if(["maximumCommission","partnerRate","officerRate","partnerOverrideRate"].includes(field)&&value!==null&&value<0)throw fail(`${field} cannot be negative.`,400);if(field==="availableMargin"&&(req.body[field]===null||value<Number(rule.allocatedMargin||0)))throw fail("availableMargin cannot be below already allocated commission margin.",409);rule[field]=req.body[field]===null?null:value;}}if(rule.calculation==="PERCENT"&&["value","partnerRate","officerRate","partnerOverrideRate"].some(field=>rule[field]!==null&&rule[field]!==undefined&&Number(rule[field])>100))throw fail("Percentage commission rates cannot exceed 100%.",400);await rule.save();await audit(req,"BUSINESS_PARTNER_COMMISSION_RULE_UPDATED","Updated commission rule",{ruleId:String(rule._id),version:rule.version});res.json({success:true,rule});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminRuleStatus = async(req,res)=>{try{const status=text(req.body.status,20).toUpperCase();if(!["ACTIVE","DISABLED"].includes(status))throw fail("Status must be ACTIVE or DISABLED.",400);const rule=await Rule.findByIdAndUpdate(req.params.ruleId,{$set:{status}},{new:true});if(!rule)throw fail("Commission rule not found.",404);await audit(req,"BUSINESS_PARTNER_COMMISSION_RULE_STATUS_UPDATED",`Changed commission rule to ${status}`,{ruleId:String(rule._id),status});res.json({success:true,rule});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminTargets = async(req,res)=>{try{const filter={};if(req.query.partnerId&&isId(req.query.partnerId))filter.businessPartner=req.query.partnerId;const targets=await Target.find(filter).populate("businessPartner","partnerId businessName").sort({effectiveFrom:-1});res.json({success:true,targets});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminCreateTarget = async(req,res)=>{try{const businessPartnerId=req.params.partnerId||req.body.businessPartnerId;if(!isId(businessPartnerId))throw fail("Valid Business Partner is required.",400);if(req.params.partnerId&&req.body.businessPartnerId&&String(req.params.partnerId)!==String(req.body.businessPartnerId))throw fail("Business Partner target does not match route scope.",403);if(req.params.partnerId)await adminPartner(req);const period=text(req.body.period,20).toUpperCase(),metric=text(req.body.metric,40).toUpperCase(),target=Number(req.body.target);if(!["DAILY","WEEKLY","MONTHLY"].includes(period)||!["ACTIVE_CUSTOMERS","TRANSACTION_COUNT","TRANSACTION_VALUE"].includes(metric)||!Number.isFinite(target)||target<0)throw fail("Valid target period, metric, and non-negative target are required.",400);const row=await Target.create({businessPartner:businessPartnerId,period,metric,target,effectiveFrom:req.body.effectiveFrom&& !Number.isNaN(Date.parse(req.body.effectiveFrom))?new Date(req.body.effectiveFrom):new Date(),createdBy:id(req)});await audit(req,"BUSINESS_PARTNER_TARGET_CREATED","Created partner target",{targetId:String(row._id),partnerId:String(row.businessPartner)});res.status(201).json({success:true,target:row});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminAssignApplication = async (req,res) => { try { const p=await Profile.findById(req.params.partnerId);const type=text(req.body.type,10).toUpperCase();if(!p)throw fail("Business Partner not found.",404);requirePartnerService(p,type);if(type==="PHONE"){const app=await PhoneApplication.findById(req.params.applicationId);if(!app)throw fail("Phone application not found.",404);if(app.businessPartner&&String(app.businessPartner)!==String(p._id))throw fail("Application belongs to another Business Partner.",409);app.businessPartner=p._id;await app.save();}else{const app=await SolarApplication.findById(req.params.applicationId);if(!app)throw fail("Solar application not found.",404);if(app.businessPartner&&String(app.businessPartner)!==String(p._id))throw fail("Application belongs to another Business Partner.",409);app.businessPartner=p._id;await app.save();}await audit(req,"BUSINESS_PARTNER_APPLICATION_ASSIGNED","Assigned application to Business Partner",{partnerId:String(p._id),applicationId:req.params.applicationId,type});await Notification.create({userId:p.user,title:"New partner application",message:"A new application was assigned to your organisation.",type:"BUSINESS_PARTNER",referenceId:p._id,referenceType:"BusinessPartnerAssignment"});res.json({success:true}); }catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});} };
exports.adminReverseCommission = async(req,res)=>{try{const result=await reverseCommission({commissionId:req.params.commissionId,eventKey:text(req.body.eventKey,160),createdBy:id(req),reason:req.body.reason});if(!result.idempotent){const partner=await Profile.findById(result.commission.businessPartner);if(partner)await Notification.create({userId:partner.user,title:"Commission reversed",message:"A Business Partner commission has been reversed.",type:"BUSINESS_PARTNER",referenceId:result.commission._id,referenceType:"BusinessPartnerCommissionReversal"});}await audit(req,"BUSINESS_PARTNER_COMMISSION_REVERSED","Recorded commission reversal",{commissionId:req.params.commissionId});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};
exports.adminRecordCommissionRecovery = async(req,res)=>{try{const result=await recordCommissionRecovery({reversalId:req.params.reversalId,eventKey:text(req.body.eventKey,160),amount:req.body.amount,createdBy:id(req)});await audit(req,"BUSINESS_PARTNER_COMMISSION_RECOVERY_RECORDED","Recorded recovered paid commission liability",{reversalId:req.params.reversalId,amount:Number(req.body.amount)});res.status(result.idempotent?200:201).json({success:true,...result});}catch(e){res.status(e.statusCode||500).json({success:false,message:e.message});}};