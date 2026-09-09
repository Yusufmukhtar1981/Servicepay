const Notification = require("../models/notification.model");
const User = require("../models/user.model");

// Customer ya ga notifications dinsa
exports.getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.user._id,
    }).sort({ createdAt: -1 });

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      isRead: false,
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount,
      notifications,
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
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    notification.isRead = true;
    notification.readAt = new Date();

    await notification.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      notification,
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
    await Notification.updateMany(
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

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
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

    const notification = await Notification.create({
      userId,
      title: title.trim(),
      message: message.trim(),
      type: type || "GENERAL",
      referenceId: referenceId || null,
      referenceType: referenceType || "",
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
    }).select("_id");

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active users found.",
      });
    }

    const notifications = users.map((user) => ({
      userId: user._id,
      title: title.trim(),
      message: message.trim(),
      type: type || "GENERAL",
      referenceType: referenceType || "",
      isRead: false,
    }));

    await Notification.insertMany(notifications);

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