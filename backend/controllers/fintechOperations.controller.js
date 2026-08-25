const crypto = require("crypto");
const mongoose = require("mongoose");
const FintechCase = require("../models/fintechCase.model");
const RiskAlert = require("../models/riskAlert.model");
const ScheduledPayment = require("../models/scheduledPayment.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const KycProfile = require("../models/kycProfile.model");
const IdVerification = require("../models/idVerification.model");
const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const AdminAuditLog = require("../models/adminAuditLog.model");

const CASE_TYPES = ["COMPLAINT", "CHARGEBACK", "MANUAL_RESOLUTION"];
const CASE_STATUSES = ["OPEN", "IN_REVIEW", "WAITING_ON_CUSTOMER", "RESOLVED", "REJECTED", "CLOSED"];
const ALERT_STATUSES = ["OPEN", "IN_REVIEW", "DISMISSED", "ESCALATED", "RESOLVED"];
const paymentTypes = ["AIRTIME", "DATA", "CABLE", "ELECTRICITY", "TRANSFER", "BANK_TRANSFER"];
const pageValues = (q) => ({ page: Math.max(1, Number(q.page) || 1), limit: Math.min(100, Math.max(1, Number(q.limit) || 25)) });
const clean = (v, max = 500) => String(v || "").trim().slice(0, max);
const ref = (prefix) => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const actorId = (req) => req.user?._id || req.user?.id;
const audit = async (req, action, reason, previousData, newData, metadata = {}, session = null) => AdminAuditLog.create([{
  actorId: actorId(req), actorRole: req.user.role, actorName: clean(req.user.fullName || req.user.name, 200),
  action, reason: clean(reason, 500) || action.replaceAll("_", " "), previousData, newData, metadata,
  ipAddress: clean(req.ip, 100), userAgent: clean(req.get("user-agent"), 500),
  requestMethod: req.method, requestPath: req.originalUrl,
}], session ? { session } : undefined);
// A mutation and its evidence are one unit of work. Mongo deployment must
// support transactions; failure to write an audit row aborts the mutation.
const auditedTransaction = async (req, action, reason, mutation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await mutation(session);
      await audit(req, action, reason, result.previousData || null, result.newData || null, result.metadata || {}, session);
    });
    return result.value;
  } finally { await session.endSession(); }
};
const duplicate = (error) => error && error.code === 11000;
const sendError = (res, error, message = "Unable to complete operation.") => res.status(error?.statusCode || (duplicate(error) ? 409 : 500)).json({ success: false, message: error?.statusCode ? error.message : (duplicate(error) ? "Idempotency key or reference already exists." : message) });
const list = async (Model, req, res, filter, select = "") => {
  const { page, limit } = pageValues(req.query);
  const [items, total] = await Promise.all([Model.find(filter).select(select).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), Model.countDocuments(filter)]);
  res.json({ success: true, data: { page, limit, total, items } });
};

exports.catalog = (req, res) => res.json({ success: true, data: {
  caseTypes: CASE_TYPES, caseStatuses: CASE_STATUSES, alertStatuses: ALERT_STATUSES,
  scheduledPaymentServiceTypes: paymentTypes,
  capabilities: { backgroundScheduler: false, scheduledPaymentExecution: "manual_validation_only", providerHealthChecks: false },
} });

