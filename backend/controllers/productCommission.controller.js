const ProductCommission = require(
  "../models/productCommission.model"
);

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toUpperCase();
};

const normalizeAmount = (value) => {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(
    (amount + Number.EPSILON) * 100
  ) / 100;
};

exports.getProductCommissions = async (
  req,
  res
) => {
  try {
    const {
      serviceType,
      search,
      isActive,
    } = req.query;

    const query = {};

    if (serviceType) {
      query.serviceType =
        normalizeText(serviceType);
    }

    if (
      isActive === "true" ||
      isActive === "false"
    ) {
      query.isActive =
        isActive === "true";
    }

    if (search) {
      query.$or = [
        {
          productName: {
            $regex: search,
            $options: "i",
          },
        },
        {
          productCode: {
            $regex: search,
            $options: "i",
          },
        },
        {
          serviceType: {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const products =
      await ProductCommission.find(query)
        .sort({
          serviceType: 1,
          productName: 1,
        });

    return res.status(200).json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error(
      "getProductCommissions error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while fetching product commissions.",
    });
  }
};

exports.upsertProductCommission = async (
  req,
  res
) => {
  try {
    const {
      serviceType,
      productCode,
      productName,
      headOfficeCommission,
      agentCommission,
      stateCommission,
      zonalCommission,
      isActive,
    } = req.body;

    const normalizedServiceType =
      normalizeText(serviceType);

    const normalizedProductCode =
      normalizeText(productCode);

    const cleanProductName =
      String(productName || "").trim();

    if (!normalizedServiceType) {
      return res.status(400).json({
        success: false,
        message:
          "Service type is required.",
      });
    }

    if (!normalizedProductCode) {
      return res.status(400).json({
        success: false,
        message:
          "Product code is required.",
      });
    }

    if (!cleanProductName) {
      return res.status(400).json({
        success: false,
        message:
          "Product name is required.",
      });
    }

    const normalizedHeadOfficeCommission =
      normalizeAmount(headOfficeCommission);

    const normalizedAgentCommission =
      normalizeAmount(agentCommission);

    const normalizedStateCommission =
      normalizeAmount(stateCommission);

    const normalizedZonalCommission =
      normalizeAmount(zonalCommission);

    if (
      normalizedHeadOfficeCommission === null ||
      normalizedAgentCommission === null ||
      normalizedStateCommission === null ||
      normalizedZonalCommission === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Commission amounts must be valid numbers and cannot be negative.",
      });
    }

    const updatedBy =
      req.user?._id || req.user?.id || null;

    const product =
      await ProductCommission.findOneAndUpdate(
        {
          serviceType:
            normalizedServiceType,
          productCode:
            normalizedProductCode,
        },
        {
          $set: {
            productName:
              cleanProductName,

            agentCommission:
              normalizedAgentCommission,

            stateCommission:
              normalizedStateCommission,

            zonalCommission:
              normalizedZonalCommission,

            isActive:
              typeof isActive ===
              "boolean"
                ? isActive
                : true,

            updatedBy,
          },

          $setOnInsert: {
            createdBy: updatedBy,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

    return res.status(200).json({
      success: true,
      message:
        "Product commission saved successfully.",
      product,
    });
  } catch (error) {
    console.error(
      "upsertProductCommission error:",
      error
    );

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "A commission setting already exists for this product.",
      });
    }

    return res.status(500).json({
      success: false,
      message:
        "Server error while saving product commission.",
    });
  }
};


exports.updateProductCommission = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      serviceType,
      productCode,
      productName,
      headOfficeCommission,
      agentCommission,
      stateCommission,
      zonalCommission,
      isActive,
    } = req.body;

    const normalizedServiceType =
      normalizeText(serviceType);

    const normalizedProductCode =
      normalizeText(productCode);

    const cleanProductName =
      String(productName || "").trim();

    if (!normalizedServiceType) {
      return res.status(400).json({
        success: false,
        message: "Service type is required.",
      });
    }

    if (!normalizedProductCode) {
      return res.status(400).json({
        success: false,
        message: "Product code is required.",
      });
    }

    if (!cleanProductName) {
      return res.status(400).json({
        success: false,
        message: "Product name is required.",
      });
    }

    const normalizedHeadOfficeCommission =
      normalizeAmount(headOfficeCommission);

    const normalizedAgentCommission =
      normalizeAmount(agentCommission);

    const normalizedStateCommission =
      normalizeAmount(stateCommission);

    const normalizedZonalCommission =
      normalizeAmount(zonalCommission);

    if (
      normalizedHeadOfficeCommission === null ||
      normalizedAgentCommission === null ||
      normalizedStateCommission === null ||
      normalizedZonalCommission === null
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Commission amounts must be valid numbers and cannot be negative.",
      });
    }

    const product =
      await ProductCommission.findByIdAndUpdate(
        id,
        {
          $set: {
            serviceType: normalizedServiceType,
            productCode: normalizedProductCode,
            productName: cleanProductName,

            headOfficeCommission:
              normalizedHeadOfficeCommission,

            agentCommission:
              normalizedAgentCommission,

            stateCommission:
              normalizedStateCommission,

            zonalCommission:
              normalizedZonalCommission,

            isActive:
              typeof isActive === "boolean"
                ? isActive
                : true,

            updatedBy:
              req.user?._id ||
              req.user?.id ||
              null,
          },
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product commission not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Product commission updated successfully.",
      product,
    });
  } catch (error) {
    console.error(
      "updateProductCommission error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while updating product commission.",
    });
  }
};

exports.updateProductCommissionStatus =
  async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      if (
        typeof isActive !== "boolean"
      ) {
        return res.status(400).json({
          success: false,
          message:
            "isActive must be true or false.",
        });
      }

      const product =
        await ProductCommission.findByIdAndUpdate(
          id,
          {
            $set: {
              isActive,
              updatedBy:
                req.user?._id ||
                req.user?.id ||
                null,
            },
          },
          {
            new: true,
            runValidators: true,
          }
        );

      if (!product) {
        return res.status(404).json({
          success: false,
          message:
            "Product commission not found.",
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Product commission status updated successfully.",
        product,
      });
    } catch (error) {
      console.error(
        "updateProductCommissionStatus error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Server error while updating product commission status.",
      });
    }
  };

exports.deleteProductCommission = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const product =
      await ProductCommission.findByIdAndDelete(
        id
      );

    if (!product) {
      return res.status(404).json({
        success: false,
        message:
          "Product commission not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Product commission deleted successfully.",
    });
  } catch (error) {
    console.error(
      "deleteProductCommission error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Server error while deleting product commission.",
    });
  }
};
