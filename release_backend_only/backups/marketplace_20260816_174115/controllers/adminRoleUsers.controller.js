const User = require("../models/user.model");

const ALLOWED_ROLES = [
  "ZONAL_MANAGER",
  "STATE_MANAGER",
  "AGENT",
  "CUSTOMER",
];

const ALLOWED_STATUSES = [
  "ACTIVE",
  "SUSPENDED",
  "BLOCKED",
];

const ensureHeadOffice = (req, res) => {
  if (!req.user || String(req.user.role || "").toUpperCase() !== "HEAD_OFFICE") {
    res.status(403).json({
      success: false,
      message: "HEAD_OFFICE access only.",
    });
    return false;
  }

  return true;
};

/*
 * GET /api/admin/role-users
 * GET /api/admin/role-users?role=ZONAL_MANAGER
 * GET /api/admin/role-users?role=STATE_MANAGER
 * GET /api/admin/role-users?role=AGENT
 * GET /api/admin/role-users?role=CUSTOMER
 */
exports.getRoleUsers = async (req, res) => {
  try {
    if (!ensureHeadOffice(req, res)) return;

    const role = String(req.query.role || "")
      .trim()
      .toUpperCase();

    const search = String(req.query.search || "").trim();

    const filter = {
      isDeleted: { $ne: true },
    };

    if (role) {
      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user role.",
        });
      }

      filter.role = role;
    } else {
      filter.role = { $in: ALLOWED_ROLES };
    }

    if (search) {
      const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      filter.$or = [
        { fullName: { $regex: safeSearch, $options: "i" } },
        { phone: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
        { state: { $regex: safeSearch, $options: "i" } },
        { zone: { $regex: safeSearch, $options: "i" } },
        { lga: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const users = await User.find(filter)
      .select(
        "_id fullName phone email role status zone state lga walletBalance createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      role: role || "ALL",
      users,
    });
  } catch (error) {
    console.error("Admin get role users error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load users.",
    });
  }
};

/*
 * GET /api/admin/role-users/:userId
 */
exports.getRoleUserById = async (req, res) => {
  try {
    if (!ensureHeadOffice(req, res)) return;

    const user = await User.findOne({
      _id: req.params.userId,
      role: { $in: ALLOWED_ROLES },
      isDeleted: { $ne: true },
    })
      .select("-password -resetPasswordToken -resetPasswordExpires")
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Admin get user details error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load account details.",
    });
  }
};

/*
 * PUT /api/admin/role-users/:userId/status
 * body: { "status": "ACTIVE" | "SUSPENDED" | "BLOCKED" }
 */
exports.updateRoleUserStatus = async (req, res) => {
  try {
    if (!ensureHeadOffice(req, res)) return;

    const status = String(req.body.status || "")
      .trim()
      .toUpperCase();

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be ACTIVE, SUSPENDED or BLOCKED.",
      });
    }

    const user = await User.findOne({
      _id: req.params.userId,
      role: { $in: ALLOWED_ROLES },
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    user.status = status;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `Account status changed to ${status}.`,
      user: {
        id: user._id,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Admin update account status error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update account status.",
    });
  }
};

/*
 * DELETE /api/admin/role-users/:userId
 *
 * SAFE DELETE:
 * - User can no longer access ServicePay
 * - User disappears from normal Admin lists
 * - Transactions/receipts/history remain in database
 */
exports.safeDeleteRoleUser = async (req, res) => {
  try {
    if (!ensureHeadOffice(req, res)) return;

    const user = await User.findOne({
      _id: req.params.userId,
      role: { $in: ALLOWED_ROLES },
      isDeleted: { $ne: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    user.status = "BLOCKED";
    user.isDeleted = true;
    user.deletedAt = new Date();
    user.deletedBy = String(req.user._id || req.user.id || "HEAD_OFFICE");

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Account safely deleted. Transaction and audit history were preserved.",
    });
  } catch (error) {
    console.error("Admin safe delete account error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete account.",
    });
  }
};
