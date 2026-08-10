const Role = require("../models/role.model");

const normalizePermissionList = (permissions) => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  return permissions
    .map((permission) =>
      String(permission || "").trim()
    )
    .filter(Boolean);
};

const loadStaffRole = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const role = String(
      req.user.role || ""
    )
      .trim()
      .toUpperCase();

    /*
     * HEAD_OFFICE always has full access.
     */
    if (role === "HEAD_OFFICE") {
      req.staffAccess = {
        isHeadOffice: true,
        roleName: "HEAD_OFFICE",
        department: "ADMINISTRATION",
        permissions: ["*"],
      };

      return next();
    }

    if (
      role !== "STAFF" ||
      req.user.isStaff !== true
    ) {
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

      const needed = String(permission || "").trim();

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
    .map((value) => String(value || "").trim())
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

module.exports = {
  loadStaffRole,
  requirePermission,
  requireAnyPermission,
};
