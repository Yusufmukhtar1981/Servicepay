const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const AccountRestriction = require("../models/accountRestriction.model");
const FintechWatchlist = require("../models/fintechWatchlist.model");
const LoginSecurityEvent = require("../models/loginSecurityEvent.model");
const {
  ensureBusinessPartnerViewAccess,
} = require("../services/businessPartnerAccess.service");

const { v2: cloudinary } = require("cloudinary");


const axios = require("axios");

// ============================================================
// SERVICEPAY_NIN_REGISTRATION_HELPER
// Mandatory identity verification for NEW customer registration.
// This does NOT debit the customer's ServicePay wallet.
// ============================================================

const SERVICEPAY_ONBOARDING_PREMBLY_BASE_URL =
  process.env.PREMBLY_BASE_URL || "https://api.prembly.com";

const SERVICEPAY_ONBOARDING_PREMBLY_SECRET_KEY = process.env.PREMBLY_SECRET_KEY || "";

const servicePayOnboardingPremblyHeaders = () => {
  return {
    "Content-Type": "application/json",
    "x-api-key": SERVICEPAY_ONBOARDING_PREMBLY_SECRET_KEY,
  };
};

const servicePayMaskNin = (value) => {
  const digits = String(value || "").replace(/\D/g, "");

  if (digits.length !== 11) {
    return "";
  }

  return `${digits.slice(0, 3)}*****${digits.slice(-3)}`;
};

const servicePayExtractOnboardingNinData = (payload) => {
  const possibleSources = [
    payload?.data,
    payload?.nin_data,
    payload?.data?.nin_data,
    payload?.response?.data,
    payload?.response?.nin_data,
    payload?.verificationData,
    payload,
  ];

  for (const source of possibleSources) {
    if (!source || typeof source !== "object") continue;

    const firstName =
      source.firstName ||
      source.firstname ||
      source.first_name ||
      source.first ||
      "";

    const middleName =
      source.middleName ||
      source.middlename ||
      source.middle_name ||
      "";

    const lastName =
      source.lastName ||
      source.lastname ||
      source.surname ||
      source.last_name ||
      "";

    const composedName =
      [firstName, middleName, lastName]
        .map((v) => String(v || "").trim())
        .filter(Boolean)
        .join(" ")
        .trim();

    const fullName =
      source.fullName ||
      source.full_name ||
      source.name ||
      composedName;

    if (String(fullName || "").trim()) {
      return {
        fullName: String(fullName).trim(),

        reference:
          source.reference ||
          source.ref ||
          source.transaction_reference ||
          source.verification_reference ||
          payload?.reference ||
          payload?.data?.reference ||
          "",
      };
    }
  }

  return {
    fullName: "",
    reference:
      payload?.reference ||
      payload?.data?.reference ||
      "",
  };
};

const servicePayVerifyRegistrationNin = async (nin) => {
  const cleanNin = String(nin || "").replace(/\D/g, "");

  if (!/^\d{11}$/.test(cleanNin)) {
    const error = new Error(
      "Please enter a valid 11-digit NIN."
    );
    error.code = "INVALID_NIN";
    throw error;
  }

  if (!SERVICEPAY_ONBOARDING_PREMBLY_SECRET_KEY) {
    const error = new Error(
      "NIN verification service is not configured."
    );
    error.code = "NIN_SERVICE_NOT_CONFIGURED";
    throw error;
  }

  let response;

  try {
    response = await axios.post(
      `${SERVICEPAY_ONBOARDING_PREMBLY_BASE_URL}/verification/vnin`,
      {
        number_nin: cleanNin,
      },
      {
        headers: servicePayOnboardingPremblyHeaders(),
        timeout: 45000,
      }
    );
  } catch (error) {
    const providerMessage =
      error?.response?.data?.message ||
      error?.response?.data?.detail ||
      error?.message ||
      "NIN verification request failed.";

    const verificationError = new Error(providerMessage);
    verificationError.code = "NIN_VERIFICATION_FAILED";
    throw verificationError;
  }

  const responseData = response?.data || {};

  const ninData =
    servicePayExtractOnboardingNinData(responseData);

  if (!ninData.fullName) {
    const error = new Error(
      responseData?.message ||
      responseData?.detail ||
      "No valid NIN data returned from provider."
    );

    error.code = "NIN_NOT_VERIFIED";
    throw error;
  }

  return {
    verified: true,
    maskedNin: servicePayMaskNin(cleanNin),
    reference:
      ninData.reference ||
      `NIN-ONBOARD-${Date.now()}`,
  };
};

