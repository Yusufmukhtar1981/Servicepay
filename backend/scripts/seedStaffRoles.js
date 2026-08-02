const mongoose = require("mongoose");

const Role = require("../models/role.model");

const {
  STAFF_PERMISSIONS: P,
} = require("../config/staffPermissions");

const defaultRoles = [
  {
    name: "SUB_ADMIN",
    displayName: "Sub Admin",
    department: "ADMINISTRATION",
    description:
      "Assists Head Office with selected administrative operations.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.STAFF_CREATE,
      P.STAFF_VIEW,
      P.STAFF_UPDATE,
      P.STAFF_SUSPEND,

      P.ROLES_VIEW,

      P.USERS_VIEW,
      P.USERS_UPDATE,
      P.USERS_SUSPEND,
      P.USERS_BLOCK,

      P.TRANSACTIONS_VIEW,
      P.TRANSACTIONS_EXPORT,

      P.WALLETS_VIEW,

      P.DELIVERY_VIEW,
      P.SUPPORT_VIEW,
      P.KYC_VIEW,

      P.AUDIT_VIEW,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,

      P.NOTIFICATIONS_CREATE,
      P.NOTIFICATIONS_SEND,
    ],
  },

  {
    name: "OPERATIONS_MANAGER",
    displayName: "Operations Manager",
    department: "OPERATIONS",
    description:
      "Manages day-to-day operational activity across ServicePay services.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,

      P.TRANSACTIONS_VIEW,
      P.TRANSACTIONS_EXPORT,

      P.WALLETS_VIEW,

      P.DELIVERY_VIEW,
      P.DELIVERY_ASSIGN,
      P.DELIVERY_UPDATE,
      P.DELIVERY_CANCEL,

      P.SUPPORT_VIEW,
      P.SUPPORT_ASSIGN,
      P.SUPPORT_RESOLVE,

      P.KYC_VIEW,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "DELIVERY_MANAGER",
    displayName: "Delivery Manager",
    department: "DELIVERY",
    description:
      "Manages delivery requests, assignments, status updates and reports.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,

      P.DELIVERY_VIEW,
      P.DELIVERY_ASSIGN,
      P.DELIVERY_UPDATE,
      P.DELIVERY_CANCEL,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "FINANCE_MANAGER",
    displayName: "Finance Manager",
    department: "FINANCE",
    description:
      "Oversees wallets, funding, reconciliation and financial approvals.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,

      P.TRANSACTIONS_VIEW,
      P.TRANSACTIONS_EXPORT,
      P.TRANSACTIONS_REVERSE,

      P.WALLETS_VIEW,
      P.WALLETS_FUND,
      P.WALLETS_ADJUST,
      P.WALLETS_FREEZE,

      P.FINANCE_VIEW,
      P.FINANCE_RECONCILE,
      P.FINANCE_EXPORT,
      P.FINANCE_APPROVE,

      P.AUDIT_VIEW,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "ACCOUNTANT",
    displayName: "Accountant",
    department: "FINANCE",
    description:
      "Handles financial reporting, reconciliation and transaction reviews.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.TRANSACTIONS_VIEW,
      P.TRANSACTIONS_EXPORT,

      P.WALLETS_VIEW,

      P.FINANCE_VIEW,
      P.FINANCE_RECONCILE,
      P.FINANCE_EXPORT,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "INTERNAL_AUDITOR",
    displayName: "Internal Auditor",
    department: "AUDIT",
    description:
      "Read-only access for internal control, audit and compliance reviews.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.STAFF_VIEW,
      P.ROLES_VIEW,

      P.USERS_VIEW,

      P.TRANSACTIONS_VIEW,
      P.TRANSACTIONS_EXPORT,

      P.WALLETS_VIEW,

      P.FINANCE_VIEW,
      P.FINANCE_EXPORT,

      P.DELIVERY_VIEW,
      P.SUPPORT_VIEW,
      P.KYC_VIEW,

      P.AUDIT_VIEW,
      P.AUDIT_EXPORT,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,

      P.SETTINGS_VIEW,
    ],
  },

  {
    name: "COMPLIANCE_MANAGER",
    displayName: "Compliance Manager",
    department: "COMPLIANCE",
    description:
      "Manages KYC, compliance reviews and non-compliant account actions.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,
      P.USERS_UPDATE,
      P.USERS_SUSPEND,
      P.USERS_BLOCK,

      P.TRANSACTIONS_VIEW,

      P.KYC_VIEW,
      P.KYC_APPROVE,
      P.KYC_REJECT,

      P.AUDIT_VIEW,
      P.AUDIT_EXPORT,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "KYC_OFFICER",
    displayName: "KYC Officer",
    department: "COMPLIANCE",
    description:
      "Reviews submitted identity records and basic KYC applications.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,

      P.KYC_VIEW,
      P.KYC_APPROVE,
      P.KYC_REJECT,

      P.REPORTS_VIEW,
    ],
  },

  {
    name: "SUPPORT_MANAGER",
    displayName: "Support Manager",
    department: "CUSTOMER_SUPPORT",
    description:
      "Manages customer complaints, escalations and support staff activity.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.STAFF_VIEW,

      P.USERS_VIEW,
      P.USERS_UPDATE,

      P.TRANSACTIONS_VIEW,

      P.WALLETS_VIEW,

      P.SUPPORT_VIEW,
      P.SUPPORT_CREATE,
      P.SUPPORT_ASSIGN,
      P.SUPPORT_RESOLVE,

      P.REPORTS_VIEW,
      P.REPORTS_EXPORT,
    ],
  },

  {
    name: "SUPPORT_STAFF",
    displayName: "Support Staff",
    department: "CUSTOMER_SUPPORT",
    description:
      "Handles customer enquiries, support cases and issue escalation.",
    permissions: [
      P.DASHBOARD_VIEW,

      P.USERS_VIEW,

      P.TRANSACTIONS_VIEW,

      P.SUPPORT_VIEW,
      P.SUPPORT_CREATE,
      P.SUPPORT_RESOLVE,
    ],
  },
];

const connectDatabase = async () => {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      "MONGODB_URI or MONGO_URI is required."
    );
  }

  await mongoose.connect(mongoUri);
};

const seedRoles = async () => {
  await connectDatabase();

  for (const role of defaultRoles) {
    await Role.findOneAndUpdate(
      {
        name: role.name,
      },
      {
        ...role,
        isSystemRole: true,
        status: "ACTIVE",
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    console.log(
      `✅ ${role.name} role created or updated.`
    );
  }

  console.log(
    `✅ ${defaultRoles.length} default staff roles are ready.`
  );
};

seedRoles()
  .catch((error) => {
    console.error(
      "❌ Unable to seed staff roles:",
      error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