exports.listCases = async (req, res) => {
  try { const f = {}; if (CASE_TYPES.includes(clean(req.query.type).toUpperCase())) f.type = clean(req.query.type).toUpperCase(); if (CASE_STATUSES.includes(clean(req.query.status).toUpperCase())) f.status = clean(req.query.status).toUpperCase(); if (req.query.assignedTo) f.assignedTo = req.query.assignedTo; await list(FintechCase, req, res, f); } catch (e) { sendError(res, e, "Unable to load cases."); }
};
exports.createCase = async (req, res) => {
  try {
    const type = clean(req.body.type).toUpperCase(), idempotencyKey = clean(req.body.idempotencyKey, 120);
    if (!CASE_TYPES.includes(type) || !idempotencyKey || !clean(req.body.subject, 200) || !clean(req.body.description, 5000)) return res.status(400).json({ success: false, message: "type, subject, description and idempotencyKey are required." });
    if (req.body.transaction && !await Transaction.exists({ _id: req.body.transaction })) return res.status(400).json({ success: false, message: "Referenced transaction does not exist." });
    const item = await auditedTransaction(req, "FINTECH_CASE_CREATED", `Created ${type} case.`, async (session) => {
      const [created] = await FintechCase.create([{ caseReference: clean(req.body.caseReference, 80) || ref("CASE"), idempotencyKey, type, subject: clean(req.body.subject, 200), description: clean(req.body.description, 5000), transaction: req.body.transaction || null, customer: req.body.customer || null, assignedTo: req.body.assignedTo || null, createdBy: actorId(req) }], { session });
      return { value: created, newData: { caseId: String(created._id), caseReference: created.caseReference } };
    });
    res.status(201).json({ success: true, data: item });
  } catch (e) { sendError(res, e, "Unable to create case."); }
};
exports.getCase = async (req, res) => { try { const item = await FintechCase.findById(req.params.id).populate("transaction", "reference amount status serviceType provider").populate("customer", "fullName phone email").populate("assignedTo", "fullName email"); if (!item) return res.status(404).json({ success: false, message: "Case not found." }); res.json({ success: true, data: item }); } catch (e) { sendError(res, e, "Unable to load case."); } };
exports.updateCase = async (req, res) => {
  try {
    if (req.body.status !== undefined && !CASE_STATUSES.includes(clean(req.body.status).toUpperCase())) return res.status(400).json({ success: false, message: "Invalid case status." });
    if (req.body.note !== undefined && !clean(req.body.note, 2000)) return res.status(400).json({ success: false, message: "Note cannot be empty." });
    const item = await auditedTransaction(req, "FINTECH_CASE_UPDATED", clean(req.body.reason, 500) || "Updated fintech case.", async (session) => {
      const current = await FintechCase.findById(req.params.id).session(session); if (!current) throw Object.assign(new Error("Case not found."), { statusCode: 404 });
      const previousData = { status: current.status, assignedTo: current.assignedTo, resolution: current.resolution };
      if (req.body.status !== undefined) current.status = clean(req.body.status).toUpperCase(); if (req.body.assignedTo !== undefined) current.assignedTo = req.body.assignedTo || null; if (req.body.resolution !== undefined) current.resolution = clean(req.body.resolution, 3000); if (req.body.note !== undefined) current.notes.push({ body: clean(req.body.note, 2000), authorId: actorId(req) });
      await current.save({ session }); return { value: current, previousData, newData: { status: current.status, assignedTo: current.assignedTo, resolution: current.resolution }, metadata: { caseId: String(current._id) } };
    }); res.json({ success: true, data: item });
  } catch (e) { sendError(res, e, "Unable to update case."); }
};

