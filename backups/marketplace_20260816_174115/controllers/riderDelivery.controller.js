const mongoose = require("mongoose");

const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");

const {
  creditRiderCommissionIfEligible,
} = require(
  "../services/riderCommission.service"
);

const RIDER_DELIVERY_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
];

const normalizeStatus = (
  value = ""
) => {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
};

const isValidObjectId = (
  value
) => {
  return mongoose.Types.ObjectId.isValid(
    String(value ?? "")
  );
};

const getAuthenticatedRider = async (
  req
) => {
  const userId =
    req.user?._id ||
    req.user?.id ||
    req.userId;

  if (!userId) {
    return null;
  }

  return User.findById(userId);
};

const populateDelivery = (
  deliveryId
) => {
  return Delivery.findById(
    deliveryId
  )
    .populate(
      "customerId",
      [
        "fullName",
        "email",
        "phone",
        "role",
        "status",
        "state",
        "lga",
      ].join(" ")
    )
    .populate(
      "assignedRiderId",
      [
        "riderId",
        "fullName",
        "email",
        "phone",
        "role",
        "status",
        "vehicleType",
        "plateNumber",
        "riderState",
        "riderLga",
        "availabilityStatus",
        "riderVerificationStatus",
        "totalRiderEarnings",
        "pendingRiderSettlement",
        "settledRiderEarnings",
      ].join(" ")
    )
    .lean();
};

const validateRiderAccount = (
  rider,
  res
) => {
  if (!rider) {
    res.status(401).json({
      success: false,
      message:
        "Authentication is required.",
    });

    return false;
  }

  if (
    String(
      rider.role || ""
    ).toUpperCase() !==
    "DELIVERY_RIDER"
  ) {
    res.status(403).json({
      success: false,
      message:
        "Only Delivery Riders can access this resource.",
    });

    return false;
  }

  if (
    rider.status !== "ACTIVE"
  ) {
    res.status(403).json({
      success: false,
      message:
        "Your rider account is not active.",
    });

    return false;
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| GET RIDER DELIVERIES
|--------------------------------------------------------------------------
|
| GET /api/rider/deliveries
|
*/

exports.getRiderDeliveries =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res
        )
      ) {
        return;
      }

      const requestedStatus =
        normalizeStatus(
          req.query.status ?? ""
        );

      const filter = {
        assignedRiderId:
          rider._id,
      };

      if (
        requestedStatus &&
        requestedStatus !== "ALL"
      ) {
        if (
          !RIDER_DELIVERY_STATUSES.includes(
            requestedStatus
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid delivery status.",
            allowedStatuses:
              RIDER_DELIVERY_STATUSES,
          });
        }

        filter.status =
          requestedStatus;
      }

      const [
        deliveries,
        totalAssigned,
        activeDeliveries,
        completedDeliveries,
        pendingAcceptance,
      ] = await Promise.all([
        Delivery.find(filter)
          .populate(
            "customerId",
            [
              "fullName",
              "email",
              "phone",
              "role",
              "status",
              "state",
              "lga",
            ].join(" ")
          )
          .sort({
            assignedAt: -1,
            createdAt: -1,
          })
          .lean(),

        Delivery.countDocuments({
          assignedRiderId:
            rider._id,
        }),

        Delivery.countDocuments({
          assignedRiderId:
            rider._id,

          status: {
            $in: [
              "ASSIGNED",
              "ACCEPTED",
              "PICKED_UP",
              "IN_TRANSIT",
            ],
          },
        }),

        Delivery.countDocuments({
          assignedRiderId:
            rider._id,

          status:
            "DELIVERED",
        }),

        Delivery.countDocuments({
          assignedRiderId:
            rider._id,

          status:
            "ASSIGNED",
        }),
      ]);

      return res.status(200).json({
        success: true,
        message:
          "Rider deliveries loaded successfully.",

        data: {
          deliveries,

          summary: {
            totalAssigned,
            active:
              activeDeliveries,
            completed:
              completedDeliveries,
            pendingAcceptance,
          },
        },

        deliveries,
      });
    } catch (error) {
      console.error(
        "Get rider deliveries error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load rider deliveries.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET ONE RIDER DELIVERY
|--------------------------------------------------------------------------
|
| GET /api/rider/deliveries/:id
|
*/

exports.getRiderDeliveryDetails =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res
        )
      ) {
        return;
      }

      const deliveryId = String(
        req.params.id ?? ""
      ).trim();

      if (
        !isValidObjectId(
          deliveryId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery ID.",
        });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,

          assignedRiderId:
            rider._id,
        })
          .populate(
            "customerId",
            [
              "fullName",
              "email",
              "phone",
              "role",
              "status",
              "state",
              "lga",
            ].join(" ")
          )
          .populate(
            "assignedRiderId",
            [
              "riderId",
              "fullName",
              "email",
              "phone",
              "vehicleType",
              "plateNumber",
              "availabilityStatus",
              "riderVerificationStatus",
            ].join(" ")
          )
          .lean();

      if (!delivery) {
        return res.status(404).json({
          success: false,
          message:
            "This delivery was not found or is not assigned to you.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Delivery details loaded successfully.",

        data: {
          delivery,
        },

        delivery,
      });
    } catch (error) {
      console.error(
        "Get rider delivery details error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to load delivery details.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| ACCEPT DELIVERY JOB
|--------------------------------------------------------------------------
|
| PATCH /api/rider/deliveries/:id/accept
|
*/

exports.acceptRiderDelivery =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res
        )
      ) {
        return;
      }

      if (
        rider.riderVerificationStatus !==
        "VERIFIED"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Your rider account must be verified.",
        });
      }

      const deliveryId = String(
        req.params.id ?? ""
      ).trim();

      if (
        !isValidObjectId(
          deliveryId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery ID.",
        });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,

          assignedRiderId:
            rider._id,
        });

      if (!delivery) {
        return res.status(404).json({
          success: false,
          message:
            "This delivery was not found or is not assigned to you.",
        });
      }

      if (
        delivery.status !==
        "ASSIGNED"
      ) {
        return res.status(400).json({
          success: false,
          message:
            `This delivery cannot be accepted because its current status is ${delivery.status}.`,
        });
      }

      const now =
        new Date();

      delivery.status =
        "ACCEPTED";

      delivery.acceptedAt =
        now;

      delivery.riderAcceptedAt =
        now;

      delivery.riderRejectedAt =
        null;

      delivery.riderRejectionReason =
        "";

      await delivery.save();

      rider.totalAcceptedDeliveries =
        Number(
          rider
            .totalAcceptedDeliveries ||
            0
        ) + 1;

      rider.availabilityStatus =
        "BUSY";

      await rider.save();

      const updatedDelivery =
        await populateDelivery(
          delivery._id
        );

      return res.status(200).json({
        success: true,
        message:
          "Delivery job accepted successfully.",

        data: {
          delivery:
            updatedDelivery,
        },

        delivery:
          updatedDelivery,
      });
    } catch (error) {
      console.error(
        "Accept rider delivery error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to accept delivery job.",
        error:
          error.message,
      });
    }
  };
  /*
|--------------------------------------------------------------------------
| REJECT DELIVERY JOB
|--------------------------------------------------------------------------
|
| PATCH /api/rider/deliveries/:id/reject
|
*/

