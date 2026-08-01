const User = require("../models/user.model");

const normalizeText = (value) =>
  String(value || "").trim();

const normalizeEmail = (value) =>
  normalizeText(value).toLowerCase();

const normalizePhone = (value) =>
  normalizeText(value).replace(/\s+/g, "");

const publicUser = (user) => ({
  id: user._id,
  fullName: user.fullName,
  phone: user.phone,
  email: user.email || "",
  role: user.role,
  status: user.status,
  zone: user.zone || "",
  state: user.state || "",
  lga: user.lga || "",
  zonalManagerId: user.zonalManagerId || null,
  createdAt: user.createdAt,
});

exports.createStateManager = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "ZONAL_MANAGER") {
      return res.status(403).json({
        success: false,
        message:
          "Only a Zonal Manager can create a State Manager.",
      });
    }

    const {
      fullName,
      phone,
      email,
      password,
      state,
      lga,
    } = req.body || {};

    const cleanFullName = normalizeText(fullName);
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || "");
    const cleanState = normalizeText(state);
    const cleanLga = normalizeText(lga);

    if (!cleanFullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!/^\d{11}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number must contain exactly 11 digits.",
      });
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    if (!cleanState) {
      return res.status(400).json({
        success: false,
        message: "State is required.",
      });
    }

    const duplicateConditions = [
      { phone: cleanPhone },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser = await User.findOne({
      $or: duplicateConditions,
    }).select("_id phone email");

    if (existingUser) {
      const samePhone =
        normalizePhone(existingUser.phone) ===
        cleanPhone;

      return res.status(409).json({
        success: false,
        message: samePhone
          ? "A user with this phone number already exists."
          : "A user with this email address already exists.",
      });
    }

    const stateManager = new User({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      password: cleanPassword,
      role: "STATE_MANAGER",
      status: "ACTIVE",

      // Zonal Manager's zone cannot be changed
      // from the frontend request.
      zone: normalizeText(loggedInUser.zone),
      state: cleanState,
      lga: cleanLga || undefined,

      zonalManagerId:
        loggedInUser._id || loggedInUser.id,
    });

    await stateManager.save();

    return res.status(201).json({
      success: true,
      message:
        "State Manager created successfully.",
      stateManager: publicUser(stateManager),
    });
  } catch (error) {
    console.error(
      "createStateManager error:",
      error
    );

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Phone number or email address already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error while creating State Manager.",
    });
  }
};

exports.getStateManagers = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "ZONAL_MANAGER") {
      return res.status(403).json({
        success: false,
        message:
          "Only a Zonal Manager can view State Managers.",
      });
    }

    const search = normalizeText(req.query.search);
    const status = normalizeText(
      req.query.status
    ).toUpperCase();

    const query = {
      role: "STATE_MANAGER",
      zonalManagerId:
        loggedInUser._id || loggedInUser.id,
    };

    if (
      status &&
      ["ACTIVE", "SUSPENDED", "BLOCKED"].includes(
        status
      )
    ) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          fullName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          state: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const stateManagers = await User.find(query)
      .select(
        "-password -transactionPin"
      )
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: stateManagers.length,
      stateManagers: stateManagers.map(
        publicUser
      ),
    });
  } catch (error) {
    console.error(
      "getStateManagers error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while loading State Managers.",
    });
  }
};


exports.createAgent = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "STATE_MANAGER") {
      return res.status(403).json({
        success: false,
        message:
          "Only a State Manager can create an Agent.",
      });
    }

    const {
      fullName,
      phone,
      email,
      password,
      lga,
    } = req.body || {};

    const cleanFullName = normalizeText(fullName);
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || "");
    const cleanLga = normalizeText(lga);

    if (!cleanFullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!/^\d{11}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number must contain exactly 11 digits.",
      });
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    const duplicateConditions = [
      { phone: cleanPhone },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser = await User.findOne({
      $or: duplicateConditions,
    }).select("_id phone email");

    if (existingUser) {
      const samePhone =
        normalizePhone(existingUser.phone) ===
        cleanPhone;

      return res.status(409).json({
        success: false,
        message: samePhone
          ? "A user with this phone number already exists."
          : "A user with this email address already exists.",
      });
    }

    const agent = new User({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      password: cleanPassword,
      role: "AGENT",
      status: "ACTIVE",

      zone: normalizeText(loggedInUser.zone),
      state: normalizeText(loggedInUser.state),
      lga: cleanLga || undefined,

      zonalManagerId:
        loggedInUser.zonalManagerId || undefined,

      stateManagerId:
        loggedInUser._id || loggedInUser.id,
    });

    await agent.save();

    return res.status(201).json({
      success: true,
      message: "Agent created successfully.",
      agent: publicUser(agent),
    });
  } catch (error) {
    console.error("createAgent error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Phone number or email address already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error while creating Agent.",
    });
  }
};