const thresholds = async () => { const s = await AppSettings.getGlobalSettings(); const r = s.fintechOperations?.risk || {}; return { suspicious: Number(r.suspiciousTransactionAmount || 500000), aml: Number(r.amlTransactionAmount || 1000000), daily: Number(r.amlDailyCustomerAmount || 2000000) }; };
exports.listAlerts = async (req, res) => { try { const f = {}; if (["SUSPICIOUS_TRANSACTION", "AML"].includes(clean(req.query.kind).toUpperCase())) f.kind = clean(req.query.kind).toUpperCase(); if (ALERT_STATUSES.includes(clean(req.query.status).toUpperCase())) f.status = clean(req.query.status).toUpperCase(); await list(RiskAlert, req, res, f); } catch (e) { sendError(res, e, "Unable to load risk alerts."); } };
exports.createAlert = async (req, res) => {
  try {
    const key = clean(req.body.idempotencyKey, 120); if (!key) return res.status(400).json({ success: false, message: "idempotencyKey is required." });
    const prior = await RiskAlert.findOne({ idempotencyKey: key }); if (prior) return res.json({ success: true, data: prior, idempotent: true });
    const tx = await Transaction.findById(req.body.transaction); if (!tx) return res.status(400).json({ success: false, message: "A real transaction is required." });
    const t = await thresholds(); let kind;
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const dailyRows = await Transaction.aggregate([{ $match: { customerId: tx.customerId, createdAt: { $gte: dayStart }, status: "SUCCESSFUL" } }, { $group: { _id: null, amount: { $sum: "$amount" } } }]);
    const dailyAmount = dailyRows[0]?.amount || 0;
    kind = tx.amount >= t.aml || dailyAmount >= t.daily ? "AML" : tx.amount >= t.suspicious ? "SUSPICIOUS_TRANSACTION" : "";
    if (!kind) return res.status(422).json({ success: false, message: "Transaction does not meet configured risk thresholds." });
    const item = await auditedTransaction(req, "RISK_ALERT_CREATED", "Created risk alert from transaction threshold.", async (session) => {
      const [created] = await RiskAlert.create([{ alertReference: ref("RISK"), idempotencyKey: key, transaction: tx._id, customer: tx.customerId, kind, severity: kind === "AML" ? "HIGH" : "MEDIUM", reason: clean(req.body.reason, 1000) || `Threshold triggered for transaction ${tx.reference}.`, details: { transactionAmount: tx.amount, dailyCustomerAmount: dailyAmount, thresholds: t } }], { session });
      return { value: created, newData: { alertId: String(created._id), transaction: tx.reference } };
    });
    res.status(201).json({ success: true, data: item });
  } catch (e) { if (duplicate(e)) { const item = await RiskAlert.findOne({ $or: [{ idempotencyKey: clean(req.body.idempotencyKey,120) }, { transaction: req.body.transaction }] }); if (item) return res.json({success:true,data:item,idempotent:true}); } sendError(res, e, "Unable to create risk alert."); }
};
exports.updateAlert = async (req, res) => { try { const status = clean(req.body.status).toUpperCase(); if (!ALERT_STATUSES.includes(status)) return res.status(400).json({success:false,message:"Invalid risk alert status."}); const item=await auditedTransaction(req,"RISK_ALERT_UPDATED",clean(req.body.reason,500)||"Updated risk alert.",async(session)=>{const current=await RiskAlert.findById(req.params.id).session(session);if(!current)throw Object.assign(new Error("Risk alert not found."),{statusCode:404});const previousData={status:current.status};current.status=status;current.reviewNote=clean(req.body.reviewNote,2000);current.reviewedBy=actorId(req);await current.save({session});return {value:current,previousData,newData:{status},metadata:{alertId:String(current._id)}};}); res.json({success:true,data:item}); } catch(e){sendError(res,e,"Unable to update risk alert.");} };

