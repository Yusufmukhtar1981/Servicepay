const mongoose = require("mongoose");
const DataPriceOverride = require("../models/dataPriceOverride.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const { getCatalog } = require("./telecomAbodeDataCatalog.service");

const reject = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

function validateAvailabilityChange(body) {
  if (body?.confirmed !== true || typeof body.active !== "boolean") {
    throw reject("Confirm the availability change and supply a boolean active status.");
  }
  if (!Array.isArray(body.planCodes) || !body.planCodes.length ||
      body.planCodes.length > 250 ||
      body.planCodes.some(code => typeof code !== "string" || !code.trim() || code.length > 128) ||
      new Set(body.planCodes).size !== body.planCodes.length) {
    throw reject("Select between 1 and 250 unique DATA plan codes.");
  }
  return { active: body.active, planCodes: body.planCodes };
}

function createDataPlanAvailability({
  prices = DataPriceOverride, audit = AdminAuditLog,
  catalog = getCatalog, startSession = () => mongoose.startSession(),
} = {}) {
  return async ({ networkCode, body, actor, ipAddress = "" }) => {
    const { active, planCodes } = validateAvailabilityChange(body);
    const supported = await catalog(networkCode);
    const byCode = new Map(supported.map(plan => [String(plan.code), plan]));
    const plans = planCodes.map(code => {
      const plan = byCode.get(code);
      if (!plan || plan.ambiguousIdentity) {
        throw reject("A selected plan is unavailable or has an ambiguous provider identity.", 409);
      }
      return plan;
    });
    const session = await startSession();
    let changed;
    try {
      await session.withTransaction(async () => {
        changed = [];
        for (const plan of plans) {
          const key = { networkCode, planCode: plan.pricingCode || plan.code };
          const before = await prices.findOne(key).session(session).lean();
          if (active && !(Number.isFinite(Number(before?.sellingPrice)) &&
              Number(before.sellingPrice) > 0)) {
            throw reject("Every enabled plan must have an approved positive selling price.", 409);
          }
          // Serialize with the purchase admission write to this same price
          // record. Disabling cannot rewrite a purchase already admitted.
          await prices.updateOne(key, {
            $set: { active, updatedBy: actor._id || actor.id },
            $inc: { pricingVersion: 1 },
            $setOnInsert: {
              networkCode, planCode: key.planCode, planName: plan.name,
              providerPrice: Number(plan.price), sellingPrice: null,
            },
          }, { upsert: !active, session, runValidators: true });
          changed.push({
            code: plan.code, pricingCode: key.planCode,
            before: before?.active === true, after: active,
          });
        }
        await audit.create([{
          actorId: actor._id || actor.id, actorRole: actor.role,
          action: "SERVICE_SETTING_UPDATED",
          reason: "Confirmed DATA plan availability change.",
          metadata: { service: "DATA", networkCode, plans: changed },
          ipAddress, status: "SUCCESSFUL",
        }], { session });
      });
      return { changed: changed.length, active, planCodes };
    } finally {
      await session.endSession();
    }
  };
}
module.exports = { createDataPlanAvailability, validateAvailabilityChange };
