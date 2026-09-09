const KekeFareSetting = require(
  "../models/kekeFareSetting.model"
);

/*
 * =====================================================
 * HELPERS
 * =====================================================
 */

const toNumber = (
  value,
  fallback = 0
) => {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
};

const normalizeState = (
  value
) => {
  const state =
    String(value || "")
      .trim()
      .toUpperCase();

  return state || null;
};

/*
 * =====================================================
 * DEFAULT GLOBAL SETTING
 * =====================================================
 */

const DEFAULT_GLOBAL_SETTING = {
  scopeType: "GLOBAL",
  state: null,

  baseFare: 250,
  minimumFare: 300,
  pricePerKm: 120,
  waitingFeePerMinute: 20,

  servicePayCommissionPercent: 10,

  maxSearchDistanceKm: 15,
  driverOfferSeconds: 60,

  active: true,
};

/*
 * =====================================================
 * GET OR CREATE GLOBAL SETTING
 * =====================================================
 */

const getOrCreateGlobalSetting =
  async () => {
    let setting =
      await KekeFareSetting.findOne({
        scopeType:
          "GLOBAL",

        state:
          null,
      });

    if (!setting) {
      setting =
        await KekeFareSetting.create(
          DEFAULT_GLOBAL_SETTING
        );
    }

    return setting;
  };

/*
 * =====================================================
 * GET EFFECTIVE KEKE FARE SETTING
 * =====================================================
 *
 * State setting overrides GLOBAL.
 *
 * Example:
 * Kano-specific setting exists:
 * use Kano.
 *
 * No Kano setting:
 * use GLOBAL.
 */

const getEffectiveFareSetting =
  async ({
    state = null,
  } = {}) => {
    const normalizedState =
      normalizeState(
        state
      );

    if (normalizedState) {
      const stateSetting =
        await KekeFareSetting.findOne({
          scopeType:
            "STATE",

          state:
            normalizedState,

          active:
            true,
        });

      if (stateSetting) {
        return stateSetting;
      }
    }

    return getOrCreateGlobalSetting();
  };

/*
 * =====================================================
 * CALCULATE KEKE FARE
 * =====================================================
 */

const calculateFare =
  ({
    distanceKm,
    waitingMinutes = 0,
    setting,
  }) => {
    const safeDistanceKm =
      Math.max(
        0,
        toNumber(
          distanceKm
        )
      );

    const safeWaitingMinutes =
      Math.max(
        0,
        toNumber(
          waitingMinutes
        )
      );

    const baseFare =
      Math.max(
        0,
        toNumber(
          setting.baseFare
        )
      );

    const minimumFare =
      Math.max(
        0,
        toNumber(
          setting.minimumFare
        )
      );

    const pricePerKm =
      Math.max(
        0,
        toNumber(
          setting.pricePerKm
        )
      );

    const waitingFeePerMinute =
      Math.max(
        0,
        toNumber(
          setting.waitingFeePerMinute
        )
      );

    const commissionPercent =
      Math.min(
        100,
        Math.max(
          0,
          toNumber(
            setting
              .servicePayCommissionPercent
          )
        )
      );

    const distanceFare =
      safeDistanceKm *
      pricePerKm;

    const waitingFare =
      safeWaitingMinutes *
      waitingFeePerMinute;

    /*
     * Gross fare before minimum fare rule.
     */
    const calculatedFare =
      baseFare +
      distanceFare +
      waitingFare;

    /*
     * Customer should never pay below
     * minimum fare.
     */
    const totalFare =
      Math.max(
        minimumFare,
        calculatedFare
      );

    const servicePayCommission =
      totalFare *
      (commissionPercent / 100);

    const driverEarning =
      totalFare -
      servicePayCommission;

    return {
      baseFare:
        Math.round(
          baseFare
        ),

      minimumFare:
        Math.round(
          minimumFare
        ),

      pricePerKm:
        Math.round(
          pricePerKm
        ),

      distanceKm:
        Number(
          safeDistanceKm
            .toFixed(2)
        ),

      distanceFare:
        Math.round(
          distanceFare
        ),

      waitingMinutes:
        Number(
          safeWaitingMinutes
            .toFixed(2)
        ),

      waitingFeePerMinute:
        Math.round(
          waitingFeePerMinute
        ),

      waitingFare:
        Math.round(
          waitingFare
        ),

      totalFare:
        Math.round(
          totalFare
        ),

      servicePayCommissionPercent:
        commissionPercent,

      servicePayCommission:
        Math.round(
          servicePayCommission
        ),

      driverEarning:
        Math.round(
          driverEarning
        ),
    };
  };

