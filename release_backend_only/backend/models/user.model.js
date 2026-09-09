const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    /*
     * Transaction PIN
     */
    transactionPin: {
      type: String,
      default: undefined,
      select: false,
    },

    transactionPinSet: {
      type: Boolean,
      default: false,
    },

    transactionPinUpdatedAt: {
      type: Date,
      default: null,
    },
    transactionPinFailedAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
    transactionPinLockedUntil: {
      type: Date,
      default: null,
      select: false,
    },
    transactionPinAttemptVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    /*
     * Password reset
     */
    passwordResetToken: {
      type: String,
      select: false,
      default: undefined,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
      default: undefined,
    },

    passwordChangedAt: {
      type: Date,
      default: undefined,
    },
    authTokenVersion: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },

    /*
     * Internal ServicePay staff
     */
    isStaff: {
      type: Boolean,
      default: false,
      index: true,
    },

    staffId: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      default: undefined,
    },

    staffRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
      index: true,
    },

    department: {
      type: String,
      uppercase: true,
      trim: true,
      enum: [
        "ADMINISTRATION",
        "OPERATIONS",
        "DELIVERY",
        "FINANCE",
        "AUDIT",
        "COMPLIANCE",
        "CUSTOMER_SUPPORT",
        null,
      ],
      default: null,
    },

    staffCreatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Branch fields are optional so all existing customer and staff records
    // remain valid during the branch-management rollout.
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    jobTitle: { type: String, trim: true, default: "" },
    onboardingSource: { type: String, trim: true, default: "" },
    createdByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    branchManagerPermissions: {
      type: [{ type: String }],
      default: [],
    },
    // Saved only while a STAFF account is temporarily promoted to manage a
    // branch, so demotion/replacement restores its previous access exactly.
    branchManagerPreviousRole: { type: String, default: null },
    branchManagerPreviousStaffRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      default: null,
    },

    lastStaffLoginAt: {
      type: Date,
      default: null,
    },

    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    /*
     * Main ServicePay role
     */
    role: {
      type: String,
      enum: [
        "HEAD_OFFICE",
        "STAFF",
        "BRANCH_MANAGER",
        "ZONAL_MANAGER",
        "STATE_MANAGER",
        "AGENT",
        "DELIVERY_RIDER",
        "SOLAR_OFFICER",
        "PHONE_FINANCING_OFFICER",
        "BUSINESS_PARTNER",
        "CUSTOMER",
      ],
      default: "CUSTOMER",
      index: true,
    },

    zone: {
      type: String,
      default: null,
      trim: true,
    },

    state: {
      type: String,
      default: null,
      trim: true,
    },

    lga: {
      type: String,
      default: null,
      trim: true,
    },

    zonalManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    stateManagerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    agentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /*
     * =====================================================
     * DELIVERY RIDER / SERVICEPAY KEKE
     * =====================================================
     */

    riderId: {
      type: String,
      trim: true,
      uppercase: true,
      unique: true,
      sparse: true,
      default: undefined,
    },

    vehicleType: {
      type: String,
      uppercase: true,
      trim: true,
      enum: [
        "MOTORCYCLE",
        "TRICYCLE",
        "BICYCLE",
        "CAR",
        "VAN",
        "TRUCK",
        "OTHER",
        null,
      ],
      default: null,
    },

    plateNumber: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
    },

    riderState: {
      type: String,
      trim: true,
      default: null,
    },

    riderLga: {
      type: String,
      trim: true,
      default: null,
    },

    riderAddress: {
      type: String,
      trim: true,
      default: null,
    },

    riderEmergencyContactName: {
      type: String,
      trim: true,
      default: null,
    },

    riderEmergencyContactPhone: {
      type: String,
      trim: true,
      default: null,
    },

    /*
     * ONLINE  = available for new job
     * OFFLINE = not accepting jobs
     * BUSY    = currently handling a job
     */
    availabilityStatus: {
      type: String,
      enum: [
        "ONLINE",
        "OFFLINE",
        "BUSY",
      ],
      default: "OFFLINE",
      index: true,
    },

    riderVerificationStatus: {
      type: String,
      enum: [
        "NOT_SUBMITTED",
        "PENDING",
        "VERIFIED",
        "REJECTED",
        "SUSPENDED",
      ],
      default: "NOT_SUBMITTED",
      index: true,
    },

    riderVerificationNote: {
      type: String,
      trim: true,
      default: null,
    },

    riderVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    riderVerifiedAt: {
      type: Date,
      default: null,
    },

    riderCreatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    riderJoinedAt: {
      type: Date,
      default: null,
    },

    riderLastOnlineAt: {
      type: Date,
      default: null,
    },

    /*
     * Rider statistics
     */
    totalRiderEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },

    pendingRiderSettlement: {
      type: Number,
      default: 0,
      min: 0,
    },

    settledRiderEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAssignedDeliveries: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAcceptedDeliveries: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCompletedDeliveries: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalRejectedDeliveries: {
      type: Number,
      default: 0,
      min: 0,
    },

    riderRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    riderRatingCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
     * =====================================================
     * LIVE RIDER LOCATION
     * =====================================================
     *
     * GeoJSON Point enables MongoDB to search for
     * the nearest available driver.
     *
     * IMPORTANT:
     * coordinates format is:
     *
     * [longitude, latitude]
     *
     * NOT:
     * [latitude, longitude]
     */
    riderCurrentLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: undefined,
      },

      coordinates: {
        type: [Number],
        default: undefined,

        validate: {
          validator: function (value) {
            if (value === undefined || value === null) {
              return true;
            }

            if (
              !Array.isArray(value) ||
              value.length !== 2
            ) {
              return false;
            }

            const longitude = Number(value[0]);
            const latitude = Number(value[1]);

            return (
              Number.isFinite(longitude) &&
              Number.isFinite(latitude) &&
              longitude >= -180 &&
              longitude <= 180 &&
              latitude >= -90 &&
              latitude <= 90
            );
          },

          message:
            "Rider location must contain valid longitude and latitude.",
        },
      },

      address: {
        type: String,
        trim: true,
        default: undefined,
      },

      accuracy: {
        type: Number,
        default: undefined,
        min: 0,
      },

      heading: {
        type: Number,
        default: undefined,
        min: 0,
        max: 360,
      },

      speed: {
        type: Number,
        default: undefined,
        min: 0,
      },

      updatedAt: {
        type: Date,
        default: undefined,
      },
    },

    /*
     * Used later to determine whether the driver's
     * location is still fresh enough for matching.
     */
    riderLocationUpdatedAt: {
      type: Date,
      default: undefined,
      index: true,
    },

    /*
     * Tracks the active Keke/delivery job.
     */
    riderCurrentJobId: {
      type: mongoose.Schema.Types.ObjectId,
      default: undefined,
      index: true,
    },

    /*
     * =====================================================
     * WALLET
     * =====================================================
     */
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    walletHeldBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
  /*
   * ==========================================================
   * BUSINESS WALLET
   * ==========================================================
   */
  businessWalletId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
    index: true,
  },

  businessName: {
    type: String,
    default: "",
    trim: true,
    maxlength: 120,
  },



  businessWalletBalance: {
    type: Number,
    default: 0,
    min: 0,
  },

  businessWalletLockedBalance: {
    type: Number,
    default: 0,
    min: 0,
  },



  withdrawalLockedBalance: {
    type: Number,
    default: 0,
    min: 0,
  },

    commissionBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    /*
     * Solar Officer commissions are intentionally kept separate from
     * customer and legacy rider balances.
     */
    solarCommissionBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
  /*
   * Customer profile photo.
   * The actual image lives in Cloudinary.
   */
  profilePhotoUrl: {
    type: String,
    default: undefined,
    trim: true,
  },

  profilePhotoPublicId: {
    type: String,
    default: undefined,
    trim: true,
  },



    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
    },

    totalEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalTransactions: {
      type: Number,
      default: 0,
      min: 0,
    },

    kycVerified: {
      type: Boolean,
      default: false,
    },

    /*
     * =====================================================
     * VIRTUAL ACCOUNT
     * =====================================================
     */
    virtualAccount: {
      provider: {
        type: String,
        default: undefined,
        trim: true,
      },

      accountNumber: {
        type: String,
        default: undefined,
        trim: true,
      },

      accountName: {
        type: String,
        default: undefined,
        trim: true,
      },

      bankName: {
        type: String,
        default: undefined,
        trim: true,
      },

      bankCode: {
        type: String,
        default: undefined,
        trim: true,
      },

      customerReference: {
        type: String,
        default: undefined,
        trim: true,
      },

      providerCustomerId: {
        type: String,
        default: undefined,
        trim: true,
      },

      isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: String,
      default: null,
    },

    status: {
        type: String,
        enum: [
          "NOT_CREATED",
          "PENDING",
          "ACTIVE",
          "FAILED",
          "DISABLED",
        ],
        default: "NOT_CREATED",
      },

      failureReason: {
        type: String,
        default: undefined,
        trim: true,
      },

      createdAt: {
        type: Date,
        default: undefined,
      },

      updatedAt: {
        type: Date,
        default: undefined,
      },
    },

    /*
     * Account status
     */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        "ACTIVE",
        "SUSPENDED",
        "BLOCKED",
      ],
      default: "ACTIVE",
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/*
 * =====================================================
 * DATABASE INDEXES
 * =====================================================
 */

