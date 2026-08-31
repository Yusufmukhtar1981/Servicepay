const Role = require("../models/role.model");
const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const mongoose = require("mongoose");
const {
  scopeFilterFor,
  isUserWithinScope,
  hasPermission,
} = require("../middleware/staffPermission.middleware");

const {
  STAFF_PERMISSION_CATALOG,
  ROLE_HIERARCHY,
  validateStaffPermissions,
} = require("../config/staffPermissions");

const normalizeRoleName = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const validatePermissions = (permissions, allowEmpty = false) =>
  validateStaffPermissions(permissions, { allowEmpty });

const createAuditLog = async (
  req,
  {
    action,
    reason,
    targetUser = null,
    previousData = null,
    newData = null,
    metadata = null,
    session = null,
  }
) => {
  const auditData = {
    actorId: req.user._id,
    actorRole: String(req.user.role || "UNKNOWN").toUpperCase(),
    actorName: req.user.fullName || "",
    targetUserId: targetUser?._id || null,
    targetUserName: targetUser?.fullName || "",
    action,
    reason,
    previousData,
    newData,
    metadata,
    ipAddress: req.ip || "",
    userAgent: String(req.headers?.["user-agent"] || ""),
    requestMethod: req.method || "",
    requestPath: req.originalUrl || "",
  };

  return session
    ? AdminAuditLog.create([auditData], { session })
    : AdminAuditLog.create(auditData);
};

const actorCanGrant = (req, permissions) => {
  if (req.staffAccess?.isHeadOffice) return true;
  const granted = new Set(req.staffAccess?.permissions || []);
  return permissions.every((permission) => granted.has(permission));
};

const actorCanManageRole = (req, role) => {
  if (req.staffAccess?.isHeadOffice) return true;
  if (role?.isSystemRole) return false;
  return Number(role?.hierarchyLevel || 20) < Number(req.staffAccess?.hierarchyLevel || 0);
};

const parseRoleControls = (body = {}) => {
  const scopeType = String(body.scopeType || "GLOBAL").trim().toUpperCase();
  const hierarchyLevel = Number(body.hierarchyLevel ?? 20);
  return {
    scopeType: ["GLOBAL", "ZONE", "STATE", "BUSINESS_PARTNER", "SELF"].includes(scopeType)
      ? scopeType
      : null,
    hierarchyLevel:
      Number.isInteger(hierarchyLevel) && hierarchyLevel >= 0 && hierarchyLevel <= 99
        ? hierarchyLevel
        : null,
  };
};

