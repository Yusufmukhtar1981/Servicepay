const User = require("../models/user.model");
const mongoose = require("mongoose");
const AdminAuditLog = require("../models/adminAuditLog.model");

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

exports.createZonalManager = async (req, res) => {
  try {
    if (!ensureHeadOffice(req, res)) return;
    const { fullName, phone, email, password, zone } = req.body || {};
    const cleanPhone = String(phone || "").replace(/\s+/g, "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!String(fullName || "").trim() || !/^\d{11}$/.test(cleanPhone) || String(password || "").length < 6 || !String(zone || "").trim()) {
      return res.status(400).json({ success: false, message: "Full name, valid 11-digit phone, password (6+), and zone are required." });
    }
    const exists = await User.findOne({ $or: [{ phone: cleanPhone }, ...(cleanEmail ? [{ email: cleanEmail }] : [])] }).select("_id");
    if (exists) return res.status(409).json({ success: false, message: "Phone number or email address already exists." });
    const user = await User.create({
      fullName: String(fullName).trim(), phone: cleanPhone, email: cleanEmail || undefined,
      password: String(password), role: "ZONAL_MANAGER", status: "ACTIVE", zone: String(zone).trim(),
    });
    await AdminAuditLog.create({
      actorId: req.user._id, actorRole: "HEAD_OFFICE", actorName: req.user.fullName || "",
      targetUserId: user._id, targetUserName: user.fullName, action: "USER_CREATED",
      reason: "Created canonical Zonal Manager.", metadata: { role: "ZONAL_MANAGER", zone: user.zone },
      requestMethod: req.method, requestPath: req.originalUrl,
    });
    return res.status(201).json({ success: true, user: { id: user._id, fullName: user.fullName, phone: user.phone, email: user.email || "", role: user.role, status: user.status, zone: user.zone } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ success: false, message: "Phone number or email address already exists." });
    console.error("Admin create zonal manager error:", error);
    return res.status(500).json({ success: false, message: "Unable to create Zonal Manager." });
  }
};

exports.promoteRoleUser = async (req, res) => {
  if (!ensureHeadOffice(req, res)) return;
  const targetRole = String(req.body?.targetRole || "").trim().toUpperCase();
  const sourceByTarget = { STATE_MANAGER: "AGENT", ZONAL_MANAGER: "STATE_MANAGER" };
  const promotionKey = String(
    req.get?.("Idempotency-Key") || req.body?.idempotencyKey ||
    `promotion:${req.params.userId}:${targetRole}`
  ).trim().slice(0, 160);
  const expectedSourceRole = sourceByTarget[targetRole];
  try {
    if (!sourceByTarget[targetRole]) {
      return res.status(400).json({ success: false, message: "Only AGENT to STATE_MANAGER and STATE_MANAGER to ZONAL_MANAGER promotions are allowed." });
    }
    const prior = await AdminAuditLog.findOne({
      action: "USER_ROLE_UPDATED",
      "metadata.promotionKey": promotionKey,
    }).lean();
    if (prior) {
      const metadata = prior.metadata || {};
      if (String(metadata.targetUserId) !== String(req.params.userId) ||
          metadata.sourceRole !== expectedSourceRole ||
          metadata.targetRole !== targetRole) {
        return res.status(409).json({ success: false, code: "IDEMPOTENCY_INTENT_CONFLICT", message: "This promotion key was already used for a different promotion." });
      }
      const current = await User.findById(req.params.userId).select("_id role fullName").lean();
      return res.json({ success: true, duplicate: true, message: "This promotion was already processed.", user: current });
    }
    const session = await mongoose.startSession();
    let updated;
    try {
      await session.withTransaction(async () => {
        const replay = await AdminAuditLog.findOne({
          action: "USER_ROLE_UPDATED",
          "metadata.promotionKey": promotionKey,
        }).session(session).lean();
        if (replay) {
          const metadata = replay.metadata || {};
          if (String(metadata.targetUserId) !== String(req.params.userId) ||
              metadata.sourceRole !== expectedSourceRole ||
              metadata.targetRole !== targetRole) {
            const error = new Error("This promotion key was already used for a different promotion.");
            error.statusCode = 409;
            throw error;
          }
          updated = await User.findById(req.params.userId).session(session).select("_id role fullName");
          return;
        }
        const user = await User.findOne({ _id: req.params.userId, role: sourceByTarget[targetRole], isDeleted: { $ne: true } }).session(session);
        if (!user) {
          const error = new Error("The account is not eligible for this promotion.");
          error.statusCode = 409; throw error;
        }
        const previousRole = user.role;
        user.role = targetRole;
        if (targetRole === "STATE_MANAGER") {
          const previousStateManager = user.stateManagerId
            ? await User.findById(user.stateManagerId).session(session).select("_id zonalManagerId")
            : null;
          user.zonalManagerId = previousStateManager?.zonalManagerId || user.zonalManagerId || null;
          user.stateManagerId = null;
          user.agentId = null;
          user.promotionParentId = previousStateManager?._id || null;
          const children = await User.find({ agentId: user._id, isDeleted: { $ne: true } }).session(session);
          for (const child of children) { child.stateManagerId = user._id; child.agentId = null; await child.save({ session }); }
        } else {
          user.zonalManagerId = null;
          user.stateManagerId = null;
          user.promotionParentId = null;
          const children = await User.find({
            $or: [
              { stateManagerId: user._id },
              { zonalManagerId: user._id },
              { promotionParentId: user._id },
            ],
            isDeleted: { $ne: true },
          }).session(session);
          for (const child of children) {
            child.zonalManagerId = user._id;
            child.stateManagerId = null;
            child.promotionParentId = null;
            await child.save({ session });
          }
        }
        await user.save({ session });
        await AdminAuditLog.create([{
          actorId: req.user._id, actorRole: "HEAD_OFFICE", actorName: req.user.fullName || "",
          targetUserId: user._id, targetUserName: user.fullName, action: "USER_ROLE_UPDATED",
          reason: `Promoted ${previousRole} to ${targetRole}.`,
          previousData: { role: previousRole }, newData: { role: targetRole },
          metadata: {
            promotion: true, promotionKey, sourceRole: previousRole, targetRole,
            targetUserId: String(user._id),
          }, requestMethod: req.method, requestPath: req.originalUrl,
        }], { session });
        updated = user;
      });
    } finally { await session.endSession(); }
    return res.json({ success: true, message: `Account promoted to ${targetRole}.`, user: { id: updated._id, role: updated.role, fullName: updated.fullName } });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.["metadata.promotionKey"]) {
      const replay = await AdminAuditLog.findOne({
        action: "USER_ROLE_UPDATED",
        "metadata.promotionKey": promotionKey,
      }).lean();
      const metadata = replay?.metadata || {};
      if (replay && String(metadata.targetUserId) === String(req.params.userId) &&
          metadata.sourceRole === expectedSourceRole && metadata.targetRole === targetRole) {
        const current = await User.findById(req.params.userId).select("_id role fullName").lean();
        return res.json({ success: true, duplicate: true, message: "This promotion was already processed.", user: current });
      }
      return res.status(409).json({ success: false, code: "IDEMPOTENCY_INTENT_CONFLICT", message: "This promotion key was already used for a different promotion." });
    }
    return res.status(error.statusCode || 500).json({ success: false, message: error.statusCode ? error.message : "Unable to promote account." });
  }
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
