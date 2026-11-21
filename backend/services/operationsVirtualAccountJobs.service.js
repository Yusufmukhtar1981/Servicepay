const crypto = require("node:crypto");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Job = require("../models/operationsVirtualAccountJob.model");
const Audit = require("../models/adminAuditLog.model");
const accounts = require("../controllers/adminVirtualAccount.controller");
const access = require("./operationsControlAccess.service");
const { loadStaffRole } = require("../middleware/staffPermission.middleware");

const fail = (code, message) => Object.assign(new Error(message), { statusCode: code });
const objectId = value => typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
const stableId = text => new mongoose.Types.ObjectId(crypto.createHash("sha256").update(text).digest("hex").slice(0, 24));
const globalLockId = stableId("operations-virtual-accounts:global-provider-lease");
const customerPopulation = { role: "CUSTOMER", isDeleted: { $ne: true }, deletedAt: null };
const missing = { ...customerPopulation, "virtualAccount.accountNumber": { $not: /\S/ } };
const safeFailures = new Set(["PROVIDER_ACCESS_REJECTED", "CONFIGURATION_UNAVAILABLE"]);
const publicJob = job => Object.fromEntries([
  ["id", String(job._id)], ...["status", "total", "processed", "successful", "failed",
    "pending", "skipped", "createdAt", "updatedAt", "pauseReason"].map(key => [key, job[key] ?? null]),
]);
const publicItem = item => ({ customerId: String(item.customerId), fullName: item.fullName || "",
  phone: item.phone || "", status: item.status, reason: item.reason || "", updatedAt: item.updatedAt });

async function storageReady() {
  if (!mongoose.connection.db) return false;
  const exists = await mongoose.connection.db.listCollections({ name: Job.collection.collectionName }, { nameOnly: true }).hasNext();
  if (!exists) return false;
  const indexes = await Job.collection.listIndexes().toArray();
  return [{ _id: 1 }, { kind: 1, status: 1, nextRunAt: 1, createdAt: 1 }, { jobId: 1, kind: 1, _id: 1 }]
    .every(key => indexes.some(index => JSON.stringify(index.key) === JSON.stringify(key)));
}

async function requireStore() {
  if (!await storageReady()) throw fail(503, "Bulk account storage requires its approved additive provisioning step. No customer or financial records were changed.");
}

async function actorContext(actorId) {
  const user = await User.findOne({ _id: actorId, status: "ACTIVE",
    isDeleted: { $ne: true }, deletedAt: null }).select("_id fullName role isStaff staffRoleId");
  if (!user) throw fail(403, "The job owner is no longer active.");
  const req = { user, method: "WORKER", originalUrl: "/admin/virtual-account-management/jobs" };
  let allowed = false;
  await loadStaffRole(req, { status() { return this; }, json() { return this; } }, () => { allowed = true; });
  if (!allowed) throw fail(403, "The job owner's current role is unavailable.");
  await access.assertActor(req, access.CAPABILITIES.virtualAccountsBulk);
  await access.assertActor(req, access.CAPABILITIES.virtualAccountsGenerate);
  return req;
}

async function createJob(req, source) {
  await access.assertActor(req, access.CAPABILITIES.virtualAccountsBulk);
  await access.assertActor(req, access.CAPABILITIES.virtualAccountsGenerate);
  await requireStore();
  const body = req.body || {};
  if (Object.keys(body).some(k => !["requestId", "reason", "confirmed", "mode", "customerIds"].includes(k)) ||
      body.confirmed !== true || typeof body.requestId !== "string" ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.requestId) ||
      typeof body.reason !== "string" || body.reason.trim().length < 5 ||
      body.reason.trim().length > 500 || /[\x00-\x1f]/.test(body.reason)) {
    throw fail(400, "Confirm the operation with a unique request ID and a reason of 5 to 500 characters.");
  }
  const mode = source?.mode || body.mode;
  const rawIds = source?.customerIds?.map(String) || body.customerIds || [];
  if (!["ALL", "SELECTED"].includes(mode) || !Array.isArray(rawIds) ||
      rawIds.some(id => !objectId(id)) || rawIds.length > 1000 ||
      mode === "SELECTED" && !rawIds.length || mode === "ALL" && rawIds.length) {
    throw fail(400, "Select all eligible customers or 1 to 1000 specific customers.");
  }
  const ids = [...new Set(rawIds)].sort();
  const requestId = body.requestId.toLowerCase();
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
    mode, ids, reason: body.reason.trim(), source: source ? String(source._id) : null,
  })).digest("hex");
  const id = stableId(`operations-virtual-account-job:${req.user._id}:${requestId}`);
  const existing = await Job.findById(id).lean();
  if (existing) {
    if (existing.kind !== "JOB" || existing.fingerprint !== fingerprint) throw fail(409, "Request ID belongs to a different confirmed operation.");
    return publicJob(existing);
  }
  const latest = source?.maxCustomerId || (await User.findOne({ role: "CUSTOMER" })
    .select("_id").sort({ _id: -1 }).lean())?._id;
  const total = !latest ? 0 : await User.countDocuments(mode === "ALL"
    ? { ...customerPopulation, _id: { $lte: latest } } : { role: "CUSTOMER", _id: { $in: ids } }).maxTimeMS(5000);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Job.create([{ _id: id, kind: "JOB", actorId: req.user._id, actorName: req.user.fullName,
        requestId, fingerprint, reason: body.reason.trim(), mode, customerIds: ids,
        maxCustomerId: latest, total, status: total ? "QUEUED" : "COMPLETED" }], { session });
      await Audit.create([{ actorId: req.user._id, actorRole: req.user.role,
        actorName: req.user.fullName || "", action: "VIRTUAL_ACCOUNT_GENERATION_REQUESTED",
        reason: body.reason.trim(), metadata: { bulkJobId: String(id), mode, total,
          outcome: "BULK_JOB_CONFIRMED", sourceJobId: source ? String(source._id) : null } }], { session });
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await Job.findById(id).lean();
    if (!winner || winner.fingerprint !== fingerprint) throw fail(409, "Concurrent request ID conflict.");
  } finally { await session.endSession(); }
  return publicJob(await Job.findById(id).lean());
}

