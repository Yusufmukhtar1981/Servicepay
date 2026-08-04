const mongoose = require("mongoose");

const AmanaOrder = require(
  "../models/amanaOrder.model"
);

const User = require(
  "../models/user.model"
);

const ALLOWED_STATUSES = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "ASSIGNED",
  "FULFILLED",
  "COMPLETED",
  "CANCELLED",
  "REFUNDED",
];

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

const cleanText = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
};

const isValidObjectId = (value) => {
  return mongoose.Types.ObjectId.isValid(
    value
  );
};

/*
 * GET /api/admin/amana
 *
 * Query examples:
 * ?page=1
 * ?limit=20
 * ?status=PAID
 * ?category=FOOD_PACKAGE
 * ?search=AMN-20260804
 */
const getAllAmanaOrders = async (
  req,
  res
) => {
  try {
    const page = Math.max(
      Number.parseInt(
        req.query.page,
        10
      ) || 1,
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

    const skip =
      (page - 1) * limit;

    const filter = {};

    const status = cleanText(
      req.query.status
    ).toUpperCase();

    if (
      status &&
      ALLOWED_STATUSES.includes(status)
    ) {
      filter.status = status;
    }

    const category = cleanText(
      req.query.category
    ).toUpperCase();

    if (
      category &&
      ALLOWED_CATEGORIES.includes(
        category
      )
    ) {
      filter.category = category;
    }

    const paymentStatus = cleanText(
      req.query.paymentStatus
    ).toUpperCase();

    if (paymentStatus) {
      filter.paymentStatus =
        paymentStatus;
    }

    const assignedTo = cleanText(
      req.query.assignedTo
    );

    if (
      assignedTo &&
      isValidObjectId(assignedTo)
    ) {
      filter.assignedTo =
        assignedTo;
    }

    const search = cleanText(
      req.query.search
    );

    if (search) {
      const escapedSearch =
        search.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const searchRegex =
        new RegExp(
          escapedSearch,
          "i"
        );

      filter.$or = [
        {
          reference:
            searchRegex,
        },
        {
          title:
            searchRegex,
        },
        {
          description:
            searchRegex,
        },
        {
          "beneficiary.fullName":
            searchRegex,
        },
        {
          "beneficiary.phone":
            searchRegex,
        },
        {
          "beneficiary.state":
            searchRegex,
        },
        {
          "beneficiary.lga":
            searchRegex,
        },
        {
          "providerDetails.name":
            searchRegex,
        },
      ];
    }

    const [
      orders,
      total,
      totalAmountResult,
      paidCount,
      processingCount,
      completedCount,
    ] = await Promise.all([
      AmanaOrder.find(filter)
        .populate(
          "customer",
          "fullName phone email role state lga"
        )
        .populate(
          "assignedTo",
          "fullName phone email role state lga staffId"
        )
        .populate(
          "assignedBy",
          "fullName role staffId"
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit)
        .select(
          "-confirmationOtpHash -confirmationOtpExpiresAt"
        ),

      AmanaOrder.countDocuments(
        filter
      ),

      AmanaOrder.aggregate([
        {
          $match: filter,
        },
        {
          $group: {
            _id: null,
            totalAmount: {
              $sum: "$totalAmount",
            },
          },
        },
      ]),

      AmanaOrder.countDocuments({
        status: "PAID",
      }),

      AmanaOrder.countDocuments({
        status: {
          $in: [
            "PROCESSING",
            "ASSIGNED",
            "FULFILLED",
          ],
        },
      }),

      AmanaOrder.countDocuments({
        status: "COMPLETED",
      }),
    ]);

    const totalAmount =
      totalAmountResult.length > 0
        ? Number(
            totalAmountResult[0]
              .totalAmount
          ) || 0
        : 0;

    return res.status(200).json({
      success: true,

      data: {
        orders,

        summary: {
          totalOrders: total,

          totalAmount,

          paidOrders:
            paidCount,

          processingOrders:
            processingCount,

          completedOrders:
            completedCount,
        },

        pagination: {
          page,

          limit,

          total,

          totalPages: Math.max(
            Math.ceil(
              total / limit
            ),
            1
          ),
        },
      },
    });
  } catch (error) {
    console.error(
      "Admin get Amana orders error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to load ServicePay Amana orders.",
    });
  }
};

