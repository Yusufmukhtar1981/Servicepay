const mongoose = require("mongoose");

const Commission = require("../models/commission.model");
const ProductCommission = require(
  "../models/productCommission.model"
);
const User = require("../models/user.model");

const roundMoney = (value) => {
  const amount = Number(value || 0);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.round(
    (amount + Number.EPSILON) * 100
  ) / 100;
};

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toUpperCase();
};

const normalizeObjectId = (value) => {
  if (!value) {
    return null;
  }

  const rawValue =
    typeof value === "object" && value._id
      ? value._id
      : value;

  if (
    !mongoose.Types.ObjectId.isValid(rawValue)
  ) {
    return null;
  }

  return new mongoose.Types.ObjectId(rawValue);
};

const getCustomerHierarchy = async (customer) => {
  const customerId = normalizeObjectId(
    customer?._id || customer
  );

  if (!customerId) {
    throw new Error(
      "A valid customer is required."
    );
  }

  const customerDocument =
    customer && customer._id
      ? customer
      : await User.findById(customerId).select(
          "agentId stateManagerId zonalManagerId"
        );

  if (!customerDocument) {
    throw new Error("Customer not found.");
  }

  let agentId = normalizeObjectId(
    customerDocument.agentId
  );

  let stateManagerId = normalizeObjectId(
    customerDocument.stateManagerId
  );

  let zonalManagerId = normalizeObjectId(
    customerDocument.zonalManagerId
  );

  /*
   * Idan State Manager ko Zonal Manager
   * ba su cikin customer record,
   * mu duba Agent record.
   */
  if (
    agentId &&
    (!stateManagerId || !zonalManagerId)
  ) {
    const agent = await User.findById(
      agentId
    ).select(
      "stateManagerId zonalManagerId"
    );

    if (agent) {
      stateManagerId =
        stateManagerId ||
        normalizeObjectId(
          agent.stateManagerId
        );

      zonalManagerId =
        zonalManagerId ||
        normalizeObjectId(
          agent.zonalManagerId
        );
    }
  }

  /*
   * Idan akwai State Manager amma babu
   * Zonal Manager, mu duba State Manager.
   */
  if (
    stateManagerId &&
    !zonalManagerId
  ) {
    const stateManager =
      await User.findById(
        stateManagerId
      ).select("zonalManagerId");

    if (stateManager) {
      zonalManagerId =
        normalizeObjectId(
          stateManager.zonalManagerId
        );
    }
  }

  return {
    customerId,
    agentId,
    stateManagerId,
    zonalManagerId,
  };
};

const getProductCommissionSetting =
  async ({
    serviceType,
    productCode,
  }) => {
    const normalizedServiceType =
      normalizeText(serviceType);

    const normalizedProductCode =
      normalizeText(productCode);

    if (!normalizedServiceType) {
      throw new Error(
        "serviceType is required."
      );
    }

    if (!normalizedProductCode) {
      throw new Error(
        "productCode is required."
      );
    }

    return ProductCommission.findOne({
      serviceType:
        normalizedServiceType,
      productCode:
        normalizedProductCode,
      isActive: true,
    });
  };

const buildCommissionRecord = ({
  transaction,
  customerId,
  beneficiaryId,
  beneficiaryRole,
  serviceType,
  productCode,
  productName,
  transactionAmount,
  providerCost,
  netProfit,
  commissionAmount,
  status,
  description,
  metadata,
}) => {
  return {
    transactionId: transaction._id,
    customerId,
    beneficiaryId,
    beneficiaryRole,
    serviceType,
    transactionReference:
      transaction.reference ||
      transaction.transactionReference ||
      String(transaction._id),

    transactionAmount,
    providerCost,
    netProfit,

    /*
     * Wannan field yana nan a tsohon
     * Commission Model, amma ba ma amfani
     * da percentage yanzu.
     */
    commissionRate: 0,

    commissionAmount,
    status,

    description:
      description ||
      `${beneficiaryRole} commission for ${productName}`,

    availableAt:
      status === "AVAILABLE"
        ? new Date()
        : null,

    metadata: {
      ...metadata,
      productCode,
      productName,
      commissionType: "FIXED_AMOUNT",
    },
  };
};

