const mongoose = require("mongoose");

const User = require("../models/user.model");

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

const normalizeText = (value) => {
  return String(value ?? "").trim();
};

const normalizeUppercase = (value) => {
  return normalizeText(value).toUpperCase();
};

const normalizePhone = (value) => {
  return normalizeText(value).replace(/\s+/g, "");
};

const generateRiderId = () => {
  const timestamp = Date.now()
    .toString()
    .slice(-8);

  const randomNumber = Math.floor(
    1000 + Math.random() * 9000
  );

  return `SPR-${timestamp}-${randomNumber}`;
};

const isValidMongoId = (value) => {
  return mongoose.Types.ObjectId.isValid(
    String(value ?? "")
  );
};

const sendServerError = (
  res,
  error,
  label
) => {
  console.error(label, error);

  if (error?.code === 11000) {
    const duplicatedField =
      Object.keys(error.keyPattern ?? {})[0] ??
      "field";

    return res.status(409).json({
      success: false,
      message:
        duplicatedField === "phone"
          ? "A user with this phone number already exists."
          : duplicatedField === "email"
            ? "A user with this email address already exists."
            : duplicatedField === "riderId"
              ? "This rider ID already exists. Please try again."
              : `A record with this ${duplicatedField} already exists.`,
    });
  }

  if (error?.name === "ValidationError") {
    const firstValidationError =
      Object.values(error.errors ?? {})[0];

    return res.status(400).json({
      success: false,
      message:
        firstValidationError?.message ??
        "The submitted rider information is invalid.",
    });
  }

  return res.status(500).json({
    success: false,
    message: "An unexpected server error occurred.",
  });
};

const riderPublicFields = [
  "_id",
  "riderId",
  "fullName",
  "phone",
  "email",
  "role",
  "status",
  "state",
  "lga",
  "riderState",
  "riderLga",
  "riderAddress",
  "vehicleType",
  "plateNumber",
  "availabilityStatus",
  "riderVerificationStatus",
  "riderVerificationNote",
  "riderVerifiedAt",
  "riderEmergencyContactName",
  "riderEmergencyContactPhone",
  "riderJoinedAt",
  "riderLastOnlineAt",
  "totalRiderEarnings",
  "pendingRiderSettlement",
  "settledRiderEarnings",
  "totalAssignedDeliveries",
  "totalAcceptedDeliveries",
  "totalCompletedDeliveries",
  "totalRejectedDeliveries",
  "riderRating",
  "riderRatingCount",
  "riderCurrentLocation",
  "createdAt",
  "updatedAt",
].join(" ");

/*
|--------------------------------------------------------------------------
| GET ALL RIDERS
|--------------------------------------------------------------------------
|
| GET /api/admin/riders
|
| Supported query parameters:
| page
| limit
| search
| status
| verificationStatus
| availabilityStatus
| state
| vehicleType
|
*/