/*
 * =====================================================
 * CUSTOMER / APP
 * GET CURRENT EFFECTIVE FARE SETTINGS
 * =====================================================
 *
 * GET /api/keke-fare
 * GET /api/keke-fare?state=Kano
 */

exports.getFareSetting =
  async (
    req,
    res
  ) => {
    try {
      const setting =
        await getEffectiveFareSetting({
          state:
            req.query.state,
        });

      return res
        .status(200)
        .json({
          success:
            true,

          setting: {
            id:
              setting._id,

            scopeType:
              setting.scopeType,

            state:
              setting.state,

            baseFare:
              setting.baseFare,

            minimumFare:
              setting.minimumFare,

            pricePerKm:
              setting.pricePerKm,

            waitingFeePerMinute:
              setting
                .waitingFeePerMinute,

            servicePayCommissionPercent:
              setting
                .servicePayCommissionPercent,

            driverSharePercent:
              100 -
              setting
                .servicePayCommissionPercent,

            maxSearchDistanceKm:
              setting
                .maxSearchDistanceKm,

            driverOfferSeconds:
              setting
                .driverOfferSeconds,

            active:
              setting.active,
          },
        });
    } catch (error) {
      console.error(
        "GET KEKE FARE SETTING ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to load Keke fare settings.",
        });
    }
  };

/*
 * =====================================================
 * FARE ESTIMATE
 * =====================================================
 *
 * POST /api/keke-fare/estimate
 *
 * Body:
 *
 * {
 *   "distanceKm": 5,
 *   "waitingMinutes": 0,
 *   "state": "Kano"
 * }
 */

exports.estimateFare =
  async (
    req,
    res
  ) => {
    try {
      const {
        distanceKm,
        waitingMinutes =
          0,
        state,
      } = req.body || {};

      const distance =
        toNumber(
          distanceKm,
          -1
        );

      if (distance < 0) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Valid distanceKm is required.",
          });
      }

      const setting =
        await getEffectiveFareSetting({
          state,
        });

      const fare =
        calculateFare({
          distanceKm:
            distance,

          waitingMinutes,

          setting,
        });

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            "Keke fare estimated successfully.",

          setting: {
            scopeType:
              setting.scopeType,

            state:
              setting.state,
          },

          fare,
        });
    } catch (error) {
      console.error(
        "ESTIMATE KEKE FARE ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to estimate Keke fare.",
        });
    }
  };

/*
 * =====================================================
 * ADMIN - GET ALL FARE SETTINGS
 * =====================================================
 *
 * GET /api/admin/keke-fare
 */

exports.adminGetFareSettings =
  async (
    req,
    res
  ) => {
    try {
      await getOrCreateGlobalSetting();

      const settings =
        await KekeFareSetting.find({})
          .populate(
            "updatedBy",
            "fullName email role"
          )
          .sort({
            scopeType:
              1,

            state:
              1,
          });

      return res
        .status(200)
        .json({
          success:
            true,

          count:
            settings.length,

          settings,
        });
    } catch (error) {
      console.error(
        "ADMIN GET KEKE FARE SETTINGS ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to load Keke fare settings.",
        });
    }
  };

/*
 * =====================================================
 * ADMIN - UPSERT GLOBAL / STATE SETTING
 * =====================================================
 *
 * POST /api/admin/keke-fare
 *
 * Body:
 *
 * {
 *   "scopeType": "GLOBAL",
 *   "baseFare": 250,
 *   "minimumFare": 300,
 *   "pricePerKm": 120,
 *   "waitingFeePerMinute": 20,
 *   "servicePayCommissionPercent": 10,
 *   "maxSearchDistanceKm": 15,
 *   "driverOfferSeconds": 60
 * }
 *
 * OR:
 *
 * {
 *   "scopeType": "STATE",
 *   "state": "Kano",
 *   ...
 * }
 */

