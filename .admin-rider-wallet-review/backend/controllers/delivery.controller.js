const crypto = require("crypto");

const Delivery = require("../models/delivery.model");

// Kirkirar tracking number
const generateTrackingNumber = () => {
  const randomCode = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `SP-${Date.now()}-${randomCode}`;
};

// Customer ya kirkiri delivery request
exports.createDelivery = async (req, res) => {
  try {
    const {
      pickupAddress,
      deliveryAddress,
      senderName,
      senderPhone,
      receiverName,
      receiverPhone,
      packageName,
      packageDescription,
      packageWeight,
    } = req.body;

    if (
      !pickupAddress ||
      !deliveryAddress ||
      !senderName ||
      !senderPhone ||
      !receiverName ||
      !receiverPhone ||
      !packageName
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required delivery information.",
      });
    }

    const parsedWeight = Number(packageWeight || 0);

    if (Number.isNaN(parsedWeight) || parsedWeight < 0) {
      return res.status(400).json({
        success: false,
        message: "Package weight must be a valid number.",
      });
    }

    const delivery = await Delivery.create({
      customerId: req.user._id,
      trackingNumber: generateTrackingNumber(),
      pickupAddress: pickupAddress.trim(),
      deliveryAddress: deliveryAddress.trim(),
      senderName: senderName.trim(),
      senderPhone: senderPhone.trim(),
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      packageName: packageName.trim(),
      packageDescription: packageDescription?.trim() || "",
      packageWeight: parsedWeight,
      deliveryFee: 0,
      paymentStatus: "UNPAID",
      status: "PENDING",
    });

    return res.status(201).json({
      success: true,
      message: "Delivery request created successfully.",
      delivery,
    });
  } catch (error) {
    console.error("Create delivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create delivery request.",
      error: error.message,
    });
  }
};

// Customer ya ga duk deliveries dinsa
exports.getMyDeliveries = async (req, res) => {
  try {
    const deliveries = await Delivery.find({
      customerId: req.user._id,
    })
      .populate("assignedRiderId", "fullName phone email")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error("Get my deliveries error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load delivery history.",
      error: error.message,
    });
  }
};

// Customer ko admin ya ga delivery guda daya
exports.getDeliveryById = async (req, res) => {
  try {
    const delivery = await Delivery.findById(req.params.id)
      .populate("customerId", "fullName phone email")
      .populate("assignedRiderId", "fullName phone email");

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found.",
      });
    }

    const userRole = req.user.role;
    const isOwner =
      delivery.customerId._id.toString() === req.user._id.toString();

    const isAdmin = [
      "HEAD_OFFICE",
      "ZONAL_MANAGER",
      "STATE_MANAGER",
    ].includes(userRole);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this delivery.",
      });
    }

    return res.status(200).json({
      success: true,
      delivery,
    });
  } catch (error) {
    console.error("Get delivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load delivery information.",
      error: error.message,
    });
  }
};

// Bincike da tracking number
exports.trackDelivery = async (req, res) => {
  try {
    const trackingNumber = String(
      req.params.trackingNumber || ""
    ).toUpperCase();

    const delivery = await Delivery.findOne({
      trackingNumber,
    }).select(
      "trackingNumber packageName pickupAddress deliveryAddress status paymentStatus deliveryFee createdAt updatedAt deliveredAt"
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Invalid tracking number.",
      });
    }

    return res.status(200).json({
      success: true,
      delivery,
    });
  } catch (error) {
    console.error("Track delivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to track delivery.",
      error: error.message,
    });
  }
};

// Customer ya soke delivery idan har ba a dauka ba
exports.cancelDelivery = async (req, res) => {
  try {
    const delivery = await Delivery.findOne({
      _id: req.params.id,
      customerId: req.user._id,
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found.",
      });
    }

    if (
      ["PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(
        delivery.status
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This delivery can no longer be cancelled.",
      });
    }

    delivery.status = "CANCELLED";
    await delivery.save();

    return res.status(200).json({
      success: true,
      message: "Delivery request cancelled successfully.",
      delivery,
    });
  } catch (error) {
    console.error("Cancel delivery error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel delivery request.",
      error: error.message,
    });
  }
};

// Admin ya ga duk deliveries
exports.getAllDeliveries = async (req, res) => {
  try {
    const {
      status,
      paymentStatus,
      search,
    } = req.query;

    const filter = {};

    if (status) {
      filter.status = status.toUpperCase();
    }

    if (paymentStatus) {
      filter.paymentStatus = paymentStatus.toUpperCase();
    }

    if (search) {
      filter.$or = [
        {
          trackingNumber: {
            $regex: search,
            $options: "i",
          },
        },
        {
          senderPhone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          receiverPhone: {
            $regex: search,
            $options: "i",
          },
        },
        {
          receiverName: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const deliveries = await Delivery.find(filter)
      .populate("customerId", "fullName phone email")
      .populate("assignedRiderId", "fullName phone email")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error("Get all deliveries error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load deliveries.",
      error: error.message,
    });
  }
};

// Admin ya saka kudin delivery
exports.setDeliveryFee = async (req, res) => {
  try {
    const deliveryFee = Number(req.body.deliveryFee);

    if (
      Number.isNaN(deliveryFee) ||
      deliveryFee < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid delivery fee.",
      });
    }

    const delivery = await Delivery.findByIdAndUpdate(
      req.params.id,
      {
        deliveryFee,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Delivery fee updated successfully.",
      delivery,
    });
  } catch (error) {
    console.error("Set delivery fee error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update delivery fee.",
      error: error.message,
    });
  }
};

// Admin ya canza delivery status
exports.updateDeliveryStatus = async (req, res) => {
  try {
    const status = String(req.body.status || "").toUpperCase();

    const allowedStatuses = [
      "PENDING",
      "ACCEPTED",
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
      "CANCELLED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid delivery status.",
      });
    }

    const updateData = {
      status,
    };

    if (req.body.adminNote !== undefined) {
      updateData.adminNote =
        String(req.body.adminNote).trim();
    }

    if (status === "DELIVERED") {
      updateData.deliveredAt = new Date();
    } else {
      updateData.deliveredAt = null;
    }

    const delivery = await Delivery.findByIdAndUpdate(
      req.params.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Delivery status updated successfully.",
      delivery,
    });
  } catch (error) {
    console.error("Update delivery status error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update delivery status.",
      error: error.message,
    });
  }
};

// Admin ya canza payment status
exports.updatePaymentStatus = async (req, res) => {
  try {
    const paymentStatus = String(
      req.body.paymentStatus || ""
    ).toUpperCase();

    const allowedPaymentStatuses = [
      "UNPAID",
      "PAID",
      "REFUNDED",
    ];

    if (
      !allowedPaymentStatuses.includes(paymentStatus)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment status.",
      });
    }

    const delivery = await Delivery.findByIdAndUpdate(
      req.params.id,
      {
        paymentStatus,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment status updated successfully.",
      delivery,
    });
  } catch (error) {
    console.error("Update payment status error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update payment status.",
      error: error.message,
    });
  }
};