/*
 * GET /api/admin/amana/:id
 */
const getAmanaOrderById = async (
  req,
  res
) => {
  try {
    if (
      !isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    const order =
      await AmanaOrder.findById(
        req.params.id
      )
        .populate(
          "customer",
          "fullName phone email role state lga zone walletBalance"
        )
        .populate(
          "assignedTo",
          "fullName phone email role state lga zone staffId department"
        )
        .populate(
          "assignedBy",
          "fullName phone email role staffId"
        )
        .populate(
          "fulfilmentProof.uploadedBy",
          "fullName role staffId"
        )
        .populate(
          "paymentTransaction"
        )
        .populate(
          "refundTransaction"
        )
        .select(
          "-confirmationOtpHash -confirmationOtpExpiresAt"
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
      "Admin get Amana order error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to load the ServicePay Amana order.",
    });
  }
};

/*
 * PATCH /api/admin/amana/:id/assign
 *
 * Body:
 * {
 *   "assignedTo": "USER_MONGODB_ID",
 *   "adminNotes": "Optional note"
 * }
 */
const assignAmanaOrder = async (
  req,
  res
) => {
  try {
    const adminId =
      req.user?._id ||
      req.user?.id;

    const orderId =
      req.params.id;

    const assignedToId =
      cleanText(
        req.body.assignedTo
      );

    if (
      !isValidObjectId(orderId)
    ) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    if (
      !isValidObjectId(
        assignedToId
      )
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Please select a valid staff member or Aggregator.",
      });
    }

    const assignee =
      await User.findOne({
        _id: assignedToId,

        status: "ACTIVE",

        $or: [
          {
            role: {
              $in: [
                "AGENT",
                "STATE_MANAGER",
                "ZONAL_MANAGER",
              ],
            },
          },
          {
            role: "STAFF",
            isStaff: true,
          },
        ],
      }).select(
        "fullName phone email role staffId state lga"
      );

    if (!assignee) {
      return res.status(404).json({
        success: false,

        message:
          "Selected staff member or Aggregator was not found or is inactive.",
      });
    }

    const order =
      await AmanaOrder.findById(
        orderId
      );

    if (!order) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    if (
      order.status ===
        "PENDING_PAYMENT" ||
      order.paymentStatus !==
        "PAID" ||
      !order.walletDebited
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Only a paid Amana order can be assigned.",
      });
    }

    if (
      [
        "COMPLETED",
        "CANCELLED",
        "REFUNDED",
      ].includes(order.status)
    ) {
      return res.status(400).json({
        success: false,

        message:
          "This Amana order can no longer be assigned.",
      });
    }

    order.assignedTo =
      assignee._id;

    order.assignedBy =
      adminId || null;

    order.assignedAt =
      new Date();

    order.status =
      "ASSIGNED";

    const adminNotes =
      cleanText(
        req.body.adminNotes
      );

    if (adminNotes) {
      order.adminNotes =
        adminNotes;
    }

    await order.save();

    const populatedOrder =
      await AmanaOrder.findById(
        order._id
      )
        .populate(
          "customer",
          "fullName phone email role state lga"
        )
        .populate(
          "assignedTo",
          "fullName phone email role staffId state lga"
        )
        .populate(
          "assignedBy",
          "fullName role staffId"
        )
        .select(
          "-confirmationOtpHash -confirmationOtpExpiresAt"
        );

    return res.status(200).json({
      success: true,

      message:
        `Amana order assigned successfully to ${assignee.fullName}.`,

      data: {
        order:
          populatedOrder,
      },
    });
  } catch (error) {
    console.error(
      "Assign Amana order error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to assign the ServicePay Amana order.",
    });
  }
};

/*
 * PATCH /api/admin/amana/:id/status
 *
 * Body:
 * {
 *   "status": "PROCESSING",
 *   "adminNotes": "Optional note"
 * }
 */