const getAdminRiders = async (
  req,
  res
) => {
  try {
    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        Number.parseInt(req.query.limit, 10) || 20,
        1
      ),
      100
    );

    const skip = (page - 1) * limit;

    const search = normalizeText(
      req.query.search
    );

    const status = normalizeUppercase(
      req.query.status
    );

    const verificationStatus =
      normalizeUppercase(
        req.query.verificationStatus
      );

    const availabilityStatus =
      normalizeUppercase(
        req.query.availabilityStatus
      );

    const riderState = normalizeText(
      req.query.state
    );

    const vehicleType = normalizeUppercase(
      req.query.vehicleType
    );

    const filter = {
      role: "DELIVERY_RIDER",
    };

    if (status) {
      filter.status = status;
    }

    if (verificationStatus) {
      filter.riderVerificationStatus =
        verificationStatus;
    }

    if (availabilityStatus) {
      filter.availabilityStatus =
        availabilityStatus;
    }

    if (riderState) {
      filter.riderState = {
        $regex: riderState,
        $options: "i",
      };
    }

    if (vehicleType) {
      filter.vehicleType = vehicleType;
    }

    if (search) {
      filter.$or = [
        {
          fullName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          phone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          riderId: {
            $regex: search,
            $options: "i",
          },
        },
        {
          plateNumber: {
            $regex: search,
            $options: "i",
          },
        },
        {
          riderState: {
            $regex: search,
            $options: "i",
          },
        },
        {
          riderLga: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const [
      riders,
      totalRiders,
      activeRiders,
      suspendedRiders,
      verifiedRiders,
      pendingVerification,
      onlineRiders,
      busyRiders,
    ] = await Promise.all([
      User.find(filter)
        .select(riderPublicFields)
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .lean(),

      User.countDocuments({
        role: "DELIVERY_RIDER",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        status: "ACTIVE",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        status: "SUSPENDED",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        riderVerificationStatus:
          "VERIFIED",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        riderVerificationStatus:
          "PENDING",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        availabilityStatus: "ONLINE",
      }),

      User.countDocuments({
        role: "DELIVERY_RIDER",
        availabilityStatus: "BUSY",
      }),
    ]);

    const totalPages = Math.max(
      Math.ceil(
        (await User.countDocuments(filter)) /
          limit
      ),
      1
    );

    return res.status(200).json({
      success: true,
      message:
        "Delivery riders retrieved successfully.",
      summary: {
        totalRiders,
        activeRiders,
        suspendedRiders,
        verifiedRiders,
        pendingVerification,
        onlineRiders,
        busyRiders,
      },
      pagination: {
        page,
        limit,
        totalPages,
        totalResults:
          await User.countDocuments(filter),
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      riders,
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "GET ADMIN RIDERS ERROR:"
    );
  }
};

/*
|--------------------------------------------------------------------------
| CREATE RIDER
|--------------------------------------------------------------------------
|
| POST /api/admin/riders
|
*/

const createAdminRider = async (
  req,
  res
) => {
  try {
    const fullName = normalizeText(
      req.body.fullName
    );

    const phone = normalizePhone(
      req.body.phone
    );

    const email = normalizeText(
      req.body.email
    ).toLowerCase();

    const password = String(
      req.body.password ?? ""
    );

    const vehicleType =
      normalizeUppercase(
        req.body.vehicleType
      ) || null;

    const plateNumber =
      normalizeUppercase(
        req.body.plateNumber
      ) || null;

    const riderState =
      normalizeText(
        req.body.riderState ??
          req.body.state
      ) || null;

    const riderLga =
      normalizeText(
        req.body.riderLga ??
          req.body.lga
      ) || null;

    const riderAddress =
      normalizeText(
        req.body.riderAddress
      ) || null;

    const emergencyContactName =
      normalizeText(
        req.body.riderEmergencyContactName
      ) || null;

    const emergencyContactPhone =
      normalizePhone(
        req.body.riderEmergencyContactPhone
      ) || null;

    if (!fullName) {
      return res.status(400).json({
        success: false,
        message:
          "Rider full name is required.",
      });
    }

    if (!phone) {
      return res.status(400).json({
        success: false,
        message:
          "Rider phone number is required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message:
          "Rider password must contain at least 6 characters.",
      });
    }

    const allowedVehicleTypes = [
      "MOTORCYCLE",
      "TRICYCLE",
      "BICYCLE",
      "CAR",
      "VAN",
      "TRUCK",
      "OTHER",
    ];

    if (
      vehicleType &&
      !allowedVehicleTypes.includes(
        vehicleType
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid rider vehicle type.",
      });
    }

    const existingConditions = [
      {
        phone,
      },
    ];

    if (email) {
      existingConditions.push({
        email,
      });
    }

    const existingUser = await User.findOne({
      $or: existingConditions,
    }).lean();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          existingUser.phone === phone
            ? "A user with this phone number already exists."
            : "A user with this email address already exists.",
      });
    }

    let riderId = generateRiderId();

    while (
      await User.exists({
        riderId,
      })
    ) {
      riderId = generateRiderId();
    }

    const rider = await User.create({
      fullName,
      phone,
      email: email || undefined,
      password,
      role: "DELIVERY_RIDER",
      status: "ACTIVE",

      riderId,

      state: riderState,
      lga: riderLga,

      riderState,
      riderLga,
      riderAddress,

      vehicleType,
      plateNumber,

      riderEmergencyContactName:
        emergencyContactName,

      riderEmergencyContactPhone:
        emergencyContactPhone,

      availabilityStatus: "OFFLINE",

      riderVerificationStatus:
        "PENDING",

      riderCreatedBy:
        req.user?._id ?? null,

      riderJoinedAt: new Date(),
    });

    const createdRider =
      await User.findById(rider._id)
        .select(riderPublicFields)
        .lean();

    return res.status(201).json({
      success: true,
      message:
        "Delivery rider account created successfully.",
      rider: createdRider,
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "CREATE ADMIN RIDER ERROR:"
    );
  }
};