// ============================================================
// END SERVICEPAY_NIN_REGISTRATION_HELPER
// ============================================================

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const { sendEmail } = require("../services/email.service");

const { validateStrongPassword, validateTransactionPin } = require('../utils/passwordPolicy');

const generateToken = (userId) => {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is missing from environment variables."
    );
  }

  return jwt.sign(
    {
      id: userId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

const recordLoginSecurityEvent = async (req, {
  user = null,
  identifier = "",
  outcome,
}) => {
  try {
    await LoginSecurityEvent.create({
      user: user?._id || null,
      identifier: String(identifier || "").trim().toLowerCase(),
      outcome,
      ipAddress: String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim(),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 1000),
    });
  } catch (error) {
    console.error("LOGIN SECURITY EVENT ERROR:", error.message);
  }
};

const loginIsRestricted = async (user) => {
  const identifiers = [
    String(user._id || "").toLowerCase(),
    String(user.phone || "").trim().toLowerCase(),
    String(user.email || "").trim().toLowerCase(),
  ].filter(Boolean);
  const active = {
    status: "ACTIVE",
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  const [restriction, blacklist] = await Promise.all([
    AccountRestriction.findOne({
      ...active,
      user: user._id,
      type: { $in: ["FULL_FREEZE", "BLOCK_LOGIN"] },
    }).lean(),
    FintechWatchlist.findOne({
      status: "BLACKLISTED",
      identifierValue: { $in: identifiers },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).lean(),
  ]);
  return Boolean(restriction || blacklist);
};

const formatUser = (user) => {
  return {
    id: user._id,
    _id: user._id,

    fullName: user.fullName,
    phone: user.phone,
    email: user.email,

    role: user.role,
    status: user.status,

    zone: user.zone,
    state: user.state,
    lga: user.lga,
      dateOfBirth: user.dateOfBirth || null,
      gender: user.gender || "",

    zonalManagerId:
      user.zonalManagerId,

    stateManagerId:
      user.stateManagerId,

    agentId:
      user.agentId,

    walletBalance: Number(
      user.walletBalance || 0
    ),

    commissionBalance: Number(
      user.commissionBalance || 0
    ),

    totalEarnings: Number(
      user.totalEarnings || 0
    ),

    totalTransactions: Number(
      user.totalTransactions || 0
    ),

    kycVerified:
      user.kycVerified === true,

    transactionPinSet:
      user.transactionPinSet === true,

    virtualAccount:
      user.virtualAccount || null,

    /*
     * Delivery Rider information.
     */
    riderId:
      user.riderId || null,

    riderState:
      user.riderState ||
      user.state ||
      null,

    riderLga:
      user.riderLga ||
      user.lga ||
      null,

    riderAddress:
      user.riderAddress || null,

    vehicleType:
      user.vehicleType || null,

    plateNumber:
      user.plateNumber || null,

    availabilityStatus:
      user.availabilityStatus ||
      "OFFLINE",

    riderVerificationStatus:
      user.riderVerificationStatus ||
      "NOT_SUBMITTED",

    riderVerificationNote:
      user.riderVerificationNote ||
      null,

    riderVerifiedAt:
      user.riderVerifiedAt ||
      null,

    riderJoinedAt:
      user.riderJoinedAt ||
      null,

    riderLastOnlineAt:
      user.riderLastOnlineAt ||
      null,

    riderEmergencyContactName:
      user.riderEmergencyContactName ||
      null,

    riderEmergencyContactPhone:
      user.riderEmergencyContactPhone ||
      null,

    totalRiderEarnings: Number(
      user.totalRiderEarnings || 0
    ),

    pendingRiderSettlement: Number(
      user.pendingRiderSettlement || 0
    ),

    settledRiderEarnings: Number(
      user.settledRiderEarnings || 0
    ),

    totalAssignedDeliveries: Number(
      user.totalAssignedDeliveries || 0
    ),

    totalAcceptedDeliveries: Number(
      user.totalAcceptedDeliveries || 0
    ),

    totalCompletedDeliveries: Number(
      user.totalCompletedDeliveries || 0
    ),

    totalRejectedDeliveries: Number(
      user.totalRejectedDeliveries || 0
    ),

    riderRating: Number(
      user.riderRating || 0
    ),

    riderRatingCount: Number(
      user.riderRatingCount || 0
    ),

    riderCurrentLocation:
      user.riderCurrentLocation ||
      null,

    /*
     * Staff information.
     */
    isStaff:
      user.isStaff === true,

    staffId:
      user.staffId || null,

    department:
      user.department || null,

    mustChangePassword:
      user.mustChangePassword === true,

    lastStaffLoginAt:
      user.lastStaffLoginAt || null,

    staffRole:
      user.staffRoleId &&
      typeof user.staffRoleId ===
        "object" &&
      user.staffRoleId.name
        ? {
            id:
              user.staffRoleId._id ||
              user.staffRoleId.id,

            name:
              user.staffRoleId.name,

            displayName:
              user.staffRoleId
                .displayName,

            department:
              user.staffRoleId
                .department,

            permissions:
              Array.isArray(
                user.staffRoleId
                  .permissions
              )
                ? user.staffRoleId
                    .permissions
                : [],

            status:
              user.staffRoleId.status,
          }
        : null,

    permissions:
      user.staffRoleId &&
      typeof user.staffRoleId ===
        "object" &&
      Array.isArray(
        user.staffRoleId.permissions
      )
        ? user.staffRoleId
            .permissions
        : [],

    createdAt:
      user.createdAt,

    updatedAt:
      user.updatedAt,
  };
};

exports.registerUser = async (
  req,
  res
) => {

  // SERVICEPAY_SECURE_REGISTRATION_POLICY
  // Applied only when creating a NEW account.
  // Existing customers are unaffected.
  {
    const passwordCheck = validateStrongPassword(req.body.password);

    if (!passwordCheck.valid) {
      return res.status(400).json({
        success: false,
        message: passwordCheck.message,
        code: 'WEAK_PASSWORD',
      });
    }

    if (req.body.transactionPin !== undefined &&
        req.body.transactionPin !== null &&
        String(req.body.transactionPin).trim() !== '') {

      const pinCheck = validateTransactionPin(req.body.transactionPin);

      if (!pinCheck.valid) {
        return res.status(400).json({
          success: false,
          message: pinCheck.message,
          code: 'INVALID_TRANSACTION_PIN',
        });
      }
    }

    if (req.body.acceptTerms !== true) {
      return res.status(400).json({
        success: false,
        message: 'You must accept the Terms and Privacy Policy.',
        code: 'TERMS_REQUIRED',
      });
    }
  }


  try {
    const {
      fullName,
      phone,
      email,
      password,
      zone,
      state,
      lga,
      zonalManagerId,
      stateManagerId,
      agentId,
    dateOfBirth,
    gender,
  } = req.body;

    const cleanFullName = String(
      fullName || ""
    ).trim();

    const cleanPhone = String(
      phone || ""
    ).trim();

    const cleanEmail = String(
      email || ""
    )
      .trim()
      .toLowerCase();

    const cleanPassword = String(
      password || ""
    );

    if (
      !cleanFullName ||
      !cleanPhone ||
      !cleanPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Full name, phone number and password are required.",
      });
    }

    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    const duplicateConditions = [
      {
        phone: cleanPhone,
      },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser =
      await User.findOne({
        $or: duplicateConditions,
      });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "An account already exists with this phone number or email.",
      });
    }

    
    // ========================================================

  // ============================================================
  // SERVICEPAY_REGISTRATION_NIN_PENDING
  // NIN remains mandatory for new customer registration.
  // Registration is NOT blocked by external NIN provider failure.
  // Verification will be completed separately/manual review.
  // ============================================================

  const registrationNin = String(
    req.body.nin ||
    req.body.ninNumber ||
    req.body.nin_number ||
    ""
  ).replace(/\D/g, "");

  if (!/^\d{11}$/.test(registrationNin)) {
    return res.status(400).json({
      success: false,
      message: "Please provide a valid 11-digit NIN.",
      code: "INVALID_NIN",
    });
  }

  const onboardingNinResult = {
    maskedNin: `*******${registrationNin.slice(-4)}`,
    reference: undefined,
    status: "PENDING",
  };

  
    const servicePayRegistrationPin = String(
      req.body?.transactionPin ||
      req.body?.transactionPIN ||
      req.body?.pin ||
      ""
    ).trim();

    if (servicePayRegistrationPin && !/^\d{4}$/.test(servicePayRegistrationPin)) {
      return res.status(400).json({
        success: false,
        message: "Transaction PIN must be exactly 4 digits.",
      });
    }

const user = await User.create({
      
      // SERVICEPAY_REGISTRATION_NIN_METADATA
      ninNumberMasked:
        onboardingNinResult.maskedNin,

      ninVerificationStatus: "PENDING",

      ninVerificationReference:
        onboardingNinResult.reference,

      ninVerifiedAt: undefined,

fullName: cleanFullName,
      phone: cleanPhone,
      email:
        cleanEmail || undefined,
      password: cleanPassword,

      /*
       * Only CUSTOMER accounts can register
       * through the public ServicePay app.
       */
      
    dateOfBirth:
      dateOfBirth && !Number.isNaN(Date.parse(String(dateOfBirth)))
        ? new Date(String(dateOfBirth))
        : undefined,

    gender:
      ["MALE", "FEMALE", "OTHER"].includes(
        String(gender || "").trim().toUpperCase()
      )
        ? String(gender).trim().toUpperCase()
        : "",
    role: "CUSTOMER",
      status: "ACTIVE",
      walletBalance: 0,
      commissionBalance: 0,
      totalEarnings: 0,
      totalTransactions: 0,
      transactionPinSet: Boolean(servicePayRegistrationPin),

      zone:
        String(zone || "").trim() ||
        undefined,

      state:
        String(state || "").trim() ||
        undefined,

      lga:
        String(lga || "").trim() ||
        undefined,

      zonalManagerId:
        zonalManagerId || undefined,

      stateManagerId:
        stateManagerId || undefined,

      agentId:
        agentId || undefined,
    });

    return res.status(201).json({
      success: true,
      message:
        "Account created successfully.",
      token: generateToken(user._id),
      user: formatUser(user),
    });
  } catch (error) {
    console.error(
      "Register error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "An account already exists with this phone number or email.",
      });
    }

    if (
      error?.name ===
      "ValidationError"
    ) {
      const validationMessage =
        Object.values(
          error.errors || {}
        )
          .map(
            (item) =>
              item.message
          )
          .join(", ");

      return res.status(400).json({
        success: false,
        message:
          validationMessage ||
          "Invalid registration information.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to create account.",
      error: error.message,
    });
  }
};

