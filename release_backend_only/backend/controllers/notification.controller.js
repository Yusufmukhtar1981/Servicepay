const Notification = require("../models/notification.model");
const User = require("../models/user.model");
const mongoose = require("mongoose");
const {
  createInAppNotification,
  inferNotificationAction,
  inferNotificationCategory,
  normalizeNotificationType,
} = require("../services/inAppNotification.service");

const clean = (value, max = 200) =>
  String(value ?? "").trim().slice(0, max);

const categoryFilter = (value) => {
  const category = clean(value, 40).toUpperCase();
  return ["TRANSACTION", "SECURITY", "ACCOUNT", "OTHER"].includes(category)
    ? category
    : "";
};

const LEGACY_TRANSACTION_TYPES = [
  "TRANSFER",
  "WALLET",
  "AIRTIME",
  "DATA",
  "CABLE",
  "ELECTRICITY",
  "EXAM_PIN",
  "GROUP_WALLET",
  "WITHDRAWAL",
  "PAYMENT",
];

const legacyCategoryQuery = (category) => {
  const missingCategory = { category: { $exists: false } };
  if (category === "TRANSACTION") {
    return {
      $or: [
        { category },
        {
          ...missingCategory,
          $or: [
            { type: { $in: LEGACY_TRANSACTION_TYPES } },
            { referenceType: /TRANSACTION|PAYMENT/i },
          ],
        },
      ],
    };
  }
  if (category === "SECURITY") {
    return {
      $or: [
        { category },
        {
          ...missingCategory,
          $or: [
            { type: "SECURITY" },
            { referenceType: /SECURITY/i },
          ],
        },
      ],
    };
  }
  if (category === "ACCOUNT") {
    return {
      $or: [
        { category },
        {
          ...missingCategory,
          $or: [
            { type: { $in: ["KYC", "ACCOUNT", "ID_VERIFICATION"] } },
            { referenceType: /KYC|ACCOUNT/i },
          ],
        },
      ],
    };
  }
  return {
    $or: [
      { category: "OTHER" },
      {
        ...missingCategory,
        type: {
          $nin: [
            ...LEGACY_TRANSACTION_TYPES,
            "SECURITY",
            "KYC",
            "ACCOUNT",
            "ID_VERIFICATION",
          ],
        },
        referenceType: { $not: /TRANSACTION|PAYMENT|SECURITY|KYC|ACCOUNT/i },
      },
    ],
  };
};

const cursorFor = (notification) =>
  Buffer.from(
    `${new Date(notification.createdAt).toISOString()}|${notification._id}`,
    "utf8"
  ).toString("base64url");

const cursorQuery = (value) => {
  if (!value) return null;
  try {
    const [dateValue, idValue] = Buffer.from(
      String(value),
      "base64url"
    ).toString("utf8").split("|");
    const date = new Date(dateValue);
    if (
      Number.isNaN(date.getTime()) ||
      !mongoose.Types.ObjectId.isValid(idValue)
    ) {
      return null;
    }
    return {
      $or: [
        { createdAt: { $lt: date } },
        { createdAt: date, _id: { $lt: idValue } },
      ],
    };
  } catch (_) {
    return null;
  }
};

const notificationPayload = (notification) => {
  const value = notification?.toObject
    ? notification.toObject()
    : notification;
  const type = normalizeNotificationType(value?.type);
  const referenceType = clean(value?.referenceType, 120);
  return {
    _id: String(value?._id || ""),
    title: clean(value?.title, 180),
    message: clean(value?.message, 1200),
    type,
    category: inferNotificationCategory({
      category: value?.category,
      type,
      referenceType,
    }),
    referenceId: value?.referenceId ? String(value.referenceId) : null,
    referenceType,
    reference: clean(value?.reference, 200),
    relatedStatus: clean(value?.relatedStatus, 50).toUpperCase(),
    action: inferNotificationAction({
      action: value?.action,
      type,
      referenceType,
    }),
    isRead: value?.isRead === true,
    readAt: value?.readAt || null,
    createdAt: value?.createdAt || null,
    updatedAt: value?.updatedAt || null,
  };
};

