const crypto = require("node:crypto");
const { DeviceRegistry } = require("./deviceRegistry.service");
const v = require("./deviceValidation.service");
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const token = (value) => typeof value === "string" && TOKEN.test(value)
  ? value : v.fail("Invalid device credential.", 401, "DEVICE_AUTH_REQUIRED");
const operational = (device) => ["AVAILABLE", "ASSIGNED"].includes(device.status);
class DeviceCompanion extends DeviceRegistry {
  async issueEnrollment(deviceId, body, actor) {
    const raw = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const device = await this.mutate(deviceId, body.expectedVersion, async (device, session) => {
      if (!operational(device)) v.fail("This device is not available for enrollment.", 409);
      if (device.companion?.enrolledAt && !device.companion?.revokedAt) v.fail("Revoke the existing companion before issuing another enrollment.", 409);
      device.enrollment = { hash: v.hash(raw), expiresAt };
      await this.audit(device._id, actor, "ENROLLMENT_ISSUED", "Single-use five-minute enrollment", {}, session);
    });
    return { enrollmentToken: raw, expiresAt, deviceId: device.deviceId, device: await this.safe(device, true) };
  }
  async revoke(deviceId, body, actor) {
    const reason = v.reason(body.reason);
    const device = await this.mutate(deviceId, body.expectedVersion, async (device, session) => {
      device.companion.revokedAt = new Date();
      device.companion.tokenHash = undefined;
      device.companion.previousTokenHash = undefined;
      device.enrollment = undefined;
      await this.audit(device._id, actor, "COMPANION_REVOKED", reason, {}, session);
    });
    return { device: await this.safe(device, true) };
  }
  async enroll(body) {
    const enrollmentHash = v.hash(token(body.enrollmentToken));
    const installationId = v.uuid(body.installationId);
    const deviceTokenHash = v.hash(token(body.deviceToken));
    if (body.deviceToken === body.enrollmentToken) v.fail("Enrollment and device credentials must be different.");
    const fields = v.reported(Object.fromEntries(Object.entries(body)
      .filter(([key]) => !["enrollmentToken", "deviceToken"].includes(key))));
    const device = await this.transaction(async (session) => {
      const found = await this.Device.findOne({ "enrollment.hash": enrollmentHash })
        .select("+enrollment.hash +companion.tokenHash").session(session);
      if (!found || !operational(found) || found.enrollment.expiresAt <= new Date()) v.fail("Enrollment is invalid or expired.", 401, "DEVICE_ENROLLMENT_EXPIRED");
      if (found.enrollment.consumedAt) {
        // Only the byte-equivalent installation/credential can acknowledge a lost
        // response. A replay can never enroll another device or issue credentials.
        if (found.companion.installationId !== installationId ||
            found.companion.tokenHash !== deviceTokenHash || found.companion.revokedAt) {
          v.fail("Enrollment was already consumed.", 409, "DEVICE_ENROLLMENT_USED");
        }
        return found.toObject();
      }
      found.enrollment.consumedAt = new Date();
      found.companion = { installationId, tokenHash: deviceTokenHash,
        enrolledAt: new Date(), lastSyncAt: new Date(), reported: fields };
      found.version += 1;
      await found.save({ session });
      await this.audit(found._id, `device:${found.deviceId}`, "COMPANION_ENROLLED",
        "Staff-authorized single-use enrollment", {}, session);
      return found.toObject();
    });
    return this.configuration(device);
  }
  async authenticate(raw, installationId) {
    const credentialHash = v.hash(token(raw));
    v.uuid(installationId);
    const now = new Date();
    const found = await this.Device.findOne({ "companion.installationId": installationId,
      "companion.revokedAt": null, status: { $in: ["AVAILABLE", "ASSIGNED"] },
      $or: [{ "companion.tokenHash": credentialHash },
        { "companion.previousTokenHash": credentialHash, "companion.previousTokenExpiresAt": { $gt: now } }],
    }).select("+companion.tokenHash +companion.previousTokenHash").lean();
    if (!found) v.fail("Device authorization is invalid or revoked.", 401, "DEVICE_AUTH_REVOKED");
    const expiredWindow = !found.companion.rateWindow || now - found.companion.rateWindow >= 60_000;
    const rateFilter = { _id: found._id, "companion.revokedAt": null,
      status: { $in: ["AVAILABLE", "ASSIGNED"] },
      "companion.installationId": installationId, "companion.tokenHash": found.companion.tokenHash };
    const updated = await this.Device.findOneAndUpdate({
      ...rateFilter, ...(expiredWindow
        ? { "companion.rateWindow": found.companion.rateWindow || null }
        : { "companion.rateWindow": found.companion.rateWindow, "companion.rateCount": { $lt: 30 } }),
    }, expiredWindow ? { $set: { "companion.rateWindow": now, "companion.rateCount": 1 } }
      : { $inc: { "companion.rateCount": 1 } }, { new: true }).lean();
    if (!updated) v.fail("Device request limit reached or authorization changed. Retry later.", 429, "DEVICE_RATE_LIMIT");
    return { device: { ...updated, companion: { ...updated.companion,
      tokenHash: found.companion.tokenHash } }, presentedHash: credentialHash };
  }
  async configuration(device) {
    let assignedStaff = null;
    if (device.assignedStaff) {
      const staff = await this.connection.collection("users").findOne({ _id: device.assignedStaff },
        { projection: { name: 1, fullName: 1 } });
      if (staff) assignedStaff = { name: staff.name || staff.fullName || "Assigned staff" };
    }
    return { deviceId: device.deviceId, manufacturer: device.manufacturer, model: device.model,
      androidVersion: device.androidVersion, status: device.status, department: device.department,
      assignedStaff, lastSyncAt: device.companion?.lastSyncAt || null,
      settings: await this.settings(), company: "YUMPAY GLOBAL TECH LTD.", ownership: "SERVICEPAY PROPERTY" };
  }
  async sync(auth, body, heartbeat = false) {
    const reported = v.reported(body);
    if (body.installationId && body.installationId !== auth.device.companion.installationId) v.fail("Installation identity does not match.", 403);
    const device = await this.transaction(async (session) => {
      const update = { [heartbeat ? "companion.lastHeartbeatAt" : "companion.lastSyncAt"]: new Date() };
      if (!heartbeat) update["companion.reported"] = reported;
      const current = await this.Device.findOneAndUpdate({
        _id: auth.device._id, "companion.revokedAt": null,
        "companion.tokenHash": auth.device.companion?.tokenHash || undefined,
        "companion.installationId": auth.device.companion.installationId,
        status: { $in: ["AVAILABLE", "ASSIGNED"] },
      }, { $set: update }, { session, new: true }).lean();
      if (!current) v.fail("Device authorization changed.", 401);
      await this.audit(current._id, `device:${current.deviceId}`,
        heartbeat ? "HEARTBEAT" : "SYNCED", "Authenticated companion request", {}, session);
      return current;
    });
    return this.configuration(device);
  }
  async rotate(auth, body) {
    const nextHash = v.hash(token(body.deviceToken));
    if (nextHash === auth.presentedHash) v.fail("Provide a new credential.");
    const updated = await this.transaction(async (session) => {
      const current = await this.Device.findById(auth.device._id)
        .select("+companion.tokenHash +companion.previousTokenHash").session(session);
      if (!current || !operational(current) || current.companion.revokedAt) v.fail("Device authorization changed.", 401);
      if (current.companion.tokenHash === nextHash &&
          current.companion.previousTokenHash === auth.presentedHash &&
          current.companion.previousTokenExpiresAt > new Date()) return current.toObject();
      if (current.companion.tokenHash !== auth.presentedHash) v.fail("Only the current device credential can rotate.", 401);
      current.companion.previousTokenHash = current.companion.tokenHash;
      current.companion.previousTokenExpiresAt = new Date(Date.now() + 120_000);
      current.companion.tokenHash = nextHash;
      current.version += 1;
      await current.save({ session });
      await this.audit(current._id, `device:${current.deviceId}`, "CREDENTIAL_ROTATED", "Device credential rotation", {}, session);
      return current.toObject();
    });
    return { rotated: true, deviceId: updated.deviceId };
  }
}
module.exports = { DeviceCompanion };