const publicRole = (role) => ({
  id: role._id,
  _id: role._id,
  name: role.name,
  displayName: role.displayName,
  department: role.department,
  description: role.description,
  permissions: role.permissions || [],
  scopeType: role.scopeType || "GLOBAL",
  hierarchyLevel: Number(role.hierarchyLevel || 20),
  isSystemRole: role.isSystemRole === true,
  status: role.status,
  assignedStaffCount: Number(role.assignedStaffCount || 0),
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

const publicStaff = (staff) => ({
  id: staff._id,
  _id: staff._id,
  fullName: staff.fullName,
  phone: staff.phone,
  email: staff.email,
  role: staff.role,
  status: staff.status,
  isStaff: staff.isStaff,
  staffId: staff.staffId,
  department: staff.department,
  staffRoleId: staff.staffRoleId,
  zone: staff.zone || null,
  state: staff.state || null,
  lga: staff.lga || null,
  mustChangePassword: staff.mustChangePassword,
  lastStaffLoginAt: staff.lastStaffLoginAt,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
});

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const staffHierarchyLevel = (staff) =>
  Number(staff?.staffRoleId?.hierarchyLevel || 20);

const canAccessStaff = (req, staff, { allowSelf = true, requireHierarchy = false } = {}) => {
  if (!staff) return false;
  if (req.staffAccess?.isHeadOffice) return true;
  if (!allowSelf && String(staff._id) === String(req.user._id)) return false;
  if (!isUserWithinScope(req.staffAccess, staff)) return false;
  return !requireHierarchy ||
    staffHierarchyLevel(staff) < Number(req.staffAccess?.hierarchyLevel || 0);
};

const staffLookup = (staffId) => User.findOne({
  _id: staffId,
  isStaff: true,
  role: "STAFF",
})
  .select("+authTokenVersion")
  .populate("staffRoleId", "name displayName department permissions status hierarchyLevel");

exports.getPermissionCatalog = async (req, res) => {
  const modules = {};
  for (const item of STAFF_PERMISSION_CATALOG) {
    modules[item.module] ||= [];
    modules[item.module].push(item);
  }
  return res.status(200).json({
    success: true,
    permissionDomain: "STAFF_ADMIN",
    count: STAFF_PERMISSION_CATALOG.length,
    permissions: STAFF_PERMISSION_CATALOG,
    values: STAFF_PERMISSION_CATALOG.map((item) => item.value),
    modules,
    businessPartnerPermissionDomain: "BUSINESS_PARTNER_DISTRIBUTOR",
  });
};

exports.createRole = async (req, res) => {
  try {
    const {
      name,
      displayName,
      department,
      description,
      permissions,
      scopeType,
      hierarchyLevel,
    } = req.body || {};

    const roleName = normalizeRoleName(name);

    if (!roleName || !displayName || !department) {
      return res.status(400).json({
        success: false,
        message:
          "Role name, display name and department are required.",
      });
    }

    const permissionResult = validatePermissions(permissions, false);
    if (!permissionResult.valid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PERMISSIONS",
        message: permissionResult.message,
        invalidPermissions: permissionResult.invalidPermissions,
      });
    }
    if (!actorCanGrant(req, permissionResult.permissions)) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot grant permissions that you do not hold.",
      });
    }
    const controls = parseRoleControls({ scopeType, hierarchyLevel });
    if (!controls.scopeType || controls.hierarchyLevel === null) {
      return res.status(400).json({
        success: false,
        message: "Invalid role scope or hierarchy level.",
      });
    }
    if (
      !req.staffAccess?.isHeadOffice &&
      (controls.scopeType === "GLOBAL" ||
        controls.hierarchyLevel >= Number(req.staffAccess?.hierarchyLevel || 0))
    ) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot create a role at or above your own access level.",
      });
    }

    const existingRole = await Role.findOne({
      name: roleName,
    });

    if (existingRole) {
      return res.status(409).json({
        success: false,
        message: "A staff role with this name already exists.",
      });
    }

    const role = await Role.create({
      name: roleName,
      displayName: String(displayName).trim(),
      department: String(department)
        .trim()
        .toUpperCase(),
      description: String(description || "").trim(),
      permissions: permissionResult.permissions,
      scopeType: controls.scopeType,
      hierarchyLevel: controls.hierarchyLevel,
      isSystemRole: false,
      status: "ACTIVE",
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await createAuditLog(req, {
      action: "ROLE_CREATED",
      reason: `Created staff role ${role.name}.`,
      newData: publicRole(role),
      metadata: { roleId: role._id },
    });

    return res.status(201).json({
      success: true,
      message: "Staff role created successfully.",
      role: publicRole(role),
    });
  } catch (error) {
    console.error("Create staff role error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create the staff role.",
    });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const status = String(
      req.query.status || "ALL"
    )
      .trim()
      .toUpperCase();

    const query = {};

    if (status !== "ALL") {
      query.status = status;
    }

    const [roles, counts] = await Promise.all([
      Role.find(query)
      .sort({
        department: 1,
        displayName: 1,
      })
      .lean(),
      User.aggregate([
        { $match: { isStaff: true, role: "STAFF", staffRoleId: { $ne: null } } },
        { $group: { _id: "$staffRoleId", count: { $sum: 1 } } },
      ]),
    ]);
    const countByRole = new Map(
      counts.map((item) => [String(item._id), Number(item.count || 0)])
    );

    return res.status(200).json({
      success: true,
      count: roles.length,
      roles: roles.map((role) =>
        publicRole({
          ...role,
          assignedStaffCount: countByRole.get(String(role._id)) || 0,
        })
      ),
    });
  } catch (error) {
    console.error("Get staff roles error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load staff roles.",
    });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const roleId =
      req.params.id ||
      req.params.roleId ||
      req.body.roleId ||
      req.body.id;

    if (!roleId) {
      return res.status(400).json({
        success: false,
        message: "Staff role ID is required.",
      });
    }

    const role = await Role.findById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Staff role not found.",
      });
    }
    if (!actorCanManageRole(req, role)) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot modify this role.",
      });
    }
    const before = publicRole(role);

    const {
      name,
      displayName,
      department,
      description,
      permissions,
      status,
    } = req.body;

    if (name !== undefined && name !== null) {
      if (role.isSystemRole) {
        return res.status(403).json({
          success: false,
          message: "System role names cannot be changed.",
        });
      }
      const normalizedName = normalizeRoleName(name);

      if (!normalizedName) {
        return res.status(400).json({
          success: false,
          message: "A valid role name is required.",
        });
      }

      const duplicateRole = await Role.findOne({
        _id: { $ne: role._id },
        name: normalizedName,
      });

      if (duplicateRole) {
        return res.status(409).json({
          success: false,
          message: "Another staff role already uses this role name.",
        });
      }

      role.name = normalizedName;
    }

    if (displayName !== undefined) {
      role.displayName = String(displayName || "").trim();
    }

    if (department !== undefined) {
      role.department = String(department || "").trim().toUpperCase();
    }

    if (description !== undefined) {
      role.description = String(description || "").trim();
    }

    if (permissions !== undefined) {
      if (!hasPermission(req.staffAccess, "roles.assign_permissions")) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to change staff role permissions.",
          requiredPermission: "roles.assign_permissions",
        });
      }
      const permissionResult = validatePermissions(permissions, false);
      if (!permissionResult.valid) {
        return res.status(400).json({
          success: false,
          code: "INVALID_PERMISSIONS",
          message: permissionResult.message,
          invalidPermissions: permissionResult.invalidPermissions,
        });
      }
      if (!actorCanGrant(req, permissionResult.permissions)) {
        return res.status(403).json({
          success: false,
          code: "PRIVILEGE_ESCALATION_DENIED",
          message: "You cannot grant permissions that you do not hold.",
        });
      }
      role.permissions = permissionResult.permissions;
    }

    if (req.body.scopeType !== undefined || req.body.hierarchyLevel !== undefined) {
      const controls = parseRoleControls({
        scopeType: req.body.scopeType ?? role.scopeType,
        hierarchyLevel: req.body.hierarchyLevel ?? role.hierarchyLevel,
      });
      if (!controls.scopeType || controls.hierarchyLevel === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid role scope or hierarchy level.",
        });
      }
      if (
        !req.staffAccess?.isHeadOffice &&
        (controls.scopeType === "GLOBAL" ||
          controls.hierarchyLevel >= Number(req.staffAccess?.hierarchyLevel || 0))
      ) {
        return res.status(403).json({
          success: false,
          code: "PRIVILEGE_ESCALATION_DENIED",
          message: "You cannot elevate a role to or above your own access level.",
        });
      }
      role.scopeType = controls.scopeType;
      role.hierarchyLevel = controls.hierarchyLevel;
    }

    if (status !== undefined) {
      if (!hasPermission(req.staffAccess, "roles.enable")) {
        return res.status(403).json({
          success: false,
          message: "You do not have permission to change staff role status.",
          requiredPermission: "roles.enable",
        });
      }
      const normalizedStatus = String(status || "")
        .trim()
        .toUpperCase();

      if (!["ACTIVE", "INACTIVE"].includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid staff role status.",
        });
      }

      role.status = normalizedStatus;
    }

    const permissionChanged =
      JSON.stringify([...(before.permissions || [])].sort()) !==
      JSON.stringify([...(role.permissions || [])].sort());
    const statusChanged = before.status !== role.status;
    const action = permissionChanged
      ? "ROLE_PERMISSIONS_CHANGED"
      : statusChanged
        ? "ROLE_STATUS_CHANGED"
        : "ROLE_UPDATED";
    const writeAuditLog = (after, session = null) => createAuditLog(req, {
      action,
      reason: `Updated staff role ${role.name}.`,
      previousData: before,
      newData: after,
      metadata: { roleId: role._id },
      session,
    });
    const invalidateAssignedStaff = permissionChanged || statusChanged;
    let after;

    if (invalidateAssignedStaff) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await role.save({ session });
          await User.updateMany(
            {
              isStaff: true,
              role: "STAFF",
              staffRoleId: role._id,
            },
            { $inc: { authTokenVersion: 1 } },
            { session }
          );
          after = publicRole(role);
          await writeAuditLog(after, session);
        });
      } finally {
        await session.endSession();
      }
    } else {
      await role.save();
      after = publicRole(role);
      await writeAuditLog(after);
    }

    return res.status(200).json({
      success: true,
      message: "Staff role updated successfully.",
      role: publicRole(role),
    });
  } catch (error) {
    console.error("UPDATE STAFF ROLE ERROR:", error);

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to update the staff role.",
    });
  }
};