const saveCommissionRecord =
  async (record) => {
    return Commission.findOneAndUpdate(
      {
        transactionId:
          record.transactionId,
        beneficiaryRole:
          record.beneficiaryRole,
        beneficiaryId:
          record.beneficiaryId || null,
      },
      {
        $setOnInsert: record,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );
  };

const distributeCommission = async ({
  transaction,
  customer,
  serviceType,
  productCode,
  providerCost = 0,
  netProfit,
  status = "AVAILABLE",
  description = "",
  metadata = {},
}) => {
  if (!transaction?._id) {
    throw new Error(
      "A saved transaction is required."
    );
  }

  const transactionStatus =
    normalizeText(transaction.status);

  if (
    transactionStatus !== "SUCCESSFUL"
  ) {
    return {
      success: false,
      distributed: false,
      message:
        "Commission is only created for successful transactions.",
      commissions: [],
    };
  }

  const normalizedServiceType =
    normalizeText(
      serviceType ||
      transaction.serviceType ||
      transaction.type
    );

  const normalizedProductCode =
    normalizeText(productCode);

  const setting =
    await getProductCommissionSetting({
      serviceType:
        normalizedServiceType,
      productCode:
        normalizedProductCode,
    });

  if (!setting) {
    return {
      success: false,
      distributed: false,
      message:
        "No active commission setting was found for this product.",
      commissions: [],
    };
  }

  const transactionAmount =
    roundMoney(transaction.amount);

  const normalizedProviderCost =
    roundMoney(providerCost);

  const calculatedNetProfit =
    netProfit === undefined ||
    netProfit === null
      ? roundMoney(
          transactionAmount -
          normalizedProviderCost
        )
      : roundMoney(netProfit);

  if (calculatedNetProfit <= 0) {
    return {
      success: false,
      distributed: false,
      message:
        "Net profit is zero or negative.",
      commissions: [],
    };
  }

  const agentAmount = roundMoney(
    setting.agentCommission
  );

  const stateAmount = roundMoney(
    setting.stateCommission
  );

  const zonalAmount = roundMoney(
    setting.zonalCommission
  );

  const configuredCommissionTotal =
    roundMoney(
      agentAmount +
      stateAmount +
      zonalAmount
    );

  /*
   * Kariyar kada commissions su fi
   * ribar product.
   */
  if (
    configuredCommissionTotal >
    calculatedNetProfit
  ) {
    throw new Error(
      `Configured commissions ₦${configuredCommissionTotal} exceed net profit ₦${calculatedNetProfit}.`
    );
  }

  const hierarchy =
    await getCustomerHierarchy(customer);

  const allocations = [];

  let distributedToManagers = 0;

  if (
    hierarchy.agentId &&
    agentAmount > 0
  ) {
    allocations.push({
      beneficiaryRole: "AGENT",
      beneficiaryId:
        hierarchy.agentId,
      commissionAmount:
        agentAmount,
    });

    distributedToManagers +=
      agentAmount;
  }

  if (
    hierarchy.stateManagerId &&
    stateAmount > 0
  ) {
    allocations.push({
      beneficiaryRole:
        "STATE_MANAGER",
      beneficiaryId:
        hierarchy.stateManagerId,
      commissionAmount:
        stateAmount,
    });

    distributedToManagers +=
      stateAmount;
  }

  if (
    hierarchy.zonalManagerId &&
    zonalAmount > 0
  ) {
    allocations.push({
      beneficiaryRole:
        "ZONAL_MANAGER",
      beneficiaryId:
        hierarchy.zonalManagerId,
      commissionAmount:
        zonalAmount,
    });

    distributedToManagers +=
      zonalAmount;
  }

  distributedToManagers =
    roundMoney(
      distributedToManagers
    );

  /*
   * Head Office yana samun:
   *
   * net profit minus commissions da
   * aka bai wa managers.
   *
   * Idan babu Agent, State ko Zone,
   * kasonsu zai kasance a Head Office.
   */
  const headOfficeProfit =
    roundMoney(
      calculatedNetProfit -
      distributedToManagers
    );

  allocations.unshift({
    beneficiaryRole: "HEAD_OFFICE",
    beneficiaryId: null,
    commissionAmount:
      headOfficeProfit,
  });

  const savedCommissions = [];

  for (
    const allocation of allocations
  ) {
    if (
      allocation.commissionAmount <= 0
    ) {
      continue;
    }

    const record =
      buildCommissionRecord({
        transaction,
        customerId:
          hierarchy.customerId,

        beneficiaryId:
          allocation.beneficiaryId,

        beneficiaryRole:
          allocation.beneficiaryRole,

        serviceType:
          normalizedServiceType,

        productCode:
          normalizedProductCode,

        productName:
          setting.productName,

        transactionAmount,
        providerCost:
          normalizedProviderCost,

        netProfit:
          calculatedNetProfit,

        commissionAmount:
          allocation.commissionAmount,

        status,
        description,
        metadata: {
          ...metadata,

          configuredAgentCommission:
            agentAmount,

          configuredStateCommission:
            stateAmount,

          configuredZonalCommission:
            zonalAmount,

          productCommissionSettingId:
            setting._id,
        },
      });

    const saved =
      await saveCommissionRecord(
        record
      );

    savedCommissions.push(saved);
  }

  const totalSaved =
    roundMoney(
      savedCommissions.reduce(
        (total, item) =>
          total +
          Number(
            item.commissionAmount || 0
          ),
        0
      )
    );

  return {
    success: true,
    distributed: true,

    serviceType:
      normalizedServiceType,

    productCode:
      normalizedProductCode,

    productName:
      setting.productName,

    transactionAmount,
    providerCost:
      normalizedProviderCost,

    netProfit:
      calculatedNetProfit,

    configuredCommissions: {
      agent: agentAmount,
      state: stateAmount,
      zonal: zonalAmount,
    },

    distributedToManagers,
    headOfficeProfit,
    totalSaved,
    commissions:
      savedCommissions,
  };
};

const reverseTransactionCommissions =
  async ({
    transactionId,
    reason =
      "Original transaction was reversed.",
  }) => {
    const normalizedTransactionId =
      normalizeObjectId(transactionId);

    if (!normalizedTransactionId) {
      throw new Error(
        "A valid transaction ID is required."
      );
    }

    const result =
      await Commission.updateMany(
        {
          transactionId:
            normalizedTransactionId,

          status: {
            $in: [
              "PENDING",
              "AVAILABLE",
            ],
          },
        },
        {
          $set: {
            status: "REVERSED",
            reversedAt: new Date(),

            "metadata.reversalReason":
              reason,
          },
        }
      );

    return {
      success: true,
      matchedCount:
        result.matchedCount || 0,
      modifiedCount:
        result.modifiedCount || 0,
    };
  };

module.exports = {
  distributeCommission,
  reverseTransactionCommissions,
  getProductCommissionSetting,
  roundMoney,
};
