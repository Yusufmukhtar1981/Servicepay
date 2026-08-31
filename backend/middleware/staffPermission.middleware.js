const Role = require("../models/role.model");
const User = require("../models/user.model");
const {
  STAFF_PERMISSIONS,
  FULL_ACCESS_ROLE_NAMES,
  canonicalRoleName,
  directRolePermissions,
  normalizeStaffPermission,
  scopeForRole,
} = require("../config/staffPermissions");

const normalizePermissionList = (permissions) => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return [
    ...new Set(
      permissions
        .map((permission) => normalizeStaffPermission(permission))
        .filter(Boolean)
    ),
  ];
};

const configuredRoleScope = (staffRole, user) => {
  const type = String(staffRole?.scopeType || "GLOBAL").trim().toUpperCase();
  if (type === "GLOBAL") return { type: "GLOBAL" };
  if (type === "ZONE") return { type, zone: user.zone || null };
  if (type === "STATE") {
    return { type, zone: user.zone || null, state: user.state || null };
  }
  if (type === "BRANCH") {
    return { type, branchId: user.branchId || null };
  }
  if (type === "BUSINESS_PARTNER") {
    return {
      type,
      businessPartnerId: user.businessPartnerProfile || user.businessPartnerId || null,
    };
  }
  return { type: "SELF", userId: user._id || user.id || null };
};

const loadStaffRole = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const rawRole = String(
      req.user.role || ""
    )
      .trim()
      .toUpperCase();
    const role = canonicalRoleName(rawRole);

    /*
     * HEAD_OFFICE always has full access.
     */
    if (FULL_ACCESS_ROLE_NAMES.includes(rawRole) || role === "HEAD_OFFICE") {
      req.staffAccess = {
        isHeadOffice: true,
        roleName: "HEAD_OFFICE",
        sourceRole: rawRole,
        department: "ADMINISTRATION",
        permissions: ["*"],
        scope: { type: "GLOBAL" },
        hierarchyLevel: 100,
      };

      return next();
    }

    if (directRolePermissions[role]) {
      const rolePermissions = role === "BRANCH_MANAGER" &&
        Array.isArray(req.user.branchManagerPermissions)
        ? normalizePermissionList(req.user.branchManagerPermissions)
            .filter((permission) => directRolePermissions.BRANCH_MANAGER.includes(permission))
        : [...directRolePermissions[role]];
      req.staffAccess = {
        isHeadOffice: false,
        roleName: role,
        sourceRole: rawRole,
        department: req.user.department || "OPERATIONS",
        permissions: rolePermissions,
        scope: scopeForRole(role, req.user),
        hierarchyLevel: role === "ZONAL_MANAGER" ? 50 : role === "BRANCH_MANAGER" ? 20 : 40,
      };
      return next();
    }

    if (role !== "STAFF" || req.user.isStaff !== true) {
      return res.status(403).json({
        success: false,
        message:
          "This endpoint is available to ServicePay staff only.",
      });
    }

    if (!req.user.staffRoleId) {
      return res.status(403).json({
        success: false,
        message:
          "No staff role has been assigned to this account.",
      });
    }

    const staffRole = await Role.findOne({
      _id: req.user.staffRoleId,
      status: "ACTIVE",
    }).lean();

    if (!staffRole) {
      return res.status(403).json({
        success: false,
        message:
          "The assigned staff role is unavailable or inactive.",
      });
    }

    req.staffRole = staffRole;

    req.staffAccess = {
      isHeadOffice: false,
      roleId: staffRole._id,
      roleName: staffRole.name,
      displayName: staffRole.displayName,
      department: staffRole.department,
      permissions: normalizePermissionList(
        staffRole.permissions
      ),
      scope: configuredRoleScope(staffRole, req.user),
      hierarchyLevel: Number(staffRole.hierarchyLevel || 20),
    };

    return next();
  } catch (error) {
    console.error(
      "Load staff role error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify staff permissions.",
    });
  }
};

const requirePermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.staffAccess) {
        return res.status(500).json({
          success: false,
          message: "Staff permission context was not loaded.",
        });
      }

      if (req.staffAccess.isHeadOffice) {
        return next();
      }

      const needed = normalizeStaffPermission(permission);

      if (!needed) {
        return res.status(500).json({
          success: false,
          message: "Required permission was not configured.",
        });
      }

      const granted = new Set(
        normalizePermissionList(
          req.staffAccess.permissions || []
        )
      );

      if (!granted.has(needed)) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to perform this action.",
          requiredPermission: needed,
        });
      }

      return next();
    } catch (error) {
      console.error("REQUIRE PERMISSION ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to verify staff permission.",
      });
    }
  };
};

const requireAnyPermission = (...permissions) => {
  const needed = permissions
    .flat()
    .map((value) => normalizeStaffPermission(value))
    .filter(Boolean);

  return (req, res, next) => {
    try {
      if (!req.staffAccess) {
        return res.status(500).json({
          success: false,
          message: "Staff permission context was not loaded.",
        });
      }

      if (req.staffAccess.isHeadOffice) {
        return next();
      }

      if (needed.length == 0) {
        return res.status(500).json({
          success: false,
          message: "Required permission was not configured.",
        });
      }

      const granted = new Set(
        normalizePermissionList(
          req.staffAccess.permissions || []
        )
      );

      const allowed = needed.some(
        (permission) => granted.has(permission)
      );

      if (!allowed) {
        return res.status(403).json({
          success: false,
          message:
            "You do not have permission to perform this action.",
          requiredAnyPermission: needed,
        });
      }

      return next();
    } catch (error) {
      console.error("REQUIRE ANY PERMISSION ERROR:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to verify staff permission.",
      });
    }
  };
};

