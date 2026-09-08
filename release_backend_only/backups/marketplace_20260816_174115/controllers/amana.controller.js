const crypto = require("crypto");

const AmanaOrder = require(
  "../models/amanaOrder.model"
);

/*
 * Initial categories available in ServicePay Amana.
 */
const ALLOWED_CATEGORIES = [
  "FOOD_PACKAGE",
  "SCHOOL_FEES",
  "MEDICAL_SUPPORT",
  "BUILDING_SUPPORT",
  "LIVESTOCK_SUPPORT",
  "RENT_SUPPORT",
  "SOLAR_AND_UTILITIES",
  "CUSTOM_REQUEST",
];

/*
 * Generate a unique ServicePay Amana reference.
 *
 * Example:
 * AMN-20260804-A1B2C3D4
 */
const generateAmanaReference = () => {
  const date = new Date();

  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  const randomCode = crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase();

  return `AMN-${year}${month}${day}-${randomCode}`;
};

/*
 * Clean ordinary text fields.
 */
const cleanText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

/*
 * Normalize Nigerian phone numbers.
 *
 * Accepted examples:
 * 08012345678
 * +2348012345678
 * 2348012345678
 */
const normalizePhone = (phone) => {
  let value = cleanText(phone).replace(/\s+/g, "");

  value = value.replace(/-/g, "");

  if (value.startsWith("+234")) {
    value = `0${value.slice(4)}`;
  } else if (
    value.startsWith("234") &&
    value.length === 13
  ) {
    value = `0${value.slice(3)}`;
  }

  return value;
};

/*
 * Validate Nigerian phone number.
 */
const isValidPhone = (phone) => {
  return /^0[789][01]\d{8}$/.test(phone);
};

/*
 * Convert an amount safely to a number.
 */
const parseAmount = (value) => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return Number(amount.toFixed(2));
};

/*
 * Create a new ServicePay Amana request.
 *
 * This creates the order as PENDING_PAYMENT.
 * Wallet debit will be handled by a separate
 * payment endpoint.
 */
const createAmanaOrder = async (req, res) => {
  try {
    const customerId = req.user?._id || req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const {
      category,
      title,
      description,
      beneficiary,
      providerDetails,
      amount,
      preferredFulfilmentDate,
    } = req.body;

    const normalizedCategory = cleanText(
      category
    ).toUpperCase();

    if (
      !ALLOWED_CATEGORIES.includes(
        normalizedCategory
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please select a valid ServicePay Amana category.",
      });
    }

    const cleanTitle = cleanText(title);

    if (
      cleanTitle.length < 3 ||
      cleanTitle.length > 150
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Order title must be between 3 and 150 characters.",
      });
    }

    const cleanDescription = cleanText(
      description
    );

    if (
      cleanDescription.length < 10 ||
      cleanDescription.length > 2000
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a clear description of the request.",
      });
    }

    if (
      !beneficiary ||
      typeof beneficiary !== "object"
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Beneficiary information is required.",
      });
    }

    const beneficiaryFullName = cleanText(
      beneficiary.fullName
    );

    const beneficiaryPhone = normalizePhone(
      beneficiary.phone
    );

    const beneficiaryState = cleanText(
      beneficiary.state
    );

    const beneficiaryLga = cleanText(
      beneficiary.lga
    );

    const beneficiaryAddress = cleanText(
      beneficiary.address
    );

    if (beneficiaryFullName.length < 3) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter the beneficiary's full name.",
      });
    }

    if (!isValidPhone(beneficiaryPhone)) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter a valid Nigerian beneficiary phone number.",
      });
    }

    if (!beneficiaryState) {
      return res.status(400).json({
        success: false,
        message:
          "Beneficiary state is required.",
      });
    }

    if (!beneficiaryLga) {
      return res.status(400).json({
        success: false,
        message:
          "Beneficiary LGA is required.",
      });
    }

    if (beneficiaryAddress.length < 5) {
      return res.status(400).json({
        success: false,
        message:
          "Please enter the beneficiary's complete address.",
      });
    }

    const parsedAmount = parseAmount(amount);

    if (
      parsedAmount === null ||
      parsedAmount < 100
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The minimum ServicePay Amana amount is ₦100.",
      });
    }

    /*
     * For the first version, the service fee
     * and delivery fee remain zero.
     *
     * We will later calculate them from the
     * selected category, state and order type.
     */
    const serviceFee = 0;
    const deliveryFee = 0;

    const totalAmount = Number(
      (
        parsedAmount +
        serviceFee +
        deliveryFee
      ).toFixed(2)
    );

    let fulfilmentDate = null;

    if (preferredFulfilmentDate) {
      fulfilmentDate = new Date(
        preferredFulfilmentDate
      );

      if (
        Number.isNaN(
          fulfilmentDate.getTime()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Preferred fulfilment date is invalid.",
        });
      }

      const today = new Date();

      today.setHours(0, 0, 0, 0);

      if (fulfilmentDate < today) {
        return res.status(400).json({
          success: false,
          message:
            "Preferred fulfilment date cannot be in the past.",
        });
      }
    }

    let reference = generateAmanaReference();

    /*
     * Extremely unlikely collision protection.
     */
    while (
      await AmanaOrder.exists({
        reference,
      })
    ) {
      reference = generateAmanaReference();
    }

    const order = await AmanaOrder.create({
      customer: customerId,

      reference,

      category: normalizedCategory,

      title: cleanTitle,

      description: cleanDescription,

      beneficiary: {
        fullName: beneficiaryFullName,

        phone: beneficiaryPhone,

        email: cleanText(
          beneficiary.email
        ).toLowerCase(),

        relationship: cleanText(
          beneficiary.relationship
        ),

        state: beneficiaryState,

        lga: beneficiaryLga,

        address: beneficiaryAddress,

        landmark: cleanText(
          beneficiary.landmark
        ),
      },

      providerDetails: {
        name: cleanText(
          providerDetails?.name
        ),

        phone: normalizePhone(
          providerDetails?.phone
        ),

        accountName: cleanText(
          providerDetails?.accountName
        ),

        accountNumber: cleanText(
          providerDetails?.accountNumber
        ),

        bankName: cleanText(
          providerDetails?.bankName
        ),

        address: cleanText(
          providerDetails?.address
        ),

        additionalInformation: cleanText(
          providerDetails
            ?.additionalInformation
        ),
      },

      amount: parsedAmount,

      serviceFee,

      deliveryFee,

      totalAmount,

      paymentMethod:
        "SERVICEPAY_WALLET",

      paymentStatus: "PENDING",

      status: "PENDING_PAYMENT",

      walletDebited: false,

      walletRefunded: false,

      preferredFulfilmentDate:
        fulfilmentDate,
    });

    return res.status(201).json({
      success: true,

      message:
        "ServicePay Amana request created successfully. Please complete payment.",

      data: {
        order: order.toSafeObject(),
      },
    });
  } catch (error) {
    console.error(
      "Create Amana order error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to create the ServicePay Amana request.",
    });
  }
};

