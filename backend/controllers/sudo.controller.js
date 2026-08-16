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
