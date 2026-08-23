const crypto = require("crypto");

const User = require("../models/user.model");
const KycProfile = require("../models/kycProfile.model");
const IdVerification = require("../models/idVerification.model");
const TrustProfile = require("../models/trustProfile.model");
const {
  calculateTrustScore,
} = require("./trustScore.service");

const MAX_SEARCH_RESULTS = 10;

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizePhone = (value) =>
  String(value || "").replace(/[^\d+]/g, "");

const maskPhone = (value) => {
  const phone = String(value || "").replace(/\D/g, "");

  if (phone.length < 7) {
    return "";
  }

  return `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
};

const safeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const generateServicePayId = () =>
  `SPT-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;

const toPlainProfile = (profile) => {
  if (profile && typeof profile.toObject === "function") {
    return profile.toObject();
  }

  return profile;
};

const profileSourceValues = (user, calculation) => ({
  displayName: String(user?.fullName || "ServicePay Member").trim(),
  displayNameNormalized: normalizeText(user?.fullName),
  businessName: String(user?.businessName || "").trim(),
  businessNameNormalized: normalizeText(user?.businessName),
  profilePhotoUrl: String(user?.profilePhotoUrl || "").trim(),
  identityVerified: calculation.scoreInputs.kycVerified,
  businessVerified: calculation.scoreInputs.businessVerified,
  accountOwnershipVerified:
    calculation.scoreInputs.accountOwnershipVerified,
  memberSince: user?.createdAt || new Date(),
  protectedTransactionsCount: 0,
  protectedTradeVolume: 0,
  completionRate: 0,
  disputesCount: 0,
  resolvedDisputesCount: 0,
  trustScore: calculation.trustScore,
  trustLevel: calculation.trustLevel,
  restricted: calculation.restricted,
  lastCalculatedAt: new Date(),
  scoreInputs: calculation.scoreInputs,
});

const loadScoreSources = async (userId) => {
  const [user, kycProfile, successfulIdentityVerifications] =
    await Promise.all([
      User.findById(userId).lean(),
      KycProfile.findOne({ user: userId }).lean(),
      IdVerification.countDocuments({
        userId,
        status: "SUCCESSFUL",
        consentAccepted: true,
      }),
    ]);

  return {
    user,
    kycProfile,
    successfulIdentityVerifications,
  };
};

const calculationFor = (sources, profile) =>
  calculateTrustScore({
    user: sources.user,
    kycProfile: sources.kycProfile,
    successfulIdentityVerifications:
      sources.successfulIdentityVerifications,
    restricted: profile?.restricted === true,
  });

const allocateServicePayId = async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = generateServicePayId();
    const exists = await TrustProfile.exists({
      servicePayId: candidate,
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate a Trust identifier.");
};

const ensureOwnTrustProfile = async (userId) => {
  const [existing, sources] = await Promise.all([
    TrustProfile.findOne({ user: userId })
      .select("+restrictionReason")
      .lean(),
    loadScoreSources(userId),
  ]);

  if (!sources.user) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const calculation = calculationFor(sources, existing);
  const values = profileSourceValues(sources.user, calculation);

  if (existing) {
    return TrustProfile.findOneAndUpdate(
      { _id: existing._id },
      { $set: values },
      { new: true }
    )
      .select("+restrictionReason")
      .lean();
  }

  try {
    const created = await TrustProfile.create({
      user: userId,
      servicePayId: await allocateServicePayId(),
      discoverable: false,
      ...values,
    });

    return toPlainProfile(created);
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    return TrustProfile.findOneAndUpdate(
      { user: userId },
      { $set: values },
      { new: true }
    )
      .select("+restrictionReason")
      .lean();
  }
};

const refreshProfileForRead = async (profile) => {
  const sources = await loadScoreSources(profile.user);
  const calculation = calculationFor(sources, profile);

  return {
    ...profile,
    ...profileSourceValues(sources.user, calculation),
    restricted: calculation.restricted,
  };
};

const toPublicTrustProfile = (profile, user) => ({
  servicePayId: profile.servicePayId,
  displayName: profile.displayName,
  businessName: profile.businessName || "",
  profilePhotoUrl: profile.profilePhotoUrl || "",
  maskedPhone: maskPhone(user?.phone),
  identityVerified: profile.identityVerified === true,
  businessVerified: profile.businessVerified === true,
  accountOwnershipVerified:
    profile.accountOwnershipVerified === true,
  memberSince: profile.memberSince,
  protectedTransactionsCount: 0,
  protectedTradeVolume: 0,
  completionRate: 0,
  disputesCount: 0,
  resolvedDisputesCount: 0,
  trustScore: Number(profile.trustScore || 0),
  trustLevel: profile.trustLevel,
  restricted: profile.restricted === true,
  discoverable: profile.discoverable === true,
  lastCalculatedAt: profile.lastCalculatedAt,
});

const toAdminTrustProfile = (profile, user) => ({
  ...toPublicTrustProfile(profile, user),
  scoreInputs: profile.scoreInputs || {},
  restrictionReason: profile.restrictionReason || "",
  accountStatus: String(user?.status || "").toUpperCase(),
});

const isPubliclyAvailable = (profile, user) =>
  profile?.discoverable === true &&
  profile?.restricted !== true &&
  String(user?.status || "").toUpperCase() === "ACTIVE";

const hydrateProfiles = async (profiles) => {
  const ids = profiles.map((profile) => profile.user);
  const users = await User.find({ _id: { $in: ids } })
    .select("phone status")
    .lean();
  const usersById = new Map(
    users.map((user) => [String(user._id), user])
  );

  const refreshed = await Promise.all(
    profiles.map((profile) => refreshProfileForRead(profile))
  );

  return refreshed.map((profile) => ({
    profile,
    user: usersById.get(String(profile.user)),
  }));
};

const classifySearch = (query, requestedKind) => {
  const kind = String(requestedKind || "auto")
    .trim()
    .toLowerCase();
  const cleanQuery = String(query || "").trim();

  if (!cleanQuery) {
    const error = new Error("Enter a search value.");
    error.status = 400;
    throw error;
  }

  if (
    !["auto", "phone", "servicepay_id", "business_name"].includes(
      kind
    )
  ) {
    const error = new Error("Invalid Trust search type.");
    error.status = 400;
    throw error;
  }

  if (kind === "servicepay_id" || /^SPT-/i.test(cleanQuery)) {
    if (!/^SPT-[A-Z0-9]{12}$/i.test(cleanQuery)) {
      const error = new Error("Enter a valid ServicePay Trust ID.");
      error.status = 400;
      throw error;
    }
    return { kind: "servicepay_id", value: cleanQuery.toUpperCase() };
  }

  const digits = cleanQuery.replace(/\D/g, "");
  if (kind === "phone" || (kind === "auto" && /^\+?\d+$/.test(cleanQuery))) {
    if (digits.length < 8 || digits.length > 15) {
      const error = new Error("Enter a valid phone number.");
      error.status = 400;
      throw error;
    }
    return { kind: "phone", value: normalizePhone(cleanQuery) };
  }

  if (cleanQuery.length < 3 || cleanQuery.length > 120) {
    const error = new Error(
      "Business name searches must contain 3 to 120 characters."
    );
    error.status = 400;
    throw error;
  }

  return {
    kind: "business_name",
    value: normalizeText(cleanQuery),
  };
};

const findDiscoverableProfiles = async ({ query, kind }) => {
  const search = classifySearch(query, kind);
  const discoverableFilter = {
    discoverable: true,
    restricted: false,
  };

  if (search.kind === "servicepay_id") {
    return TrustProfile.find({
      ...discoverableFilter,
      servicePayId: search.value,
    })
      .limit(1)
      .lean();
  }

  if (search.kind === "business_name") {
    const prefix = new RegExp(`^${safeRegex(search.value)}`, "i");
    return TrustProfile.find({
      ...discoverableFilter,
      businessNameNormalized: prefix,
    })
      .sort({ trustScore: -1, createdAt: 1 })
      .limit(MAX_SEARCH_RESULTS)
      .lean();
  }

  const phoneVariants = [
    search.value,
    search.value.replace(/^\+/, ""),
  ];
  const users = await User.find({
    phone: { $in: phoneVariants },
    status: "ACTIVE",
  })
    .select("_id")
    .limit(1)
    .lean();

  if (users.length === 0) {
    return [];
  }

  return TrustProfile.find({
    ...discoverableFilter,
    user: users[0]._id,
  })
    .limit(1)
    .lean();
};

const searchPublicProfiles = async ({ query, kind }) => {
  const profiles = await findDiscoverableProfiles({ query, kind });
  const hydrated = await hydrateProfiles(profiles);

  return hydrated
    .filter(
      ({ profile, user }) =>
        isPubliclyAvailable(profile, user)
    )
    .map(({ profile, user }) => toPublicTrustProfile(profile, user));
};

const getPublicProfile = async (servicePayId) => {
  const cleanId = String(servicePayId || "").trim().toUpperCase();

  if (!/^SPT-[A-Z0-9]{12}$/.test(cleanId)) {
    const error = new Error("Trust profile unavailable.");
    error.status = 404;
    throw error;
  }

  const profile = await TrustProfile.findOne({
    servicePayId: cleanId,
    discoverable: true,
    restricted: false,
  }).lean();

  if (!profile) {
    const error = new Error("Trust profile unavailable.");
    error.status = 404;
    throw error;
  }

  const [{ profile: refreshed, user }] = await hydrateProfiles([profile]);

  if (!isPubliclyAvailable(refreshed, user)) {
    const error = new Error("Trust profile unavailable.");
    error.status = 404;
    throw error;
  }

  return toPublicTrustProfile(refreshed, user);
};

const getOwnProfile = async (userId) => {
  const profile = await ensureOwnTrustProfile(userId);
  const sources = await loadScoreSources(profile.user);
  const user = sources.user;
  const calculation = calculationFor(sources, profile);
  const refreshed = {
    ...profile,
    ...profileSourceValues(user, calculation),
    restricted: calculation.restricted,
  };

  return toPublicTrustProfile(refreshed, user);
};

const updateDiscoverability = async ({
  userId,
  discoverable,
}) => {
  const profile = await ensureOwnTrustProfile(userId);

  const updated = await TrustProfile.findOneAndUpdate(
    { _id: profile._id, user: userId },
    { $set: { discoverable } },
    { new: true }
  )
    .select("+restrictionReason")
    .lean();

  return getOwnProfile(updated.user);
};

const listAdminProfiles = async ({
  query = "",
  limit = 20,
}) => {
  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 20, 1),
    50
  );
  const normalizedQuery = normalizeText(query);
  const filter = {};

  if (normalizedQuery) {
    if (/^SPT-[A-Z0-9]{12}$/i.test(normalizedQuery)) {
      filter.servicePayId = normalizedQuery.toUpperCase();
    } else if (normalizedQuery.length >= 3) {
      const prefix = new RegExp(
        `^${safeRegex(normalizedQuery)}`,
        "i"
      );
      filter.$or = [
        { displayNameNormalized: prefix },
        { businessNameNormalized: prefix },
      ];
    } else {
      const error = new Error(
        "Admin Trust searches must contain at least 3 characters."
      );
      error.status = 400;
      throw error;
    }
  }

  const profiles = await TrustProfile.find(filter)
    .sort({ updatedAt: -1 })
    .limit(safeLimit)
    .select("+restrictionReason")
    .lean();
  const hydrated = await hydrateProfiles(profiles);

  return hydrated.map(({ profile, user }) =>
    toAdminTrustProfile(profile, user)
  );
};

const getAdminProfile = async (servicePayId) => {
  const profile = await TrustProfile.findOne({
    servicePayId: String(servicePayId || "").trim().toUpperCase(),
  })
    .select("+restrictionReason")
    .lean();

  if (!profile) {
    const error = new Error("Trust profile not found.");
    error.status = 404;
    throw error;
  }

  const [{ profile: refreshed, user }] = await hydrateProfiles([profile]);
  return toAdminTrustProfile(refreshed, user);
};

module.exports = {
  MAX_SEARCH_RESULTS,
  classifySearch,
  ensureOwnTrustProfile,
  getAdminProfile,
  getOwnProfile,
  getPublicProfile,
  isPubliclyAvailable,
  listAdminProfiles,
  maskPhone,
  searchPublicProfiles,
  toAdminTrustProfile,
  toPlainProfile,
  toPublicTrustProfile,
  updateDiscoverability,
};