exports.createStaff = async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      password,
      roleId,
      zone,
      state,
      lga,
    } = req.body || {};

    if (
      !fullName ||
      !phone ||
      !email ||
      !password ||
      !roleId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, phone, email, temporary password and staff role are required.",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Temporary password must contain at least 6 characters.",
      });
    }

    const staffRole = await Role.findOne({
      _id: roleId,
      status: "ACTIVE",
    });

    if (!staffRole) {
      return res.status(400).json({
        success: false,
        message:
          "The selected staff role is unavailable.",
      });
    }
    if (
      !actorCanGrant(req, staffRole.permissions || []) ||
      (!req.staffAccess?.isHeadOffice &&
        Number(staffRole.hierarchyLevel || 20) >=
          Number(req.staffAccess?.hierarchyLevel || 0))
    ) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot assign this staff role.",
      });
    }

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const normalizedPhone = String(phone).trim();
    const location = {
      zone: zone === undefined ? null : String(zone || "").trim() || null,
      state: state === undefined ? null : String(state || "").trim() || null,
      lga: lga === undefined ? null : String(lga || "").trim() || null,
    };
    if (
      !req.staffAccess?.isHeadOffice &&
      !isUserWithinScope(req.staffAccess, { _id: null, ...location })
    ) {
      return res.status(403).json({
        success: false,
        code: "DATA_SCOPE_DENIED",
        message: "You cannot create a staff account outside your authorized data scope.",
      });
    }

    const existingUser = await User.findOne({
      $or: [
        {
          email: normalizedEmail,
        },
        {
          phone: normalizedPhone,
        },
      ],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          "An account already exists with this email or phone number.",
      });
    }

    const latestStaff = await User.findOne({
      isStaff: true,
      staffId: {
        $regex: /^SP-STF-/,
      },
    })
      .sort({
        createdAt: -1,
      })
      .select("staffId")
      .lean();

    const previousNumber =
      Number(
        String(latestStaff?.staffId || "")
          .replace("SP-STF-", "")
      ) || 0;

    const nextStaffId =
      `SP-STF-${String(previousNumber + 1).padStart(
        5,
        "0"
      )}`;

    const staff = await User.create({
      fullName: String(fullName).trim(),
      phone: normalizedPhone,
      email: normalizedEmail,
      password: String(password),

      role: "STAFF",
      status: "ACTIVE",

      isStaff: true,
      staffId: nextStaffId,
      staffRoleId: staffRole._id,
      department: staffRole.department,
      ...location,
      staffCreatedBy: req.user._id,
      mustChangePassword: true,

      walletBalance: 0,
      commissionBalance: 0,
      totalEarnings: 0,
    });

    await staff.populate(
      "staffRoleId",
      "name displayName department permissions status"
    );
    await createAuditLog(req, {
      action: "STAFF_ROLE_ASSIGNED",
      reason: `Assigned ${staffRole.name} to new staff account.`,
      targetUser: staff,
      newData: { roleId: staffRole._id, roleName: staffRole.name },
    });

    return res.status(201).json({
      success: true,
      message: "Staff account created successfully.",
      staff: publicStaff(staff),
    });
  } catch (error) {
    console.error("Create staff error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create the staff account.",
    });
  }
};