/*
 * Unique virtual account number.
 */
userSchema.index(
  {
    "virtualAccount.accountNumber": 1,
  },
  {
    name: "virtualAccount.accountNumber_1",
    unique: true,

    partialFilterExpression: {
      "virtualAccount.accountNumber": {
        $type: "string",
        $gt: "",
      },
    },
  }
);

/*
 * Unique SecureWaveNG customer reference.
 */
userSchema.index(
  {
    "virtualAccount.customerReference": 1,
  },
  {
    name: "virtualAccount.customerReference_1",
    unique: true,

    partialFilterExpression: {
      "virtualAccount.customerReference": {
        $type: "string",
        $gt: "",
      },
    },
  }
);

/*
 * Helps ServicePay find available verified riders.
 */
userSchema.index({
  role: 1,
  status: 1,
  riderVerificationStatus: 1,
  availabilityStatus: 1,
});

/*
 * =====================================================
 * NEAREST DRIVER INDEX
 * =====================================================
 *
 * MongoDB uses this 2dsphere index to find
 * the Keke/driver nearest to the customer's
 * pickup point.
 */
userSchema.index({
  riderCurrentLocation: "2dsphere",
});

/*
 * =====================================================
 * PRE-SAVE
 * =====================================================
 */
userSchema.pre(
  "save",
  async function () {
    /*
     * Hash login password.
     */
    if (this.isModified("password")) {
      this.password = await bcrypt.hash(
        this.password,
        12
      );
    }

    /*
     * Hash transaction PIN.
     */
    if (
      this.isModified("transactionPin") &&
      this.transactionPin
    ) {
      const plainPin = String(
        this.transactionPin
      ).trim();

      if (!/^\d{4}$/.test(plainPin)) {
        throw new Error(
          "Transaction PIN must contain exactly 4 digits."
        );
      }

      this.transactionPin =
        await bcrypt.hash(
          plainPin,
          12
        );

      this.transactionPinSet = true;

      this.transactionPinUpdatedAt =
        new Date();
    }

    /*
     * Automatically set rider joining date.
     */
    if (
      this.role === "DELIVERY_RIDER" &&
      !this.riderJoinedAt
    ) {
      this.riderJoinedAt = new Date();
    }

    /*
     * A non-rider must never remain online.
     */
    if (
      this.role !== "DELIVERY_RIDER"
    ) {
      this.availabilityStatus =
        "OFFLINE";

      this.riderCurrentJobId = null;
    }

    /*
     * Update rider online timestamp.
     */
    if (
      this.role === "DELIVERY_RIDER" &&
      this.availabilityStatus ===
        "ONLINE"
    ) {
      this.riderLastOnlineAt =
        new Date();
    }
  }
);

