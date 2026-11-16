const crypto = require("crypto");

const PACKAGE_ID = "ng.servicepay.app";
const PLAY_URL = `https://play.google.com/store/apps/details?id=${PACKAGE_ID}`;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (value, max, name) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw fail(`A valid ${name} is required.`);
  }
  return value.trim();
};
function minor(value, name = "amountMinor", allowZero = false) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 1000000000) {
    throw fail(`${name} must be an integer in kobo within the supported range.`);
  }
  return value;
}
function creditPayload(body, actorId, key) {
  const requestKey = text(key, 128, "idempotency key");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestKey)) throw fail("Invalid idempotency key.");
  return {
    _id: crypto.createHash("sha256").update(`${actorId}:${requestKey}`).digest("hex"),
    amountMinor: minor(body.amountMinor),
    description: text(body.description, 500, "description"),
  };
}
function isConfiguredAdmin(req, email = process.env.SERVICEPAY_PRODUCTION_ADMIN_EMAIL) {
  if (req.staffAccess?.isHeadOffice !== true) return false;
  // Preserve the existing configured administrator. Explicit financial authority
  // is an additive path, never implied by Head Office's operational wildcard.
  const configured = Boolean(email?.trim()) &&
    String(req.user?.email || "").trim().toLowerCase() === email.trim().toLowerCase();
  const explicitlyAuthorized = req.user?.role === "HEAD_OFFICE" &&
    req.staffAccess?.scope?.type === "GLOBAL" &&
    req.staffRole?.status === "ACTIVE" &&
    Array.isArray(req.staffRole?.permissions) &&
    req.staffRole.permissions.includes(
      require("../config/staffPermissions").STAFF_PERMISSIONS.CASHBACK_CREDIT,
    );
  return configured || explicitlyAuthorized;
}
function dates(start, end) {
  const parse = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fail("Use YYYY-MM-DD dates.");
    const d = new Date(`${value}T00:00:00+01:00`);
    if (!Number.isFinite(d.getTime()) || new Date(d.getTime() + 3600000).toISOString().slice(0, 10) !== value) {
      throw fail("Invalid calendar date.");
    }
    return d;
  };
  const from = parse(start), last = parse(end);
  const to = new Date(last.getTime() + 86400000);
  if (from >= to || to - from > 366 * 86400000) throw fail("Choose an ordered date range of at most 366 days.");
  if (last > new Date()) throw fail("The end date cannot be in the future.");
  return { from, to };
}
function yearMonth(now = new Date()) {
  const local = new Date(now.getTime() + 3600000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth() + 1;
  return {
    month: new Date(`${y}-${String(m).padStart(2, "0")}-01T00:00:00+01:00`),
    year: new Date(`${y}-01-01T00:00:00+01:00`),
  };
}
function updatePayload(body) {
  for (const key of ["active", "forceUpdate"]) {
    if (typeof body[key] !== "boolean") throw fail(`${key} must be true or false.`);
  }
  const latestVersionCode = minor(body.latestVersionCode, "latestVersionCode");
  const minimumVersionCode = minor(body.minimumVersionCode, "minimumVersionCode", true);
  if (minimumVersionCode > latestVersionCode) throw fail("Minimum versionCode cannot exceed the latest versionCode.");
  const latestVersion = text(body.latestVersion, 40, "latest version");
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(latestVersion)) throw fail("Invalid version name.");
  if (body.playStoreUrl && body.playStoreUrl !== PLAY_URL) throw fail("Use the existing ServicePay Google Play listing.");
  return {
    active: body.active, forceUpdate: body.forceUpdate, latestVersion, latestVersionCode,
    minimumVersionCode, releaseTitle: text(body.releaseTitle, 160, "release title"),
    releaseNotes: text(body.releaseNotes, 4000, "release notes"), playStoreUrl: PLAY_URL,
  };
}
function publicUpdate(settings) {
  const v = settings?.appVersion || {};
  // Legacy version-name-only settings cannot accidentally activate a lockout.
  return {
    active: v.notificationActive === true && Number.isSafeInteger(v.latestVersionCode) && v.latestVersionCode > 0,
    latestVersion: v.latestVersion || "", latestVersionCode: v.latestVersionCode || 0,
    minimumVersionCode: v.minimumVersionCode || 0, forceUpdate: v.forceUpdate === true,
    releaseTitle: v.releaseTitle || "ServicePay update", releaseNotes: v.releaseNotes || v.updateMessage || "",
    playStoreUrl: PLAY_URL,
  };
}
const csvCell = value => {
  let s = String(value ?? "").replace(/[\r\n]/g, " ");
  if (/^[\s]*[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};
module.exports = { PACKAGE_ID, PLAY_URL, fail, minor, creditPayload, isConfiguredAdmin,
  dates, yearMonth, updatePayload, publicUpdate, csvCell };
