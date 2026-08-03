const axios = require("axios");
const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const ExamPin = require("../models/examPin.model");

const {
  distributeCommission,
} = require("../services/commission.service");

const WAEC_PURCHASE_URL =
  "https://www.nellobytesystems.com/APIWAECV1.asp";

const WAEC_PACKAGES_URL =
  "https://www.nellobytesystems.com/APIWAECPackagesV2.asp";

const MAX_QUANTITY = 5;

const SUPPORTED_PRODUCTS = {
  waecdirect: {
    examType: "WAEC",
    productCode: "waecdirect",
    productName: "WAEC Result Checker PIN",
  },

  "waec-registration": {
    examType: "WAEC",
    productCode: "waec-registration",
    productName: "WAEC Registration PIN",
  },
};

const generateReference = (
  prefix = "EXAM"
) => {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

const normalizePhone = (phone) => {
  let value = String(phone || "")
    .replace(/\D/g, "");

  if (
    value.startsWith("234") &&
    value.length === 13
  ) {
    value = `0${value.substring(3)}`;
  }

  return value;
};

const getCredentials = () => {
  const userId = String(
    process.env.CLUBKONNECT_USER_ID || ""
  ).trim();

  const apiKey = String(
    process.env.CLUBKONNECT_API_KEY || ""
  ).trim();

  return {
    userId,
    apiKey,
    valid: Boolean(userId && apiKey),
  };
};

const normalizeKey = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

const parseProviderResponse = (data) => {
  if (
    data === null ||
    data === undefined
  ) {
    return {};
  }

  if (typeof data === "object") {
    return data;
  }

  const text = String(data).trim();

  try {
    return JSON.parse(text);
  } catch (_) {
    return {
      message: text,
      raw: text,
    };
  }
};

const readObjectField = (
  object,
  possibleNames
) => {
  if (
    !object ||
    typeof object !== "object"
  ) {
    return null;
  }

  const normalizedObject = {};

  for (
    const [key, value] of Object.entries(
      object
    )
  ) {
    normalizedObject[normalizeKey(key)] =
      value;
  }

  for (const name of possibleNames) {
    const value =
      normalizedObject[
        normalizeKey(name)
      ];

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {
      return value;
    }
  }

  return null;
};

const parseMoney = (value) => {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  const cleaned = String(value)
    .replace(/NGN/gi, "")
    .replace(/[₦,\s]/g, "")
    .trim();

  const number = Number(cleaned);

  return Number.isFinite(number)
    ? number
    : 0;
};

const collectObjects = (
  value,
  output = []
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectObjects(item, output);
    }

    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  output.push(value);

  for (const child of Object.values(value)) {
    if (
      child &&
      typeof child === "object"
    ) {
      collectObjects(child, output);
    }
  }

  return output;
};

