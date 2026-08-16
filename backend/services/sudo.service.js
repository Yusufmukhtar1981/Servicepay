const axios = require("axios");

const SUDO_BASE_URL =
  process.env.SUDO_BASE_URL || "https://api.sudo.africa";

function getApiKey() {
  const apiKey = process.env.SUDO_API_KEY;

  if (!apiKey) {
    throw new Error("SUDO_API_KEY is not configured");
  }

  return apiKey.trim();
}

const sudoClient = axios.create({
  baseURL: SUDO_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

sudoClient.interceptors.request.use((config) => {
  config.headers.Authorization = getApiKey();
  return config;
});

async function sudoRequest(config) {
  try {
    const response = await sudoClient(config);

    return {
      success: true,
      status: response.status,
      data: response.data,
    };
  } catch (error) {
    const status = error.response?.status || 500;
    const data = error.response?.data || null;

    const message =
      data?.message ||
      data?.error ||
      error.message ||
      "Sudo API request failed";

    const sudoError = new Error(message);
    sudoError.status = status;
    sudoError.data = data;

    throw sudoError;
  }
}

async function getCustomers(params = {}) {
  return sudoRequest({
    method: "GET",
    url: "/customers",
    params,
  });
}

async function getCustomer(customerId) {
  return sudoRequest({
    method: "GET",
    url: `/customers/${customerId}`,
  });
}

async function createCustomer(payload) {
  return sudoRequest({
    method: "POST",
    url: "/customers",
    data: payload,
  });
}

async function updateCustomer(customerId, payload) {
  return sudoRequest({
    method: "PUT",
    url: `/customers/${customerId}`,
    data: payload,
  });
}

async function getCards(params = {}) {
  return sudoRequest({
    method: "GET",
    url: "/cards",
    params,
  });
}

async function getCustomerCards(customerId, params = {}) {
  return sudoRequest({
    method: "GET",
    url: `/cards/customer/${customerId}`,
    params,
  });
}


async function getCardPrograms(params = {}) {
  return sudoRequest({
    method: "GET",
    url: "/card-programs",
    params,
  });
}

module.exports = {
  getCardPrograms,
  sudoClient,
  sudoRequest,
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  getCards,
  getCustomerCards,
};

async function generateTestCard() {
  return sudoRequest({
    method: "GET",
    url: "/cards/simulator/generate",
  });
}

module.exports.generateTestCard = generateTestCard;

async function createOrMapCard(payload) {
  return sudoRequest({
    method: "POST",
    url: "/cards",
    data: payload,
  });
}

module.exports.createOrMapCard = createOrMapCard;


async function getAccounts(params = {}) {
  return sudoRequest({
    method: "GET",
    url: "/accounts",
    params,
  });
}

async function getFundingSources(params = {}) {
  return sudoRequest({
    method: "GET",
    url: "/fundingsources",
    params,
  });
}

module.exports.getAccounts = getAccounts;
module.exports.getFundingSources = getFundingSources;


async function createAccount(payload) {
  return sudoRequest({
    method: "POST",
    url: "/accounts",
    data: payload,
  });
}

module.exports.createAccount = createAccount;


async function createFundingSource(payload) {
  return sudoRequest({
    method: "POST",
    url: "/fundingsources",
    data: payload,
  });
}

module.exports.createFundingSource = createFundingSource;


async function createCardProgram(payload) {
  return sudoRequest({
    method: "POST",
    url: "/card-programs",
    data: payload,
  });
}

module.exports.createCardProgram = createCardProgram;