/*
 * =====================================================
 * METHODS
 * =====================================================
 */

/*
 * Compare login password.
 */
userSchema.methods.comparePassword =
  async function (enteredPassword) {
    if (!this.password) {
      return false;
    }

    return bcrypt.compare(
      String(enteredPassword),
      this.password
    );
  };

/*
 * Compare transaction PIN.
 */
userSchema.methods.compareTransactionPin =
  async function (enteredPin) {
    if (!this.transactionPin) {
      return false;
    }

    const storedPin = String(this.transactionPin);

    if (/^\$2[aby]\$\d{2}\$/.test(storedPin)) {
      return bcrypt.compare(
        String(enteredPin),
        storedPin
      );
    }

    // Compatibility only: the canonical PIN service upgrades this value after
    // a successful match. Do not accept malformed legacy values.
    return /^\d{4}$/.test(storedPin) &&
      String(enteredPin) === storedPin;
  };

/*
 * Set or change transaction PIN.
 */
userSchema.methods.setTransactionPin =
  function (newPin) {
    const pin = String(
      newPin || ""
    ).trim();

    if (!/^\d{4}$/.test(pin)) {
      throw new Error(
        "Transaction PIN must contain exactly 4 digits."
      );
    }

    this.transactionPin = pin;

    this.transactionPinSet = true;

    this.transactionPinUpdatedAt =
      new Date();
  };

/*
 * Check if rider has a valid location.
 */