const normalizeProviderProduct = (
  item
) => {
  const rawCode = readObjectField(
    item,
    [
      "code",
      "productCode",
      "product_code",
      "examType",
      "exam_type",
      "id",
      "ID",
    ]
  );

  const rawName = readObjectField(
    item,
    [
      "name",
      "productName",
      "product_name",
      "description",
      "title",
      "product",
    ]
  );

  const rawPrice = readObjectField(
    item,
    [
      "price",
      "amount",
      "productAmount",
      "product_amount",
      "sellingPrice",
      "selling_price",
      "cost",
    ]
  );

  const combinedText = [
    rawCode,
    rawName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let productCode = "";

  if (
    combinedText.includes(
      "waec-registration"
    ) ||
    combinedText.includes(
      "registration"
    )
  ) {
    productCode = "waec-registration";
  } else if (
    combinedText.includes("waecdirect") ||
    combinedText.includes(
      "result checker"
    )
  ) {
    productCode = "waecdirect";
  }

  if (
    !productCode ||
    !SUPPORTED_PRODUCTS[productCode]
  ) {
    return null;
  }

  const price = parseMoney(rawPrice);

  if (price <= 0) {
    return null;
  }

  return {
    ...SUPPORTED_PRODUCTS[productCode],
    price,
  };
};

const getProviderProducts = async () => {
  const credentials = getCredentials();

  if (!credentials.valid) {
    const error = new Error(
      "ClubKonnect credentials are not configured on the server."
    );

    error.statusCode = 503;

    throw error;
  }

  const response = await axios.get(
    WAEC_PACKAGES_URL,
    {
      params: {
        UserID: credentials.userId,
      },
      timeout: 45000,
      validateStatus: () => true,
    }
  );

  const parsed = parseProviderResponse(
    response.data
  );

  console.log(
    "WAEC PACKAGES PROVIDER RESPONSE:",
    {
      httpStatus: response.status,
      data: parsed,
    }
  );

  if (
    response.status < 200 ||
    response.status >= 300
  ) {
    const error = new Error(
      "Unable to retrieve WAEC PIN packages from the provider."
    );

    error.statusCode = 502;
    error.providerResponse = parsed;

    throw error;
  }

  const products = collectObjects(parsed)
    .map(normalizeProviderProduct)
    .filter((item) => item !== null)
    .filter(
      (item, index, array) =>
        array.findIndex(
          (other) =>
            other.productCode ===
            item.productCode
        ) === index
    );

  /*
   * Provider response structures may change.
   * These prices are only temporary fallbacks
   * based on the current live package list.
   */
  const fallbackProducts = [
    {
      ...SUPPORTED_PRODUCTS.waecdirect,
      price: 5350,
    },
    {
      ...SUPPORTED_PRODUCTS[
        "waec-registration"
      ],
      price: 37500,
    },
  ];

  return products.length > 0
    ? products
    : fallbackProducts;
};

const getProviderStatus = (data) => {
  return String(
    readObjectField(data, [
      "status",
      "statuscode",
      "statusCode",
      "response_description",
      "responseDescription",
      "remark",
      "message",
    ]) || ""
  )
    .trim()
    .toUpperCase();
};

const getProviderMessage = (data) => {
  return String(
    readObjectField(data, [
      "remark",
      "message",
      "response_description",
      "responseDescription",
      "status",
    ]) ||
      "The provider rejected this request."
  ).trim();
};

const isProviderSuccessful = (data) => {
  const statusCode = String(
    readObjectField(data, [
      "statuscode",
      "statusCode",
      "code",
    ]) || ""
  ).trim();

  const status = getProviderStatus(data);

  const failureWords = [
    "INVALID",
    "FAILED",
    "FAILURE",
    "ERROR",
    "MISSING",
    "INSUFFICIENT",
    "DECLINED",
    "REJECTED",
    "UNAUTHORIZED",
    "NOT FOUND",
    "CANCELLED",
  ];

  if (
    failureWords.some((word) =>
      status.includes(word)
    )
  ) {
    return false;
  }

  if (statusCode === "200") {
    return true;
  }

  const successWords = [
    "SUCCESS",
    "SUCCESSFUL",
    "COMPLETED",
    "ORDER_COMPLETED",
    "ORDER COMPLETED",
  ];

  return successWords.some((word) =>
    status.includes(word)
  );
};

const extractCardDetails = (data) => {
  const cardDetails = String(
    readObjectField(data, [
      "carddetails",
      "cardDetails",
      "card_detail",
      "details",
      "pinDetails",
      "pin_details",
    ]) || ""
  ).trim();

  const directPin = String(
    readObjectField(data, [
      "pin",
      "cardPin",
      "card_pin",
      "token",
    ]) || ""
  ).trim();

  const directSerial = String(
    readObjectField(data, [
      "serial",
      "serialNumber",
      "serial_number",
      "serialNo",
      "serial_no",
    ]) || ""
  ).trim();

  let pin = directPin;
  let serialNumber = directSerial;

  if (!pin && cardDetails) {
    const pinMatch = cardDetails.match(
      /(?:pin|token)\s*[:=-]\s*([A-Z0-9-]+)/i
    );

    if (pinMatch) {
      pin = pinMatch[1].trim();
    }
  }

  if (!serialNumber && cardDetails) {
    const serialMatch =
      cardDetails.match(
        /(?:serial(?:\s*(?:number|no))?)\s*[:=-]\s*([A-Z0-9-]+)/i
      );

    if (serialMatch) {
      serialNumber =
        serialMatch[1].trim();
    }
  }

  return {
    pin,
    serialNumber,
    cardDetails,
  };
};

const refundWallet = async ({
  customerId,
  amount,
  decrementTransactionCount = false,
}) => {
  if (
    !Number.isFinite(Number(amount)) ||
    Number(amount) <= 0
  ) {
    return User.findById(customerId);
  }

  const increment = {
    walletBalance: Number(amount),
  };

  if (decrementTransactionCount) {
    increment.totalTransactions = -1;
  }

  return User.findByIdAndUpdate(
    customerId,
    {
      $inc: increment,
    },
    {
      new: true,
    }
  );
};

exports.getExamPinProducts = async (
  req,
  res
) => {
  try {
    const products =
      await getProviderProducts();

    return res.status(200).json({
      success: true,
      message:
        "Exam PIN products retrieved successfully.",
      products,
    });
  } catch (error) {
    console.error(
      "GET EXAM PIN PRODUCTS ERROR:",
      error
    );

    return res
      .status(error.statusCode || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Unable to retrieve Exam PIN products.",
        providerResponse:
          error.providerResponse,
      });
  }
};

