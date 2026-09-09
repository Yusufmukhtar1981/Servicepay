const DeliveryCoverage = require(
  "../models/deliveryCoverage.model"
);

const {
  NIGERIA_DELIVERY_LOCATIONS,
} = require(
  "../models/deliveryCoverage.model"
);

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const normalizeText = (
  value = ""
) => {
  return String(value).trim();
};

const normalizeStateCode = (
  value = ""
) => {
  const cleaned = String(value)
    .trim()
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const aliases = {
    ABUJA: "FCT_ABUJA",
    FCT: "FCT_ABUJA",
    FCT_ABUJA: "FCT_ABUJA",
    FEDERAL_CAPITAL_TERRITORY:
      "FCT_ABUJA",
    FEDERAL_CAPITAL_TERRITORY_ABUJA:
      "FCT_ABUJA",

    AKWAIBOM: "AKWA_IBOM",
    CROSSRIVER: "CROSS_RIVER",
  };

  return aliases[cleaned] || cleaned;
};

const stateDefinitionFromValue = (
  value
) => {
  const normalized =
    normalizeStateCode(value);

  return (
    NIGERIA_DELIVERY_LOCATIONS.find(
      (location) =>
        location.code === normalized
    ) ||
    NIGERIA_DELIVERY_LOCATIONS.find(
      (location) =>
        normalizeStateCode(
          location.name
        ) === normalized
    ) ||
    null
  );
};