async function recordItem(job, user, result, token, pauseReason) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const field = { SUCCESS: "successful", FAILED: "failed", PENDING: "pending", SKIPPED: "skipped" }[result.status];
      const itemId = stableId(`operations-va-item:${job._id}:${user._id}`);
      const prior = await Job.findById(itemId).session(session).lean();
      if (prior) throw fail(409, "This customer result was already recorded.");
      const updated = await Job.updateOne({ _id: job._id, kind: "JOB", leaseToken: token, status: "RUNNING" },
        { $set: { cursor: user._id, ...(pauseReason ? { status: "PAUSED", pauseReason } : {}) },
          $inc: { processed: 1, [field]: 1 } }, { session });
      if (updated.modifiedCount !== 1) throw fail(409, "Job lease changed; do not dispatch another account.");
      await Job.create([{ _id: itemId, kind: "ITEM", jobId: job._id, customerId: user._id,
        fullName: user.fullName, phone: user.phone, ...result }], { session });
    });
  } finally { await session.endSession(); }
}

// One global lease controls provider dispatch across all application replicas.
// Per-customer admission remains the canonical controller's atomic claim and
// durable deterministic audit intent, including after a worker/process crash.
async function runBatch({ delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  await requireStore();
  const now = new Date(), token = crypto.randomUUID();
  const candidate = await Job.findOne({ kind: "JOB", nextRunAt: { $lte: now },
    $or: [{ status: "QUEUED" }, { status: "RUNNING", leaseUntil: { $lt: now } }] })
    .sort({ nextRunAt: 1, createdAt: 1 }).lean();
  if (!candidate) return false;
  let lock;
  try {
    lock = await Job.findOneAndUpdate({ _id: globalLockId, $or: [
      { leaseUntil: { $lt: now } }, { leaseUntil: null },
    ] }, { $set: { kind: "LOCK", status: "LOCK", leaseToken: token,
      leaseUntil: new Date(Date.now() + 120000) } }, { upsert: true, returnDocument: "after" });
  } catch (error) { if (error.code === 11000) return false; throw error; }
  if (!lock) return false;
  try {
    const job = await Job.findOneAndUpdate({ _id: candidate._id, kind: "JOB",
      $or: [{ status: "QUEUED" }, { status: "RUNNING", leaseUntil: { $lt: now } }] },
    { $set: { status: "RUNNING", leaseToken: token, leaseUntil: new Date(Date.now() + 120000) } },
    { returnDocument: "after" }).lean();
    if (!job) return false;
    // Existing accounts are scanned without provider delay. Keep a strict
    // three-dispatch batch limit while avoiding hours spent on retained accounts.
    let dispatched = 0;
    for (let count = 0; count < 100 && dispatched < 3; count++) {
      const req = await actorContext(job.actorId);
      const expiry = new Date(Date.now() + 120000);
      const renewed = await Job.updateOne({ _id: globalLockId, leaseToken: token }, { $set: { leaseUntil: expiry } });
      if (renewed.matchedCount !== 1) throw fail(409, "Provider lease is unavailable.");
      await Job.updateOne({ _id: job._id, leaseToken: token }, { $set: { leaseUntil: expiry } });
      const idFilter = { ...(job.cursor ? { $gt: job.cursor } : {}),
        ...(job.maxCustomerId ? { $lte: job.maxCustomerId } : {}) };
      const filter = job.mode === "ALL" ? { ...customerPopulation, _id: idFilter }
        : { role: "CUSTOMER", _id: { $in: job.customerIds, ...idFilter } };
      const user = await User.findOne(filter).select(accounts.accountProjection).sort({ _id: 1 }).lean();
      if (!user) {
        const final = await Job.findById(job._id).select("processed").lean();
        await Job.updateOne({ _id: job._id, leaseToken: token, status: "RUNNING" },
          { $set: { status: "COMPLETED", total: final.processed }, $unset: { leaseToken: "", leaseUntil: "" } });
        return true;
      }
      const eligibility = accounts.accountEligibility(user);
      const result = { status: "SKIPPED", reason: eligibility.reason };
      let pauseReason;
      if (String(user.virtualAccount?.accountNumber || "").trim()) {
        result.status = "SUCCESS"; result.reason = "Existing account retained; no provider request.";
      } else if (eligibility.requiresReconciliation) {
        result.status = "PENDING"; result.reason = "Existing uncertain attempt requires provider reconciliation; no creation was dispatched.";
      } else if (eligibility.canGenerate || eligibility.canRetry) {
        dispatched++;
        req.params = { id: String(user._id) }; req.query = {};
        const hex = crypto.createHash("sha256").update(`${job._id}:${user._id}`).digest("hex").slice(0, 32);
        req.body = { reason: job.reason, requestId: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` };
        let response, code = 200;
        await accounts.generate(req, { status(value) { code = value; return this; }, json(value) { response = value; return this; } });
        const fresh = await User.findById(user._id).select(accounts.accountProjection).lean();
        result.responseStatus = code;
        if (String(fresh?.virtualAccount?.accountNumber || "").trim()) {
          result.status = "SUCCESS"; result.reason = "Account saved through the existing provisioning integration.";
        } else if (safeFailures.has(fresh?.virtualAccount?.failureReason)) {
          result.status = "FAILED"; result.reason = fresh.virtualAccount.failureReason;
          pauseReason = fresh.virtualAccount.failureReason;
        } else {
          result.status = "PENDING"; result.reason = "Provider outcome is unconfirmed. No automatic creation replay.";
          pauseReason = "PROVIDER_CONFIRMATION_REQUIRED";
        }
        // Keep provider payloads/references and account numbers out of job data.
        void response;
      }
      await recordItem(job, user, result, token, pauseReason);
      job.cursor = user._id;
      if (pauseReason) return true;
      if (result.responseStatus !== undefined) await delay(2000);
    }
    await Job.updateOne({ _id: job._id, leaseToken: token, status: "RUNNING" },
      { $set: { status: "QUEUED", nextRunAt: new Date(Date.now() + 2000) },
        $unset: { leaseToken: "", leaseUntil: "" } });
    return true;
  } catch (error) {
    await Job.updateOne({ _id: candidate._id, leaseToken: token, status: "RUNNING" },
      { $set: { status: "PAUSED", pauseReason: error.statusCode === 403 ? "ACTOR_AUTHORIZATION_REQUIRED" : "WORKER_REVIEW_REQUIRED" } });
    throw error;
  } finally {
    await Job.updateOne({ _id: globalLockId, leaseToken: token }, { $unset: { leaseToken: "" }, $set: { leaseUntil: new Date(0) } });
  }
}

let timer, running = false;
let workerHealth = { enabled: false, lastCheckedAt: null, lastError: null };
function startWorker() {
  // Render's production process owns provider dispatch. Workspace previews must
  // not compete for production jobs from a different, unapproved outbound IP.
  if (timer || process.env.RENDER !== "true" || process.env.NODE_ENV === "test") return;
  workerHealth.enabled = true;
  let nextStorageCheck = 0, ready = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() >= nextStorageCheck) {
        ready = await storageReady();
        nextStorageCheck = Date.now() + 60000;
      }
      if (ready) await runBatch();
      workerHealth = { enabled: true, lastCheckedAt: new Date(),
        lastError: ready ? null : "JOB_STORAGE_NOT_READY" };
    } catch (_) {
      workerHealth = { enabled: true, lastCheckedAt: new Date(), lastError: "BULK_WORKER_REVIEW_REQUIRED" };
    } finally { running = false; }
  };
  timer = setInterval(tick, 10000);
  timer.unref?.();
  void tick();
}

module.exports = { Job, missing, publicJob, publicItem, storageReady, requireStore,
  createJob, runBatch, stableId, startWorker, health: () => ({ ...workerHealth }) };
