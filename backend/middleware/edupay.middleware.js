const { EduPaySchoolUser } = require("../models/edupaySchoolUser.model");
const School = require("../models/edupaySchool.model");
const { protect, adminOnly } = require("./auth.middleware");

const customer = [protect, (req, res, next) => {
  const role = String(req.user?.role || "").toUpperCase();
  if (["CUSTOMER", "USER", ""].includes(role) && req.user?.isStaff !== true) return next();
  return res.status(403).json({ success: false, message: "Customer access required." });
}];
const headOffice = [protect, adminOnly("HEAD_OFFICE")];
const school = [protect, async (req, res, next) => {
  try {
    const membership = await EduPaySchoolUser.findOne({ user: req.user._id, status: "ACTIVE" }).populate("school");
    if (!membership || !membership.school || membership.school.status !== "APPROVED" || !membership.school.active) return res.status(403).json({ success: false, message: "Approved EduPay school access required." });
    req.eduPaySchool = membership.school; req.eduPaySchoolUser = membership; return next();
  } catch (error) { return next(error); }
}];
module.exports = { customer, headOffice, school };