exports.getStaff = async (req, res) => {
  try {
    const status = String(
      req.query.status || "ALL"
    )
      .trim()
      .toUpperCase();

    const search = String(
      req.query.search || ""
    ).trim();

    const query = {
      isStaff: true,
      role: "STAFF",
    };

    if (status !== "ALL") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          fullName: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          email: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          phone: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          staffId: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
      ];
    }

    Object.assign(query, scopeFilterFor(req.staffAccess));

    const staff = await User.find(query)
      .select("-password")
      .populate(
        "staffRoleId",
        "name displayName department permissions status"
      )
      .sort({
        createdAt: -1,
      });

    return res.status(200).json({
      success: true,
      count: staff.length,
      staff: staff.map(publicStaff),
    });
  } catch (error) {
    console.error("Get staff error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load staff accounts.",
    });
  }
};

exports.getStaffDetail = async (req, res) => {
  try {
    const staff = await staffLookup(req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff account was not found." });
    }
    if (!canAccessStaff(req, staff)) {
      return res.status(403).json({
        success: false,
        code: "DATA_SCOPE_DENIED",
        message: "This record is outside your authorized data scope.",
      });
    }
    return res.status(200).json({ success: true, staff: publicStaff(staff) });
  } catch (error) {
    console.error("Get staff detail error:", error);
    return res.status(500).json({ success: false, message: "Unable to load the staff account." });
  }
};