exports.buyExamPin = async (
  req,
  res
) => {
  let customer = null;
  let transaction = null;
  let purchase = null;
  let walletDebited = false;

  try {
    const credentials = getCredentials();

    if (!credentials.valid) {
      return res.status(503).json({
        success: false,
        message:
          "ClubKonnect credentials are not configured on the server.",
      });
    }

    const productCode = String(
      req.body.productCode ||
        req.body.examType ||
        ""
    )
      .trim()
      .toLowerCase();

    const phone = normalizePhone(
      req.body.phone
    );

    const quantity = Number(
      req.body.quantity || 1
    );

    if (
      !SUPPORTED_PRODUCTS[productCode]
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Select a valid WAEC PIN product.",
      });
    }

    if (
      phone.length !== 11 ||
      !phone.startsWith("0")
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Nigerian phone number.",
      });
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Quantity must be between 1 and 5.",
      });
    }

    const products =
      await getProviderProducts();

    const selectedProduct =
      products.find(
        (item) =>
          item.productCode ===
          productCode
      );

    if (!selectedProduct) {
      return res.status(400).json({
        success: false,
        message:
          "The selected WAEC PIN product is currently unavailable.",
      });
    }

    const unitAmount = Number(
      selectedProduct.price
    );

    const totalAmount =
      unitAmount * quantity;

    const reference =
      generateReference("EXAM");

    customer =
      await User.findOneAndUpdate(
        {
          _id: req.user._id,
          status: "ACTIVE",
          walletBalance: {
            $gte: totalAmount,
          },
        },
        {
          $inc: {
            walletBalance:
              -totalAmount,
            totalTransactions: 1,
          },
        },
        {
          new: true,
        }
      );

    if (!customer) {
      const existingCustomer =
        await User.findById(
          req.user._id
        );

      if (!existingCustomer) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account was not found.",
        });
      }

      if (
        existingCustomer.status !==
        "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account is not active.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance.",
        walletBalance:
          existingCustomer.walletBalance ||
          0,
        totalAmount,
      });
    }

    walletDebited = true;

    transaction =
      await Transaction.create({
        reference,
        customerId: customer._id,
        agentId:
          customer.agentId || null,
        stateManagerId:
          customer.stateManagerId ||
          null,
        zonalManagerId:
          customer.zonalManagerId ||
          null,
        serviceType: "EXAM_PIN",
        provider: "CLUBKONNECT",
        phone,
        amount: totalAmount,
        status: "PENDING",
        providerResponse: {
          productCode,
          productName:
            selectedProduct.productName,
          quantity,
          unitAmount,
        },
      });

    purchase = await ExamPin.create({
      customerId: customer._id,
      transactionId:
        transaction._id,
      reference,
      provider: "CLUBKONNECT",
      examType:
        selectedProduct.examType,
      productCode,
      productName:
        selectedProduct.productName,
      phone,
      quantity,
      unitAmount,
      totalAmount,
      status: "PENDING",
      successfulQuantity: 0,
      failedQuantity: 0,
      refundedAmount: 0,
      pins: [],
    });

    const pinItems = [];
    const providerResponses = [];

    for (
      let index = 0;
      index < quantity;
      index += 1
    ) {
      const requestId =
        `${reference}-${index + 1}`;

      try {
        const response =
          await axios.get(
            WAEC_PURCHASE_URL,
            {
              params: {
                UserID:
                  credentials.userId,
                APIKey:
                  credentials.apiKey,
                ExamType:
                  productCode,
                PhoneNo: phone,
                RequestID: requestId,
              },
              timeout: 45000,
              validateStatus: () => true,
            }
          );

        const providerResponse =
          parseProviderResponse(
            response.data
          );

        providerResponses.push({
          requestId,
          httpStatus:
            response.status,
          response:
            providerResponse,
        });

        const successful =
          response.status >= 200 &&
          response.status < 300 &&
          isProviderSuccessful(
            providerResponse
          );

        if (!successful) {
          pinItems.push({
            pin: "",
            serialNumber: "",
            cardDetails: "",
            providerOrderId: String(
              readObjectField(
                providerResponse,
                [
                  "orderid",
                  "orderId",
                ]
              ) || ""
            ),
            providerRequestId:
              requestId,
            amountCharged: 0,
            status: "FAILED",
            providerResponse,
          });

          continue;
        }

        const card =
          extractCardDetails(
            providerResponse
          );

        const providerAmount =
          parseMoney(
            readObjectField(
              providerResponse,
              [
                "amountcharged",
                "amountCharged",
                "amount",
              ]
            )
          );

        pinItems.push({
          pin: card.pin,
          serialNumber:
            card.serialNumber,
          cardDetails:
            card.cardDetails,
          providerOrderId: String(
            readObjectField(
              providerResponse,
              [
                "orderid",
                "orderId",
              ]
            ) || ""
          ),
          providerRequestId:
            requestId,
          amountCharged:
            providerAmount > 0
              ? providerAmount
              : unitAmount,
          status: "SUCCESSFUL",
          providerResponse,
        });
      } catch (providerError) {
        const failedResponse =
          providerError.response?.data ||
          {
            message:
              providerError.message,
          };

        providerResponses.push({
          requestId,
          error: failedResponse,
        });

        pinItems.push({
          pin: "",
          serialNumber: "",
          cardDetails: "",
          providerOrderId: "",
          providerRequestId:
            requestId,
          amountCharged: 0,
          status: "FAILED",
          providerResponse:
            failedResponse,
        });
      }
    }

    const successfulItems =
      pinItems.filter(
        (item) =>
          item.status ===
          "SUCCESSFUL"
      );

    const failedItems =
      pinItems.filter(
        (item) =>
          item.status === "FAILED"
      );

    const successfulQuantity =
      successfulItems.length;

    const failedQuantity =
      failedItems.length;

    const successfulAmount =
      successfulQuantity * unitAmount;

    const refundedAmount =
      failedQuantity * unitAmount;

    let updatedCustomer = customer;

    if (refundedAmount > 0) {
      updatedCustomer =
        await refundWallet({
          customerId:
            customer._id,
          amount: refundedAmount,
          decrementTransactionCount:
            successfulQuantity === 0,
        });
    }

    purchase.pins = pinItems;
    purchase.successfulQuantity =
      successfulQuantity;
    purchase.failedQuantity =
      failedQuantity;
    purchase.refundedAmount =
      refundedAmount;
    purchase.providerResponse =
      providerResponses;

    if (successfulQuantity === 0) {
      purchase.status = "REFUNDED";
      purchase.failureReason =
        "The provider could not supply any PIN.";

      transaction.status =
        "REFUNDED";
      transaction.amount =
        totalAmount;
      transaction.providerResponse = {
        productCode,
        productName:
          selectedProduct.productName,
        quantity,
        successfulQuantity,
        failedQuantity,
        refundedAmount:
          totalAmount,
        responses:
          providerResponses,
      };

      await Promise.all([
        purchase.save(),
        transaction.save(),
      ]);

      walletDebited = false;

      return res.status(400).json({
        success: false,
        message:
          "Exam PIN purchase failed. Your wallet has been refunded.",
        reference,
        status: "REFUNDED",
        walletBalance:
          updatedCustomer?.walletBalance ||
          0,
        refundedAmount:
          totalAmount,
      });
    }

    if (
      successfulQuantity < quantity
    ) {
      purchase.status =
        "PARTIALLY_SUCCESSFUL";
    } else {
      purchase.status =
        "SUCCESSFUL";
    }

    transaction.status =
      "SUCCESSFUL";
    transaction.amount =
      successfulAmount;
    transaction.providerResponse = {
      productCode,
      productName:
        selectedProduct.productName,
      quantity,
      successfulQuantity,
      failedQuantity,
      refundedAmount,
      responses:
        providerResponses,
    };

    await Promise.all([
      purchase.save(),
      transaction.save(),
    ]);

    walletDebited = false;

    try {
      const commissionResult =
        await distributeCommission({
          transaction,
          customer:
            updatedCustomer ||
            customer,
          serviceType:
            "EXAM_PIN",
          productCode,
          description:
            "Exam PIN purchase commission",
          metadata: {
            productCode,
            productName:
              selectedProduct.productName,
            phone,
            quantity:
              successfulQuantity,
            amount:
              successfulAmount,
            reference,
          },
        });

      console.log(
        "EXAM PIN COMMISSION RESULT:",
        commissionResult
      );
    } catch (commissionError) {
      console.error(
        "EXAM PIN COMMISSION ERROR:",
        commissionError
      );
    }

    return res.status(200).json({
      success: true,
      message:
        failedQuantity > 0
          ? `${successfulQuantity} PIN(s) purchased successfully. ₦${refundedAmount.toFixed(
              2
            )} was refunded for failed item(s).`
          : "Exam PIN purchase was successful.",
      reference,
      status: purchase.status,
      product: {
        examType:
          selectedProduct.examType,
        productCode,
        productName:
          selectedProduct.productName,
        unitAmount,
      },
      quantity,
      successfulQuantity,
      failedQuantity,
      amountCharged:
        successfulAmount,
      refundedAmount,
      walletBalance:
        updatedCustomer?.walletBalance ??
        customer.walletBalance,
      pins: successfulItems.map(
        (item) => ({
          pin: item.pin,
          serialNumber:
            item.serialNumber,
          cardDetails:
            item.cardDetails,
          providerOrderId:
            item.providerOrderId,
          providerRequestId:
            item.providerRequestId,
        })
      ),
    });
  } catch (error) {
    console.error(
      "BUY EXAM PIN ERROR:",
      error
    );

    if (
      walletDebited &&
      customer
    ) {
      try {
        const refundAmount =
          transaction?.amount ||
          purchase?.totalAmount ||
          0;

        const refundedCustomer =
          await refundWallet({
            customerId:
              customer._id,
            amount: refundAmount,
            decrementTransactionCount:
              true,
          });

        if (transaction) {
          transaction.status =
            "REFUNDED";

          transaction.providerResponse = {
            message:
              error.message,
            error:
              error.response?.data ||
              null,
          };

          await transaction.save();
        }

        if (purchase) {
          purchase.status =
            "REFUNDED";
          purchase.refundedAmount =
            refundAmount;
          purchase.failureReason =
            error.message;

          await purchase.save();
        }

        return res.status(500).json({
          success: false,
          message:
            "Exam PIN purchase failed. Your wallet has been refunded.",
          reference:
            transaction?.reference ||
            purchase?.reference ||
            "",
          status: "REFUNDED",
          walletBalance:
            refundedCustomer?.walletBalance ||
            0,
        });
      } catch (refundError) {
        console.error(
          "EXAM PIN REFUND ERROR:",
          refundError
        );
      }
    }

    return res.status(500).json({
      success: false,
      message:
        "Exam PIN purchase could not be completed.",
      error: error.message,
    });
  }
};

exports.getExamPinHistory = async (
  req,
  res
) => {
  try {
    const records =
      await ExamPin.find({
        customerId: req.user._id,
      })
        .sort({
          createdAt: -1,
        })
        .limit(50)
        .lean();

    return res.status(200).json({
      success: true,
      message:
        "Exam PIN history retrieved successfully.",
      count: records.length,
      records,
    });
  } catch (error) {
    console.error(
      "GET EXAM PIN HISTORY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve Exam PIN history.",
    });
  }
};

exports.getSingleExamPin = async (
  req,
  res
) => {
  try {
    const record =
      await ExamPin.findOne({
        _id: req.params.id,
        customerId: req.user._id,
      }).lean();

    if (!record) {
      return res.status(404).json({
        success: false,
        message:
          "Exam PIN purchase was not found.",
      });
    }

    return res.status(200).json({
      success: true,
      record,
    });
  } catch (error) {
    console.error(
      "GET SINGLE EXAM PIN ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to retrieve Exam PIN details.",
    });
  }
};