const User = require("../models/user.model");
const Profile = require("../models/businessPartnerProfile.model");
const {
  permissionsForBusinessPartnerServices,
} = require("../config/businessPartnerPermissions");

const normalizedRole = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

async function ensureBusinessPartnerViewAccess(user, options = {}) {
  if (!user || normalizedRole(user.role) !== "BUSINESS_PARTNER") return null;

  const query = Profile.findOne({
    user: user._id,
    status: "ACTIVE",
  });
  if (options.session) query.session(options.session);
  const profile = await query;
  if (!profile || String(profile.user) !== String(user._id)) return null;

  const existingPermissions = Array.isArray(profile.permissions)
    ? profile.permissions
    : [];
  const permissions = permissionsForBusinessPartnerServices(
    profile.services,
    existingPermissions
  );
  const permissionsChanged =
    permissions.length !== existingPermissions.length ||
    permissions.some((permission) => !existingPermissions.includes(permission));
  if (permissionsChanged) {
    profile.permissions = permissions;
    await profile.save({ session: options.session });
  }

  const profileId = String(profile._id);
  const linksChanged =
    String(user.businessPartnerProfile || "") !== profileId ||
    String(user.businessPartnerId || "") !== profileId;
  if (linksChanged) {
    await User.updateOne(
      { _id: user._id, role: "BUSINESS_PARTNER" },
      {
        $set: {
          businessPartnerProfile: profile._id,
          businessPartnerId: profile._id,
        },
      },
      { session: options.session }
    );
    user.businessPartnerProfile = profile._id;
    user.businessPartnerId = profile._id;
  }

  return profile;
}

module.exports = {
  ensureBusinessPartnerViewAccess,
};