const axios = require("axios");

const PREMBLY_BASE_URL =
  process.env.PREMBLY_BASE_URL || "https://api.prembly.com";

const normalizeIdentityType = (value) => {
  const type = String(value || "").trim().toUpperCase();
  return ["NIN", "BVN"].includes(type) ? type : "";
};

const maskIdentifier = (value) => {
  const identifier = String(value || "").trim();
  return identifier.length > 4
    ? `${"*".repeat(identifier.length - 4)}${identifier.slice(-4)}`
    : "****";
};

const normalizedName = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

const getProviderName = (payload) => {
  const sources = [
    payload?.data,
    payload?.nin_data,
    payload?.data?.nin_data,
    payload?.bvn_data,
    payload?.data?.bvn_data,
    payload?.response?.data,
    payload,
  ].filter((value) => value && typeof value === "object");

  for (const source of sources) {
    const fullName =
      source.fullName ||
      source.full_name ||
      source.name ||
      [source.firstname || source.first_name, source.middlename || source.middle_name, source.surname || source.last_name]
        .filter(Boolean)
        .join(" ");
    if (String(fullName || "").trim()) return String(fullName).trim();
  }
  return "";
};

const nameMatchStatus = ({ firstName, middleName, lastName, providerName }) => {
  const profileName = normalizedName(
    [firstName, middleName, lastName].filter(Boolean).join(" "),
  );
  const verifiedName = normalizedName(providerName);
  if (!profileName || !verifiedName) return "REVIEW_REQUIRED";
  return profileName === verifiedName ? "MATCHED" : "REVIEW_REQUIRED";
};

const verifyIdentity = async ({ type, identifier, profile }) => {
  const identityType = normalizeIdentityType(type);
  const cleanIdentifier = String(identifier || "").replace(/\s+/g, "");
  const appId = String(process.env.PREMBLY_APP_ID || "").trim();
  const secret = String(process.env.PREMBLY_SECRET_KEY || "").trim();

  if (!identityType || !/^\d{11}$/.test(cleanIdentifier)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_IDENTIFIER",
      message: "Enter a valid 11-digit identity number.",
    };
  }

  if (!appId || !secret) {
    return {
      ok: false,
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
      message: "Identity verification is temporarily unavailable. Please try again later.",
    };
  }

  const path =
    identityType === "NIN"
      ? "/verification/vnin-basic"
      : "/verification/bvn_validation";

  let response;
  try {
    response = await axios.post(
      `${PREMBLY_BASE_URL}${path}`,
      { number: cleanIdentifier },
      {
        headers: {
          "Content-Type": "application/json",
          app_id: appId,
          "x-api-key": secret,
        },
        timeout: 45000,
      },
    );
  } catch (error) {
    const upstreamStatus = Number(error?.response?.status);
    return {
      ok: false,
      status: upstreamStatus >= 500 ? 503 : 400,
      code: upstreamStatus >= 500 ? "PROVIDER_UNAVAILABLE" : "VERIFICATION_FAILED",
      message:
        upstreamStatus >= 500
          ? "Identity verification is temporarily unavailable. Please try again later."
          : "We could not verify that identity number.",
    };
  }

  const providerName = getProviderName(response?.data || {});
  if (!providerName) {
    return {
      ok: false,
      status: 400,
      code: "VERIFICATION_FAILED",
      message: "We could not verify that identity number.",
    };
  }

  return {
    ok: true,
    identityType,
    maskedIdentifier: maskIdentifier(cleanIdentifier),
    providerReference: String(
      response?.data?.reference ||
        response?.data?.transaction_id ||
        response?.headers?.["x-request-id"] ||
        "",
    ).slice(0, 255),
    matchStatus: nameMatchStatus({
      firstName: profile?.firstName,
      middleName: profile?.middleName,
      lastName: profile?.lastName,
      providerName,
    }),
  };
};

module.exports = {
  normalizeIdentityType,
  maskIdentifier,
  normalizedName,
  nameMatchStatus,
  verifyIdentity,
};