const updateAmanaOrderStatus =
  async (req, res) => {
    try {
      const orderId =
        req.params.id;

      const newStatus =
        cleanText(
          req.body.status
        ).toUpperCase();

      if (
        !isValidObjectId(orderId)
      ) {
        return res.status(404).json({
          success: false,

          message:
            "ServicePay Amana order not found.",
        });
      }

      if (
        !ALLOWED_STATUSES.includes(
          newStatus
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Please select a valid Amana order status.",
        });
      }

      const order =
        await AmanaOrder.findById(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          success: false,

          message:
            "ServicePay Amana order not found.",
        });
      }

      /*
       * Financial statuses must not be
       * manually forced from this endpoint.
       */
      if (
        [
          "PENDING_PAYMENT",
          "PAID",
          "REFUNDED",
        ].includes(newStatus)
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Payment and refund statuses cannot be changed manually.",
        });
      }

      if (
        order.paymentStatus !==
          "PAID" ||
        !order.walletDebited
      ) {
        return res.status(400).json({
          success: false,

          message:
            "This Amana order has not been paid.",
        });
      }

      if (
        [
          "COMPLETED",
          "CANCELLED",
          "REFUNDED",
        ].includes(order.status)
      ) {
        return res.status(400).json({
          success: false,

          message:
            "This Amana order has already reached a final status.",
        });
      }

      if (
        newStatus ===
          "ASSIGNED" &&
        !order.assignedTo
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Assign this order to a staff member or Aggregator first.",
        });
      }

      if (
        newStatus ===
          "FULFILLED" &&
        !order.fulfilmentProof
          ?.notes &&
        !order.fulfilmentProof
          ?.receiptUrl &&
        (
          !Array.isArray(
            order.fulfilmentProof
              ?.imageUrls
          ) ||
          order.fulfilmentProof
            .imageUrls.length === 0
        )
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Please add fulfilment proof before marking this order as fulfilled.",
        });
      }

      if (
        newStatus ===
          "COMPLETED" &&
        order.status !==
          "FULFILLED"
      ) {
        return res.status(400).json({
          success: false,

          message:
            "The order must first be marked as fulfilled.",
        });
      }

      order.status =
        newStatus;

      const adminNotes =
        cleanText(
          req.body.adminNotes
        );

      if (adminNotes) {
        order.adminNotes =
          adminNotes;
      }

      if (
        newStatus ===
        "PROCESSING"
      ) {
        order.processingStartedAt =
          order.processingStartedAt ||
          new Date();
      }

      if (
        newStatus ===
        "FULFILLED"
      ) {
        order.fulfilledAt =
          order.fulfilledAt ||
          new Date();
      }

      if (
        newStatus ===
        "COMPLETED"
      ) {
        order.completedAt =
          order.completedAt ||
          new Date();
      }

      if (
        newStatus ===
        "CANCELLED"
      ) {
        const cancellationReason =
          cleanText(
            req.body
              .cancellationReason
          );

        if (
          cancellationReason.length <
          3
        ) {
          return res.status(400).json({
            success: false,

            message:
              "Please provide a cancellation reason.",
          });
        }

        order.cancellationReason =
          cancellationReason;

        order.cancelledAt =
          new Date();
      }

      await order.save();

      const populatedOrder =
        await AmanaOrder.findById(
          order._id
        )
          .populate(
            "customer",
            "fullName phone email role state lga"
          )
          .populate(
            "assignedTo",
            "fullName phone email role staffId state lga"
          )
          .populate(
            "assignedBy",
            "fullName role staffId"
          )
          .select(
            "-confirmationOtpHash -confirmationOtpExpiresAt"
          );

      return res.status(200).json({
        success: true,

        message:
          `Amana order status updated to ${newStatus}.`,

        data: {
          order:
            populatedOrder,
        },
      });
    } catch (error) {
      console.error(
        "Update Amana status error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to update the ServicePay Amana order status.",
      });
    }
  };

/*
 * PATCH /api/admin/amana/:id/vendor
 */