const validateHeadOffice = (
  req,
  res
) => {
  const role = String(
    req.user?.role || ""
  )
    .trim()
    .toUpperCase();

  const allowedRoles = [
    "HEAD_OFFICE",
    "HEAD_OFFICE_ADMIN",
    "SUPER_ADMIN",
    "ADMIN",
  ];

  if (!allowedRoles.includes(role)) {
    res.status(403).json({
      success: false,
      message:
        "Only ServicePay Head Office can manage Delivery Coverage.",
    });

    return false;
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| CREATE ALL STATES IF THEY DO NOT EXIST
|--------------------------------------------------------------------------
|
| This function is safe to call repeatedly.
| Existing state settings will not be overwritten.
|
*/

const ensureCoverageSeeded =
  async () => {
    const operations =
      NIGERIA_DELIVERY_LOCATIONS.map(
        (location) => ({
          updateOne: {
            filter: {
              stateCode:
                location.code,
            },

            update: {
              $setOnInsert: {
                stateCode:
                  location.code,

                stateName:
                  location.name,

                isLive: false,

                unavailableMessage:
                  `ServicePay Delivery is not yet available in ${location.name}. We will notify you when the service becomes live.`,

                expectedLaunchDate:
                  null,

                activatedAt:
                  null,

                activatedBy:
                  null,

                deactivatedAt:
                  null,

                deactivatedBy:
                  null,

                adminNote: "",
              },
            },

            upsert: true,
          },
        })
      );

    if (operations.length > 0) {
      await DeliveryCoverage.bulkWrite(
        operations,
        {
          ordered: false,
        }
      );
    }

    return DeliveryCoverage.find()
      .sort({
        stateName: 1,
      });
  };

/*
|--------------------------------------------------------------------------
| PUBLIC: GET ALL DELIVERY STATES
|--------------------------------------------------------------------------
|
| GET /api/delivery/coverage
|
| Customers can use this endpoint to populate
| pickup-state and destination-state dropdowns.
|
*/

exports.getDeliveryCoverage =
  async (req, res) => {
    try {
      const states =
        await ensureCoverageSeeded();

      return res.status(200).json({
        success: true,

        message:
          "ServicePay Delivery Coverage loaded successfully.",

        count: states.length,

        data: {
          states: states.map(
            (state) =>
              state.toPublicJSON()
          ),
        },

        states: states.map(
          (state) =>
            state.toPublicJSON()
        ),
      });
    } catch (error) {
      console.error(
        "Get Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to load Delivery Coverage.",

        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| PUBLIC: GET ONLY LIVE DELIVERY STATES
|--------------------------------------------------------------------------
|
| GET /api/delivery/coverage/live
|
*/

exports.getLiveDeliveryCoverage =
  async (req, res) => {
    try {
      await ensureCoverageSeeded();

      const states =
        await DeliveryCoverage.find({
          isLive: true,
        }).sort({
          stateName: 1,
        });

      return res.status(200).json({
        success: true,

        message:
          "Live ServicePay Delivery states loaded successfully.",

        count: states.length,

        data: {
          states: states.map(
            (state) =>
              state.toPublicJSON()
          ),
        },

        states: states.map(
          (state) =>
            state.toPublicJSON()
        ),
      });
    } catch (error) {
      console.error(
        "Get live Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to load live Delivery states.",

        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: GET COMPLETE DELIVERY COVERAGE
|--------------------------------------------------------------------------
|
| GET /api/delivery/coverage/admin
|
*/

exports.getAdminDeliveryCoverage =
  async (req, res) => {
    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      const states =
        await ensureCoverageSeeded();

      const liveCount =
        states.filter(
          (state) =>
            state.isLive === true
        ).length;

      const notLiveCount =
        states.length - liveCount;

      return res.status(200).json({
        success: true,

        message:
          "Admin Delivery Coverage loaded successfully.",

        data: {
          states,

          summary: {
            totalStates:
              states.length,

            liveStates:
              liveCount,

            notLiveStates:
              notLiveCount,
          },
        },

        states,

        summary: {
          totalStates:
            states.length,

          liveStates:
            liveCount,

          notLiveStates:
            notLiveCount,
        },
      });
    } catch (error) {
      console.error(
        "Admin get Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to load Admin Delivery Coverage.",

        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: ACTIVATE OR DEACTIVATE ONE STATE
|--------------------------------------------------------------------------
|
| PATCH /api/delivery/coverage/admin/:stateCode
|
| Body:
|
| {
|   "isLive": true,
|   "unavailableMessage": "",
|   "expectedLaunchDate": null,
|   "adminNote": ""
| }
|
*/

exports.updateDeliveryCoverage =
  async (req, res) => {
    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      await ensureCoverageSeeded();

      const definition =
        stateDefinitionFromValue(
          req.params.stateCode
        );

      if (!definition) {
        return res.status(400).json({
          success: false,

          message:
            "Invalid Nigerian state or FCT Abuja.",
        });
      }

      if (
        typeof req.body.isLive !==
        "boolean"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "isLive must be true or false.",
        });
      }

      const isLive =
        req.body.isLive;

      const unavailableMessage =
        normalizeText(
          req.body
            .unavailableMessage
        );

      const adminNote =
        normalizeText(
          req.body.adminNote
        );

      let expectedLaunchDate =
        null;

      if (
        req.body
          .expectedLaunchDate
      ) {
        const parsedDate =
          new Date(
            req.body
              .expectedLaunchDate
          );

        if (
          Number.isNaN(
            parsedDate.getTime()
          )
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Invalid expected launch date.",
          });
        }

        expectedLaunchDate =
          parsedDate;
      }

      const now = new Date();

      const updateData = {
        isLive,

        unavailableMessage:
          unavailableMessage ||
          (
            `ServicePay Delivery is not yet available in ` +
            `${definition.name}. We will notify you when the service becomes live.`
          ),

        expectedLaunchDate,

        adminNote,
      };

      if (isLive) {
        updateData.activatedAt =
          now;

        updateData.activatedBy =
          req.user._id;

        updateData.deactivatedAt =
          null;

        updateData.deactivatedBy =
          null;
      } else {
        updateData.deactivatedAt =
          now;

        updateData.deactivatedBy =
          req.user._id;
      }

      const state =
        await DeliveryCoverage.findOneAndUpdate(
          {
            stateCode:
              definition.code,
          },
          {
            $set: updateData,
          },
          {
            new: true,
            runValidators: true,
          }
        )
          .populate(
            "activatedBy",
            "fullName email role"
          )
          .populate(
            "deactivatedBy",
            "fullName email role"
          );

      if (!state) {
        return res.status(404).json({
          success: false,

          message:
            "Delivery Coverage state was not found.",
        });
      }

      return res.status(200).json({
        success: true,

        message: isLive
            ? `ServicePay Delivery is now LIVE in ${state.stateName}.`
            : `ServicePay Delivery has been deactivated in ${state.stateName}.`,

        data: {
          state,
        },

        state,
      });
    } catch (error) {
      console.error(
        "Update Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to update Delivery Coverage.",

        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ADMIN: ACTIVATE OR DEACTIVATE MULTIPLE STATES
|--------------------------------------------------------------------------
|
| PATCH /api/delivery/coverage/admin/bulk/update
|
| Body:
|
| {
|   "stateCodes": ["KANO", "KADUNA"],
|   "isLive": true
| }
|
*/

exports.bulkUpdateDeliveryCoverage =
  async (req, res) => {
    try {
      if (
        !validateHeadOffice(
          req,
          res
        )
      ) {
        return;
      }

      await ensureCoverageSeeded();

      const rawStateCodes =
        Array.isArray(
          req.body.stateCodes
        )
          ? req.body.stateCodes
          : [];

      if (
        rawStateCodes.length === 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Please provide at least one state.",
        });
      }

      if (
        typeof req.body.isLive !==
        "boolean"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "isLive must be true or false.",
        });
      }

      const definitions = [];

      for (
        const value
        of rawStateCodes
      ) {
        const definition =
          stateDefinitionFromValue(
            value
          );

        if (
          definition &&
          !definitions.some(
            (item) =>
              item.code ===
              definition.code
          )
        ) {
          definitions.push(
            definition
          );
        }
      }

      if (
        definitions.length === 0
      ) {
        return res.status(400).json({
          success: false,

          message:
            "No valid Nigerian state was provided.",
        });
      }

      const isLive =
        req.body.isLive;

      const now =
        new Date();

      const operations =
        definitions.map(
          (definition) => {
            const updateData = {
              isLive,

              adminNote:
                normalizeText(
                  req.body
                    .adminNote
                ),
            };

            if (isLive) {
              updateData.activatedAt =
                now;

              updateData.activatedBy =
                req.user._id;

              updateData.deactivatedAt =
                null;

              updateData.deactivatedBy =
                null;
            } else {
              updateData.deactivatedAt =
                now;

              updateData.deactivatedBy =
                req.user._id;
            }

            return {
              updateOne: {
                filter: {
                  stateCode:
                    definition.code,
                },

                update: {
                  $set:
                    updateData,
                },
              },
            };
          }
        );

      await DeliveryCoverage.bulkWrite(
        operations,
        {
          ordered: false,
        }
      );

      const states =
        await DeliveryCoverage.find({
          stateCode: {
            $in:
              definitions.map(
                (definition) =>
                  definition.code
              ),
          },
        }).sort({
          stateName: 1,
        });

      return res.status(200).json({
        success: true,

        message: isLive
            ? `${states.length} Delivery states activated successfully.`
            : `${states.length} Delivery states deactivated successfully.`,

        count:
          states.length,

        data: {
          states,
        },

        states,
      });
    } catch (error) {
      console.error(
        "Bulk update Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to update multiple Delivery states.",

        error: error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| VALIDATE DELIVERY COVERAGE BEFORE ORDER CREATION
|--------------------------------------------------------------------------
|
| This middleware runs before createDelivery.
|
*/

exports.validateDeliveryCoverage =
  async (req, res, next) => {
    try {
      await ensureCoverageSeeded();

      const pickupDefinition =
        stateDefinitionFromValue(
          req.body.pickupState
        );

      const deliveryDefinition =
        stateDefinitionFromValue(
          req.body.deliveryState ??
          req.body.destinationState
        );

      if (!pickupDefinition) {
        return res.status(400).json({
          success: false,

          code:
            "INVALID_PICKUP_STATE",

          message:
            "Please select a valid pickup state.",
        });
      }

      if (!deliveryDefinition) {
        return res.status(400).json({
          success: false,

          code:
            "INVALID_DELIVERY_STATE",

          message:
            "Please select a valid destination state.",
        });
      }

      const coverageStates =
        await DeliveryCoverage.find({
          stateCode: {
            $in: [
              pickupDefinition.code,
              deliveryDefinition.code,
            ],
          },
        });

      const pickupCoverage =
        coverageStates.find(
          (state) =>
            state.stateCode ===
            pickupDefinition.code
        );

      const deliveryCoverage =
        coverageStates.find(
          (state) =>
            state.stateCode ===
            deliveryDefinition.code
        );

      if (
        !pickupCoverage ||
        pickupCoverage.isLive !== true
      ) {
        return res.status(409).json({
          success: false,

          code:
            "PICKUP_STATE_NOT_LIVE",

          stateCode:
            pickupDefinition.code,

          stateName:
            pickupDefinition.name,

          message:
            pickupCoverage
              ?.unavailableMessage ||
            (
              `ServicePay Delivery is not yet available in ` +
              `${pickupDefinition.name}. We will notify you when the service becomes live.`
            ),
        });
      }

      if (
        !deliveryCoverage ||
        deliveryCoverage.isLive !== true
      ) {
        return res.status(409).json({
          success: false,

          code:
            "DESTINATION_STATE_NOT_LIVE",

          stateCode:
            deliveryDefinition.code,

          stateName:
            deliveryDefinition.name,

          message:
            deliveryCoverage
              ?.unavailableMessage ||
            (
              `ServicePay Delivery is not yet available for deliveries to ` +
              `${deliveryDefinition.name}. We will notify you when the service becomes live.`
            ),
        });
      }

      /*
       * Make normalized values available
       * to createDelivery.
       */
      req.deliveryCoverage = {
        pickupStateCode:
          pickupDefinition.code,

        pickupStateName:
          pickupDefinition.name,

        deliveryStateCode:
          deliveryDefinition.code,

        deliveryStateName:
          deliveryDefinition.name,
      };

      req.body.pickupState =
        pickupDefinition.code;

      req.body.deliveryState =
        deliveryDefinition.code;

      next();
    } catch (error) {
      console.error(
        "Validate Delivery Coverage error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to confirm Delivery availability.",

        error: error.message,
      });
    }
  };

module.exports.ensureCoverageSeeded =
  ensureCoverageSeeded;