exports.listPayments = async (req,res) => { try { const f={}; if (req.query.status) f.status=clean(req.query.status).toUpperCase(); if(req.query.customer) f.customer=req.query.customer; await list(ScheduledPayment,req,res,f); } catch(e){sendError(res,e,"Unable to load scheduled payments.");} };
exports.createPayment = async (req,res) => { try { const b=req.body, serviceType=clean(b.serviceType).toUpperCase(), amount=Number(b.amount), executeAt=new Date(b.executeAt), key=clean(b.idempotencyKey,120); if(!paymentTypes.includes(serviceType)||!key||!b.customer||!Number.isFinite(amount)||amount<=0||Number.isNaN(executeAt.getTime())) return res.status(400).json({success:false,message:"Valid customer, serviceType, amount, executeAt and idempotencyKey are required."}); if(!await User.exists({_id:b.customer})) return res.status(400).json({success:false,message:"Customer does not exist."}); const item=await auditedTransaction(req,"SCHEDULED_PAYMENT_CREATED","Created scheduled payment.",async(session)=>{const [created]=await ScheduledPayment.create([{reference:clean(b.reference,80)||ref("SCH"),idempotencyKey:key,customer:b.customer,serviceType,provider:clean(b.provider,100),amount,executeAt,payload:b.payload&&typeof b.payload==="object"?b.payload:{},createdBy:actorId(req)}],{session});return {value:created,newData:{paymentId:String(created._id),reference:created.reference}};});res.status(201).json({success:true,data:item}); }catch(e){sendError(res,e,"Unable to create scheduled payment.");} };
exports.updatePayment = async (req,res) => { try { const requestedStatus=clean(req.body.status).toUpperCase();if(requestedStatus&&requestedStatus!=="CANCELLED")return res.status(400).json({success:false,message:"Only CANCELLED is a valid scheduled-payment status update."});if(req.body.executeAt&&Number.isNaN(new Date(req.body.executeAt).getTime()))return res.status(400).json({success:false,message:"Invalid executeAt."});const item=await auditedTransaction(req,"SCHEDULED_PAYMENT_UPDATED",clean(req.body.reason,500)||"Updated scheduled payment.",async(session)=>{const current=await ScheduledPayment.findById(req.params.id).session(session);if(!current)throw Object.assign(new Error("Scheduled payment not found."),{statusCode:404});if(current.status!=="SCHEDULED")throw Object.assign(new Error("Only scheduled payments may be changed."),{statusCode:409});const previousData={status:current.status,executeAt:current.executeAt};if(requestedStatus==="CANCELLED")current.status="CANCELLED";if(req.body.executeAt)current.executeAt=new Date(req.body.executeAt);await current.save({session});return {value:current,previousData,newData:{status:current.status,executeAt:current.executeAt},metadata:{paymentId:String(current._id)}};});res.json({success:true,data:item}); }catch(e){sendError(res,e,"Unable to update scheduled payment.");} };
exports.executePayment = async (req,res) => { try { const key=clean(req.body.idempotencyKey,120);if(!key)return res.status(400).json({success:false,message:"idempotencyKey is required."});const item=await auditedTransaction(req,"SCHEDULED_PAYMENT_EXECUTION_REFUSED","Refused unsupported scheduled payment execution.",async(session)=>{const current=await ScheduledPayment.findById(req.params.id).session(session);if(!current)throw Object.assign(new Error("Scheduled payment not found."),{statusCode:404});if(current.lastExecutionIdempotencyKey===key)throw Object.assign(new Error("This execution request has already been handled."),{statusCode:409});if(current.status!=="SCHEDULED")throw Object.assign(new Error("Payment is not scheduled."),{statusCode:409});const customer=await User.findById(current.customer).select("walletBalance").session(session);if(!customer||Number(customer.walletBalance||0)<current.amount)throw Object.assign(new Error("Customer balance is insufficient; no execution was attempted."),{statusCode:422});current.executionAttempts+=1;current.lastExecutionIdempotencyKey=key;current.status="EXECUTION_REFUSED";current.refusalReason="No supported scheduler/provider execution adapter is registered. No funds were debited.";await current.save({session});return {value:current,newData:{paymentId:String(current._id),reference:current.reference}};});res.status(409).json({success:false,message:item.refusalReason,data:item}); }catch(e){sendError(res,e,"Unable to execute scheduled payment.");} };

exports.providers = async (req, res) => {
  try {
    if (req.method === "PATCH") return res.status(409).json({ success: false, message: "Provider state is not persisted because this API has no provider-state enforcement adapter." });
    const rows = await Transaction.aggregate([{ $group: { _id: { $ifNull: ["$provider", "UNSPECIFIED"] }, transactions: { $sum: 1 }, successful: { $sum: { $cond: [{ $eq: ["$status", "SUCCESSFUL"] }, 1, 0] } }, volume: { $sum: "$amount" }, lastTransactionAt: { $max: "$createdAt" } } }, { $sort: { transactions: -1 } }, { $limit: 100 }]);
    res.json({ success: true, data: { items: rows.map((r) => ({ provider: r._id, transactions: r.transactions, successful: r.successful, successRate: r.transactions ? Number((r.successful / r.transactions * 100).toFixed(2)) : 0, volume: r.volume, lastTransactionAt: r.lastTransactionAt, statePersistence: "not_supported" })), capabilities: { healthChecks: false, statePersistence: false } } });
  } catch (e) { sendError(res, e, "Unable to summarize providers."); }
};

