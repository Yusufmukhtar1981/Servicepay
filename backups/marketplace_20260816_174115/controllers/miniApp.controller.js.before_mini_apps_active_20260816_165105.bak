const MiniApp = require("../models/miniApp.model");

const DEFAULT_MINI_APPS = [
  {
    name: "ServicePay Cards",
    slug: "servicepay-cards",
    description: "Manage ServicePay physical and virtual cards.",
    category: "Finance",
    icon: "credit_card",
    routeKey: "cards",
    status: "ACTIVE",
    featured: true,
    systemApp: true,
    sortOrder: 10,
  },
  {
    name: "Empowerment",
    slug: "empowerment",
    description: "Create and manage transparent empowerment programmes.",
    category: "Business",
    icon: "volunteer_activism",
    routeKey: "empowerment",
    status: "ACTIVE",
    featured: true,
    systemApp: true,
    sortOrder: 20,
  },
  {
    name: "Business Wallet",
    slug: "business-wallet",
    description: "Business wallet services for merchants and SMEs.",
    category: "Business",
    icon: "business",
    routeKey: "businessWallet",
    status: "ACTIVE",
    featured: true,
    systemApp: true,
    sortOrder: 30,
  },
  {
    name: "Delivery",
    slug: "delivery",
    description: "Request and manage ServicePay delivery services.",
    category: "Lifestyle",
    icon: "local_shipping",
    routeKey: "delivery",
    status: "ACTIVE",
    featured: false,
    systemApp: true,
    sortOrder: 40,
  },
  {
    name: "Airtime & Data",
    slug: "airtime-data",
    description: "Buy airtime and mobile data from one place.",
    category: "Utilities",
    icon: "signal_cellular_alt",
    routeKey: "airtimeData",
    status: "ACTIVE",
    featured: false,
    systemApp: true,
    sortOrder: 50,
  },
  {
    name: "Group Wallet / Ajo",
    slug: "group-wallet",
    description: "Save and manage group contributions digitally.",
    category: "Finance",
    icon: "groups",
    routeKey: "groupWallet",
    status: "ACTIVE",
    featured: false,
    systemApp: true,
    sortOrder: 60,
  },
  {
    name: "Marketplace",
    slug: "marketplace",
    description: "Discover trusted merchants and services inside ServicePay.",
    category: "Shopping",
    icon: "storefront",
    routeKey: "marketplace",
    status: "COMING_SOON",
    featured: true,
    systemApp: true,
    sortOrder: 70,
  },
  {
    name: "Transport",
    slug: "transport",
    description: "Transport and mobility services inside ServicePay.",
    category: "Lifestyle",
    icon: "directions_car",
    routeKey: "transport",
    status: "COMING_SOON",
    featured: false,
    systemApp: true,
    sortOrder: 80,
  },
];

async function ensureDefaults() {
  const count = await MiniApp.countDocuments();

  if (count > 0) {
    return;
  }

  await MiniApp.insertMany(DEFAULT_MINI_APPS, {
    ordered: false,
  });
}

exports.getMiniApps = async (req, res) => {
  try {
    await ensureDefaults();

    const apps = await MiniApp.find({
      status: {
        $ne: "DISABLED",
      },
    })
      .sort({
        sortOrder: 1,
        name: 1,
      })
      .lean();

    return res.status(200).json({
      success: true,
      message: "ServicePay Mini Apps fetched successfully.",
      data: apps,
    });
  } catch (error) {
    console.error("GET_MINI_APPS_ERROR", error);

    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to fetch ServicePay Mini Apps.",
    });
  }
};

exports.getMiniApp = async (req, res) => {
  try {
    await ensureDefaults();

    const app = await MiniApp.findOne({
      slug: req.params.slug,
      status: {
        $ne: "DISABLED",
      },
    }).lean();

    if (!app) {
      return res.status(404).json({
        success: false,
        message: "Mini App not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: app,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error?.message ||
        "Unable to fetch Mini App.",
    });
  }
};