exports.updateStaff = async (req, res) => {
  try {
    const staff = await staffLookup(req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff account was not found." });
    }
    if (!canAccessStaff(req, staff, { allowSelf: false, requireHierarchy: true })) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot update this staff account.",
      });
    }

    const allowedFields = ["fullName", "phone", "email", "zone", "state", "lga"];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => req.body?.[field] !== undefined)
        .map((field) => [field, String(req.body[field] || "").trim()])
    );
    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one editable staff detail.",
      });
    }
    if (updates.fullName !== undefined && !updates.fullName) {
      return res.status(400).json({ success: false, message: "Full name cannot be empty." });
    }
    if (updates.phone !== undefined && !updates.phone) {
      return res.status(400).json({ success: false, message: "Phone cannot be empty." });
    }
    if (updates.email !== undefined) {
      updates.email = updates.email.toLowerCase();
      if (!updates.email) {
        return res.status(400).json({ success: false, message: "Email cannot be empty." });
      }
    }

    // A scoped administrator may not move a record outside of their own scope.
    const scopedCandidate = {
      ...staff.toObject(),
      ...updates,
    };
    if (!req.staffAccess?.isHeadOffice && !isUserWithinScope(req.staffAccess, scopedCandidate)) {
      return res.status(403).json({
        success: false,
        code: "DATA_SCOPE_DENIED",
        message: "You cannot move a staff account outside your authorized data scope.",
      });
    }
    if (updates.email !== undefined || updates.phone !== undefined) {
      const duplicateQuery = [];
      if (updates.email !== undefined) duplicateQuery.push({ email: updates.email });
      if (updates.phone !== undefined) duplicateQuery.push({ phone: updates.phone });
      const duplicate = await User.findOne({ _id: { $ne: staff._id }, $or: duplicateQuery });
      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "An account already exists with this email or phone number.",
        });
      }
    }
    const before = publicStaff(staff);
    Object.assign(staff, updates);
    await staff.save({ validateBeforeSave: false });
    await createAuditLog(req, {
      action: "STAFF_UPDATED",
      reason: "Updated staff account details.",
      targetUser: staff,
      previousData: before,
      newData: publicStaff(staff),
      metadata: { changedFields: Object.keys(updates) },
    });
    return res.status(200).json({
      success: true,
      message: "Staff account updated successfully.",
      staff: publicStaff(staff),
    });
  } catch (error) {
    console.error("Update staff error:", error);
    return res.status(500).json({ success: false, message: "Unable to update the staff account." });
  }
};

exports.resetStaffPassword = async (req, res) => {
  try {
    const temporaryPassword = String(
      req.body?.temporaryPassword ?? req.body?.password ?? ""
    );
    if (temporaryPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Temporary password must contain at least 6 characters.",
      });
    }
    const staff = await staffLookup(req.params.staffId);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff account was not found." });
    }
    if (!canAccessStaff(req, staff, { allowSelf: false, requireHierarchy: true })) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot reset this staff account password.",
      });
    }
    staff.password = temporaryPassword;
    staff.mustChangePassword = true;
    staff.passwordChangedAt = new Date();
    staff.authTokenVersion = Number(staff.authTokenVersion || 0) + 1;
    await staff.save();
    await createAuditLog(req, {
      action: "STAFF_PASSWORD_RESET",
      reason: "Reset staff temporary password; password change is required at next sign-in.",
      targetUser: staff,
      newData: { mustChangePassword: true },
    });
    return res.status(200).json({
      success: true,
      message: "Temporary password reset successfully.",
      staff: publicStaff(staff),
    });
  } catch (error) {
    console.error("Reset staff password error:", error);
    return res.status(500).json({ success: false, message: "Unable to reset the staff password." });
  }
};

