const EduPaySchoolUser = require("../models/edupaySchoolUser.model");
const School = require("../models/edupaySchool.model");
const { protect, adminOnly } = require("./auth.middleware");

const customer = [protect, (req, res, next) => {
  const role = String(req.user?.role || "").toUpperCase();
  if (role === "CUSTOMER" && req.user?.isStaff !== true) return next();
  return res.status(403).json({ success: false, message: "Customer access required." });
}];
const headOffice = [protect, adminOnly("HEAD_OFFICE")];
const school = [protect, async (req, res, next) => {
  try {
    const requested = req.headers["x-edupay-school-id"] || req.query.schoolId || req.body?.schoolId;
    const memberships = await EduPaySchoolUser.find({ user: req.user._id, status: "ACTIVE" }).populate("school");
    const eligible = memberships.filter((row) => row.school && row.school.status === "APPROVED" && row.school.active);
    const membership = requested ? eligible.find((row) => String(row.school._id) === String(requested)) : (eligible.length === 1 ? eligible[0] : null);
    if (requested && !membership) return res.status(403).json({ success: false, message: "The requested school is not an active membership." });
    if (!membership && eligible.length > 1) return res.status(409).json({ success: false, code: "EDUPAY_SCHOOL_CONTEXT_REQUIRED", message: "Select an active EduPay school before continuing." });
    if (!membership || !membership.school) return res.status(403).json({ success: false, message: "Approved EduPay school access required." });
    req.eduPaySchool = membership.school; req.eduPaySchoolUser = membership; return next();
  } catch (error) { return next(error); }
}];
module.exports = { customer, headOffice, school };