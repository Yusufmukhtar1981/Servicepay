const Settings = require("../models/appSettings.model");
const Delivery = require("../models/delivery.model");

const fail = (message, status = 400, code = "INVALID_DELIVERY_PRICE") =>
  Object.assign(new Error(message), { status, code });

function validPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 ||
      value > 10000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) {
    throw fail("Enter a positive delivery price with at most two decimal places.");
  }
  return Number(value.toFixed(2));
}

async function intraState(session = null, { admit = false } = {}) {
  const settings = await Settings.findOne({ key: "GLOBAL_SETTINGS" })
    .select("deliveryPricing").session(session).lean();
  const stored = settings?.deliveryPricing;
  if (admit && settings) {
    if (!session) throw fail("Price admission requires a transaction.", 500);
    await Settings.updateOne({ _id: settings._id },
      { $inc: { deliveryPriceAdmissionVersion: 1 } }, { session });
  }
  // Absence preserves the approved legacy tariff, without creating settings
  // or changing unrelated service controls during a quote.
  if (!stored) return { price: Delivery.STANDARD_DELIVERY_FEE, version: 0, updatedAt: null };
  return { price: validPrice(stored.price), version: stored.version || 0,
    updatedAt: stored.updatedAt || null };
}

module.exports = { intraState, validPrice, fail };