exports.updateStaffStatus = async (req, res) => {
  try {
    const status = String(
      req.body?.status || ""
    )
      .trim()
      .toUpperCase();

    if (
      ![
        "ACTIVE",
        "SUSPENDED",
        "BLOCKED",
      ].includes(status)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be ACTIVE, SUSPENDED or BLOCKED.",
      });
    }

    const staff = await User.findOne({
      _id: req.params.staffId,
      isStaff: true,
      role: "STAFF",
    })
      .select("+authTokenVersion")
      .populate("staffRoleId", "name permissions hierarchyLevel");

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff account was not found.",
      });
    }
    if (!canAccessStaff(req, staff, { allowSelf: false, requireHierarchy: true })) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot change the status of this staff account.",
      });
    }
    const previousStatus = staff.status;

    staff.status = status;
    staff.authTokenVersion = Number(staff.authTokenVersion || 0) + 1;

    await staff.save({
      validateBeforeSave: false,
    });
    await createAuditLog(req, {
      action: "STAFF_STATUS_UPDATED",
      reason: `Changed staff account status from ${previousStatus} to ${status}.`,
      targetUser: staff,
      previousData: { status: previousStatus },
      newData: { status },
    });

    return res.status(200).json({
      success: true,
      message: `Staff account changed to ${status}.`,
      staff: publicStaff(staff),
    });
  } catch (error) {
    console.error(
      "Update staff status error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update the staff account status.",
    });
  }
};

exports.duplicateRole = async (req, res) => {
  try {
    const source = await Role.findById(req.params.roleId);
    if (!source) {
      return res.status(404).json({ success: false, message: "Staff role not found." });
    }
    if (!actorCanManageRole(req, source) || !actorCanGrant(req, source.permissions || [])) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot duplicate this role.",
      });
    }
    const name = normalizeRoleName(req.body?.name);
    const displayName = String(req.body?.displayName || "").trim();
    if (!name || !displayName) {
      return res.status(400).json({
        success: false,
        message: "A unique role name and display name are required.",
      });
    }
    if (await Role.exists({ name })) {
      return res.status(409).json({
        success: false,
        message: "A staff role with this name already exists.",
      });
    }
    const role = await Role.create({
      name,
      displayName,
      department: source.department,
      description: String(req.body?.description ?? source.description ?? "").trim(),
      permissions: source.permissions,
      scopeType: source.scopeType || "GLOBAL",
      hierarchyLevel: source.hierarchyLevel || 20,
      isSystemRole: false,
      status: "ACTIVE",
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await createAuditLog(req, {
      action: "ROLE_DUPLICATED",
      reason: `Duplicated staff role ${source.name} as ${role.name}.`,
      newData: publicRole(role),
      metadata: { sourceRoleId: source._id, roleId: role._id },
    });
    return res.status(201).json({
      success: true,
      message: "Staff role duplicated successfully.",
      role: publicRole(role),
    });
  } catch (error) {
    console.error("Duplicate staff role error:", error);
    return res.status(500).json({ success: false, message: "Unable to duplicate the staff role." });
  }
};

exports.getRoleStaff = async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId).lean();
    if (!role) {
      return res.status(404).json({ success: false, message: "Staff role not found." });
    }
    const staff = await User.find({
      isStaff: true,
      role: "STAFF",
      staffRoleId: role._id,
      ...scopeFilterFor(req.staffAccess),
    })
      .select("-password")
      .sort({ fullName: 1 })
      .lean();
    return res.status(200).json({
      success: true,
      role: publicRole(role),
      count: staff.length,
      staff: staff.map(publicStaff),
    });
  } catch (error) {
    console.error("Get role staff error:", error);
    return res.status(500).json({ success: false, message: "Unable to load assigned staff." });
  }
};

