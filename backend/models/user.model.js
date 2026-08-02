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
     * Transaction PIN is optional because existing
     * users may not have created a PIN yet.
     *
     * It will be hashed before being saved.
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

    /*
     * Password reset fields.
     * passwordResetToken stores only the hashed reset token.
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

    /*
     * Internal ServicePay staff account.
     * Specific duties and permissions come from staffRoleId.
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

    lastStaffLoginAt: {
      type: Date,
      default: null,
    },

    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    role: {
      type: String,
      enum: [
        "HEAD_OFFICE",
        "STAFF",
        "ZONAL_MANAGER",
        "STATE_MANAGER",
        "AGENT",
        "CUSTOMER",
      ],
      default: "CUSTOMER",
    },

    zone: {
      type: String,
      default: null,
    },

    state: {
      type: String,
      default: null,
    },

    lga: {
      type: String,
      default: null,
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

    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionBalance: {
      type: Number,
      default: 0,
      min: 0,
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
      default: null,
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

    virtualAccount: {
      provider: {
        type: String,
        default: null,
        trim: true,
      },

      accountNumber: {
        type: String,
        default: undefined,
        trim: true,
      },

      accountName: {
        type: String,
        default: null,
        trim: true,
      },

      bankName: {
        type: String,
        default: null,
        trim: true,
      },

      bankCode: {
        type: String,
        default: null,
        trim: true,
      },

      customerReference: {
        type: String,
        default: undefined,
        trim: true,
      },

      providerCustomerId: {
        type: String,
        default: null,
        trim: true,
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
        default: null,
        trim: true,
      },

      createdAt: {
        type: Date,
        default: null,
      },

      updatedAt: {
        type: Date,
        default: null,
      },
    },

    status: {
      type: String,
      enum: [
        "ACTIVE",
        "SUSPENDED",
        "BLOCKED",
      ],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Unique virtual-account number index.
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
 * Unique SecureWaveNG customer reference index.
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
 * Hash password before saving.
 */
userSchema.pre("save", async function () {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(
      this.password,
      12
    );
  }

  /*
   * Hash transaction PIN before saving.
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

    this.transactionPin = await bcrypt.hash(
      plainPin,
      12
    );

    this.transactionPinSet = true;
    this.transactionPinUpdatedAt = new Date();
  }
});

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

    return bcrypt.compare(
      String(enteredPin),
      this.transactionPin
    );
  };

/*
 * Set or change transaction PIN.
 */
userSchema.methods.setTransactionPin =
  function (newPin) {
    const pin = String(newPin || "").trim();

    if (!/^\d{4}$/.test(pin)) {
      throw new Error(
        "Transaction PIN must contain exactly 4 digits."
      );
    }

    this.transactionPin = pin;
    this.transactionPinSet = true;
    this.transactionPinUpdatedAt = new Date();
  };

module.exports = mongoose.model(
  "User",
  userSchema
);