const csv = (rows) => rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
exports.report = async (req, res) => {
  try {
    const type = clean(req.params.type).toLowerCase(), format = clean(req.query.format).toLowerCase() || "json";
    if (!["transactions", "ledger", "kyc", "cases", "operations", "risk", "providers"].includes(type) || !["json", "csv"].includes(format)) return res.status(400).json({ success: false, message: "Unsupported report type or format." });
    const { limit } = pageValues(req.query); let headers; let rows;
    if (type === "transactions") { const docs = await Transaction.find({}).select("reference customerId serviceType provider amount status createdAt").sort({createdAt:-1}).limit(limit); headers=["reference","customerId","serviceType","provider","amount","status","createdAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "ledger") { const docs = await LedgerEntry.find({}).select("reference user direction amount service status createdAt").sort({createdAt:-1}).limit(limit); headers=["reference","user","direction","amount","service","status","createdAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "kyc") { const docs = await KycProfile.find({}).select("user level requestedLevel status identityMatchStatus submittedAt reviewedAt").sort({createdAt:-1}).limit(limit); headers=["user","level","requestedLevel","status","identityMatchStatus","submittedAt","reviewedAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "cases") { const docs = await FintechCase.find({}).select("caseReference type status transaction customer assignedTo createdAt").sort({createdAt:-1}).limit(limit); headers=["caseReference","type","status","transaction","customer","assignedTo","createdAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "operations") { const docs = await ScheduledPayment.find({}).select("reference customer serviceType amount executeAt status createdAt").sort({createdAt:-1}).limit(limit); headers=["reference","customer","serviceType","amount","executeAt","status","createdAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "risk") { const docs = await RiskAlert.find({}).select("alertReference transaction customer kind severity status createdAt").sort({createdAt:-1}).limit(limit); headers=["alertReference","transaction","customer","kind","severity","status","createdAt"]; rows=docs.map(d=>headers.map(h=>d[h])); }
    if (type === "providers") { const docs=await Transaction.aggregate([{ $group:{_id:{$ifNull:["$provider","UNSPECIFIED"]},transactions:{$sum:1},volume:{$sum:"$amount"}}},{ $limit:limit }]);headers=["provider","transactions","volume"];rows=docs.map(d=>[d._id,d.transactions,d.volume]); }
    if (format === "csv") { res.type("text/csv").attachment(`regulatory-${type}.csv`); return res.send(csv([headers, ...rows])); }
    return res.json({ success:true, data:{ report:type, generatedAt:new Date(), headers, rows:rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))) } });
  } catch(e) { sendError(res,e,"Unable to generate regulatory report."); }
};
exports.kyb = async (req,res) => { try { const f={}; if(req.query.status)f.status=clean(req.query.status).toUpperCase(); const {page,limit}=pageValues(req.query); const [items,total]=await Promise.all([KycProfile.find(f).select("user level requestedLevel status identityMatchStatus documentType submittedAt reviewedAt verifiedAt").populate("user","fullName email phone accountNumber").sort({createdAt:-1}).skip((page-1)*limit).limit(limit),KycProfile.countDocuments(f)]);res.json({success:true,page,limit,total,items}); }catch(e){sendError(res,e,"Unable to load KYB/KYC records.");} };
exports.identityVerifications = async (req,res) => { try { const f={};if(req.query.status)f.status=clean(req.query.status).toUpperCase();if(req.query.idType)f.idType=clean(req.query.idType).toUpperCase();const {page,limit}=pageValues(req.query);const [items,total]=await Promise.all([IdVerification.find(f).select("userId idType searchType slipType reference amountCharged status ninNumberMasked bvnNumberMasked idNumberMasked consentAccepted failureReason createdAt").populate("userId","fullName email phone").sort({createdAt:-1}).skip((page-1)*limit).limit(limit),IdVerification.countDocuments(f)]);res.json({success:true,page,limit,total,items});}catch(e){sendError(res,e,"Unable to load identity verifications.");} };