// Customer ya ga notifications dinsa
exports.getMyNotifications = async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const filter = { userId: req.user._id };
    const category = categoryFilter(req.query.category);
    if (category) {
      filter.$and = [legacyCategoryQuery(category)];
    }
    if (String(req.query.unread || "").toLowerCase() === "true") {
      filter.isRead = false;
    }
    const search = clean(req.query.search, 100);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$and = [{
        $or: [
          { title: { $regex: escaped, $options: "i" } },
          { message: { $regex: escaped, $options: "i" } },
          { reference: { $regex: escaped, $options: "i" } },
        ],
      }];
    }
    const before = cursorQuery(req.query.before);
    if (before) {
      filter.$and = [...(filter.$and || []), before];
    }

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean(),
      Notification.countDocuments({
        userId: req.user._id,
        isRead: false,
      }),
      Notification.countDocuments(filter),
    ]);
    const hasMore = notifications.length > limit;
    const items = notifications.slice(0, limit);

    return res.status(200).json({
      success: true,
      count: total,
      unreadCount,
      notifications: items.map(notificationPayload),
      pagination: {
        limit,
        hasMore,
        nextCursor: hasMore && items.length
          ? cursorFor(items[items.length - 1])
          : null,
      },
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load notifications.",
      error: error.message,
    });
  }
};

// Customer ya ga unread notification count
exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      unreadCount,
    });
  } catch (error) {
    console.error("Get unread count error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load unread notification count.",
      error: error.message,
    });
  }
};

// Customer ya yi mark notification guda daya as read
exports.markAsRead = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }
    const now = new Date();
    let notification = await Notification.findOneAndUpdate({
      _id: req.params.id,
      userId: req.user._id,
      isRead: false,
    }, {
      $set: { isRead: true, readAt: now },
    }, { new: true });

    if (!notification) {
      notification = await Notification.findOne({
        _id: req.params.id,
        userId: req.user._id,
      });
      if (!notification) {
        return res.status(404).json({
          success: false,
          message: "Notification not found.",
        });
      }
    }

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      notification: notificationPayload(notification),
      unreadCount,
    });
  } catch (error) {
    console.error("Mark notification as read error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update notification.",
      error: error.message,
    });
  }
};

// Customer ya yi mark duk notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        userId: req.user._id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    );
    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
      modifiedCount: result.modifiedCount || 0,
      unreadCount,
    });
  } catch (error) {
    console.error("Mark all notifications as read error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
      error: error.message,
    });
  }
};

exports.getNotificationDetail = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }
    return res.status(200).json({
      success: true,
      notification: notificationPayload(notification),
    });
  } catch (_) {
    return res.status(404).json({
      success: false,
      message: "Notification not found.",
    });
  }
};

// Customer ya goge notification guda daya
exports.deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully.",
    });
  } catch (error) {
    console.error("Delete notification error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete notification.",
      error: error.message,
    });
  }
};

// Customer ya goge duk notifications dinsa
exports.deleteAllNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({
      userId: req.user._id,
    });

    return res.status(200).json({
      success: true,
      message: "All notifications deleted successfully.",
    });
  } catch (error) {
    console.error("Delete all notifications error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to delete notifications.",
      error: error.message,
    });
  }
};

// Admin ya aika notification ga user guda daya
exports.sendNotificationToUser = async (req, res) => {
  try {
    const {
      userId,
      title,
      message,
      type,
      referenceId,
      referenceType,
    } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "User, title and message are required.",
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const notification = await createInAppNotification({
      userId,
      title: title.trim(),
      message: message.trim(),
      type: type || "GENERAL",
      referenceId: referenceId || null,
      referenceType: referenceType || "",
      reference: req.body.reference,
      relatedStatus: req.body.relatedStatus,
      action: req.body.action,
      dedupeKey: req.body.idempotencyKey
        ? `admin:${userId}:${clean(req.body.idempotencyKey, 160)}`
        : undefined,
    });

    return res.status(201).json({
      success: true,
      message: "Notification sent successfully.",
      notification,
    });
  } catch (error) {
    console.error("Send notification error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send notification.",
      error: error.message,
    });
  }
};

// Admin ya aika notification ga duk active users
exports.sendNotificationToAll = async (req, res) => {
  try {
    const {
      title,
      message,
      type,
      referenceType,
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: "Title and message are required.",
      });
    }

    const users = await User.find({
      status: "ACTIVE",
      role: "CUSTOMER",
    }).select("_id");

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active users found.",
      });
    }

    await Promise.all(users.map((user) => createInAppNotification({
      userId: user._id,
      title: title.trim(),
      message: message.trim(),
      type: type || "GENERAL",
      referenceType: referenceType || "",
      dedupeKey: req.body.idempotencyKey
        ? `broadcast:${user._id}:${clean(req.body.idempotencyKey, 160)}`
        : undefined,
    })));

    return res.status(201).json({
      success: true,
      message: `Notification sent to ${users.length} users.`,
      recipientCount: users.length,
    });
  } catch (error) {
    console.error("Send notification to all error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send notifications.",
      error: error.message,
    });
  }
};