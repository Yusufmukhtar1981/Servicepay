const express = require("express");
const router = express.Router();

const {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  sendNotificationToUser,
  sendNotificationToAll,
} = require("../controllers/notification.controller");

const { protect, adminOnly } = require("../middleware/auth.middleware");

// Customer
router.get("/", protect, getMyNotifications);
router.get("/unread-count", protect, getUnreadCount);
router.put("/read-all", protect, markAllAsRead);
router.put("/read/:id", protect, markAsRead);
router.delete("/:id", protect, deleteNotification);
router.delete("/", protect, deleteAllNotifications);

// Admin
router.post("/send", protect, adminOnly("HEAD_OFFICE"), sendNotificationToUser);
router.post("/broadcast", protect, adminOnly("HEAD_OFFICE"), sendNotificationToAll);

module.exports = router;