exports.loginUser = async (
  req,
  res
) => {
  try {
    const {
      phone,
      email,
      identifier,
      password,
    } = req.body;

    const loginValue =
      email ||
      phone ||
      identifier;

    if (
      !loginValue ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Email or phone number and password are required.",
      });
    }

    const cleanLoginValue = String(
      loginValue
    ).trim();

    const normalizedEmail =
      cleanLoginValue.toLowerCase();

    /*
     * Password uses select:false in user.model.js.
     * We must explicitly request it with +password.
     */
    const user = await User.findOne({
      $or: [
        {
          email: normalizedEmail,
        },
        {
          phone: cleanLoginValue,
        },
      ],
    }).select("+password");

    if (!user) {
      await recordLoginSecurityEvent(req, {
        identifier: cleanLoginValue,
        outcome: "FAILED",
      });
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    const userStatus = String(
      user.status || "ACTIVE"
    )
      .trim()
      .toUpperCase();

    if (
      userStatus !== "ACTIVE"
    ) {
      await recordLoginSecurityEvent(req, {
        user,
        identifier: cleanLoginValue,
        outcome: "FAILED",
      });
      return res.status(403).json({
        success: false,
        message:
          "This account is not active.",
      });
    }

    const savedPassword =
      typeof user.password ===
      "string"
        ? user.password
        : "";

    if (!savedPassword) {
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    const passwordIsHashed =
      savedPassword.startsWith(
        "$2a$"
      ) ||
      savedPassword.startsWith(
        "$2b$"
      ) ||
      savedPassword.startsWith(
        "$2y$"
      );

    let passwordIsCorrect = false;

    if (passwordIsHashed) {
      passwordIsCorrect =
        await user.comparePassword(
          String(password)
        );
    } else {
      /*
       * This supports older accounts whose
       * passwords were saved before bcrypt.
       */
      passwordIsCorrect =
        String(password) ===
        savedPassword;

      if (passwordIsCorrect) {
        user.password =
          String(password);

        /*
         * user.model.js will hash it
         * automatically before saving.
         */
        
    if (servicePayRegistrationPin) {
      if ("transactionPin" in user) {
        user.transactionPin = servicePayRegistrationPin;
      }

      if ("transactionPIN" in user) {
        user.transactionPIN = servicePayRegistrationPin;
      }

      if ("pin" in user && !user.pin) {
        user.pin = servicePayRegistrationPin;
      }

      /*
       * If the model exposes a dedicated setter/method, use it.
       * Otherwise save a bcrypt hash in the standard transactionPinHash field.
       */
      if (typeof user.setTransactionPin === "function") {
        await user.setTransactionPin(servicePayRegistrationPin);
      } else if ("transactionPinHash" in user || user.schema?.path?.("transactionPinHash")) {
        const bcryptLib =
          typeof bcrypt !== "undefined"
            ? bcrypt
            : require("bcryptjs");
        user.transactionPinHash = await bcryptLib.hash(
          servicePayRegistrationPin,
          10
        );
      }

      user.transactionPinSet = true;
    }

await user.save();

        console.log(
          `Password migrated to bcrypt for ${
            user.email ||
            user.phone
          }`
        );
      }
    }

    if (!passwordIsCorrect) {
      await recordLoginSecurityEvent(req, {
        user,
        identifier: cleanLoginValue,
        outcome: "FAILED",
      });
      return res.status(401).json({
        success: false,
        message:
          "Incorrect email, phone number or password.",
      });
    }

    if (
      String(user.role || "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_") === "BUSINESS_PARTNER"
    ) {
      const businessPartnerProfile =
        await ensureBusinessPartnerViewAccess(user);
      if (!businessPartnerProfile) {
        await recordLoginSecurityEvent(req, {
          user,
          identifier: cleanLoginValue,
          outcome: "FAILED",
        });
        return res.status(403).json({
          success: false,
          message:
            "This Business Partner account is unavailable or inactive.",
        });
      }
    }

    /*
     * Load the assigned staff role only for internal staff accounts.
     * Existing customer and network-manager logins remain unchanged.
     */
    if (
      String(user.role || "")
        .trim()
        .toUpperCase() === "STAFF" &&
      user.isStaff === true
    ) {
      await user.populate({
        path: "staffRoleId",
        select:
          "name displayName department permissions status",
      });

      if (
        !user.staffRoleId ||
        user.staffRoleId.status !== "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your assigned staff role is unavailable or inactive.",
        });
      }

      user.lastStaffLoginAt = new Date();

      await user.save({
        validateBeforeSave: false,
      });
    }

    if (await loginIsRestricted(user)) {
      await recordLoginSecurityEvent(req, {
        user,
        identifier: cleanLoginValue,
        outcome: "FAILED",
      });
      return res.status(403).json({
        success: false,
        message: "This account is restricted from signing in. Contact ServicePay support.",
      });
    }

    await recordLoginSecurityEvent(req, {
      user,
      identifier: cleanLoginValue,
      outcome: "SUCCESS",
    });

    return res.status(200).json({
      success: true,
      message:
        "Login successful.",
      token: generateToken(
        user._id
      ),
      user: formatUser(user),
    });
  } catch (error) {
    console.error(
      "Login error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to sign in at the moment.",
      error: error.message,
    });
  }
};

