const CustomerBeneficiary = require("../models/customerBeneficiary.model");

const normalizePhone = (value) => {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("234") && phone.length === 13) phone = `0${phone.slice(3)}`;
  return phone;
};

const customerId = (req) => req.user && (req.user._id || req.user.id);
const validPhone = (phone) => /^0\d{10}$/.test(phone);

exports.list = async (req, res) => {
  const filter = { customer: customerId(req) };
  const search = String(req.query.search || "").trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ name: new RegExp(escaped, "i") }, { phone: new RegExp(escaped) }];
  }
  const items = await CustomerBeneficiary.find(filter).sort({ name: 1, createdAt: -1 }).lean();
  return res.json({ success: true, beneficiaries: items });
};

exports.create = async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const name = String(req.body.name || "").trim();
  if (!validPhone(phone)) return res.status(400).json({ success: false, message: "Enter a valid Nigerian phone number." });
  if (!name) return res.status(400).json({ success: false, message: "A beneficiary name is required." });
  try {
    const serviceType = String(req.body.serviceType || "").toUpperCase();
    const update = { $set: { name, network: String(req.body.network || "").trim() } };
    if (["AIRTIME", "DATA"].includes(serviceType)) update.$addToSet = { serviceTypes: serviceType };
    const item = await CustomerBeneficiary.findOneAndUpdate(
      { customer: customerId(req), phone },
      update,
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ success: true, beneficiary: item });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "This phone number is already saved." });
    throw error;
  }
};

exports.update = async (req, res) => {
  const update = {};
  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ success: false, message: "A beneficiary name is required." });
    update.name = name;
  }
  if (req.body.network !== undefined) update.network = String(req.body.network).trim();
  const item = await CustomerBeneficiary.findOneAndUpdate(
    { _id: req.params.id, customer: customerId(req) }, { $set: update }, { new: true, runValidators: true }
  );
  if (!item) return res.status(404).json({ success: false, message: "Beneficiary not found." });
  return res.json({ success: true, beneficiary: item });
};

exports.remove = async (req, res) => {
  const item = await CustomerBeneficiary.findOneAndDelete({ _id: req.params.id, customer: customerId(req) });
  if (!item) return res.status(404).json({ success: false, message: "Beneficiary not found." });
  return res.json({ success: true, message: "Beneficiary deleted." });
};

exports.normalizePhone = normalizePhone;