exports.adminSaveFareSetting =
  async (
    req,
    res
  ) => {
    try {
      const scopeType =
        String(
          req.body?.scopeType ||
            "GLOBAL"
        )
          .trim()
          .toUpperCase();

      if (
        ![
          "GLOBAL",
          "STATE",
        ].includes(
          scopeType
        )
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "scopeType must be GLOBAL or STATE.",
          });
      }

      let state = null;

      if (
        scopeType ===
        "STATE"
      ) {
        state =
          normalizeState(
            req.body?.state
          );

        if (!state) {
          return res
            .status(400)
            .json({
              success:
                false,

              message:
                "State is required for STATE fare settings.",
            });
        }
      }

      const baseFare =
        toNumber(
          req.body?.baseFare,
          250
        );

      const minimumFare =
        toNumber(
          req.body?.minimumFare,
          300
        );

      const pricePerKm =
        toNumber(
          req.body?.pricePerKm,
          120
        );

      const waitingFeePerMinute =
        toNumber(
          req.body
            ?.waitingFeePerMinute,
          20
        );

      const commissionPercent =
        toNumber(
          req.body
            ?.servicePayCommissionPercent,
          10
        );

      const maxSearchDistanceKm =
        toNumber(
          req.body
            ?.maxSearchDistanceKm,
          15
        );

      const driverOfferSeconds =
        toNumber(
          req.body
            ?.driverOfferSeconds,
          60
        );

      if (
        baseFare < 0 ||
        minimumFare < 0 ||
        pricePerKm < 0 ||
        waitingFeePerMinute <
          0
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Fare values cannot be negative.",
          });
      }

      if (
        commissionPercent < 0 ||
        commissionPercent >
          100
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "ServicePay commission must be between 0 and 100 percent.",
          });
      }

      if (
        maxSearchDistanceKm <
          1 ||
        maxSearchDistanceKm >
          100
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Maximum search distance must be between 1 and 100 km.",
          });
      }

      if (
        driverOfferSeconds <
          10 ||
        driverOfferSeconds >
          300
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Driver offer seconds must be between 10 and 300.",
          });
      }

      const update = {
        scopeType,

        state,

        baseFare,

        minimumFare,

        pricePerKm,

        waitingFeePerMinute,

        servicePayCommissionPercent:
          commissionPercent,

        maxSearchDistanceKm,

        driverOfferSeconds,

        active:
          req.body?.active ===
          undefined
            ? true
            : Boolean(
                req.body.active
              ),

        updatedBy:
          req.user?._id ||
          null,
      };

      const setting =
        await KekeFareSetting.findOneAndUpdate(
          {
            scopeType,

            state,
          },
          {
            $set:
              update,
          },
          {
            new:
              true,

            upsert:
              true,

            runValidators:
              true,

            setDefaultsOnInsert:
              true,
          }
        );

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            scopeType ===
            "GLOBAL"
              ? "Global Keke fare settings saved successfully."
              : `${state} Keke fare settings saved successfully.`,

          setting,
        });
    } catch (error) {
      console.error(
        "ADMIN SAVE KEKE FARE SETTING ERROR:",
        error
      );

      if (
        error?.code ===
        11000
      ) {
        return res
          .status(409)
          .json({
            success:
              false,

            message:
              "A fare setting already exists for this scope.",
          });
      }

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to save Keke fare settings.",
        });
    }
  };

/*
 * =====================================================
 * ADMIN - DISABLE STATE OVERRIDE
 * =====================================================
 *
 * DELETE /api/admin/keke-fare/:id
 *
 * GLOBAL setting cannot be deleted.
 */

exports.adminDeleteFareSetting =
  async (
    req,
    res
  ) => {
    try {
      const setting =
        await KekeFareSetting.findById(
          req.params.id
        );

      if (!setting) {
        return res
          .status(404)
          .json({
            success:
              false,

            message:
              "Keke fare setting not found.",
          });
      }

      if (
        setting.scopeType ===
        "GLOBAL"
      ) {
        return res
          .status(400)
          .json({
            success:
              false,

            message:
              "Global Keke fare setting cannot be deleted.",
          });
      }

      await setting.deleteOne();

      return res
        .status(200)
        .json({
          success:
            true,

          message:
            "State Keke fare override removed successfully.",
        });
    } catch (error) {
      console.error(
        "ADMIN DELETE KEKE FARE SETTING ERROR:",
        error
      );

      return res
        .status(500)
        .json({
          success:
            false,

          message:
            "Unable to remove Keke fare setting.",
        });
    }
  };

/*
 * =====================================================
 * EXPORT HELPERS FOR KEKE RIDE CONTROLLER
 * =====================================================
 */

exports.getEffectiveFareSetting =
  getEffectiveFareSetting;

exports.calculateFare =
  calculateFare;