exports.getProfile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const user =
      await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Profile fetched successfully.",
      user: formatUser(user),
      data: {
        user: formatUser(user),
      },
    });
  } catch (error) {
    console.error(
      "Get profile error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to fetch your profile.",
    });
  }
};

exports.updateProfile = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const {
      fullName,
      phone,
      email,
      state,
      lga,
      zone,
    } = req.body;

    const user =
      await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    const cleanFullName =
      fullName === undefined
        ? user.fullName
        : String(
            fullName
          ).trim();

    const cleanPhone =
      phone === undefined
        ? user.phone
        : String(phone).trim();

    const cleanEmail =
      email === undefined
        ? String(
            user.email || ""
          )
        : String(email)
            .trim()
            .toLowerCase();

    if (!cleanFullName) {
      return res.status(400).json({
        success: false,
        message:
          "Full name is required.",
      });
    }

    if (
      !cleanPhone ||
      cleanPhone.length < 10
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid phone number.",
      });
    }

    const duplicateConditions = [
      {
        phone: cleanPhone,
        _id: {
          $ne: userId,
        },
      },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
        _id: {
          $ne: userId,
        },
      });
    }

    const existingUser =
      await User.findOne({
        $or: duplicateConditions,
      });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "Another account already uses this phone number or email.",
      });
    }

    user.fullName =
      cleanFullName;

    user.phone =
      cleanPhone;

    user.email =
      cleanEmail || undefined;

    if (state !== undefined) {
      user.state =
        String(
          state || ""
        ).trim() || undefined;
    }

    if (lga !== undefined) {
      user.lga =
        String(
          lga || ""
        ).trim() || undefined;
    }

    if (zone !== undefined) {
      user.zone =
        String(
          zone || ""
        ).trim() || undefined;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Profile updated successfully.",
      user: formatUser(user),
      data: {
        user: formatUser(user),
      },
    });
  } catch (error) {
    console.error(
      "Update profile error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(400).json({
        success: false,
        message:
          "Another account already uses this phone number or email.",
      });
    }

    if (
      error?.name ===
      "ValidationError"
    ) {
      const message =
        Object.values(
          error.errors || {}
        )
          .map(
            (item) =>
              item.message
          )
          .join(", ");

      return res.status(400).json({
        success: false,
        message:
          message ||
          "Invalid profile information.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to update your profile.",
    });
  }
};

