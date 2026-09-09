const Role = require("../models/role.model");
const User = require("../models/user.model");

const {
  STAFF_PERMISSION_VALUES,
} = require("../config/staffPermissions");

const normalizeRoleName = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizePermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    return [];
  }

  const allowed = new Set(STAFF_PERMISSION_VALUES);

  return [
    ...new Set(
      permissions
        .map((item) => String(item || "").trim())
        .filter((item) => allowed.has(item))
    ),
  ];
};

const publicRole = (role) => ({
  id: role._id,
  _id: role._id,
  name: role.name,
  displayName: role.displayName,
  department: role.department,
  description: role.description,
  permissions: role.permissions || [],
  isSystemRole: role.isSystemRole === true,
  status: role.status,
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
  mustChangePassword: staff.mustChangePassword,
  lastStaffLoginAt: staff.lastStaffLoginAt,
  createdAt: staff.createdAt,
  updatedAt: staff.updatedAt,
});

exports.getPermissionCatalog = async (req, res) => {
  return res.status(200).json({
    success: true,
    count: STAFF_PERMISSION_VALUES.length,
    permissions: STAFF_PERMISSION_VALUES,
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
    } = req.body || {};

    const roleName = normalizeRoleName(name);

    if (!roleName || !displayName || !department) {
      return res.status(400).json({
        success: false,
        message:
          "Role name, display name and department are required.",
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
      permissions: normalizePermissions(permissions),
      isSystemRole: false,
      status: "ACTIVE",
      createdBy: req.user._id,
      updatedBy: req.user._id,
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

    const roles = await Role.find(query)
      .sort({
        department: 1,
        displayName: 1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      count: roles.length,
      roles: roles.map(publicRole),
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

    const {
      name,
      displayName,
      department,
      description,
      permissions,
      status,
    } = req.body;

    if (name !== undefined && name !== null) {
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
      if (!Array.isArray(permissions)) {
        return res.status(400).json({
          success: false,
          message: "Permissions must be provided as a list.",
        });
      }

      role.permissions = normalizePermissions(permissions);
    }

    if (status !== undefined) {
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

    await role.save();

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

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const normalizedPhone = String(phone).trim();

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
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          staffId: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

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
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff account was not found.",
      });
    }

    staff.status = status;

    await staff.save({
      validateBeforeSave: false,
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
