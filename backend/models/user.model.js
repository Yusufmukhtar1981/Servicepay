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
    },

    role: {
      type: String,
      enum: [
        "HEAD_OFFICE",
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
        default: null,
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
        default: null,
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
      enum: ["ACTIVE", "SUSPENDED", "BLOCKED"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

/*
 * Prevent two ServicePay users from sharing
 * the same virtual account number.
 */
userSchema.index(
  {
    "virtualAccount.accountNumber": 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

/*
 * Prevent duplicate provider references.
 */
userSchema.index(
  {
    "virtualAccount.customerReference": 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

userSchema.pre("save", async function () {
  if (!this.isModified("password")) {
    return;
  }

  this.password = await bcrypt.hash(
    this.password,
    12
  );
});

userSchema.methods.comparePassword = async function (
  enteredPassword
) {
  return bcrypt.compare(
    enteredPassword,
    this.password
  );
};

module.exports = mongoose.model(
  "User",
  userSchema
);