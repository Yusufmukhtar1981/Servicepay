const DataPriceOverride = require(
  "../models/dataPriceOverride.model"
);

const { getCatalog } = require("../services/telecomAbodeDataCatalog.service");
const changeAvailability = require("../services/dataPlanAvailability.service")
  .createDataPlanAvailability();

const normalizeNetwork = (value = "") => {
  const v = String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const map = {
    MTN: "01",
    "01": "01",
    GLO: "02",
    "02": "02",
    "9MOBILE": "03",
    "03": "03",
    AIRTEL: "04",
    "04": "04",
  };

  return map[v] || null;
};

exports.setDataPlanAvailability = async (req, res) => {
  try {
    const networkCode = normalizeNetwork(req.params.network);
    if (!networkCode) return res.status(400).json({ success: false, message: "Invalid network." });
    const result = await changeAvailability({
      networkCode, body: req.body, actor: req.user, ipAddress: req.ip || "",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.statusCode || 503).json({
      success: false,
      message: error.statusCode ? error.message : "Unable to change DATA plan availability.",
    });
  }
};

exports.getAdminDataPricing = async (req, res) => {
  try {
    const networkCode = normalizeNetwork(
      req.params.network
    );

    if (!networkCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid network.",
      });
    }

    const providerPlans = await getCatalog(networkCode);

    const overrides =
      await DataPriceOverride.find({
        networkCode,
      }).lean();

    const overrideMap = new Map(
      overrides.map((item) => [
        String(item.planCode),
        item,
      ])
    );

    const plans = providerPlans.map((plan) => {
      const providerPrice = Number(plan.price);

      const override = overrideMap.get(
        String(plan.pricingCode || plan.code)
      );

      const configuredPrice = Number(override?.sellingPrice);
      const configured = Number.isFinite(configuredPrice) && configuredPrice > 0;
      const priced = override?.active === true && configured;
      const sellingPrice = configured ? configuredPrice : null;

      return {
        code: plan.code,
        name: plan.name,
        networkCode,
        provider: "TELECOM_ABODE",
        ambiguousIdentity: plan.ambiguousIdentity,
        providerPlanId: plan.providerPlanId,
        providerPrice,
        sellingPrice,
        priced,
        active: priced,
        available: !plan.ambiguousIdentity,
        canEnable: configured && !plan.ambiguousIdentity,
        dataVolume: plan.name.match(/\b\d+(?:\.\d+)?\s*(?:GB|MB|TB)\b/i)?.[0] || "",
        validity: plan.name.match(/\b\d+\s*(?:days?|weeks?|months?|hours?)\b/i)?.[0] || "",
        dataType: /SME/i.test(plan.name) ? "SME" : /GIFT/i.test(plan.name) ? "GIFTING" : "OTHER",
        margin: configured
          ? Number((sellingPrice - providerPrice).toFixed(2))
          : null,
      };
    });

    return res.status(200).json({
      success: true,
      networkCode,
      plans,
    });
  } catch (error) {
    console.error(
      "Admin data pricing error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load Data pricing.",
      error: error.message,
    });
  }
};

exports.saveDataSellingPrice = async (
  req,
  res
) => {
  try {
    const networkCode = normalizeNetwork(
      req.params.network
    );

    const planCode = String(
      req.params.planCode || ""
    ).trim();

    const sellingPrice = Number(
      req.body.sellingPrice
    );

    if (
      !networkCode ||
      !planCode ||
      !Number.isFinite(sellingPrice) ||
      sellingPrice <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid network, plan and selling price.",
      });
    }

    const providerPlans = await getCatalog(networkCode);

    const plan = providerPlans.find(
      (item) =>
        String(item.code) === planCode
    );

    if (!plan) {
      return res.status(404).json({
        success: false,
        message:
          "Data plan was not found.",
      });
    }

    const providerPrice = Number(
      plan.price || 0
    );

    const record =
      await DataPriceOverride.findOneAndUpdate(
        {
          networkCode,
          planCode: plan.pricingCode || planCode,
        },
        {
          $set: {
            networkCode,
            planCode: plan.pricingCode || planCode,
            planName: plan.name || "",
            providerPrice,
            sellingPrice,
            updatedBy: req.user?._id || null,
          },
          $setOnInsert: { active: false },
          $inc: { pricingVersion: 1 },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

    return res.status(200).json({
      success: true,
      message:
        "Selling price updated successfully.",
      pricing: {
        networkCode,
        planCode,
        providerPrice,
        sellingPrice:
          record.sellingPrice,
        margin: Number(
          (
            record.sellingPrice -
            providerPrice
          ).toFixed(2)
        ),
      },
    });
  } catch (error) {
    console.error(
      "Save Data pricing error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to save selling price.",
      error: error.message,
    });
  }
};