exports.assignStaffRole = async (req, res) => {
  try {
    if (String(req.params.staffId) === String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You cannot change your own staff role.",
      });
    }
    const [staff, role] = await Promise.all([
      User.findOne({ _id: req.params.staffId, isStaff: true, role: "STAFF" })
        .select("+authTokenVersion")
        .populate("staffRoleId", "name hierarchyLevel permissions"),
      Role.findOne({ _id: req.body?.roleId, status: "ACTIVE" }),
    ]);
    if (!staff) {
      return res.status(404).json({ success: false, message: "Staff account was not found." });
    }
    if (!role) {
      return res.status(400).json({ success: false, message: "The selected staff role is unavailable." });
    }
    const actorLevel = Number(req.staffAccess?.hierarchyLevel || 0);
    const currentLevel = Number(staff.staffRoleId?.hierarchyLevel || 20);
    if (
      !req.staffAccess?.isHeadOffice &&
      (!isUserWithinScope(req.staffAccess, staff) ||
        currentLevel >= actorLevel ||
        Number(role.hierarchyLevel || 20) >= actorLevel ||
        !actorCanGrant(req, role.permissions || []))
    ) {
      return res.status(403).json({
        success: false,
        code: "PRIVILEGE_ESCALATION_DENIED",
        message: "You cannot assign this role to this staff account.",
      });
    }
    const previousRole = staff.staffRoleId
      ? { id: staff.staffRoleId._id, name: staff.staffRoleId.name }
      : null;
    staff.staffRoleId = role._id;
    staff.department = role.department;
    staff.authTokenVersion = Number(staff.authTokenVersion || 0) + 1;
    await staff.save({ validateBeforeSave: false });
    await createAuditLog(req, {
      action: "STAFF_ROLE_ASSIGNED",
      reason: `Assigned ${role.name} to staff account.`,
      targetUser: staff,
      previousData: { role: previousRole },
      newData: { role: { id: role._id, name: role.name } },
    });
    return res.status(200).json({
      success: true,
      message: "Staff role assigned successfully.",
      staff: publicStaff(staff),
    });
  } catch (error) {
    console.error("Assign staff role error:", error);
    return res.status(500).json({ success: false, message: "Unable to assign the staff role." });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId);
    if (!role) {
      return res.status(404).json({ success: false, message: "Staff role not found." });
    }
    if (role.isSystemRole || !actorCanManageRole(req, role)) {
      return res.status(403).json({ success: false, message: "This role cannot be deleted." });
    }
    if (await User.exists({ isStaff: true, role: "STAFF", staffRoleId: role._id })) {
      return res.status(409).json({
        success: false,
        message: "Reassign staff before deleting this role.",
      });
    }
    const snapshot = publicRole(role);
    await role.deleteOne();
    await createAuditLog(req, {
      action: "ROLE_UPDATED",
      reason: `Deleted unused staff role ${role.name}.`,
      previousData: snapshot,
      metadata: { roleId: role._id, operation: "DELETE" },
    });
    return res.status(200).json({ success: true, message: "Staff role deleted successfully." });
  } catch (error) {
    console.error("Delete staff role error:", error);
    return res.status(500).json({ success: false, message: "Unable to delete the staff role." });
  }
};


