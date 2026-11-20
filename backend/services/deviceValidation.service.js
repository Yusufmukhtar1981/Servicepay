const crypto = require("node:crypto");
const manufacturers = ["TECNO", "Infinix", "Redmi", "Samsung", "Other"];
const statuses = ["AVAILABLE", "ASSIGNED", "INACTIVE", "LOST_STOLEN", "RETIRED"];
class DeviceError extends Error {
  constructor(message, status = 400, code = "DEVICE_VALIDATION") { super(message); this.status = status; this.code = code; }
}
const fail = (message, status, code) => { throw new DeviceError(message, status, code); };
const text = (value, name, max = 120, optional = false) => {
  if (optional && (value === undefined || value === "" || value === null)) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x1f]/.test(value)) fail(`Invalid ${name}.`);
  return value.trim();
};
const id = (value, name = "record ID") => /^[a-f\d]{24}$/i.test(String(value || ""))
  ? String(value) : fail(`Invalid ${name}.`);
const uuid = (value) => /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value || "")
  ? value.toLowerCase() : fail("A valid random UUID is required.");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const reason = (value) => text(value, "reason", 500);
const expectedVersion = (value) => Number.isSafeInteger(value) && value >= 0 ? value : fail("Device version is required.");
function imei(value) {
  const normalized = text(value, "IMEI", 15);
  if (!/^\d{15}$/.test(normalized) || /^(\d)\1+$/.test(normalized)) fail("IMEI must contain 15 valid digits.");
  // IMEIs use the Luhn check digit; never derive or guess an identifier.
  let sum = 0;
  for (let i = 0; i < 15; i++) { let n = +normalized[i]; if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; }
  if (sum % 10) fail("IMEI check digit is invalid.");
  return normalized;
}
function date(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) ||
      !Number.isFinite(Date.parse(value))) fail(`Invalid ${field}.`);
  const parsed = new Date(value);
  if (parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) fail(`Invalid ${field}.`);
  return parsed;
}
function registration(body) {
  const manufacturer = manufacturers.find((m) => m.toLowerCase() === String(body.manufacturer).toLowerCase());
  if (!manufacturer) fail("Unsupported manufacturer.");
  const first = imei(body.imei1), second = body.imei2 ? imei(body.imei2) : undefined;
  if (second === first) fail("The two IMEI slots must differ.");
  const price = body.purchasePrice;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(Math.round(price * 100)) ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) fail("Purchase price must be a non-negative amount with at most two decimals.");
  const purchaseDate = date(body.purchaseDate, "purchase date"), warrantyExpiry = date(body.warrantyExpiry, "warranty expiry");
  if (purchaseDate > new Date() || warrantyExpiry < purchaseDate) fail("Purchase/warranty dates are inconsistent.");
  const serialNumber = text(body.serialNumber, "serial number", 100).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]*$/.test(serialNumber)) fail("Invalid serial number.");
  return { manufacturer, model: text(body.model, "model"), imei1: first,
    ...(second ? { imei2: second } : {}), imeis: second ? [first, second] : [first],
    serialNumber, androidVersion: text(body.androidVersion, "Android version", 40),
    purchaseDate, purchasePrice: price, warrantyExpiry,
    department: text(body.department, "department", 100), state: text(body.state, "state", 100) };
}
function settings(body) {
  if (typeof body.allowWallpaper !== "boolean" || typeof body.allowLauncher !== "boolean") fail("Branding switches must be boolean.");
  if (!Array.isArray(body.approvedPackages) || body.approvedPackages.length > 30 ||
      body.approvedPackages.some((p) => typeof p !== "string" || p.length > 150 || !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(p))) fail("Invalid approved package list.");
  return { allowWallpaper: body.allowWallpaper, allowLauncher: body.allowLauncher,
    approvedPackages: [...new Set(body.approvedPackages)].sort() };
}
function reported(body) {
  const allowed = ["installationId", "manufacturer", "model", "androidVersion", "appVersion"];
  if (!body || Object.keys(body).some((key) => !allowed.includes(key))) fail("Device sync cannot change registry ownership, status or identifiers.");
  return Object.fromEntries(["manufacturer", "model", "androidVersion", "appVersion"]
    .filter((k) => body[k] !== undefined).map((k) => [k, text(body[k], k, 100)]));
}
module.exports = { DeviceError, fail, text, id, uuid, hash, reason, expectedVersion, imei, date, registration, settings, reported, manufacturers, statuses };
