const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require(
  "../models/transaction.model"
);
const { verifyTransactionPin } = require("../services/transactionPin.service");

const ELECTRICITY_PAYMENT_URL =
  "https://www.nellobytesystems.com/APIElectricityV1.asp";

const ELECTRICITY_VERIFY_URL =
  "https://www.nellobytesystems.com/APIVerifyElectricityV1.asp";

const ELECTRICITY_CALLBACK_URL =
  process.env.ELECTRICITY_CALLBACK_URL ||
  "https://api.servicepay.ng/api/electricity/callback";

const ELECTRICITY_COMPANIES = {
  "01": {
    code: "01",
    shortName: "EKEDC",
    name: "Eko Electric",
  },
  "02": {
    code: "02",
    shortName: "IKEDC",
    name: "Ikeja Electric",
  },
  "03": {
    code: "03",
    shortName: "AEDC",
    name: "Abuja Electric",
  },
  "04": {
    code: "04",
    shortName: "KEDC",
    name: "Kano Electric",
  },
  "05": {
    code: "05",
    shortName: "PHEDC",
    name: "Port Harcourt Electric",
  },
  "06": {
    code: "06",
    shortName: "JEDC",
    name: "Jos Electric",
  },
  "07": {
    code: "07",
    shortName: "IBEDC",
    name: "Ibadan Electric",
  },
  "08": {
    code: "08",
    shortName: "KAEDC",
    name: "Kaduna Electric",
  },
  "09": {
    code: "09",
    shortName: "EEDC",
    name: "Enugu Electric",
  },
  "10": {
    code: "10",
    shortName: "BEDC",
    name: "Benin Electric",
  },
  "11": {
    code: "11",
    shortName: "YEDC",
    name: "Yola Electric",
  },
  "12": {
    code: "12",
    shortName: "APLE",
    name: "Aba Electric",
  },
};

const METER_TYPES = {
  "01": {
    code: "01",
    name: "Prepaid",
  },
  "02": {
    code: "02",
    name: "Postpaid",
  },
};

