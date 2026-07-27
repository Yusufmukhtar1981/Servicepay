const Announcement = require(
  "../models/announcement.model"
);

const getAnnouncement = async (req, res) => {
  try {
    const announcement = await Announcement.findOne()
      .sort({
        updatedAt: -1,
      })
      .lean();

    if (!announcement) {
      return res.status(200).json({
        success: true,
        data: {
          announcement: {
            title: "",
            message: "",
            isActive: false,
          },
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        announcement,
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
    const title = String(
      req.body.title || ""
    ).trim();

    const message = String(
      req.body.message || ""
    ).trim();

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

    let announcement =
      await Announcement.findOne().sort({
        updatedAt: -1,
      });

    if (!announcement) {
      announcement = new Announcement();
    }

    announcement.title = title;
    announcement.message = message;
    announcement.isActive = isActive;
    announcement.updatedBy =
      req.user?._id || null;

    await announcement.save();

    return res.status(200).json({
      success: true,
      message: isActive
        ? "Announcement published successfully."
        : "Announcement disabled successfully.",
      data: {
        announcement,
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