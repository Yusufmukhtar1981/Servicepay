const Duty = require("../models/edupayDutyAssignment.model");
const requireExplicitEduPayDuty = (permission) => async (req, res, next) => {
  try {
    if (!req.user?._id) return res.status(401).json({ success: false, message: "Unauthorized." });
    const duty = await Duty.findOne({ user: req.user._id }).sort({ version: -1 }).select("_id active permissions");
    if (!duty?.active || !duty.permissions.includes(permission)) return res.status(403).json({ success: false, code: "EDUPAY_DUTY_REQUIRED", message: `Explicit EduPay duty ${permission} is required.` });
    req.edupayDuty = duty;
    return next();
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to verify EduPay duty assignment." }); }
};
module.exports = { requireExplicitEduPayDuty };