exports.rejectRiderDelivery =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res
        )
      ) {
        return;
      }

      const deliveryId = String(
        req.params.id ?? ""
      ).trim();

      if (
        !isValidObjectId(
          deliveryId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery ID.",
        });
      }

      const reason = String(
        req.body.reason ??
          req.body.rejectionReason ??
          ""
      ).trim();

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,

          assignedRiderId:
            rider._id,
        });

      if (!delivery) {
        return res.status(404).json({
          success: false,
          message:
            "This delivery was not found or is not assigned to you.",
        });
      }

      if (
        delivery.status !==
        "ASSIGNED"
      ) {
        return res.status(400).json({
          success: false,
          message:
            `This delivery cannot be rejected because its current status is ${delivery.status}.`,
        });
      }

      delivery.assignedRiderId =
        null;

      delivery.riderName = "";
      delivery.riderPhone = "";

      delivery.assignedBy =
        null;

      delivery.assignedAt =
        null;

      delivery.riderRejectedAt =
        new Date();

      delivery.riderRejectionReason =
        reason ||
        "Rejected by Delivery Rider.";

      delivery.riderAcceptedAt =
        null;

      delivery.acceptedAt =
        null;

      delivery.status =
        "PENDING";

      await delivery.save();

      if (
        Number(
          rider
            .totalAssignedDeliveries ||
            0
        ) > 0
      ) {
        rider.totalAssignedDeliveries =
          Number(
            rider
              .totalAssignedDeliveries ||
              0
          ) - 1;
      }

      rider.totalRejectedDeliveries =
        Number(
          rider
            .totalRejectedDeliveries ||
            0
        ) + 1;

      rider.availabilityStatus =
        "ONLINE";

      await rider.save();

      const updatedDelivery =
        await populateDelivery(
          delivery._id
        );

      return res.status(200).json({
        success: true,
        message:
          "Delivery job rejected successfully.",

        data: {
          delivery:
            updatedDelivery,
        },

        delivery:
          updatedDelivery,
      });
    } catch (error) {
      console.error(
        "Reject rider delivery error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to reject delivery job.",
        error:
          error.message,
      });
    }
  };

