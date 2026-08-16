const KekeRide = require(
  "../models/kekeRide.model"
);

/*
 * =====================================================
 * CUSTOMER - GET RIDE OTP
 * =====================================================
 *
 * GET /api/keke-rides/:rideId/otp
 *
 * Security:
 * - User must own the ride.
 * - OTP is only revealed after driver arrives.
 * - OTP is not returned to unrelated users.
 */
exports.getRideOtp = async (
  req,
  res
) => {
  try {
    const ride =
      await KekeRide.findById(
        req.params.rideId
      ).select(
        "+rideOtp"
      );

    if (!ride) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Keke ride not found.",
        });
    }

    if (
      String(ride.customerId) !==
      String(req.user._id)
    ) {
      return res
        .status(403)
        .json({
          success: false,
          message:
            "You are not allowed to view this Ride OTP.",
        });
    }

    if (
      ![
        "DRIVER_ARRIVED",
        "RIDE_STARTED",
      ].includes(
        ride.status
      )
    ) {
      return res
        .status(409)
        .json({
          success: false,
          message:
            "Ride OTP becomes available when your driver arrives.",
          status:
            ride.status,
        });
    }

    if (!ride.rideOtp) {
      return res
        .status(404)
        .json({
          success: false,
          message:
            "Ride OTP is not available.",
        });
    }

    return res
      .status(200)
      .json({
        success: true,

        message:
          "Ride OTP loaded successfully.",

        ride: {
          id:
            ride._id,

          reference:
            ride.rideReference,

          status:
            ride.status,

          otp:
            ride.rideOtp,

          otpVerified:
            ride.rideOtpVerified,
        },
      });
  } catch (error) {
    console.error(
      "GET KEKE RIDE OTP ERROR:",
      error
    );

    return res
      .status(500)
      .json({
        success: false,
        message:
          "Unable to load Ride OTP.",
      });
  }
};