exports.changePassword = async (
  req,
  res
) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication is required.",
      });
    }

    const {
      currentPassword,
      newPassword,
      confirmPassword,
    } = req.body;

    if (
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Current password, new password and confirmation are required.",
      });
    }

    if (
      String(newPassword)
        .length < 6
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password must contain at least 6 characters.",
      });
    }

    if (
      String(newPassword) !==
      String(confirmPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation do not match.",
      });
    }

    if (
      String(currentPassword) ===
      String(newPassword)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be different from the current password.",
      });
    }

    const user =
      await User.findById(
        userId
      ).select("+password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account not found.",
      });
    }

    const savedPassword =
      typeof user.password ===
      "string"
        ? user.password
        : "";

    if (!savedPassword) {
      return res.status(400).json({
        success: false,
        message:
          "Current password is incorrect.",
      });
    }

    const passwordIsHashed =
      savedPassword.startsWith(
        "$2a$"
      ) ||
      savedPassword.startsWith(
        "$2b$"
      ) ||
      savedPassword.startsWith(
        "$2y$"
      );

    let passwordIsCorrect = false;

    if (passwordIsHashed) {
      passwordIsCorrect =
        await user.comparePassword(
          String(
            currentPassword
          )
        );
    } else {
      passwordIsCorrect =
        String(
          currentPassword
        ) === savedPassword;
    }

    if (!passwordIsCorrect) {
      return res.status(400).json({
        success: false,
        message:
          "Current password is incorrect.",
      });
    }

    user.password =
      String(newPassword);

    await user.save();

    return res.status(200).json({
      success: true,
      message:
        "Password changed successfully.",
    });
  } catch (error) {
    console.error(
      "Change password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to change your password.",
    });
  }
};