const generateReference = () => {
  return `ELEC-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

const hasProviderCredentials = () => {
  return Boolean(
    process.env.NELLOBYTES_USERID &&
      process.env.NELLOBYTES_APIKEY
  );
};

const normalizeProviderData = (value) => {
  if (
    value &&
    typeof value === "object"
  ) {
    return value;
  }

  return {
    rawResponse: String(value || ""),
  };
};

const getProviderStatus = (data) => {
  return String(
    data?.status ||
      data?.orderstatus ||
      data?.orderStatus ||
      data?.statuscode ||
      data?.statusCode ||
      ""
  )
    .trim()
    .toUpperCase();
};

const getProviderMessage = (data) => {
  return String(
    data?.message ||
      data?.description ||
      data?.orderremark ||
      data?.orderRemark ||
      data?.response_description ||
      data?.responseDescription ||
      data?.status ||
      "Electricity request failed."
  ).trim();
};

const getOrderId = (data) => {
  return String(
    data?.orderid ||
      data?.orderId ||
      data?.OrderID ||
      ""
  ).trim();
};

const getMeterToken = (data) => {
  return String(
    data?.metertoken ||
      data?.meterToken ||
      data?.token ||
      data?.electricityToken ||
      ""
  ).trim();
};

const getUnits = (data) => {
  return String(
    data?.units ||
      data?.unit ||
      data?.meterUnits ||
      ""
  ).trim();
};

const providerAcceptedOrder = (
  statusCode,
  data
) => {
  if (
    statusCode < 200 ||
    statusCode >= 300
  ) {
    return false;
  }

  const status =
    getProviderStatus(data);

  const acceptedStatuses = [
    "ORDER_RECEIVED",
    "ORDER_COMPLETED",
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "200",
    "100",
  ];

  if (
    acceptedStatuses.includes(status)
  ) {
    return true;
  }

  return Boolean(
    getOrderId(data) &&
      !providerExplicitlyFailed(data)
  );
};

const providerCompletedOrder = (
  data
) => {
  const status =
    getProviderStatus(data);

  return [
    "ORDER_COMPLETED",
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "200",
  ].includes(status);
};

const providerExplicitlyFailed = (
  data
) => {
  const status =
    getProviderStatus(data);

  const failureStatuses = [
    "INVALID_CREDENTIALS",
    "MISSING_CREDENTIALS",
    "MISSING_USERID",
    "MISSING_APIKEY",
    "MISSING_ELECTRICITY",
    "MISSING_METERTYPE",
    "INVALID_METERNO",
    "INVALID_METER",
    "METERTYPE_NOT_AVAILABLE",
    "FAILED",
    "FAILURE",
    "DECLINED",
    "CANCELLED",
    "REJECTED",
    "400",
    "401",
    "403",
    "404",
  ];

  return failureStatuses.includes(
    status
  );
};

const extractCustomerName = (
  data
) => {
  return String(
    data?.customer_name ||
      data?.customerName ||
      data?.name ||
      ""
  ).trim();
};

const validateElectricityInput = ({
  electricCompany,
  meterType,
  meterNumber,
}) => {
  if (
    !ELECTRICITY_COMPANIES[
      electricCompany
    ]
  ) {
    return "Select a valid electricity company.";
  }

  if (!METER_TYPES[meterType]) {
    return "Select a valid meter type.";
  }

  if (
    !/^[A-Za-z0-9]+$/.test(
      meterNumber
    ) ||
    meterNumber.length < 5
  ) {
    return "Enter a valid meter number.";
  }

  return null;
};

const verifyMeterWithProvider =
  async ({
    electricCompany,
    meterType,
    meterNumber,
  }) => {
    const response = await axios.get(
      ELECTRICITY_VERIFY_URL,
      {
        params: {
          UserID:
            process.env
              .NELLOBYTES_USERID,

          APIKey:
            process.env
              .NELLOBYTES_APIKEY,

          ElectricCompany:
            electricCompany,

          MeterNo:
            meterNumber,

          MeterType:
            meterType,
        },

        timeout: 45000,

        validateStatus:
          () => true,
      }
    );

    const data =
      normalizeProviderData(
        response.data
      );

    return {
      statusCode:
        response.status,
      data,
      customerName:
        extractCustomerName(data),
    };
  };

const refundElectricityTransaction =
  async ({
    transactionId,
    reason,
    providerData,
  }) => {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const transaction =
        await Transaction.findOne({
          _id: transactionId,
          status: {
            $in: [
              "PENDING",
              "FAILED",
            ],
          },
        }).session(session);

      if (!transaction) {
        await session.abortTransaction();

        return null;
      }

      const refundedUser =
        await User.findByIdAndUpdate(
          transaction.customerId,
          {
            $inc: {
              walletBalance:
                transaction.amount,
            },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

      if (!refundedUser) {
        throw new Error(
          "Unable to refund customer wallet."
        );
      }

      transaction.status =
        "REFUNDED";

      transaction.providerResponse = {
        ...(transaction.providerResponse ||
          {}),

        refundReason: reason,

        refundAmount:
          transaction.amount,

        refundedAt:
          new Date(),

        providerResponse:
          providerData ||
          null,

        walletBalanceAfterRefund:
          refundedUser.walletBalance,
      };

      await transaction.save({
        session,
      });

      await session.commitTransaction();

      return {
        transaction,
        user: refundedUser,
      };
    } catch (error) {
      if (
        session.inTransaction()
      ) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  };

/*
 * GET /api/electricity/companies
 */
exports.getElectricityCompanies =
  async (req, res) => {
    return res.status(200).json({
      success: true,

      companies:
        Object.values(
          ELECTRICITY_COMPANIES
        ),

      meterTypes:
        Object.values(
          METER_TYPES
        ),

      limits: {
        minimumAmount: 1000,
        maximumAmount: 200000,
      },
    });
  };

/*
 * POST /api/electricity/verify-meter
 */
exports.verifyMeter = async (
  req,
  res
) => {
  try {
    const electricCompany =
      String(
        req.body.electricCompany ||
          ""
      ).trim();

    const meterType = String(
      req.body.meterType || ""
    ).trim();

    const meterNumber = String(
      req.body.meterNumber || ""
    ).trim();

    const validationError =
      validateElectricityInput({
        electricCompany,
        meterType,
        meterNumber,
      });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    if (
      !hasProviderCredentials()
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Electricity provider credentials are not configured.",
      });
    }

    const verification =
      await verifyMeterWithProvider({
        electricCompany,
        meterType,
        meterNumber,
      });

    const customerName =
      verification.customerName;

    if (
      !customerName ||
      customerName
        .toUpperCase()
        .includes(
          "INVALID_METER"
        )
    ) {
      return res.status(400).json({
        success: false,

        message:
          "The meter number could not be verified.",

        providerResponse:
          verification.data,
      });
    }

    const company =
      ELECTRICITY_COMPANIES[
        electricCompany
      ];

    const meter =
      METER_TYPES[meterType];

    return res.status(200).json({
      success: true,

      message:
        "Meter verified successfully.",

      customer: {
        name: customerName,

        meterNumber,

        meterType:
          meter.name,

        meterTypeCode:
          meter.code,

        electricityCompany:
          company.name,

        electricityCompanyCode:
          company.code,

        electricityCompanyShortName:
          company.shortName,
      },
    });
  } catch (error) {
    console.error(
      "Electricity meter verification error:",
      error.response?.data ||
        error.message
    );

    return res.status(500).json({
      success: false,

      message:
        "Unable to verify the meter number.",
    });
  }
};

/*
 * POST /api/electricity/pay
 */
exports.payElectricity = async (
  req,
  res
) => {
  let pendingTransaction = null;

  try {
    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    const electricCompany =
      String(
        req.body.electricCompany ||
          ""
      ).trim();

    const meterType = String(
      req.body.meterType || ""
    ).trim();

    const meterNumber = String(
      req.body.meterNumber || ""
    ).trim();

    const phoneNumber = String(
      req.body.phoneNumber || ""
    ).trim();

    const transactionPin =
      req.body.transactionPin ?? req.body.pin;

    const requestedAmount = Number(
      req.body.amount
    );

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in before paying an electricity bill.",
      });
    }

    const validationError =
      validateElectricityInput({
        electricCompany,
        meterType,
        meterNumber,
      });

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    if (
      !/^0\d{10}$/.test(
        phoneNumber
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid 11-digit phone number.",
      });
    }

    if (
      !Number.isFinite(
        requestedAmount
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid electricity amount.",
      });
    }

    const amount =
      Math.round(
        (
          requestedAmount +
          Number.EPSILON
        ) *
          100
      ) / 100;

    if (
      amount < 1000 ||
      amount > 200000
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Electricity amount must be between ₦1,000 and ₦200,000.",
      });
    }

    if (
      !hasProviderCredentials()
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Electricity provider credentials are not configured.",
      });
    }

    /*
     * Verify the meter again immediately
     * before payment.
     */
    const verification =
      await verifyMeterWithProvider({
        electricCompany,
        meterType,
        meterNumber,
      });

    const customerName =
      verification.customerName;

    if (
      !customerName ||
      customerName
        .toUpperCase()
        .includes(
          "INVALID_METER"
        )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "The meter number could not be verified. No money was deducted.",
      });
    }

    const sender =
      await User.findById(userId);

    if (!sender) {
      return res.status(404).json({
        success: false,
        message:
          "User account was not found.",
      });
    }

    if (
      String(
        sender.status || ""
      ).toUpperCase() !==
      "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is not active.",
      });
    }

    await verifyTransactionPin(sender._id, transactionPin);

    const reference =
      generateReference();

    const company =
      ELECTRICITY_COMPANIES[
        electricCompany
      ];

    const meter =
      METER_TYPES[meterType];

    /*
     * Debit wallet and save a pending
     * transaction together.
     */
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const updatedUser =
        await User.findOneAndUpdate(
          {
            _id: sender._id,
            status: "ACTIVE",
            walletBalance: {
              $gte: amount,
            },
          },
          {
            $inc: {
              walletBalance: -amount,
              totalTransactions: 1,
            },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

      if (!updatedUser) {
        await session.abortTransaction();

        return res.status(400).json({
          success: false,

          message:
            "Your wallet balance is insufficient for this electricity payment.",
        });
      }

      const transactions =
        await Transaction.create(
          [
            {
              reference,

              customerId:
                updatedUser._id,

              agentId:
                updatedUser.agentId ||
                null,

              stateManagerId:
                updatedUser
                  .stateManagerId ||
                null,

              zonalManagerId:
                updatedUser
                  .zonalManagerId ||
                null,

              serviceType:
                "ELECTRICITY",

              provider:
                "NELLOBYTES",

              phone:
                phoneNumber,

              amount,

              status:
                "PENDING",

              providerResponse: {
                requestId:
                  reference,

                customerName,

                meterNumber,

                meterType:
                  meter.name,

                meterTypeCode:
                  meter.code,

                electricityCompany:
                  company.name,

                electricityCompanyCode:
                  company.code,

                electricityCompanyShortName:
                  company.shortName,

                phoneNumber,

                walletBalanceAfter:
                  updatedUser
                    .walletBalance,

                narration:
                  `${company.shortName} electricity payment for ${meterNumber}`,

                receiptTitle:
                  "ServicePay Electricity Receipt",
              },
            },
          ],
          {
            session,
          }
        );

      pendingTransaction =
        transactions[0];

      await session.commitTransaction();
    } catch (transactionError) {
      if (
        session.inTransaction()
      ) {
        await session.abortTransaction();
      }

      throw transactionError;
    } finally {
      await session.endSession();
    }

    /*
     * Send payment request to provider.
     */
    let providerResponse;

    try {
      providerResponse =
        await axios.get(
          ELECTRICITY_PAYMENT_URL,
          {
            params: {
              UserID:
                process.env
                  .NELLOBYTES_USERID,

              APIKey:
                process.env
                  .NELLOBYTES_APIKEY,

              ElectricCompany:
                electricCompany,

              MeterType:
                meterType,

              MeterNo:
                meterNumber,

              Amount:
                amount,

              PhoneNo:
                phoneNumber,

              RequestID:
                reference,

              CallBackURL:
                ELECTRICITY_CALLBACK_URL,
            },

            timeout: 60000,

            validateStatus:
              () => true,
          }
        );
    } catch (networkError) {
      /*
       * Do not refund automatically after an
       * uncertain network error. The provider
       * may already have received the request.
       */
      await Transaction.findByIdAndUpdate(
        pendingTransaction._id,
        {
          $set: {
            status: "PENDING",

            "providerResponse.networkError":
              networkError.message,

            "providerResponse.orderStatus":
              "AWAITING_CONFIRMATION",
          },
        }
      );

      return res.status(202).json({
        success: true,

        pending: true,

        message:
          "The electricity request is awaiting provider confirmation.",

        data: {
          transactionId:
            pendingTransaction._id,

          reference,

          status:
            "PENDING",

          customerName,

          meterNumber,

          amount,
        },
      });
    }

    const providerData =
      normalizeProviderData(
        providerResponse.data
      );

    console.log(
      "Electricity provider response:",
      {
        httpStatus:
          providerResponse.status,

        data:
          providerData,

        reference,

        meterNumber,

        electricCompany,

        meterType,
      }
    );

    const accepted =
      providerAcceptedOrder(
        providerResponse.status,
        providerData
      );

    if (!accepted) {
      const failureMessage =
        getProviderMessage(
          providerData
        );

      const refund =
        await refundElectricityTransaction(
          {
            transactionId:
              pendingTransaction._id,

            reason:
              failureMessage,

            providerData,
          }
        );

      return res.status(400).json({
        success: false,

        message:
          `${failureMessage} Your wallet was refunded.`,

        data: {
          status:
            "REFUNDED",

          walletBalance:
            refund?.user
              ?.walletBalance,

          reference,
        },
      });
    }

    const completed =
      providerCompletedOrder(
        providerData
      );

    const orderId =
      getOrderId(providerData);

    const meterToken =
      getMeterToken(providerData);

    const units =
      getUnits(providerData);

    const finalStatus =
      completed
        ? "SUCCESSFUL"
        : "PENDING";

    const updatedTransaction =
      await Transaction.findByIdAndUpdate(
        pendingTransaction._id,
        {
          $set: {
            status:
              finalStatus,

            "providerResponse.orderId":
              orderId,

            "providerResponse.orderStatus":
              getProviderStatus(
                providerData
              ),

            "providerResponse.meterToken":
              meterToken,

            "providerResponse.units":
              units,

            "providerResponse.providerResponse":
              providerData,

            "providerResponse.updatedAt":
              new Date(),
          },
        },
        {
          new: true,
        }
      );

    const freshUser =
      await User.findById(
        userId
      ).select(
        "walletBalance"
      );

    return res.status(
      completed ? 200 : 202
    ).json({
      success: true,

      pending: !completed,

      message: completed
        ? "Electricity payment completed successfully."
        : "Electricity payment has been received and is being processed.",

      data: {
        transactionId:
          updatedTransaction._id,

        reference,

        orderId,

        status:
          finalStatus,

        customerName,

        meterNumber,

        meterType:
          meter.name,

        electricityCompany:
          company.name,

        electricityCompanyShortName:
          company.shortName,

        amount,

        phoneNumber,

        meterToken,

        units,

        walletBalance:
          Number(
            freshUser?.walletBalance ||
              0
          ),

        createdAt:
          updatedTransaction.createdAt,
      },
    });
  } catch (error) {
    console.error(
      "Electricity payment error:",
      error.response?.data ||
        error.message
    );

    if (error?.statusCode && [
      "INVALID_TRANSACTION_PIN",
      "TRANSACTION_PIN_NOT_SET",
      "INCORRECT_TRANSACTION_PIN",
      "USER_NOT_FOUND",
    ].includes(error.code)) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,

      message:
        "Unable to complete the electricity payment.",
    });
  }
};

/*
 * Provider callback:
 * GET/POST /api/electricity/callback
 */
exports.electricityCallback =
  async (req, res) => {
    try {
      const payload = {
        ...req.query,
        ...req.body,
      };

      const requestId =
        String(
          payload.requestid ||
            payload.requestId ||
            payload.RequestID ||
            ""
        ).trim();

      const orderId = String(
        payload.orderid ||
          payload.orderId ||
          payload.OrderID ||
          ""
      ).trim();

      const statusCode =
        String(
          payload.statuscode ||
            payload.statusCode ||
            ""
        )
          .trim()
          .toUpperCase();

      const orderStatus =
        String(
          payload.orderstatus ||
            payload.orderStatus ||
            ""
        )
          .trim()
          .toUpperCase();

      const orderRemark =
        String(
          payload.orderremark ||
            payload.orderRemark ||
            ""
        ).trim();

      const meterToken =
        getMeterToken(payload);

      const units =
        getUnits(payload);

      const filterConditions = [];

      if (requestId) {
        filterConditions.push({
          reference: requestId,
        });

        filterConditions.push({
          "providerResponse.requestId":
            requestId,
        });
      }

      if (orderId) {
        filterConditions.push({
          "providerResponse.orderId":
            orderId,
        });
      }

      if (
        filterConditions.length === 0
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Callback reference is missing.",
        });
      }

      const transaction =
        await Transaction.findOne({
          serviceType:
            "ELECTRICITY",

          $or:
            filterConditions,
        });

      if (!transaction) {
        return res.status(404).json({
          success: false,
          message:
            "Electricity transaction was not found.",
        });
      }

      const completed =
        statusCode === "200" ||
        [
          "ORDER_COMPLETED",
          "SUCCESS",
          "SUCCESSFUL",
          "COMPLETED",
        ].includes(orderStatus);

      const failed =
        [
          "FAILED",
          "FAILURE",
          "DECLINED",
          "CANCELLED",
          "REJECTED",
        ].includes(orderStatus) ||
        [
          "400",
          "401",
          "403",
          "404",
          "500",
        ].includes(statusCode);

      if (completed) {
        transaction.status =
          "SUCCESSFUL";

        transaction.providerResponse = {
          ...(transaction.providerResponse ||
            {}),

          orderId:
            orderId ||
            transaction
              .providerResponse
              ?.orderId ||
            "",

          orderStatus:
            orderStatus ||
            "ORDER_COMPLETED",

          statusCode,

          orderRemark,

          meterToken:
            meterToken ||
            transaction
              .providerResponse
              ?.meterToken ||
            "",

          units:
            units ||
            transaction
              .providerResponse
              ?.units ||
            "",

          callbackPayload:
            payload,

          callbackReceivedAt:
            new Date(),
        };

        await transaction.save();

        return res.status(200).json({
          success: true,
          message:
            "Electricity transaction completed.",
        });
      }

      if (
        failed &&
        transaction.status !==
          "REFUNDED"
      ) {
        await refundElectricityTransaction(
          {
            transactionId:
              transaction._id,

            reason:
              orderRemark ||
              orderStatus ||
              "Electricity transaction failed.",

            providerData:
              payload,
          }
        );

        return res.status(200).json({
          success: true,
          message:
            "Failed electricity payment was refunded.",
        });
      }

      transaction.status =
        "PENDING";

      transaction.providerResponse = {
        ...(transaction.providerResponse ||
          {}),

        orderId:
          orderId ||
          transaction
            .providerResponse
            ?.orderId ||
          "",

        orderStatus:
          orderStatus ||
          "PROCESSING",

        statusCode,

        orderRemark,

        callbackPayload:
          payload,

        callbackReceivedAt:
          new Date(),
      };

      await transaction.save();

      return res.status(200).json({
        success: true,
        message:
          "Electricity transaction remains pending.",
      });
    } catch (error) {
      console.error(
        "Electricity callback error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to process electricity callback.",
      });
    }
  };