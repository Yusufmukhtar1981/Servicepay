const {
  getAdminProfile,
  listAdminProfiles,
} = require("../services/trustProfile.service");

const listTrustProfiles = async (req, res) => {
  try {
    const profiles = await listAdminProfiles({
      query: req.query.q,
      limit: req.query.limit,
    });

    return res.status(200).json({
      success: true,
      data: { profiles },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status
        ? error.message
        : "Unable to load Trust profiles.",
    });
  }
};

const getTrustProfile = async (req, res) => {
  try {
    const profile = await getAdminProfile(
      req.params.servicePayId
    );

    return res.status(200).json({
      success: true,
      data: { profile },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status
        ? error.message
        : "Unable to load Trust profile.",
    });
  }
};

module.exports = {
  getTrustProfile,
  listTrustProfiles,
};