/**
 * Request a password reset link.
 * Always returns a generic response so attackers cannot discover
 * whether an email address is registered.
 */
exports.forgotPassword = async (req, res) => {
  const genericMessage =
    "If an account exists with this email, a password reset link has been sent.";

  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const user = await User.findOne({
      email,
    }).select(
      "+passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return res.status(200).json({
        success: true,
        message: genericMessage,
      });
    }

    const resetToken = crypto
      .randomBytes(32)
      .toString("hex");

    const hashedToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires =
      Date.now() + 20 * 60 * 1000;

    await user.save({
      validateBeforeSave: false,
    });

    const frontendUrl = String(
      process.env.FRONTEND_URL ||
        "https://servicepay.ng"
    ).replace(/\/+$/, "");

    const resetUrl =
      `${frontendUrl}/?reset-password=true&token=${resetToken}`;

    const firstName =
      String(user.fullName || "Customer")
        .trim()
        .split(/\s+/)[0] || "Customer";

    const subject =
      "Reset your ServicePay password";

    const text = [
      `Hello ${firstName},`,
      "",
      "We received a request to reset your ServicePay password.",
      "",
      `Open this link to create a new password: ${resetUrl}`,
      "",
      "This link will expire in 20 minutes.",
      "",
      "If you did not request this change, you can ignore this email.",
      "",
      "ServicePay Support",
    ].join("\n");

    const html = `
      <!doctype html>
      <html>
        <body style="margin:0;padding:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17211a;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:30px 12px;background:#f4f7f6;">
            <tr>
              <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;">
                  <tr>
                    <td style="padding:24px;background:#149b8f;color:#ffffff;">
                      <div style="font-size:24px;font-weight:800;">ServicePay</div>
                      <div style="font-size:13px;margin-top:4px;">Password Reset</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:28px;">
                      <p style="font-size:17px;margin-top:0;">Hello ${firstName},</p>

                      <p style="line-height:1.6;">
                        We received a request to reset your ServicePay password.
                      </p>

                      <p style="line-height:1.6;">
                        Click the button below to create a new password.
                        This link expires in <strong>20 minutes</strong>.
                      </p>

                      <p style="text-align:center;margin:30px 0;">
                        <a
                          href="${resetUrl}"
                          style="display:inline-block;background:#149b8f;color:#ffffff;text-decoration:none;padding:15px 25px;border-radius:10px;font-weight:700;"
                        >
                          Reset Password
                        </a>
                      </p>

                      <p style="font-size:13px;line-height:1.6;color:#64748b;">
                        If the button does not work, copy and paste this link into your browser:
                      </p>

                      <p style="font-size:12px;word-break:break-all;color:#149b8f;">
                        ${resetUrl}
                      </p>

                      <p style="line-height:1.6;margin-bottom:0;">
                        If you did not request this change, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:18px 28px;background:#f8fafc;color:#64748b;font-size:12px;">
                      © ServicePay. Making everyday services simple.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `;

    try {
      await sendEmail({
        to: user.email,
        subject,
        text,
        html,
      });
    } catch (emailError) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;

      await user.save({
        validateBeforeSave: false,
      });

      console.error(
        "Forgot password email error:",
        emailError
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to send the password reset email. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: genericMessage,
    });
  } catch (error) {
    console.error(
      "Forgot password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to process the password reset request.",
    });
  }
};

