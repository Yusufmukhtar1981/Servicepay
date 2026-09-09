const sudoService = require("../services/sudo.service");

function sendError(res, error) {
  console.error("SUDO ERROR:", error?.response?.data || error?.data || error?.message || error);

  const status =
    Number(error?.status) ||
    Number(error?.response?.status) ||
    500;

  const apiData =
    error?.data ||
    error?.response?.data ||
    null;

  const message =
    apiData?.message ||
    apiData?.error ||
    error?.message ||
    "Sudo request failed";

  return res.status(status).json({
    success: false,
    message,
    error: apiData,
  });
}

exports.status = async (req, res) => {
  return res.json({
    success: true,
    provider: "Sudo Africa",
    configured: Boolean(process.env.SUDO_API_KEY),
    baseUrl:
      process.env.SUDO_BASE_URL ||
      "https://api.sudo.africa",
  });
};

exports.getCustomers = async (req, res) => {
  try {
    const data = await sudoService.getCustomers(req.query || {});
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const data = await sudoService.getCustomer(req.params.customerId);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const data = await sudoService.createCustomer(req.body || {});
    return res.status(201).json({
      success: true,
      message: "Sudo customer created successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const data = await sudoService.updateCustomer(
      req.params.customerId,
      req.body || {}
    );

    return res.json({
      success: true,
      message: "Sudo customer updated successfully",
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getCards = async (req, res) => {
  try {
    const data = await sudoService.getCards(req.query || {});
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};

exports.getCustomerCards = async (req, res) => {
  try {
    const data = await sudoService.getCustomerCards(
      req.params.customerId,
      req.query || {}
    );

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    return sendError(res, error);
  }
};


exports.getCardPrograms = async (req, res) => {
  try {
    const data = await sudoService.getCardPrograms(req.query || {});

    return res.status(200).json({
      success: true,
      message: "Sudo card programs fetched successfully.",
      data,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to fetch Sudo card programs.",
      error: error.data || null,
    });
  }
};


exports.generateTestCard = async (req, res) => {
  try {
    const data = await sudoService.generateTestCard();

    return res.status(200).json({
      success: true,
      message: "Sudo test card generated successfully.",
      data,
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Unable to generate Sudo test card.",
      error: error.data || null,
    });
  }
};

exports.createOrMapCard = async (req, res) => {
  try {
    const {
      customerId,
      number,
      type = "physical",
      currency = "NGN",
      status = "active",
      programId,
      metadata = {},
    } = req.body || {};

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "Sudo customerId is required.",
      });
    }

    if (!number && !programId) {
      return res.status(400).json({
        success: false,
        message: "Card number or programId is required.",
      });
    }

    const payload = {
      customerId,
      status,
      metadata,
    };

    if (number) {
      payload.number = String(number).trim();
      payload.type = type;
      payload.currency = currency;
    }

    if (programId) {
      payload.programId = programId;
    }

    const data = await sudoService.createOrMapCard(payload);

    return res.status(201).json({
      success: true,
      message: "Sudo card mapped to customer successfully.",
      data,
    });
  } catch (error) {
    const status =
      error?.status ||
      error?.response?.status ||
      500;

    return res.status(status).json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.message ||
        "Unable to map Sudo card.",
      error: error?.response?.data || null,
    });
  }
};


exports.getAccounts = async (req, res) => {
  try {
    const data = await sudoService.getAccounts(req.query || {});
    return res.status(200).json({
      success: true,
      message: "Sudo accounts fetched successfully.",
      data,
    });
  } catch (error) {
    const status =
      error?.status ||
      error?.response?.status ||
      500;

    return res.status(status).json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.message ||
        "Unable to fetch Sudo accounts.",
      error: error?.response?.data || null,
    });
  }
};

exports.getFundingSources = async (req, res) => {
  try {
    const data = await sudoService.getFundingSources(req.query || {});
    return res.status(200).json({
      success: true,
      message: "Sudo funding sources fetched successfully.",
      data,
    });
  } catch (error) {
    const status =
      error?.status ||
      error?.response?.status ||
      500;

    return res.status(status).json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.message ||
        "Unable to fetch Sudo funding sources.",
      error: error?.response?.data || null,
    });
  }
};


exports.createAccount = async (req, res) => {
  try {
    const {
      customerId,
      currency = "NGN",
      accountType = "Savings",
    } = req.body || {};

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required.",
      });
    }

    const data = await sudoService.createAccount({
      type: "account",
      currency,
      accountType,
      customerId,
    });

    const innerStatus = data?.statusCode || data?.status || 200;

    if (innerStatus >= 400) {
      return res.status(innerStatus).json({
        success: false,
        message: data?.message || "Unable to create Sudo account.",
        data,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Sudo account created successfully.",
      data,
    });
  } catch (error) {
    const status =
      error?.status ||
      error?.response?.status ||
      500;

    return res.status(status).json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.message ||
        "Unable to create Sudo account.",
      error: error?.response?.data || null,
    });
  }
};


exports.createFundingSource = async (req, res) => {
  try {
    const {
      type = "default",
      status = "active",
    } = req.body || {};

    const data = await sudoService.createFundingSource({
      type,
      status,
    });

    return res.status(201).json({
      success: true,
      message: "Sudo funding source created successfully.",
      data,
    });
  } catch (error) {
    const status =
      error?.status ||
      error?.response?.status ||
      500;

    return res.status(status).json({
      success: false,
      message:
        error?.message ||
        error?.response?.data?.message ||
        "Unable to create Sudo funding source.",
      error: error?.response?.data || null,
    });
  }
};
