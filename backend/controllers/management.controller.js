const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Commission = require("../models/commission.model");
const mongoose = require("mongoose");
const { getZonalScope } = require("../services/zonalScope.service");

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

const descendantUsers = async (root) => {
  const rootId = root?._id || root?.id;
  const rootRole = normalizeText(root?.role).toUpperCase();
  const seen = new Set([String(rootId)]);
  let frontier = [rootId];
  const rows = [];
  while (frontier.length && rows.length < 10000) {
    const parentLinks = rootRole === "ZONAL_MANAGER"
      ? [{ zonalManagerId: { $in: frontier } }, { stateManagerId: { $in: frontier } }, { agentId: { $in: frontier } }]
      : rootRole === "STATE_MANAGER"
        ? [{ stateManagerId: { $in: frontier } }, { agentId: { $in: frontier } }]
        : [{ agentId: { $in: frontier } }];
    const children = await User.find({
      isDeleted: { $ne: true },
      $or: parentLinks,
    }).select("-password -transactionPin").lean();
    frontier = [];
    for (const child of children) {
      const id = String(child._id);
      if (seen.has(id)) continue;
      seen.add(id); rows.push(child); frontier.push(child._id);
    }
  }
  return rows;
};

const managerRoot = (req) => {
  const role = normalizeText(req.user?.role).toUpperCase();
  return ["ZONAL_MANAGER", "STATE_MANAGER", "AGENT"].includes(role) ? role : null;
};

exports.getDownlineSummary = async (req, res) => {
  try {
    if (!managerRoot(req)) return res.status(403).json({ success: false, message: "A manager role is required." });
    if (String(req.user.role).toUpperCase() === "ZONAL_MANAGER") {
      const scope = await getZonalScope(req.user);
      const customerIds = scope.customerIds.map((value) => new mongoose.Types.ObjectId(value));
      const visibleIds = [...scope.stateManagerIds, ...scope.agentIds, ...scope.customerIds].map((value) => new mongoose.Types.ObjectId(value));
      const transactionFilter = { customerId: { $in: customerIds } };
      const [tx, totalTransactions, totals, users] = await Promise.all([
        Transaction.find(transactionFilter).select("customerId amount serviceType status reference createdAt").sort({ createdAt: -1 }).limit(100).lean(),
        Transaction.countDocuments(transactionFilter),
        Transaction.aggregate([{ $match: transactionFilter }, { $group: { _id: null, value: { $sum: "$amount" } } }]),
        User.find({ _id: { $in: visibleIds }, isDeleted: { $ne: true } }).select("-password -transactionPin -authTokenVersion").lean(),
      ]);
      return res.json({ success: true, scope: { role: "ZONAL_MANAGER", userId: req.user._id }, counts: { totalDownline: visibleIds.length, customers: scope.customerIds.length, transactions: totalTransactions, transactionValue: Number(totals[0]?.value || 0) }, users: users.map(publicUser), recentTransactions: tx });
    }
    const rows = await descendantUsers(req.user);
    const customerIds = rows.filter((x) => x.role === "CUSTOMER").map((x) => x._id);
    const transactionFilter = { customerId: { $in: customerIds } };
    const [tx, totalTransactions, totals] = await Promise.all([
      Transaction.find(transactionFilter).select("customerId amount serviceType status reference createdAt").sort({ createdAt: -1 }).limit(100).lean(),
      Transaction.countDocuments(transactionFilter),
      Transaction.aggregate([
        { $match: transactionFilter },
        { $group: { _id: null, value: { $sum: "$amount" } } },
      ]),
    ]);
    return res.json({
      success: true,
      scope: { role: String(req.user.role).toUpperCase(), userId: req.user._id },
      counts: { totalDownline: rows.length, customers: customerIds.length, transactions: totalTransactions, transactionValue: Number(totals[0]?.value || 0) },
      users: rows.map(publicUser), recentTransactions: tx,
    });
  } catch (error) { console.error("Downline summary error:", error); return res.status(500).json({ success: false, message: "Unable to load downline summary." }); }
};