/**
 * Reset password with a valid one-time token.
 */
exports.resetPassword = async (req, res) => {
  try {
    const token = String(
      req.body?.token ||
        req.params?.token ||
        ""
    ).trim();

    const newPassword = String(
      req.body?.newPassword ||
        req.body?.password ||
        ""
    );

    const confirmPassword = String(
      req.body?.confirmPassword ||
        req.body?.passwordConfirmation ||
        ""
    );

    if (!token) {
      return res.status(400).json({
        success: false,
        message:
          "Password reset token is required.",
      });
    }

    if (!newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "New password must contain at least 6 characters.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password and confirmation do not match.",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: {
        $gt: Date.now(),
      },
    }).select(
      "+password +passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message:
          "This password reset link is invalid or has expired.",
      });
    }

    const savedPassword =
      typeof user.password === "string"
        ? user.password
        : "";

    const passwordIsHashed =
      savedPassword.startsWith("$2a$") ||
      savedPassword.startsWith("$2b$") ||
      savedPassword.startsWith("$2y$");

    let sameAsCurrentPassword = false;

    if (savedPassword) {
      if (passwordIsHashed) {
        sameAsCurrentPassword =
          await bcrypt.compare(
            newPassword,
            savedPassword
          );
      } else {
        sameAsCurrentPassword =
          newPassword === savedPassword;
      }
    }

    if (sameAsCurrentPassword) {
      return res.status(400).json({
        success: false,
        message:
          "New password must be different from the previous password.",
      });
    }

    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.passwordChangedAt = new Date();

    await user.save({
      validateBeforeSave: false,
    });

    return res.status(200).json({
      success: true,
      message:
        "Password reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error(
      "Reset password error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to reset your password. Please try again.",
    });
  }
};
/*
|--------------------------------------------------------------------------
| UPDATE RIDER AVAILABILITY
|--------------------------------------------------------------------------
|
| PATCH /api/auth/rider/availability
|
| Body:
| {
|   "availabilityStatus": "ONLINE"
| }
|
*/

exports.updateRiderAvailability =
  async (req, res) => {
    try {
      const userId =
        req.user?._id ||
        req.user?.id ||
        req.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message:
            "Authentication is required.",
        });
      }

      const availabilityStatus =
        String(
          req.body
            ?.availabilityStatus ||
            req.body?.status ||
            ""
        )
          .trim()
          .toUpperCase();

      const allowedStatuses = [
        "ONLINE",
        "OFFLINE",
        "BUSY",
      ];

      if (
        !allowedStatuses.includes(
          availabilityStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Availability status must be ONLINE, OFFLINE or BUSY.",
        });
      }

      const rider =
        await User.findById(userId);

      if (!rider) {
        return res.status(404).json({
          success: false,
          message:
            "Rider account was not found.",
        });
      }

      const riderRole = String(
        rider.role || ""
      )
        .trim()
        .toUpperCase();

      if (
        riderRole !==
        "DELIVERY_RIDER"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Only Delivery Rider accounts can update availability.",
        });
      }

      if (
        rider.status !== "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your rider account is not active.",
        });
      }

      if (
        rider.riderVerificationStatus !==
          "VERIFIED" &&
        availabilityStatus !==
          "OFFLINE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your rider account must be verified before going online.",
        });
      }

      rider.availabilityStatus =
        availabilityStatus;

      if (
        availabilityStatus ===
        "ONLINE"
      ) {
        rider.riderLastOnlineAt =
          new Date();
      }

      await rider.save();

      return res.status(200).json({
        success: true,
        message:
          availabilityStatus ===
          "ONLINE"
            ? "You are now online and available for delivery jobs."
            : availabilityStatus ===
                "BUSY"
              ? "Your rider status is now busy."
              : "You are now offline.",

        user: formatUser(rider),

        data: {
          user: formatUser(rider),
        },
      });
    } catch (error) {
      console.error(
        "Update rider availability error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update rider availability.",
      });
    }
  };