userSchema.methods.hasValidRiderLocation =
  function () {
    const location =
      this.riderCurrentLocation;

    if (!location) {
      return false;
    }

    if (location.type !== "Point") {
      return false;
    }

    if (
      !Array.isArray(
        location.coordinates
      ) ||
      location.coordinates.length !== 2
    ) {
      return false;
    }

    const longitude =
      Number(
        location.coordinates[0]
      );

    const latitude =
      Number(
        location.coordinates[1]
      );

    return (
      Number.isFinite(longitude) &&
      Number.isFinite(latitude) &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude >= -90 &&
      latitude <= 90
    );
  };

/*
 * Check whether rider can receive a normal
 * ServicePay delivery job.
 */
userSchema.methods.canReceiveDelivery =
  function () {
    return (
      this.role ===
        "DELIVERY_RIDER" &&
      this.status === "ACTIVE" &&
      this.riderVerificationStatus ===
        "VERIFIED" &&
      this.availabilityStatus ===
        "ONLINE"
    );
  };

/*
 * Check whether rider can receive a
 * ServicePay Keke ride request.
 */
userSchema.methods.canReceiveKekeRide =
  function () {
    return (
      this.role ===
        "DELIVERY_RIDER" &&
      this.status === "ACTIVE" &&
      this.riderVerificationStatus ===
        "VERIFIED" &&
      this.availabilityStatus ===
        "ONLINE" &&
      this.vehicleType ===
        "TRICYCLE" &&
      !this.riderCurrentJobId &&
      this.hasValidRiderLocation()
    );
  };

/*
 * Update rider live location.
 */
userSchema.methods.setRiderLocation =
  function ({
    latitude,
    longitude,
    address = null,
    accuracy = null,
    heading = null,
    speed = null,
  }) {
    const lat =
      Number(latitude);

    const lng =
      Number(longitude);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      throw new Error(
        "Invalid rider latitude or longitude."
      );
    }

    if (
      lat < -90 ||
      lat > 90
    ) {
      throw new Error(
        "Invalid rider latitude."
      );
    }

    if (
      lng < -180 ||
      lng > 180
    ) {
      throw new Error(
        "Invalid rider longitude."
      );
    }

    const now = new Date();

    this.riderCurrentLocation = {
      type: "Point",

      coordinates: [
        lng,
        lat,
      ],

      address:
        address || null,

      accuracy:
        accuracy === null ||
        accuracy === undefined
          ? null
          : Number(accuracy),

      heading:
        heading === null ||
        heading === undefined
          ? null
          : Number(heading),

      speed:
        speed === null ||
        speed === undefined
          ? null
          : Math.max(
              0,
              Number(speed)
            ),

      updatedAt: now,
    };

    this.riderLocationUpdatedAt =
      now;
  };

/*
 * =====================================================
 * EXPORT
 * =====================================================
 */


// SERVICEPAY_SECURE_ONBOARDING_FIELDS
// Optional fields: existing users remain fully compatible.
userSchema.add({
  // A Business Partner is an authenticated User with a separate operational
  // profile.  This intentionally does not overlap with the legacy API Partner
  // model, which represents an integration client.
  businessPartnerProfile: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BusinessPartnerProfile",
    default: null,
    index: true,
  },
  businessPartnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BusinessPartnerProfile",
    default: null,
    index: true,
  },
  gender: {
    type: String,
    enum: ['MALE', 'FEMALE', 'OTHER', ''],
    default: '',
  },

  dateOfBirth: {
    type: Date,
    default: null,
  },

  residentialAddress: {
    type: String,
    trim: true,
    default: '',
  },

  registrationState: {
    type: String,
    trim: true,
    default: '',
  },

  registrationLga: {
    type: String,
    trim: true,
    default: '',
  },

  nin: {
    type: String,
    trim: true,
    default: '',
    select: false,
  },

  kycConsent: {
    type: Boolean,
    default: false,
  },

  termsAcceptedAt: {
    type: Date,
    default: null,
  },

  onboardingCompletedAt: {
    type: Date,
    default: null,
  },
});


/*
 * SERVICEPAY_NIN_ONBOARDING_VERIFICATION_FIELDS
 * Stores only masked onboarding NIN information.
 * Raw NIN/provider response is not stored here.
 */
userSchema.add({
  ninNumberMasked: {
    type: String,
    trim: true,
    default: undefined,
  },

  ninVerificationStatus: {
    type: String,
    enum: ["PENDING", "VERIFIED", "FAILED"],
    default: undefined,
  },

  ninVerificationReference: {
    type: String,
    trim: true,
    default: undefined,
  },

  ninVerifiedAt: {
    type: Date,
    default: null,
  },
});

userSchema.index({ createdAt: -1 });

module.exports =
  mongoose.model(
    "User",
    userSchema
  );
