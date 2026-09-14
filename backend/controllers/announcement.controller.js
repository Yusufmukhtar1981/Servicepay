const Announcement = require(
  "../models/announcement.model"
);

const legacySafeAnnouncement = (announcement) => ({
  title: String(announcement?.title || ""),
  message: String(announcement?.message || ""),
  isActive: announcement?.isActive === true,
});

const getAnnouncement = async (req, res) => {
  try {
    const now = new Date();
    const announcement = await Announcement.findOne({
      legacyEligible: { $ne: false },
      isActive: true,
      audience: { $in: ["ALL", null] },
      $and: [
        { $or: [{ startAt: null }, { startAt: { $lte: now } }, { startAt: { $exists: false } }] },
        { $or: [{ endAt: null }, { endAt: { $gt: now } }, { endAt: { $exists: false } }] },
      ],
    })
      .select("title message isActive")
      .sort({
        updatedAt: -1,
      })
      .lean();

    if (!announcement) {
      return res.status(200).json({
        success: true,
        data: {
          announcement: legacySafeAnnouncement(null),
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        announcement: legacySafeAnnouncement(announcement),
      },
    });
  } catch (error) {
    console.error(
      "Get announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to load announcement.",
    });
  }
};

const updateAnnouncement = async (
  req,
  res
) => {
  try {
    const title = String(req.body.title || "").trim();

    const message = String(req.body.message || "").trim();

    const isActive =
      req.body.isActive === true ||
      req.body.isActive === "true";

    if (isActive && !title) {
      return res.status(400).json({
        success: false,
        message:
          "Announcement title is required.",
      });
    }

    if (isActive && !message) {
      return res.status(400).json({
        success: false,
        message:
          "Announcement message is required.",
      });
    }

    if (title.length > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Announcement title is too long.",
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        success: false,
        message:
          "Announcement message is too long.",
      });
    }

    let announcement = await Announcement.findOne({
      $or: [
        { legacyEligible: { $ne: false }, audience: { $exists: false } },
        { legacyEligible: { $ne: false }, audience: "ALL", startAt: null, endAt: null },
      ],
    }).sort({ updatedAt: -1 });

    if (!announcement) {
      announcement = new Announcement();
    }

    announcement.title = title;
    announcement.message = message;
    announcement.isActive = isActive;
    announcement.legacyEligible = true;
    // The singular API deliberately cannot create or mutate targeting,
    // scheduling, CTA, image, style, or metrics fields.
    announcement.updatedBy =
      req.user?._id || null;

    await announcement.save();

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Announcement published successfully."
        : "Announcement disabled successfully.",
      data: {
        announcement: legacySafeAnnouncement(announcement),
      },
    });
  } catch (error) {
    console.error(
      "Update announcement error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update announcement.",
    });
  }
};

module.exports = {
  getAnnouncement,
  updateAnnouncement,
};