/*
|--------------------------------------------------------------------------
| GET RIDER DETAILS
|--------------------------------------------------------------------------
|
| GET /api/admin/riders/:id
|
*/

const getAdminRiderDetails = async (
  req,
  res
) => {
  try {
    const riderId = req.params.id;

    if (!isValidMongoId(riderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider ID.",
      });
    }

    const rider = await User.findOne({
      _id: riderId,
      role: "DELIVERY_RIDER",
    })
      .select(riderPublicFields)
      .populate(
        "riderVerifiedBy",
        "fullName email phone role"
      )
      .populate(
        "riderCreatedBy",
        "fullName email phone role"
      )
      .lean();

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery rider was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      rider,
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "GET ADMIN RIDER DETAILS ERROR:"
    );
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE RIDER PROFILE
|--------------------------------------------------------------------------
|
| PATCH /api/admin/riders/:id
|
*/

const updateAdminRider = async (
  req,
  res
) => {
  try {
    const riderId = req.params.id;

    if (!isValidMongoId(riderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider ID.",
      });
    }

    const rider = await User.findOne({
      _id: riderId,
      role: "DELIVERY_RIDER",
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery rider was not found.",
      });
    }

    const allowedVehicleTypes = [
      "MOTORCYCLE",
      "TRICYCLE",
      "BICYCLE",
      "CAR",
      "VAN",
      "TRUCK",
      "OTHER",
    ];

    if (
      req.body.fullName !== undefined
    ) {
      const fullName = normalizeText(
        req.body.fullName
      );

      if (!fullName) {
        return res.status(400).json({
          success: false,
          message:
            "Rider full name cannot be empty.",
        });
      }

      rider.fullName = fullName;
    }

    if (req.body.phone !== undefined) {
      const phone = normalizePhone(
        req.body.phone
      );

      if (!phone) {
        return res.status(400).json({
          success: false,
          message:
            "Rider phone number cannot be empty.",
        });
      }

      const phoneOwner = await User.findOne({
        phone,
        _id: {
          $ne: rider._id,
        },
      }).lean();

      if (phoneOwner) {
        return res.status(409).json({
          success: false,
          message:
            "A user with this phone number already exists.",
        });
      }

      rider.phone = phone;
    }

    if (req.body.email !== undefined) {
      const email = normalizeText(
        req.body.email
      ).toLowerCase();

      if (email) {
        const emailOwner =
          await User.findOne({
            email,
            _id: {
              $ne: rider._id,
            },
          }).lean();

        if (emailOwner) {
          return res.status(409).json({
            success: false,
            message:
              "A user with this email address already exists.",
          });
        }

        rider.email = email;
      } else {
        rider.email = undefined;
      }
    }

    if (
      req.body.vehicleType !== undefined
    ) {
      const vehicleType =
        normalizeUppercase(
          req.body.vehicleType
        );

      if (
        vehicleType &&
        !allowedVehicleTypes.includes(
          vehicleType
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid rider vehicle type.",
        });
      }

      rider.vehicleType =
        vehicleType || null;
    }

    if (
      req.body.plateNumber !== undefined
    ) {
      rider.plateNumber =
        normalizeUppercase(
          req.body.plateNumber
        ) || null;
    }

    if (
      req.body.riderState !== undefined ||
      req.body.state !== undefined
    ) {
      const riderState =
        normalizeText(
          req.body.riderState ??
            req.body.state
        ) || null;

      rider.riderState = riderState;
      rider.state = riderState;
    }

    if (
      req.body.riderLga !== undefined ||
      req.body.lga !== undefined
    ) {
      const riderLga =
        normalizeText(
          req.body.riderLga ??
            req.body.lga
        ) || null;

      rider.riderLga = riderLga;
      rider.lga = riderLga;
    }

    if (
      req.body.riderAddress !== undefined
    ) {
      rider.riderAddress =
        normalizeText(
          req.body.riderAddress
        ) || null;
    }

    if (
      req.body
        .riderEmergencyContactName !==
      undefined
    ) {
      rider.riderEmergencyContactName =
        normalizeText(
          req.body
            .riderEmergencyContactName
        ) || null;
    }

    if (
      req.body
        .riderEmergencyContactPhone !==
      undefined
    ) {
      rider.riderEmergencyContactPhone =
        normalizePhone(
          req.body
            .riderEmergencyContactPhone
        ) || null;
    }

    await rider.save();

    const updatedRider =
      await User.findById(rider._id)
        .select(riderPublicFields)
        .lean();

    return res.status(200).json({
      success: true,
      message:
        "Delivery rider profile updated successfully.",
      rider: updatedRider,
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "UPDATE ADMIN RIDER ERROR:"
    );
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE RIDER ACCOUNT STATUS
|--------------------------------------------------------------------------
|
| PATCH /api/admin/riders/:id/status
|
| Body:
| {
|   "status": "ACTIVE"
| }
|
*/

const updateAdminRiderStatus = async (
  req,
  res
) => {
  try {
    const riderId = req.params.id;

    if (!isValidMongoId(riderId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rider ID.",
      });
    }

    const status = normalizeUppercase(
      req.body.status
    );

    const allowedStatuses = [
      "ACTIVE",
      "SUSPENDED",
      "BLOCKED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message:
          "Status must be ACTIVE, SUSPENDED or BLOCKED.",
      });
    }

    const rider = await User.findOne({
      _id: riderId,
      role: "DELIVERY_RIDER",
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message:
          "Delivery rider was not found.",
      });
    }

    rider.status = status;

    if (status !== "ACTIVE") {
      rider.availabilityStatus =
        "OFFLINE";
    }

    await rider.save();

    const updatedRider =
      await User.findById(rider._id)
        .select(riderPublicFields)
        .lean();

    return res.status(200).json({
      success: true,
      message:
        `Delivery rider account changed to ${status}.`,
      rider: updatedRider,
    });
  } catch (error) {
    return sendServerError(
      res,
      error,
      "UPDATE ADMIN RIDER STATUS ERROR:"
    );
  }
};

