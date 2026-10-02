"use strict";
const mongoose = require("mongoose");
const User = require("../models/user.model");
const LegacyBeneficiary = require("../models/customerBeneficiary.model");
const { normalizeNigerianMsisdn } = require("../services/nigerianMsisdn.service");
const MAX_NUMBERS = 200;
const normalizePhone = value => normalizeNigerianMsisdn(value) || "";
const customerId = req => req.user?._id || req.user?.id;
const ownerFilter = req => ({ _id: customerId(req), role: "CUSTOMER", status: "ACTIVE" });
const view = row => ({
  _id: String(row._id), phone: row.phone, normalizedPhone: row.normalizedPhone || row.phone,
  name: row.name || "", createdAt: row.createdAt, updatedAt: row.updatedAt,
});
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const nickname = body => {
  if (body.name !== undefined && typeof body.name !== "string") return null;
  const name = (body.name || "").trim();
  return name.length <= 80 ? name : null;
};
const validId = id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);

// Import existing rows without creating a new collection. The single-document
// conditional push enforces uniqueness even during parallel saves/migrations.
async function readOwner(req) {
  const owner = await User.findOne(ownerFilter(req)).select("+savedTelecomBeneficiaries +savedTelecomLegacyDeleted").lean();
  if (!owner) return null;
  const legacy = await LegacyBeneficiary.find({ customer: owner._id }).limit(MAX_NUMBERS).lean();
  for (const row of legacy) {
    const phone = normalizePhone(row.phone);
    if (!phone || owner.savedTelecomBeneficiaries?.some(b => b.normalizedPhone === phone) ||
        owner.savedTelecomLegacyDeleted?.some(id => String(id) === String(row._id))) continue;
    await User.updateOne({
      ...ownerFilter(req), "savedTelecomBeneficiaries.normalizedPhone": { $ne: phone },
      savedTelecomLegacyDeleted: { $ne: row._id },
      $expr: { $lt: [{ $size: { $ifNull: ["$savedTelecomBeneficiaries", []] } }, MAX_NUMBERS] },
    }, { $push: { savedTelecomBeneficiaries: {
      _id: row._id, phone, normalizedPhone: phone, name: String(row.name || "").slice(0, 80),
      createdAt: row.createdAt || new Date(), updatedAt: row.updatedAt || new Date(),
    } } });
  }
  return legacy.length
    ? User.findOne(ownerFilter(req)).select("+savedTelecomBeneficiaries").lean()
    : owner;
}

exports.list = async (req, res) => {
  const owner = await readOwner(req);
  if (!owner) return fail(res, 403, "Saved numbers are available to active customers only.");
  const search = String(req.query?.search || "").trim().toLowerCase().slice(0, 100);
  const items = (owner.savedTelecomBeneficiaries || []).map(view)
    .filter(b => !search || b.name.toLowerCase().includes(search) || b.phone.includes(search))
    .sort((a, b) => a.name.localeCompare(b.name) || a.phone.localeCompare(b.phone));
  return res.json({ success: true, beneficiaries: items });
};

exports.create = async (req, res) => {
  const phone = normalizePhone(req.body?.phone), name = nickname(req.body || {});
  if (!phone) return fail(res, 400, "Enter a valid Nigerian phone number.");
  if (name === null) return fail(res, 400, "Use a name of no more than 80 characters.");
  if (!await readOwner(req)) return fail(res, 403, "Saved numbers are available to active customers only.");
  const now = new Date();
  const item = { _id: new mongoose.Types.ObjectId(), phone, normalizedPhone: phone, name, createdAt: now, updatedAt: now };
  const owner = await User.findOneAndUpdate({
    ...ownerFilter(req), "savedTelecomBeneficiaries.normalizedPhone": { $ne: phone },
    $expr: { $lt: [{ $size: { $ifNull: ["$savedTelecomBeneficiaries", []] } }, MAX_NUMBERS] },
  }, { $push: { savedTelecomBeneficiaries: item } },
  { returnDocument: "after", runValidators: true }).select("+savedTelecomBeneficiaries").lean();
  if (owner) return res.status(201).json({ success: true, message: "Number saved.", beneficiary: view(item) });
  const current = await User.findOne(ownerFilter(req)).select("+savedTelecomBeneficiaries").lean();
  const duplicate = current?.savedTelecomBeneficiaries?.find(b => b.normalizedPhone === phone);
  if (duplicate) return res.json({ success: true, message: "This number is already saved.", beneficiary: view(duplicate) });
  return fail(res, 409, "Saved-number limit reached. Delete an unused number first.");
};

exports.update = async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, "Beneficiary not found.");
  const name = nickname(req.body || {});
  if (name === null || req.body?.name === undefined) return fail(res, 400, "Use a name of no more than 80 characters.");
  if (!await readOwner(req)) return fail(res, 403, "Saved numbers are available to active customers only.");
  const owner = await User.findOneAndUpdate({
    ...ownerFilter(req), "savedTelecomBeneficiaries._id": req.params.id,
  }, { $set: { "savedTelecomBeneficiaries.$.name": name, "savedTelecomBeneficiaries.$.updatedAt": new Date() } },
  { returnDocument: "after", runValidators: true }).select("+savedTelecomBeneficiaries").lean();
  if (!owner) return fail(res, 404, "Beneficiary not found.");
  // Keep legacy backing rows in sync so future list imports cannot resurrect
  // an older nickname after deletion or replacement.
  await LegacyBeneficiary.updateOne({ _id: req.params.id, customer: customerId(req) }, { $set: { name } });
  return res.json({ success: true, beneficiary: view(owner.savedTelecomBeneficiaries.find(b => String(b._id) === req.params.id)) });
};

exports.remove = async (req, res) => {
  if (!validId(req.params.id)) return fail(res, 404, "Beneficiary not found.");
  if (!await readOwner(req)) return fail(res, 403, "Saved numbers are available to active customers only.");
  // Delete a legacy row first so subsequent reads cannot re-import it.
  await LegacyBeneficiary.deleteOne({ _id: req.params.id, customer: customerId(req) });
  const r = await User.updateOne({
    ...ownerFilter(req), "savedTelecomBeneficiaries._id": req.params.id,
  }, { $pull: { savedTelecomBeneficiaries: { _id: req.params.id } },
    $addToSet: { savedTelecomLegacyDeleted: new mongoose.Types.ObjectId(req.params.id) } });
  if (!r.modifiedCount) return fail(res, 404, "Beneficiary not found.");
  return res.json({ success: true, message: "Beneficiary deleted." });
};
exports.normalizePhone = normalizePhone;