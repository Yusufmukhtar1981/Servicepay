const mongoose = require("mongoose");

const {
  STAFF_PERMISSION_VALUES,
} = require("../config/staffPermissions");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z][A-Z0-9_]*$/,
    },

    displayName: {
      type: String,
      required: true,
      trim: true,
    },

    department: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      enum: [
        "ADMINISTRATION",
        "OPERATIONS",
        "DELIVERY",
        "FINANCE",
        "AUDIT",
        "COMPLIANCE",
        "CUSTOMER_SUPPORT",
      ],
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    permissions: {
      type: [
        {
          type: String,
          enum: STAFF_PERMISSION_VALUES,
        },
      ],
      default: [],
    },

    isSystemRole: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: [
        "ACTIVE",
        "INACTIVE",
      ],
      default: "ACTIVE",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

roleSchema.index(
  {
    name: 1,
  },
  {
    unique: true,
  }
);

roleSchema.index({
  department: 1,
  status: 1,
});

roleSchema.pre("save", function normalizeRole(next) {
  if (this.name) {
    this.name = String(this.name)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  if (Array.isArray(this.permissions)) {
    this.permissions = [
      ...new Set(this.permissions),
    ];
  }

  next();
});

module.exports = mongoose.model(
  "Role",
  roleSchema
);