exports.getDownlineTransactions = async (req, res) => {
  try {
    if (!managerRoot(req)) return res.status(403).json({ success: false, message: "A manager role is required." });
    if (String(req.user.role).toUpperCase() === "ZONAL_MANAGER") {
      const scope = await getZonalScope(req.user);
      const ids = scope.customerIds.map((value) => new mongoose.Types.ObjectId(value));
      const query = { customerId: { $in: ids } };
      if (req.params.transactionId) {
        if (!mongoose.Types.ObjectId.isValid(req.params.transactionId)) return res.status(403).json({ success: false, message: "Transaction is outside your downline scope." });
        query._id = req.params.transactionId;
        const transaction = await Transaction.findOne(query).lean();
        if (!transaction) return res.status(403).json({ success: false, message: "Transaction is outside your downline scope." });
        return res.json({ success: true, transaction });
      }
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const [transactions, total] = await Promise.all([
        Transaction.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Transaction.countDocuments(query),
      ]);
      return res.json({ success: true, transactions, page, limit, total, totalPages: Math.ceil(total / limit) });
    }
    const rows = await descendantUsers(req.user);
    const ids = rows.filter((x) => x.role === "CUSTOMER").map((x) => x._id);
    const query = { customerId: { $in: ids } };
    if (req.params.transactionId) {
      if (!require("mongoose").Types.ObjectId.isValid(req.params.transactionId)) {
        return res.status(404).json({ success: false, message: "Transaction is outside your downline scope." });
      }
      query._id = req.params.transactionId;
      const transaction = await Transaction.findOne(query).lean();
      if (!transaction) return res.status(404).json({ success: false, message: "Transaction is outside your downline scope." });
      return res.json({ success: true, transaction });
    }
    const page = Math.max(1, Number.parseInt(req.query.page || "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || "25", 10) || 25));
    const [transactions, total, totals] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Transaction.countDocuments(query),
      Transaction.aggregate([{ $match: query }, { $group: { _id: null, value: { $sum: "$amount" } } }]),
    ]);
    return res.json({
      success: true,
      transactions,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      totals: { count: total, value: Number(totals[0]?.value || 0) },
    });
  } catch (error) { return res.status(500).json({ success: false, message: "Unable to load downline transactions." }); }
};

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

    const session = await mongoose.startSession();
    let customer;
    let actor;
    try {
      await session.withTransaction(async () => {
        // Lock the parent hierarchy document first. A promotion updates this
        // same document, so MongoDB retries one transaction rather than
        // allowing a stale AGENT request to create an orphan.
        actor = await User.findOneAndUpdate(
          { _id: loggedInUser._id || loggedInUser.id, role: "AGENT", status: "ACTIVE", isDeleted: { $ne: true } },
          { $inc: { hierarchyVersion: 1 } },
          { session, new: true }
        );
        if (!actor) {
          const error = new Error("Agent hierarchy changed; registration was rejected.");
          error.statusCode = 409;
          throw error;
        }
        const existingUser = await User.findOne({ $or: duplicateConditions }).session(session).select("_id phone email");

        if (existingUser) {
          const samePhone = normalizePhone(existingUser.phone) === cleanPhone;
          const error = new Error(samePhone ? "A user with this phone number already exists." : "A user with this email address already exists.");
          error.statusCode = 409;
          throw error;
        }

        customer = new User({
          fullName: cleanFullName,
          phone: cleanPhone,
          email: cleanEmail || undefined,
          password: cleanPassword,

          role: "CUSTOMER",
          status: "ACTIVE",

          zone: actor.zone,
          state: actor.state,
          lga: cleanLga || normalizeText(actor.lga) || undefined,

          zonalManagerId: actor.zonalManagerId || undefined,
          stateManagerId: actor.stateManagerId || undefined,
          agentId: actor._id,
          walletBalance: 0,
        });

        await customer.save({ session });
      });
    } finally { await session.endSession(); }

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

    return res.status(error.statusCode || 500).json({
      success: false,
      message:
        error.statusCode ? error.message : "Server error while creating Customer.",
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

exports.getAgentTransactions = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const role = String(loggedInUser.role || "")
      .trim()
      .toUpperCase();

    if (role !== "AGENT") {
      return res.status(403).json({
        success: false,
        message: "Only an Agent can view Agent transactions.",
      });
    }

    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "ALL")
      .trim()
      .toUpperCase();

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100
    );

    const customerQuery = {
      role: "CUSTOMER",
      agentId: loggedInUser._id,
    };

    const customers = await User.find(customerQuery)
      .select("_id fullName phone email")
      .lean();

    const customerIds = customers.map(
      (customer) => customer._id
    );

    if (customerIds.length === 0) {
      return res.status(200).json({
        success: true,
        summary: {
          totalTransactions: 0,
          successfulTransactions: 0,
          pendingTransactions: 0,
          failedTransactions: 0,
          totalAmount: 0,
        },
        transactions: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      });
    }

    const transactionQuery = {
      customerId: { $in: customerIds },
    };

    if (status !== "ALL") {
      transactionQuery.status = status;
    }

    if (search) {
      transactionQuery.$and = [
        {
          $or: [
            {
              reference: {
                $regex: search,
                $options: "i",
              },
            },
            {
              serviceType: {
                $regex: search,
                $options: "i",
              },
            },
            {
              description: {
                $regex: search,
                $options: "i",
              },
            },
          ],
        },
      ];
    }

    const skip = (page - 1) * limit;

    const [
      transactions,
      total,
      summaryRows,
    ] = await Promise.all([
      Transaction.find(transactionQuery)
        .populate(
          "customerId",
          "fullName phone email"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Transaction.countDocuments(transactionQuery),

      Transaction.aggregate([
        {
          $match: {
            customerId: { $in: customerIds },
          },
        },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalAmount: {
              $sum: { $ifNull: ["$amount", 0] },
            },
            successfulTransactions: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "SUCCESSFUL"] },
                  1,
                  0,
                ],
              },
            },
            pendingTransactions: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "PENDING"] },
                  1,
                  0,
                ],
              },
            },
            failedTransactions: {
              $sum: {
                $cond: [
                  { $eq: ["$status", "FAILED"] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const summary = summaryRows[0] || {
      totalTransactions: 0,
      successfulTransactions: 0,
      pendingTransactions: 0,
      failedTransactions: 0,
      totalAmount: 0,
    };

    return res.status(200).json({
      success: true,
      summary,
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error(
      "GET AGENT TRANSACTIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load Agent transactions.",
    });
  }
};


exports.getRoleTransactions = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const role = String(loggedInUser.role || "")
      .trim()
      .toUpperCase();

    if (
      ![
        "AGENT",
        "STATE_MANAGER",
        "ZONAL_MANAGER",
      ].includes(role)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not permitted to view role transactions.",
      });
    }

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1,
    );

    const limit = Math.min(
      Math.max(
        Number.parseInt(req.query.limit, 10) || 50,
        1,
      ),
      100,
    );

    const search = String(
      req.query.search || "",
    ).trim();

    const status = String(
      req.query.status || "ALL",
    )
      .trim()
      .toUpperCase();

    const serviceType = String(
      req.query.serviceType || "ALL",
    )
      .trim()
      .toUpperCase();

    const query = {};

    if (role === "AGENT") {
      query.agentId = loggedInUser._id;
    }

    if (role === "STATE_MANAGER") {
      query.stateManagerId = loggedInUser._id;
    }

    if (role === "ZONAL_MANAGER") {
      const scope = await getZonalScope(loggedInUser);
      query.customerId = { $in: scope.customerIds.map((value) => new mongoose.Types.ObjectId(value)) };
    }

    if (status !== "ALL") {
      query.status = status;
    }

    if (serviceType !== "ALL") {
      query.serviceType = serviceType;
    }

    if (search) {
      query.$or = [
        {
          reference: {
            $regex: search,
            $options: "i",
          },
        },
        {
          serviceType: {
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
          description: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const skip = (page - 1) * limit;

    const [
      transactions,
      total,
      successful,
      pending,
      failed,
      volumeResult,
    ] = await Promise.all([
      Transaction.find(query)
        .populate(
          "customerId",
          "fullName phone email",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Transaction.countDocuments(query),

      Transaction.countDocuments({
        ...query,
        status: "SUCCESSFUL",
      }),

      Transaction.countDocuments({
        ...query,
        status: "PENDING",
      }),

      Transaction.countDocuments({
        ...query,
        status: {
          $in: [
            "FAILED",
            "REFUNDED",
            "REVERSED",
          ],
        },
      }),

      Transaction.aggregate([
        {
          $match: query,
        },
        {
          $group: {
            _id: null,
            totalVolume: {
              $sum: {
                $ifNull: ["$amount", 0],
              },
            },
          },
        },
      ]),
    ]);

    const totalVolume =
      volumeResult.length > 0
        ? Number(
            volumeResult[0].totalVolume || 0,
          )
        : 0;

    return res.status(200).json({
      success: true,
      role,
      summary: {
        total,
        successful,
        pending,
        failed,
        totalVolume,
      },
      transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(
          Math.ceil(total / limit),
          1,
        ),
      },
    });
  } catch (error) {
    console.error(
      "GET ROLE TRANSACTIONS ERROR:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while loading role transactions.",
    });
  }
};

exports.getRoleCommissions = async (req, res) => {
  try {
    const loggedInUser = req.user;

    if (!loggedInUser) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const role = String(loggedInUser.role || "")
      .trim()
      .toUpperCase();

    if (
      ![
        "AGENT",
        "STATE_MANAGER",
        "ZONAL_MANAGER",
      ].includes(role)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not permitted to view commissions.",
      });
    }

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1,
    );

    const limit = Math.min(
      Math.max(
        Number.parseInt(req.query.limit, 10) || 50,
        1,
      ),
      100,
    );

    const status = String(
      req.query.status || "ALL",
    )
      .trim()
      .toUpperCase();

    const query = {
      beneficiaryId: loggedInUser._id,
      beneficiaryRole: role,
    };

    if (status !== "ALL") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [
      commissions,
      total,
      availableResult,
      pendingResult,
      withdrawnResult,
    ] = await Promise.all([
      Commission.find(query)
        .populate(
          "transactionId",
          "reference serviceType amount status createdAt",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Commission.countDocuments(query),

      Commission.aggregate([
        {
          $match: {
            beneficiaryId: loggedInUser._id,
            beneficiaryRole: role,
            status: "AVAILABLE",
          },
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: "$commissionAmount",
            },
          },
        },
      ]),

      Commission.aggregate([
        {
          $match: {
            beneficiaryId: loggedInUser._id,
            beneficiaryRole: role,
            status: "PENDING",
          },
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: "$commissionAmount",
            },
          },
        },
      ]),

      Commission.aggregate([
        {
          $match: {
            beneficiaryId: loggedInUser._id,
            beneficiaryRole: role,
            status: "WITHDRAWN",
          },
        },
        {
          $group: {
            _id: null,
            amount: {
              $sum: "$commissionAmount",
            },
          },
        },
      ]),
    ]);

    const available =
      availableResult.length > 0
        ? Number(
            availableResult[0].amount || 0,
          )
        : 0;

    const pending =
      pendingResult.length > 0
        ? Number(
            pendingResult[0].amount || 0,
          )
        : 0;

    const withdrawn =
      withdrawnResult.length > 0
        ? Number(
            withdrawnResult[0].amount || 0,
          )
        : 0;

    return res.status(200).json({
      success: true,
      role,
      summary: {
        total,
        available,
        pending,
        withdrawn,
        totalEarned:
          available + pending + withdrawn,
      },
      commissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(
          Math.ceil(total / limit),
          1,
        ),
      },
    });
  } catch (error) {
    console.error(
      "GET ROLE COMMISSIONS ERROR:",
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while loading role commissions.",
    });
  }
};