/*
 * ============================================================
 * MY REFERRAL CODE
 * ============================================================
 */
exports.getMyReferral = async (req, res) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    let user = await User.findById(userId)
      .select(
        "_id fullName role status referralCode"
      )
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (
      String(user.role || "")
        .trim()
        .toUpperCase() !== "CUSTOMER"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Referral codes are available to customers only.",
      });
    }

    /*
     * Existing customers created before Referral V1
     * may not yet have a referral code.
     *
     * Use an atomic update instead of user.save()
     * so we do not trigger unrelated User pre-save logic.
     */
    if (!user.referralCode) {
      let referralCode = "";

      const rawName =
        String(user.fullName || "USER")
          .replace(/[^A-Za-z0-9]/g, "")
          .toUpperCase();

      const prefix =
        rawName
          .substring(0, 4)
          .padEnd(4, "X");

      let generated = false;

      for (
        let attempt = 0;
        attempt < 30;
        attempt += 1
      ) {
        const random =
          Math.random()
            .toString(36)
            .substring(2, 6)
            .toUpperCase();

        const candidate =
          `SP-${prefix}-${random}`;

        try {
          const updated =
            await User.findOneAndUpdate(
              {
                _id: userId,
                $or: [
                  {
                    referralCode: {
                      $exists: false,
                    },
                  },
                  {
                    referralCode: null,
                  },
                  {
                    referralCode: "",
                  },
                ],
              },
              {
                $set: {
                  referralCode:
                    candidate,
                },
              },
              {
                new: true,
                runValidators: false,
              }
            )
              .select(
                "_id referralCode"
              )
              .lean();

          /*
           * Another request may already have
           * created the referral code.
           */
          if (!updated) {
            const existing =
              await User.findById(userId)
                .select(
                  "_id referralCode"
                )
                .lean();

            if (
              existing?.referralCode
            ) {
              referralCode =
                existing.referralCode;

              generated = true;
              break;
            }

            continue;
          }

          referralCode =
            updated.referralCode;

          generated = true;
          break;
        } catch (error) {
          if (error?.code === 11000) {
            continue;
          }

          throw error;
        }
      }

      if (!generated) {
        return res.status(500).json({
          success: false,
          message:
            "Unable to generate referral code.",
        });
      }

      user = {
        ...user,
        referralCode,
      };
    }

    const referrals =
      await User.find({
        referredBy: userId,
        role: "CUSTOMER",
      })
        .select(
          "_id fullName createdAt status"
        )
        .sort({
          createdAt: -1,
        })
        .lean();

    const referredCount =
      referrals.length;

    return res.status(200).json({
      success: true,
      referralCode:
        user.referralCode,
      referredCount,
      referrals: referrals.map(
        (item) => ({
          id: item._id,
          fullName:
            item.fullName || "ServicePay User",
          status:
            item.status || "ACTIVE",
          joinedAt:
            item.createdAt,
        })
      ),
    });
  } catch (error) {
    console.error(
      "GET REFERRAL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load referral code.",
    });
  }
};


/*
 * ============================================================
 * CUSTOMER PROFILE PHOTO
 * ============================================================
 */

exports.updateProfilePhoto = async (req, res) => {
  try {
    const userId =
      req.user?._id ||
      req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Profile photo storage is not configured yet.",
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Please select an image.",
      });
    }

    if (
      !String(req.file.mimetype || "")
        .toLowerCase()
        .startsWith("image/")
    ) {
      return res.status(400).json({
        success: false,
        message: "Only image files are allowed.",
      });
    }

    const uploadResult = await new Promise(
      (resolve, reject) => {
        const stream =
          cloudinary.uploader.upload_stream(
            {
              folder: "servicepay/profile-photos",
              public_id: `user_${userId}`,
              overwrite: true,
              resource_type: "image",
              transformation: [
                {
                  width: 700,
                  height: 700,
                  crop: "fill",
                  gravity: "auto",
                  quality: "auto",
                  fetch_format: "auto",
                },
              ],
            },
            (error, result) => {
              if (error) {
                reject(error);
                return;
              }

              resolve(result);
            },
          );

        stream.end(req.file.buffer);
      },
    );

    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          profilePhotoUrl:
            uploadResult.secure_url,
          profilePhotoPublicId:
            uploadResult.public_id,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Profile photo updated successfully.",
      profilePhotoUrl:
        user.profilePhotoUrl || "",
      user,
    });
  } catch (error) {
    console.error(
      "Profile photo upload error:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update profile photo right now.",
    });
  }
};

