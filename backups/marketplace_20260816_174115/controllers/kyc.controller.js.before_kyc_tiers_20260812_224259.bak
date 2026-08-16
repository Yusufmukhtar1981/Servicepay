const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");

const getOrCreateProfile = async (userId) => {
  let profile = await KycProfile.findOne({
    user: userId,
  });

  if (!profile) {
    const user = await User.findById(userId);

    if (!user) {
      return null;
    }

    const fullName = String(user.fullName || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    profile = await KycProfile.create({
      user: user._id,
      firstName: fullName[0] || "",
      middleName:
        fullName.length > 2
          ? fullName.slice(1, -1).join(" ")
          : "",
      lastName:
        fullName.length > 1
          ? fullName[fullName.length - 1]
          : "",
      phone: user.phone || "",
      email: user.email || "",
      state: user.state || "",
      lga: user.lga || "",
      status: "NOT_STARTED",
      level: "TIER_1",
    });
  }

  return profile;
};

exports.getMyKycStatus = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(
      req.user._id
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      kyc: profile,
    });
  } catch (error) {
    console.error("GET KYC STATUS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load KYC status.",
      error: error.message,
    });
  }
};

exports.submitMyKyc = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(
      req.user._id
    );

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "User account was not found.",
      });
    }

    const {
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      gender,
      address,
      state,
      lga,
      selfieUrl,
      idDocumentUrl,
      proofOfAddressUrl,
    } = req.body || {};

    if (
      !String(firstName || "").trim() ||
      !String(lastName || "").trim() ||
      !String(address || "").trim() ||
      !String(state || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "First name, last name, address and state are required.",
      });
    }

    profile.firstName = String(firstName).trim();
    profile.middleName = String(
      middleName || ""
    ).trim();
    profile.lastName = String(lastName).trim();

    if (dateOfBirth) {
      profile.dateOfBirth = new Date(dateOfBirth);
    }

    if (
      ["MALE", "FEMALE", "OTHER"].includes(
        String(gender || "").toUpperCase()
      )
    ) {
      profile.gender =
        String(gender).toUpperCase();
    }

    profile.address = String(address).trim();
    profile.state = String(state).trim();
    profile.lga = String(lga || "").trim();

    profile.selfieUrl = String(
      selfieUrl || profile.selfieUrl || ""
    ).trim();

    profile.idDocumentUrl = String(
      idDocumentUrl ||
        profile.idDocumentUrl ||
        ""
    ).trim();

    profile.proofOfAddressUrl = String(
      proofOfAddressUrl ||
        profile.proofOfAddressUrl ||
        ""
    ).trim();

    profile.status = "PENDING";
    profile.submittedAt = new Date();
    profile.rejectionReason = "";

    await profile.save();

    return res.status(200).json({
      success: true,
      message:
        "KYC submitted successfully and is awaiting review.",
      kyc: profile,
    });
  } catch (error) {
    console.error("SUBMIT KYC ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to submit KYC.",
      error: error.message,
    });
  }
};
