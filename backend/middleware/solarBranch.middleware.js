const Branch = require("../models/branch.model");

// Solar is an explicitly enabled branch module.  The authenticated assignment,
// not a request value, is the only source of the branch used by controllers.
const requireSolarBranchModule = async (req, res, next) => {
  try {
    const role = String(req.user?.role || "").trim().toUpperCase();
    // These legacy administrator identities have always been global. Keep
    // that contract when this middleware is reused without staffAccess.
    if (req.staffAccess?.isHeadOffice || ["HEAD_OFFICE", "ADMIN", "SUPER_ADMIN"].includes(role)) {
      return next();
    }
    const branchId = req.staffAccess?.scope?.type === "BRANCH"
      ? req.staffAccess.scope.branchId
      : req.user?.branchId;
    if (!branchId) {
      // Pre-branch Solar Officer accounts retain access to their legacy,
      // null-branch assignments. Branch-assigned officers are always checked.
      if (role === "SOLAR_OFFICER") return next();
      return res.status(403).json({ success: false, code: "BRANCH_SCOPE_DENIED", message: "An active Solar branch assignment is required." });
    }
    const branch = req.branchScope || await Branch.findById(branchId)
      .select("status assignedModules").lean();
    if (!branch || branch.status !== "ACTIVE") {
      return res.status(403).json({ success: false, code: "BRANCH_INACTIVE", message: "Your assigned branch is not active." });
    }
    if (!(branch.assignedModules || []).map((item) => String(item).toUpperCase()).includes("SOLAR")) {
      return res.status(403).json({ success: false, code: "SOLAR_MODULE_NOT_ASSIGNED", message: "Solar is not assigned to your branch." });
    }
    req.branchScope = branch;
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to verify Solar branch access." });
  }
};

module.exports = { requireSolarBranchModule };