/*
 * Get all ServicePay Amana orders
 * created by the logged-in customer.
 */
const getMyAmanaOrders = async (
  req,
  res
) => {
  try {
    const customerId = req.user?._id || req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        Number.parseInt(
          req.query.limit,
          10
        ) || 20,
        1
      ),
      100
    );

    const skip = (page - 1) * limit;

    const filter = {
      customer: customerId,
    };

    const requestedStatus = cleanText(
      req.query.status
    ).toUpperCase();

    if (requestedStatus) {
      filter.status = requestedStatus;
    }

    const requestedCategory = cleanText(
      req.query.category
    ).toUpperCase();

    if (requestedCategory) {
      filter.category = requestedCategory;
    }

    const [orders, total] =
      await Promise.all([
        AmanaOrder.find(filter)
          .sort({
            createdAt: -1,
          })
          .skip(skip)
          .limit(limit)
          .select(
            "-confirmationOtpHash -confirmationOtpExpiresAt -adminNotes"
          ),

        AmanaOrder.countDocuments(filter),
      ]);

    return res.status(200).json({
      success: true,

      data: {
        orders,

        pagination: {
          page,

          limit,

          total,

          totalPages: Math.max(
            Math.ceil(total / limit),
            1
          ),
        },
      },
    });
  } catch (error) {
    console.error(
      "Get my Amana orders error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to load your ServicePay Amana orders.",
    });
  }
};

/*
 * Get one ServicePay Amana order
 * belonging to the logged-in customer.
 */
const getMyAmanaOrderById = async (
  req,
  res
) => {
  try {
    const customerId = req.user?._id || req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const order = await AmanaOrder.findOne({
      _id: req.params.id,

      customer: customerId,
    }).select(
      "-confirmationOtpHash -confirmationOtpExpiresAt -adminNotes"
    );

    if (!order) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    return res.status(200).json({
      success: true,

      data: {
        order,
      },
    });
  } catch (error) {
    console.error(
      "Get Amana order error:",
      error
    );

    /*
     * Invalid MongoDB ID.
     */
    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    return res.status(500).json({
      success: false,

      message:
        "Unable to load the ServicePay Amana order.",
    });
  }
};

/*
 * Cancel an unpaid ServicePay Amana order.
 *
 * Paid orders cannot be cancelled directly
 * by the customer because a refund may be
 * required.
 */
const cancelMyAmanaOrder = async (
  req,
  res
) => {
  try {
    const customerId = req.user?._id || req.user?.id;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const cancellationReason = cleanText(
      req.body.cancellationReason
    );

    if (cancellationReason.length < 3) {
      return res.status(400).json({
        success: false,

        message:
          "Please provide a reason for cancelling the request.",
      });
    }

    const order = await AmanaOrder.findOne({
      _id: req.params.id,

      customer: customerId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    if (
      order.status === "CANCELLED"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "This ServicePay Amana order has already been cancelled.",
      });
    }

    if (
      order.status !==
        "PENDING_PAYMENT" ||
      order.paymentStatus !== "PENDING" ||
      order.walletDebited
    ) {
      return res.status(400).json({
        success: false,

        message:
          "A paid or processing order cannot be cancelled directly. Please contact ServicePay support.",
      });
    }

    order.status = "CANCELLED";

    order.cancelledAt = new Date();

    order.cancellationReason =
      cancellationReason;

    await order.save();

    return res.status(200).json({
      success: true,

      message:
        "ServicePay Amana order cancelled successfully.",

      data: {
        order: order.toSafeObject(),
      },
    });
  } catch (error) {
    console.error(
      "Cancel Amana order error:",
      error
    );

    if (error.name === "CastError") {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    return res.status(500).json({
      success: false,

      message:
        "Unable to cancel the ServicePay Amana order.",
    });
  }
};

module.exports = {
  createAmanaOrder,

  getMyAmanaOrders,

  getMyAmanaOrderById,

  cancelMyAmanaOrder,
};