exports.seedDefaultRoles = async (req, res) => {
  try {
    const {
      STAFF_PERMISSIONS: P,
    } = require("../config/staffPermissions");

    const defaultRoles = [
      {
        name: "SUB_ADMIN",
        displayName: "Sub Admin",
        department: "ADMINISTRATION",
        description:
          "Assists Head Office with selected administrative operations.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.STAFF_CREATE,
          P.STAFF_VIEW,
          P.STAFF_UPDATE,
          P.STAFF_SUSPEND,
          P.STAFF_RESET_PASSWORD,
          P.ROLES_VIEW,
          P.USERS_VIEW,
          P.USERS_UPDATE,
          P.USERS_SUSPEND,
          P.USERS_BLOCK,
          P.TRANSACTIONS_VIEW,
          P.TRANSACTIONS_EXPORT,
          P.WALLETS_VIEW,
          P.DELIVERY_VIEW,
          P.SUPPORT_VIEW,
          P.KYC_VIEW,
          P.AUDIT_VIEW,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
          P.NOTIFICATIONS_CREATE,
          P.NOTIFICATIONS_SEND,
        ],
      },
      {
        name: "OPERATIONS_MANAGER",
        displayName: "Operations Manager",
        department: "OPERATIONS",
        description:
          "Manages daily ServicePay operational activity.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.TRANSACTIONS_VIEW,
          P.TRANSACTIONS_EXPORT,
          P.WALLETS_VIEW,
          P.DELIVERY_VIEW,
          P.DELIVERY_ASSIGN,
          P.DELIVERY_UPDATE,
          P.DELIVERY_CANCEL,
          P.SUPPORT_VIEW,
          P.SUPPORT_ASSIGN,
          P.SUPPORT_RESOLVE,
          P.KYC_VIEW,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "DELIVERY_MANAGER",
        displayName: "Delivery Manager",
        department: "DELIVERY",
        description:
          "Manages delivery requests and delivery staff.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.DELIVERY_VIEW,
          P.DELIVERY_ASSIGN,
          P.DELIVERY_UPDATE,
          P.DELIVERY_CANCEL,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "FINANCE_MANAGER",
        displayName: "Finance Manager",
        department: "FINANCE",
        description:
          "Oversees wallets, reconciliation and financial approvals.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.TRANSACTIONS_VIEW,
          P.TRANSACTIONS_EXPORT,
          P.TRANSACTIONS_REVERSE,
          P.WALLETS_VIEW,
          P.WALLETS_FUND,
          P.WALLETS_ADJUST,
          P.WALLETS_FREEZE,
          P.FINANCE_VIEW,
          P.FINANCE_RECONCILE,
          P.FINANCE_EXPORT,
          P.FINANCE_APPROVE,
          P.AUDIT_VIEW,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "ACCOUNTANT",
        displayName: "Accountant",
        department: "FINANCE",
        description:
          "Handles financial reports and reconciliation.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.TRANSACTIONS_VIEW,
          P.TRANSACTIONS_EXPORT,
          P.WALLETS_VIEW,
          P.FINANCE_VIEW,
          P.FINANCE_RECONCILE,
          P.FINANCE_EXPORT,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "INTERNAL_AUDITOR",
        displayName: "Internal Auditor",
        department: "AUDIT",
        description:
          "Read-only internal audit and control access.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.STAFF_VIEW,
          P.ROLES_VIEW,
          P.USERS_VIEW,
          P.TRANSACTIONS_VIEW,
          P.TRANSACTIONS_EXPORT,
          P.WALLETS_VIEW,
          P.FINANCE_VIEW,
          P.FINANCE_EXPORT,
          P.DELIVERY_VIEW,
          P.SUPPORT_VIEW,
          P.KYC_VIEW,
          P.AUDIT_VIEW,
          P.AUDIT_EXPORT,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
          P.SETTINGS_VIEW,
        ],
      },
      {
        name: "COMPLIANCE_MANAGER",
        displayName: "Compliance Manager",
        department: "COMPLIANCE",
        description:
          "Manages KYC and compliance operations.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.USERS_UPDATE,
          P.USERS_SUSPEND,
          P.USERS_BLOCK,
          P.TRANSACTIONS_VIEW,
          P.KYC_VIEW,
          P.KYC_APPROVE,
          P.KYC_REJECT,
          P.TRUST_VIEW,
          P.AUDIT_VIEW,
          P.AUDIT_EXPORT,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "KYC_OFFICER",
        displayName: "KYC Officer",
        department: "COMPLIANCE",
        description:
          "Reviews KYC and identity verification submissions.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.KYC_VIEW,
          P.KYC_APPROVE,
          P.KYC_REJECT,
          P.REPORTS_VIEW,
        ],
      },
      {
        name: "SUPPORT_MANAGER",
        displayName: "Support Manager",
        department: "CUSTOMER_SUPPORT",
        description:
          "Manages support complaints and escalations.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.STAFF_VIEW,
          P.USERS_VIEW,
          P.USERS_UPDATE,
          P.TRANSACTIONS_VIEW,
          P.WALLETS_VIEW,
          P.SUPPORT_VIEW,
          P.SUPPORT_CREATE,
          P.SUPPORT_ASSIGN,
          P.SUPPORT_RESOLVE,
          P.REPORTS_VIEW,
          P.REPORTS_EXPORT,
        ],
      },
      {
        name: "SUPPORT_STAFF",
        displayName: "Support Staff",
        department: "CUSTOMER_SUPPORT",
        description:
          "Handles customer enquiries and support cases.",
        permissions: [
          P.DASHBOARD_VIEW,
          P.USERS_VIEW,
          P.TRANSACTIONS_VIEW,
          P.SUPPORT_VIEW,
          P.SUPPORT_CREATE,
          P.SUPPORT_RESOLVE,
        ],
      },
    ];

    const results = [];

    for (const roleData of defaultRoles) {
      const role = await Role.findOneAndUpdate(
        {
          name: roleData.name,
        },
        {
          ...roleData,
          scopeType: "GLOBAL",
          hierarchyLevel: ROLE_HIERARCHY[roleData.name] || 20,
          isSystemRole: true,
          status: "ACTIVE",
          updatedBy: req.user._id,
          $setOnInsert: {
            createdBy: req.user._id,
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      results.push(publicRole(role));
    }

    return res.status(200).json({
      success: true,
      message:
        "Default staff roles created or updated successfully.",
      count: results.length,
      roles: results,
    });
  } catch (error) {
    console.error(
      "Seed default staff roles error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create the default staff roles.",
    });
  }
};

module.exports.publicRole = publicRole;
module.exports.publicStaff = publicStaff;