/*
|--------------------------------------------------------------------------
| VERIFY OR REJECT RIDER
|--------------------------------------------------------------------------
|
| PATCH /api/admin/riders/:id/verification
|
| Body:
| {
|   "verificationStatus": "VERIFIED",
|   "note": "Documents confirmed."
| }
|
*/

const updateAdminRiderVerification =
  async (req, res) => {
    try {
      const riderId = req.params.id;

      if (!isValidMongoId(riderId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid rider ID.",
        });
      }

      const verificationStatus =
        normalizeUppercase(
          req.body.verificationStatus ??
            req.body.status
        );

      const note =
        normalizeText(
          req.body.note ??
            req.body
              .riderVerificationNote
        ) || null;

      const allowedStatuses = [
        "NOT_SUBMITTED",
        "PENDING",
        "VERIFIED",
        "REJECTED",
        "SUSPENDED",
      ];

      if (
        !allowedStatuses.includes(
          verificationStatus
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid rider verification status.",
        });
      }

      const rider = await User.findOne({
        _id: riderId,
        role: "DELIVERY_RIDER",
      });

      if (!rider) {
        return res.status(404).json({
          success: false,
          message:
            "Delivery rider was not found.",
        });
      }

      rider.riderVerificationStatus =
        verificationStatus;

      rider.riderVerificationNote = note;

      if (
        verificationStatus === "VERIFIED"
      ) {
        rider.riderVerifiedBy =
          req.user?._id ?? null;

        rider.riderVerifiedAt =
          new Date();
      } else {
        rider.riderVerifiedBy = null;
        rider.riderVerifiedAt = null;

        if (
          verificationStatus ===
            "REJECTED" ||
          verificationStatus ===
            "SUSPENDED"
        ) {
          rider.availabilityStatus =
            "OFFLINE";
        }
      }

      await rider.save();

      const updatedRider =
        await User.findById(rider._id)
          .select(riderPublicFields)
          .lean();

      return res.status(200).json({
        success: true,
        message:
          `Rider verification changed to ${verificationStatus}.`,
        rider: updatedRider,
      });
    } catch (error) {
      return sendServerError(
        res,
        error,
        "UPDATE RIDER VERIFICATION ERROR:"
      );
    }
  };

module.exports = {
  getAdminRiders,
  createAdminRider,
  getAdminRiderDetails,
  updateAdminRider,
  updateAdminRiderStatus,
  updateAdminRiderVerification,
};