const hasPermission = (staffAccess, permission) => {
  if (!staffAccess) return false;
  if (staffAccess.isHeadOffice || staffAccess.permissions?.includes("*")) return true;
  const normalized = normalizeStaffPermission(permission);
  return Boolean(
    normalized && normalizePermissionList(staffAccess.permissions).includes(normalized)
  );
};

const scopeFilterFor = (
  staffAccess,
  {
    zoneField = "zone",
    stateField = "state",
    businessPartnerField = "businessPartnerId",
    branchField = "branchId",
    userField = "_id",
  } = {}
) => {
  const scope = staffAccess?.scope || { type: "SELF" };
  if (scope.type === "GLOBAL") return {};
  if (scope.type === "ZONE") return scope.zone ? { [zoneField]: scope.zone } : { _id: null };
  if (scope.type === "STATE") {
    if (!scope.state) return { _id: null };
    const filter = { [stateField]: scope.state };
    if (scope.zone) filter[zoneField] = scope.zone;
    return filter;
  }
  if (scope.type === "BUSINESS_PARTNER") {
    return scope.businessPartnerId ? { [businessPartnerField]: scope.businessPartnerId } : { _id: null };
  }
  if (scope.type === "BRANCH") return scope.branchId ? { [branchField]: scope.branchId } : { _id: null };
  return scope.userId ? { [userField]: scope.userId } : { _id: null };
};

const isUserWithinScope = (staffAccess, targetUser) => {
  const scope = staffAccess?.scope || { type: "SELF" };
  if (scope.type === "GLOBAL") return true;
  if (!targetUser) return false;
  if (scope.type === "ZONE") return Boolean(scope.zone && targetUser.zone === scope.zone);
  if (scope.type === "STATE") {
    return Boolean(
      scope.state &&
        targetUser.state === scope.state &&
        (!scope.zone || targetUser.zone === scope.zone)
    );
  }
  if (scope.type === "BUSINESS_PARTNER") {
    const partnerId = targetUser.businessPartnerProfile || targetUser.businessPartnerId;
    return Boolean(
      scope.businessPartnerId &&
        partnerId &&
        String(partnerId) === String(scope.businessPartnerId)
    );
  }
  if (scope.type === "BRANCH") {
    return Boolean(scope.branchId && targetUser.branchId &&
      String(targetUser.branchId) === String(scope.branchId));
  }
  return Boolean(
    scope.userId && String(targetUser._id || targetUser.id) === String(scope.userId)
  );
};

const requireTargetUserScope = (
  parameter = "id",
  select = "_id zone state businessPartnerProfile businessPartnerId"
) => async (req, res, next) => {
  try {
    const targetId = req.params?.[parameter];
    if (!targetId) {
      return res.status(400).json({ success: false, message: "Target user ID is required." });
    }
    const targetUser = await User.findById(targetId).select(select).lean();
    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }
    if (!isUserWithinScope(req.staffAccess, targetUser)) {
      return res.status(403).json({
        success: false,
        code: "DATA_SCOPE_DENIED",
        message: "This record is outside your authorized data scope.",
      });
    }
    req.scopedTargetUser = targetUser;
    return next();
  } catch (error) {
    console.error("Target user scope error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to verify data scope.",
    });
  }
};

// Branch routes use the role scope as the authority, never a body/query value.
// This also detects stale assignments when a role or user was changed mid-session.
const enforceActiveBranchScope = async (req, res, next) => {
  try {
    if (req.staffAccess?.isHeadOffice) return next();
    const scope = req.staffAccess?.scope;
    const scopeBranchId = scope?.type === "BRANCH" ? scope.branchId : null;
    if (!scopeBranchId || !req.user?.branchId ||
      String(scopeBranchId) !== String(req.user.branchId)) {
      return res.status(403).json({ success: false, code: "BRANCH_SCOPE_DENIED", message: "A valid assigned branch scope is required." });
    }
    const Branch = require("../models/branch.model");
    const branch = await Branch.findById(scopeBranchId).select("status assignedModules managerId").lean();
    if (!branch || branch.status !== "ACTIVE") {
      return res.status(403).json({ success: false, code: "BRANCH_INACTIVE", message: "Your assigned branch is not active." });
    }
    req.branchScope = branch;
    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: "Unable to verify branch access." });
  }
};

// A branch assignment alone is not authorization to operate every product.
// Route modules use this after enforceActiveBranchScope so the branch is both
// active and explicitly provisioned for the requested module.
const requireAssignedBranchModule = (moduleName) => (req, res, next) => {
  if (req.staffAccess?.isHeadOffice) return next();
  const assigned = (req.branchScope?.assignedModules || []).map((value) =>
    String(value || "").trim().toUpperCase()
  );
  if (!assigned.includes(String(moduleName || "").trim().toUpperCase())) {
    return res.status(403).json({
      success: false,
      code: "BRANCH_MODULE_DENIED",
      message: "Your assigned branch is not enabled for this module.",
    });
  }
  return next();
};

module.exports = {
  STAFF_PERMISSIONS,
  loadStaffRole,
  requirePermission,
  requireAnyPermission,
  hasPermission,
  scopeFilterFor,
  isUserWithinScope,
  requireTargetUserScope,
  enforceActiveBranchScope,
  requireAssignedBranchModule,
};