const updateAmanaVendor = async (
  req,
  res
) => {
  try {
    const orderId =
      req.params.id;

    if (
      !isValidObjectId(orderId)
    ) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    const name =
      cleanText(
        req.body.name
      );

    if (name.length < 2) {
      return res.status(400).json({
        success: false,

        message:
          "Please enter the vendor name.",
      });
    }

    const order =
      await AmanaOrder.findById(
        orderId
      );

    if (!order) {
      return res.status(404).json({
        success: false,

        message:
          "ServicePay Amana order not found.",
      });
    }

    if (
      order.paymentStatus !==
      "PAID"
    ) {
      return res.status(400).json({
        success: false,

        message:
          "Vendor information can only be added to a paid order.",
      });
    }

    order.vendor = {
      name,

      phone:
        cleanText(
          req.body.phone
        ),

      address:
        cleanText(
          req.body.address
        ),

      accountName:
        cleanText(
          req.body.accountName
        ),

      accountNumber:
        cleanText(
          req.body.accountNumber
        ),

      bankName:
        cleanText(
          req.body.bankName
        ),
    };

    if (
      order.status === "PAID"
    ) {
      order.status =
        "PROCESSING";

      order.processingStartedAt =
        new Date();
    }

    await order.save();

    return res.status(200).json({
      success: true,

      message:
        "Amana vendor information updated successfully.",

      data: {
        order:
          order.toSafeObject(),
      },
    });
  } catch (error) {
    console.error(
      "Update Amana vendor error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to update the Amana vendor information.",
    });
  }
};

/*
 * PATCH /api/admin/amana/:id/proof
 *
 * Initial version accepts URLs and notes.
 * Actual file upload integration can be
 * added later with Cloudinary or another
 * secure storage provider.
 *
 * Body:
 * {
 *   "receiptUrl": "https://...",
 *   "imageUrls": ["https://..."],
 *   "notes": "Delivered successfully"
 * }
 */
const addAmanaFulfilmentProof =
  async (req, res) => {
    try {
      const adminId =
        req.user?._id ||
        req.user?.id;

      const orderId =
        req.params.id;

      if (
        !isValidObjectId(orderId)
      ) {
        return res.status(404).json({
          success: false,

          message:
            "ServicePay Amana order not found.",
        });
      }

      const receiptUrl =
        cleanText(
          req.body.receiptUrl
        );

      const notes =
        cleanText(
          req.body.notes
        );

      const rawImageUrls =
        Array.isArray(
          req.body.imageUrls
        )
          ? req.body.imageUrls
          : [];

      const imageUrls =
        rawImageUrls
          .map((url) =>
            cleanText(url)
          )
          .filter(
            (url) =>
              url.length > 0
          )
          .slice(0, 10);

      if (
        !receiptUrl &&
        imageUrls.length === 0 &&
        notes.length < 3
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Please provide a receipt, image or fulfilment note.",
        });
      }

      const order =
        await AmanaOrder.findById(
          orderId
        );

      if (!order) {
        return res.status(404).json({
          success: false,

          message:
            "ServicePay Amana order not found.",
        });
      }

      if (
        order.paymentStatus !==
          "PAID" ||
        !order.walletDebited
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Fulfilment proof can only be added to a paid order.",
        });
      }

      if (
        [
          "COMPLETED",
          "CANCELLED",
          "REFUNDED",
        ].includes(order.status)
      ) {
        return res.status(400).json({
          success: false,

          message:
            "Fulfilment proof cannot be added to this order.",
        });
      }

      order.fulfilmentProof = {
        receiptUrl,

        imageUrls,

        notes,

        uploadedBy:
          adminId || null,

        uploadedAt:
          new Date(),
      };

      order.status =
        "FULFILLED";

      order.fulfilledAt =
        new Date();

      await order.save();

      const populatedOrder =
        await AmanaOrder.findById(
          order._id
        )
          .populate(
            "customer",
            "fullName phone email role state lga"
          )
          .populate(
            "assignedTo",
            "fullName phone email role staffId state lga"
          )
          .populate(
            "fulfilmentProof.uploadedBy",
            "fullName role staffId"
          )
          .select(
            "-confirmationOtpHash -confirmationOtpExpiresAt"
          );

      return res.status(200).json({
        success: true,

        message:
          "Amana fulfilment proof added successfully.",

        data: {
          order:
            populatedOrder,
        },
      });
    } catch (error) {
      console.error(
        "Add Amana proof error:",
        error
      );

      return res.status(500).json({
        success: false,

        message:
          "Unable to add the Amana fulfilment proof.",
      });
    }
  };

module.exports = {
  getAllAmanaOrders,

  getAmanaOrderById,

  assignAmanaOrder,

  updateAmanaOrderStatus,

  updateAmanaVendor,

  addAmanaFulfilmentProof,
};