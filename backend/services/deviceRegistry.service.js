const mongoose = require("mongoose");
const crypto = require("node:crypto");
const v = require("./deviceValidation.service");
const { models, readiness } = require("./deviceProvisioning.service");
const staffRoles = ["HEAD_OFFICE", "ZONAL_MANAGER", "STATE_MANAGER", "AGGREGATOR", "STAFF", "OPERATIONS_MANAGER", "CUSTOMER_SUPPORT", "BRANCH_MANAGER"];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
class DeviceRegistry {
  constructor(connection = mongoose.connection) {
    this.connection = connection;
    Object.assign(this, models(connection));
  }
  ready() { return readiness(this.connection); }
  async transaction(work) {
    const session = await this.connection.startSession();
    try { return await session.withTransaction(() => work(session)); }
    finally { await session.endSession(); }
  }
  async audit(device, actor, action, reason, metadata, session) {
    await this.Audit.create([{ ...(device ? { device } : {}), actor: String(actor), action, reason, metadata }], { session });
  }
  async staff(staffId, session) {
    const user = await this.connection.collection("users").findOne({
      _id: new mongoose.Types.ObjectId(v.id(staffId, "staff ID")), status: "ACTIVE",
      $or: [{ isStaff: true }, { role: { $in: staffRoles } }],
      role: { $ne: "CUSTOMER" },
    }, { projection: { name: 1, fullName: 1, role: 1, department: 1 }, session });
    if (!user) v.fail("Select an active ServicePay staff account.", 400);
    return user;
  }
  async safe(device, fullIdentifiers = false) {
    const result = JSON.parse(JSON.stringify(device.toObject ? device.toObject() : device));
    delete result.enrollment; delete result.registrationKey; delete result.registrationDigest;
    delete result.imeis; delete result.__v;
    if (!fullIdentifiers) {
      result.imei1 = "••••" + result.imei1.slice(-4);
      if (result.imei2) result.imei2 = "••••" + result.imei2.slice(-4);
      result.serialNumber = "••••" + result.serialNumber.slice(-4);
    }
    const companion = result.companion || {};
    result.companion = { installationId: companion.installationId || null,
      enrolled: !!companion.enrolledAt && !companion.revokedAt, revoked: !!companion.revokedAt,
      enrolledAt: companion.enrolledAt || null, lastSyncAt: companion.lastSyncAt || null,
      lastHeartbeatAt: companion.lastHeartbeatAt || null };
    if (result.assignedStaff) {
      const staff = await this.connection.collection("users").findOne(
        { _id: new mongoose.Types.ObjectId(result.assignedStaff) },
        { projection: { name: 1, fullName: 1, role: 1 } });
      result.assignedStaff = staff ? JSON.parse(JSON.stringify(staff)) : null;
    }
    return result;
  }
  async register(body, actor) {
    const fields = v.registration(body);
    const registrationKey = `${actor}:${v.uuid(body.requestId)}`;
    const registrationDigest = v.hash(JSON.stringify({ ...fields, staffId: body.staffId || null }));
    const old = await this.Device.findOne({ registrationKey }).lean();
    if (old) {
      if (old.registrationDigest !== registrationDigest) v.fail("Registration request ID was already used with different details.", 409);
      return this.safe(old, true);
    }
    const device = await this.transaction(async (session) => {
      const staff = body.staffId ? await this.staff(body.staffId, session) : null;
      const [created] = await this.Device.create([{
        ...fields, deviceId: `SPDEV-${new Date().getUTCFullYear()}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
        registrationKey, registrationDigest, registeredBy: actor,
        ...(staff ? { assignedStaff: staff._id, status: "ASSIGNED" } : {}),
      }], { session });
      await this.audit(created._id, actor, "REGISTERED", "Company device registration", {}, session);
      if (staff) {
        await this.Assignment.create([{ device: created._id, staff: staff._id, assignedBy: actor, reason: "Initial registration assignment" }], { session });
        await this.audit(created._id, actor, "ASSIGNED", "Initial registration assignment", { staffId: String(staff._id) }, session);
      }
      return created.toObject();
    });
    return this.safe(device, true);
  }
  async get(deviceId, actor) {
    const device = await this.Device.findById(v.id(deviceId)).lean();
    if (!device) v.fail("Device not found.", 404);
    await this.audit(device._id, actor, "DETAILS_VIEWED", "Authorized registry access", {});
    return { device: await this.safe(device, true),
      assignments: await this.Assignment.find({ device: device._id }).sort({ startedAt: -1 }).limit(100).lean(),
      audit: await this.Audit.find({ device: device._id }).sort({ createdAt: -1, _id: -1 }).limit(50).lean() };
  }
  async mutate(deviceId, version, work) {
    const key = v.id(deviceId); v.expectedVersion(version);
    return this.transaction(async (session) => {
      const device = await this.Device.findById(key).session(session);
      if (!device) v.fail("Device not found.", 404);
      if (device.version !== version) v.fail("Device changed. Refresh before trying again.", 409, "DEVICE_VERSION_CONFLICT");
      await work(device, session);
      device.version += 1;
      await device.save({ session });
      return device.toObject();
    });
  }
  async endAssignment(device, actor, session) {
    await this.Assignment.updateMany({ device: device._id, endedAt: null },
      { $set: { endedAt: new Date(), endedBy: actor } }, { session });
    device.assignedStaff = null;
  }
  async assign(deviceId, body, actor) {
    const reason = v.reason(body.reason);
    const device = await this.mutate(deviceId, body.expectedVersion, async (device, session) => {
      if (!["AVAILABLE", "ASSIGNED"].includes(device.status)) v.fail("Only available or assigned devices can be assigned.", 409);
      const staff = await this.staff(body.staffId, session);
      if (String(device.assignedStaff) === String(staff._id)) v.fail("Device is already assigned to this staff member.", 409);
      await this.endAssignment(device, actor, session);
      await this.Assignment.create([{ device: device._id, staff: staff._id, assignedBy: actor, reason }], { session });
      device.assignedStaff = staff._id; device.status = "ASSIGNED";
      await this.audit(device._id, actor, "ASSIGNED", reason, { staffId: String(staff._id) }, session);
    });
    return this.safe(device, true);
  }
  async status(deviceId, body, actor) {
    const reason = v.reason(body.reason);
    if (!["AVAILABLE", "INACTIVE", "LOST_STOLEN", "RETIRED"].includes(body.status)) v.fail("Invalid device lifecycle status.");
    const device = await this.mutate(deviceId, body.expectedVersion, async (device, session) => {
      if (device.status === "RETIRED") v.fail("Retired devices cannot be reactivated.", 409);
      if (device.status === body.status) v.fail("Device already has this status.", 409);
      const previous = device.status;
      await this.endAssignment(device, actor, session);
      device.status = body.status;
      if (body.status !== "AVAILABLE") {
        device.companion.revokedAt = new Date();
        device.companion.tokenHash = undefined; device.companion.previousTokenHash = undefined;
        device.enrollment = undefined;
      }
      await this.audit(device._id, actor, "STATUS_CHANGED", reason, { previous, status: body.status }, session);
    });
    return this.safe(device, true);
  }
  async search(body) {
    const filter = {};
    for (const key of ["manufacturer", "status", "department", "model"]) {
      if (body[key]) filter[key] = v.text(body[key], key, 120);
    }
    if (body.staff) filter.assignedStaff = new mongoose.Types.ObjectId(v.id(body.staff));
    if (body.q) {
      const q = v.text(body.q, "search", 100);
      filter.$or = ["deviceId", "serialNumber", "imei1", "imei2"].map((key) => ({ [key]: { $regex: escapeRegex(q), $options: "i" } }));
    }
    const page = Math.max(1, Math.min(10000, Number.parseInt(body.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(body.limit, 10) || 20));
    const [devices, total] = await Promise.all([
      this.Device.find(filter).sort({ registeredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.Device.countDocuments(filter),
    ]);
    return { devices: await Promise.all(devices.map((d) => this.safe(d))), total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }
  async overview() {
    const entries = await this.Device.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const counts = Object.fromEntries(entries.map((e) => [e._id, e.count]));
    return { stats: { total: entries.reduce((n, e) => n + e.count, 0),
      active: (counts.AVAILABLE || 0) + (counts.ASSIGNED || 0), available: counts.AVAILABLE || 0,
      assigned: counts.ASSIGNED || 0, inactive: counts.INACTIVE || 0,
      lostStolen: counts.LOST_STOLEN || 0, retired: counts.RETIRED || 0 } };
  }
  async directory(query) {
    const q = query.q ? v.text(query.q, "staff search", 100) : "";
    const filter = { status: "ACTIVE", role: { $ne: "CUSTOMER" },
      $and: [{ $or: [{ isStaff: true }, { role: { $in: staffRoles } }] },
        ...(q ? [{ $or: [{ name: { $regex: escapeRegex(q), $options: "i" } }, { fullName: { $regex: escapeRegex(q), $options: "i" } }] }] : [])] };
    const users = this.connection.collection("users");
    return { staff: await users.find(filter, { projection: { name: 1, fullName: 1, role: 1, department: 1 } }).limit(100).toArray(),
      total: await users.countDocuments(filter) };
  }
  async history(deviceId, query) {
    const device = v.id(deviceId);
    if (!await this.Device.exists({ _id: device })) v.fail("Device not found.", 404);
    const page = Math.max(1, Math.min(10000, Number.parseInt(query.page, 10) || 1)), limit = 50;
    const [history, total] = await Promise.all([
      this.Audit.find({ device }).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      this.Audit.countDocuments({ device }),
    ]);
    return { history, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }
  async settings() {
    const last = await this.Audit.findOne({ action: "SETTINGS_UPDATED" }).sort({ settingsRevision: -1 }).lean();
    return last ? { ...last.settings, revision: last.settingsRevision } : {
      allowWallpaper: true, allowLauncher: true, approvedPackages: ["ng.servicepay.app", "com.android.settings"], revision: 0 };
  }
  async updateSettings(body, actor) {
    const settings = v.settings(body), reason = v.reason(body.reason);
    v.expectedVersion(body.revision);
    if ((await this.settings()).revision !== body.revision) v.fail("Settings changed; refresh first.", 409);
    const revision = body.revision + 1;
    await this.Audit.create({ actor: String(actor), action: "SETTINGS_UPDATED", reason, settingsRevision: revision, settings });
    return { ...settings, revision };
  }
  async reports(actor) {
    const data = await this.Device.find({}).select("deviceId manufacturer model department state status purchaseDate warrantyExpiry registeredAt").sort({ deviceId: 1 }).limit(10000).lean();
    if (await this.Device.countDocuments({}) > 10000) v.fail("Report exceeds 10,000 devices; use paginated search.", 413);
    await this.audit(null, actor, "REPORT_VIEWED", "Authorized inventory report", { rows: data.length });
    return { rows: data, totals: (await this.overview()).stats, generatedAt: new Date().toISOString() };
  }
}
module.exports = { DeviceRegistry };
