const { once } = require("node:events");
const User = require("../models/user.model");
const Audit = require("../models/adminAuditLog.model");
const jobs = require("../services/operationsVirtualAccountJobs.service");
const access = require("../services/operationsControlAccess.service");
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const wrap = action => async (req, res) => {
  try {
    await access.assertActor(req, access.CAPABILITIES.virtualAccountsView);
    res.set("Cache-Control", "no-store");
    return await action(req, res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    return res.status(error.statusCode || 503).json({ success: false,
      message: error.statusCode ? error.message : "Virtual account operations are temporarily unavailable. Refresh safely." });
  }
};
const paging = query => {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  if (page > 10000) throw fail(400, "Select a narrower report range.");
  return { page, limit, skip: (page - 1) * limit };
};
const findJob = async id => {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) throw fail(404, "Generation job not found.");
  await jobs.requireStore();
  const job = await jobs.Job.findOne({ _id: id, kind: "JOB" }).lean();
  if (!job) throw fail(404, "Generation job not found.");
  return job;
};
exports.summary = wrap(async (req, res) => {
  const [totalCustomers, withoutAccounts, storageReady] = await Promise.all([
    User.countDocuments({ role: "CUSTOMER", isDeleted: { $ne: true }, deletedAt: null }).maxTimeMS(5000),
    User.countDocuments(jobs.missing).maxTimeMS(5000), jobs.storageReady(),
  ]);
  return res.json({ success: true, data: { totalCustomers, withoutAccounts,
    withAccounts: totalCustomers - withoutAccounts, storageReady, worker: jobs.health(),
    permissions: { view: true,
      generate: req.user.role === "HEAD_OFFICE" || access.permitted(req, access.CAPABILITIES.virtualAccountsGenerate),
      bulk: req.user.role === "HEAD_OFFICE" || access.permitted(req, access.CAPABILITIES.virtualAccountsBulk) },
    totalExplanation: "All-customer jobs inspect existing customers, retain assigned accounts, and generate only when canonical eligibility permits." } });
});
exports.list = wrap(async (req, res) => {
  await jobs.requireStore();
  const { page, limit, skip } = paging(req.query);
  const [rows, total] = await Promise.all([
    jobs.Job.find({ kind: "JOB" }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    jobs.Job.countDocuments({ kind: "JOB" }).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { items: rows.map(jobs.publicJob),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});
exports.create = wrap(async (req, res) => res.status(202).json({ success: true,
  data: { job: await jobs.createJob(req) } }));
exports.detail = wrap(async (req, res) => {
  const job = await findJob(req.params.id);
  const { page, limit, skip } = paging(req.query);
  const filter = { kind: "ITEM", jobId: job._id };
  const [rows, total] = await Promise.all([
    jobs.Job.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).maxTimeMS(5000).lean(),
    jobs.Job.countDocuments(filter).maxTimeMS(5000),
  ]);
  return res.json({ success: true, data: { job: jobs.publicJob(job), items: rows.map(jobs.publicItem),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
});
exports.retry = wrap(async (req, res) => {
  const source = await findJob(req.params.id);
  if (!["PAUSED", "FAILED", "COMPLETED"].includes(source.status) ||
      source.status === "COMPLETED" && !source.failed) throw fail(409, "No safely retryable failed job is available.");
  if (Object.keys(req.body || {}).some(key => !["requestId", "reason", "confirmed"].includes(key))) {
    throw fail(400, "Retry accepts only the confirmed reason and a new request ID.");
  }
  // A new job rechecks current canonical eligibility. It never resets failed or
  // uncertain customer records or repeats successful account generation.
  return res.status(202).json({ success: true, data: { job: await jobs.createJob(req, source) } });
});
const csv = value => {
  let text = String(value ?? "").replace(/[\r\n]/g, " ");
  if (/^[=+\-@\t]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
};
exports.report = wrap(async (req, res) => {
  const job = await findJob(req.params.id);
  await Audit.create({ actorId: req.user._id, actorRole: req.user.role,
    actorName: req.user.fullName || "", action: "VIRTUAL_ACCOUNT_GENERATION_RESULT",
    reason: "Downloaded an authorized account generation report.",
    metadata: { bulkJobId: String(job._id), outcome: "BULK_REPORT_EXPORTED" } });
  res.type("text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="ServicePay-virtual-accounts-${job._id}.csv"`);
  res.write("\uFEFFCustomer ID,Customer,Phone,Status,Reason,Updated\r\n");
  for await (const item of jobs.Job.find({ kind: "ITEM", jobId: job._id }).sort({ _id: 1 }).lean().cursor()) {
    const row = jobs.publicItem(item);
    if (!res.write([row.customerId, row.fullName, row.phone, row.status, row.reason, row.updatedAt].map(csv).join(",") + "\r\n")) {
      await once(res, "drain");
    }
  }
  return res.end();
});
