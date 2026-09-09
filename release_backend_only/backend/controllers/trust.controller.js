const {
  getOwnProfile,
  getPublicProfile,
  searchPublicProfiles,
  updateDiscoverability,
} = require("../services/trustProfile.service");

const currentUserId = (req) =>
  req.user?._id || req.user?.id;

const sendError = (res, error, fallback) =>
  res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : fallback,
  });

const searchTrustProfiles = async (req, res) => {
  try {
    const profiles = await searchPublicProfiles({
      query: req.query.q,
      kind: req.query.kind,
    });

    return res.status(200).json({
      success: true,
      message: "Trust profiles loaded successfully.",
      data: { profiles },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Unable to search Trust profiles."
    );
  }
};

const getTrustProfile = async (req, res) => {
  try {
    const profile = await getPublicProfile(
      req.params.servicePayId
    );

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Unable to load Trust profile."
    );
  }
};

const getMyTrustProfile = async (req, res) => {
  try {
    const userId = currentUserId(req);
    const profile = await getOwnProfile(userId);

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Unable to load your Trust profile."
    );
  }
};

const updateMyDiscoverability = async (req, res) => {
  try {
    if (typeof req.body?.discoverable !== "boolean") {
      return res.status(400).json({
        success: false,
        message:
          "Discoverability must be provided as true or false.",
      });
    }

    const profile = await updateDiscoverability({
      userId: currentUserId(req),
      discoverable: req.body.discoverable,
    });

    return res.status(200).json({
      success: true,
      message: "Trust profile discoverability updated.",
      data: { profile },
    });
  } catch (error) {
    return sendError(
      res,
      error,
      "Unable to update Trust discoverability."
    );
  }
};

module.exports = {
  getMyTrustProfile,
  getTrustProfile,
  searchTrustProfiles,
  updateMyDiscoverability,
};