exports.getAgents = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "STATE_MANAGER") {
      return res.status(403).json({
        success: false,
        message:
          "Only a State Manager can view Agents.",
      });
    }

    const search = normalizeText(req.query.search);
    const status = normalizeText(
      req.query.status
    ).toUpperCase();

    const query = {
      role: "AGENT",
      stateManagerId:
        loggedInUser._id || loggedInUser.id,
    };

    if (
      status &&
      ["ACTIVE", "SUSPENDED", "BLOCKED"].includes(
        status
      )
    ) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          fullName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          lga: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const agents = await User.find(query)
      .select("-password -transactionPin")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: agents.length,
      agents: agents.map(publicUser),
    });
  } catch (error) {
    console.error("getAgents error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Server error while loading Agents.",
    });
  }
};


exports.createCustomer = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "AGENT") {
      return res.status(403).json({
        success: false,
        message:
          "Only an Agent can create a Customer.",
      });
    }

    const {
      fullName,
      phone,
      email,
      password,
      lga,
    } = req.body || {};

    const cleanFullName = normalizeText(fullName);
    const cleanPhone = normalizePhone(phone);
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || "");
    const cleanLga = normalizeText(lga);

    if (!cleanFullName) {
      return res.status(400).json({
        success: false,
        message: "Full name is required.",
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required.",
      });
    }

    if (!/^\d{11}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number must contain exactly 11 digits.",
      });
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least 6 characters.",
      });
    }

    const duplicateConditions = [
      { phone: cleanPhone },
    ];

    if (cleanEmail) {
      duplicateConditions.push({
        email: cleanEmail,
      });
    }

    const existingUser = await User.findOne({
      $or: duplicateConditions,
    }).select("_id phone email");

    if (existingUser) {
      const samePhone =
        normalizePhone(existingUser.phone) ===
        cleanPhone;

      return res.status(409).json({
        success: false,
        message: samePhone
          ? "A user with this phone number already exists."
          : "A user with this email address already exists.",
      });
    }

    const customer = new User({
      fullName: cleanFullName,
      phone: cleanPhone,
      email: cleanEmail || undefined,
      password: cleanPassword,

      role: "CUSTOMER",
      status: "ACTIVE",

      zone: normalizeText(loggedInUser.zone),
      state: normalizeText(loggedInUser.state),
      lga:
        cleanLga ||
        normalizeText(loggedInUser.lga) ||
        undefined,

      zonalManagerId:
        loggedInUser.zonalManagerId || undefined,

      stateManagerId:
        loggedInUser.stateManagerId || undefined,

      agentId:
        loggedInUser._id || loggedInUser.id,

      walletBalance: 0,
    });

    await customer.save();

    return res.status(201).json({
      success: true,
      message: "Customer created successfully.",
      customer: publicUser(customer),
    });
  } catch (error) {
    console.error("createCustomer error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "Phone number or email address already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error while creating Customer.",
    });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const loggedInRole = normalizeText(
      loggedInUser.role
    ).toUpperCase();

    if (loggedInRole !== "AGENT") {
      return res.status(403).json({
        success: false,
        message:
          "Only an Agent can view Customers.",
      });
    }

    const search = normalizeText(req.query.search);
    const status = normalizeText(
      req.query.status
    ).toUpperCase();

    const query = {
      role: "CUSTOMER",
      agentId:
        loggedInUser._id || loggedInUser.id,
    };

    if (
      status &&
      ["ACTIVE", "SUSPENDED", "BLOCKED"].includes(
        status
      )
    ) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          fullName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          lga: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const customers = await User.find(query)
      .select("-password -transactionPin")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: customers.length,
      customers: customers.map(publicUser),
    });
  } catch (error) {
    console.error("getCustomers error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Server error while loading Customers.",
    });
  }
};