/*
|--------------------------------------------------------------------------
| UPDATE RIDER DELIVERY STATUS
|--------------------------------------------------------------------------
|
| PATCH /api/rider/deliveries/:id/status
|
| ACCEPTED  -> PICKED_UP
| PICKED_UP -> IN_TRANSIT
| IN_TRANSIT -> DELIVERED
|
*/

exports.updateRiderDeliveryStatus =
  async (req, res) => {
    try {
      const rider =
        await getAuthenticatedRider(
          req
        );

      if (
        !validateRiderAccount(
          rider,
          res
        )
      ) {
        return;
      }

      const deliveryId = String(
        req.params.id ?? ""
      ).trim();

      if (
        !isValidObjectId(
          deliveryId
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery ID.",
        });
      }

      const requestedStatus =
        normalizeStatus(
          req.body.status
        );

      const allowedStatuses = [
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED",
      ];

      if (
        !allowedStatuses.includes(
          requestedStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Rider status must be PICKED_UP, IN_TRANSIT or DELIVERED.",
          allowedStatuses,
        });
      }

      const delivery =
        await Delivery.findOne({
          _id: deliveryId,

          assignedRiderId:
            rider._id,
        });

      if (!delivery) {
        return res.status(404).json({
          success: false,
          message:
            "This delivery was not found or is not assigned to you.",
        });
      }

      const allowedTransitions = {
        ACCEPTED:
          "PICKED_UP",

        PICKED_UP:
          "IN_TRANSIT",

        IN_TRANSIT:
          "DELIVERED",
      };

      const expectedNextStatus =
        allowedTransitions[
          delivery.status
        ];

      if (
        expectedNextStatus !==
        requestedStatus
      ) {
        return res.status(400).json({
          success: false,
          message:
            expectedNextStatus
              ? `The next allowed status is ${expectedNextStatus}.`
              : `This delivery cannot be updated from ${delivery.status}.`,
        });
      }

      const now =
        new Date();

      delivery.status =
        requestedStatus;

      if (
        requestedStatus ===
        "PICKED_UP"
      ) {
        delivery.pickedUpAt =
          now;
      }

      if (
        requestedStatus ===
        "IN_TRANSIT"
      ) {
        delivery.inTransitAt =
          now;
      }

      if (
        requestedStatus ===
        "DELIVERED"
      ) {
        delivery.deliveredAt =
          now;
      }

      await delivery.save();

      let commissionResult = {
        credited: false,
        amount: 0,
        servicepayProfit: 0,
        reason: "",
      };

      if (
        requestedStatus ===
        "DELIVERED"
      ) {
        rider.totalCompletedDeliveries =
          Number(
            rider
              .totalCompletedDeliveries ||
              0
          ) + 1;

        rider.availabilityStatus =
          "ONLINE";

        await rider.save();

        commissionResult =
          await creditRiderCommissionIfEligible(
            {
              deliveryId:
                delivery._id,

              riderId:
                rider._id,
            }
          );
      }

      const updatedDelivery =
        await populateDelivery(
          delivery._id
        );

      let message =
        `Delivery status updated to ${requestedStatus}.`;

      if (
        requestedStatus ===
          "DELIVERED" &&
        commissionResult.credited
      ) {
        message =
          `Delivery completed. ₦${Number(
            commissionResult.amount
          ).toFixed(
            2
          )} has been added to your pending settlement.`;
      } else if (
        requestedStatus ===
          "DELIVERED" &&
        commissionResult.reason ===
          "PAYMENT_NOT_CONFIRMED"
      ) {
        message =
          "Delivery completed successfully. Your commission will be credited automatically after payment is confirmed.";
      } else if (
        requestedStatus ===
          "DELIVERED" &&
        commissionResult.reason ===
          "DELIVERY_FEE_NOT_SET"
      ) {
        message =
          "Delivery completed successfully. Your commission is pending because the delivery fee has not been set.";
      }

      return res.status(200).json({
        success: true,
        message,

        data: {
          delivery:
            updatedDelivery,

          commission: {
            credited:
              commissionResult
                .credited,

            amount:
              commissionResult
                .amount,

            servicepayProfit:
              commissionResult
                .servicepayProfit,

            reason:
              commissionResult
                .reason,
          },
        },

        delivery:
          updatedDelivery,
      });
    } catch (error) {
      console.error(
        "Update rider delivery status error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to update delivery status.",
        error:
          error.message,
      });
    }
  };