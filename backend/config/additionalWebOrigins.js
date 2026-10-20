"use strict";

function additionalWebOrigins(value = "") {
  const origins = String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
  return [...new Set(origins.map((entry) => {
    const url = new URL(entry);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || entry.includes("*")
    ) {
      throw new Error("SERVICEPAY_EXTRA_WEB_ORIGINS must contain exact HTTPS origins");
    }
    return url.origin;
  }))];
}

module.exports = { additionalWebOrigins };
