const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const BankTransfer = require("../models/bankTransfer.model");

const SQUAD_BANKS = [
  { code: "000014", name: "Access Bank" },
  { code: "000010", name: "Ecobank Nigeria" },
  { code: "000003", name: "First City Monument Bank" },
  { code: "000016", name: "First Bank of Nigeria" },
  { code: "000027", name: "Globus Bank" },
  { code: "000013", name: "Guaranty Trust Bank" },
  { code: "000006", name: "Jaiz Bank" },
  { code: "000002", name: "Keystone Bank" },
  { code: "000029", name: "Lotus Bank" },
  {
    code: "120003",
    name: "MoMo Payment Service Bank",
  },
  { code: "000036", name: "Optimus Bank" },
  { code: "000008", name: "Polaris Bank" },
  { code: "000031", name: "PremiumTrust Bank" },
  { code: "000023", name: "Providus Bank" },
  { code: "000034", name: "Signature Bank" },
  {
    code: "120004",
    name: "SmartCash Payment Service Bank",
  },
  { code: "000012", name: "Stanbic IBTC Bank" },
  {
    code: "000021",
    name: "Standard Chartered Bank",
  },
  { code: "000001", name: "Sterling Bank" },
  { code: "000022", name: "SunTrust Bank" },
  { code: "000026", name: "TAJBank" },
  { code: "000025", name: "Titan Trust Bank" },
  {
    code: "000004",
    name: "United Bank for Africa",
  },
  { code: "000011", name: "Unity Bank" },
  { code: "000017", name: "Wema Bank" },
  { code: "000015", name: "Zenith Bank" },
];

const normalizeText = (value) =>
  String(value ?? "").trim();

const normalizeDigits = (value) =>
  String(value ?? "").replace(/\D/g, "");

const normalizeBankCode = (value) =>
  normalizeDigits(value).padStart(6, "0");

const parseMoney = (value) => {
  const cleanedValue = String(value ?? "")
    .replace(/[₦,\s]/g, "")
    .trim();

  const amount = Number(cleanedValue);

  if (!Number.isFinite(amount)) {
    return 0;
  }

  return (
    Math.round(
      (amount + Number.EPSILON) * 100
    ) / 100
  );
};

const isTransferEnabled = () =>
  String(
    process.env.SQUAD_TRANSFER_ENABLED || ""
  )
    .trim()
    .toLowerCase() === "true";

const getConfig = () => {
  const baseUrl = normalizeText(
    process.env.SQUAD_BASE_URL ||
      "https://api-d.squadco.com"
  ).replace(/\/+$/, "");

  const secretKey = normalizeText(
    process.env.SQUAD_SECRET_KEY
  );

  const merchantId = normalizeText(
    process.env.SQUAD_MERCHANT_ID
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const webhookSecret = normalizeText(
    process.env.SQUAD_WEBHOOK_SECRET ||
      secretKey
  );

  const minTransfer =
    parseMoney(
      process.env.SQUAD_MIN_TRANSFER
    ) || 100;

  const maxTransfer =
    parseMoney(
      process.env.SQUAD_MAX_TRANSFER
    ) || 50000;

  const transferFee = Math.max(
    0,
    parseMoney(
      process.env.SQUAD_TRANSFER_FEE
    )
  );

  return {
    baseUrl,
    secretKey,
    merchantId,
    webhookSecret,
    minTransfer,
    maxTransfer,
    transferFee,
    valid: Boolean(
      baseUrl &&
        secretKey &&
        merchantId
    ),
  };
};

const squadHeaders = (secretKey) => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${secretKey}`,
});

const generateReference = (
  merchantId
) => {
  const randomPart = crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase();

  return `${merchantId}_${Date.now()}_${randomPart}`;
};

const getLoggedInUserId = (req) =>
  req.user?._id ||
  req.user?.id ||
  req.userId ||
  null;

const getMessage = (
  payload,
  fallback
) =>
  normalizeText(
    payload?.message ||
      payload?.data?.message ||
      payload?.detail ||
      fallback
  ) || fallback;

const getPayload = (response) => {
  if (
    response?.data &&
    typeof response.data === "object"
  ) {
    return response.data;
  }

  return {
    message: String(
      response?.data ?? ""
    ),
  };
};

const readStatusText = (payload) =>
  normalizeText(
    payload?.data?.status ||
      payload?.data
        ?.transaction_status ||
      payload?.data
        ?.transactionStatus ||
      payload?.status ||
      payload?.transaction_status ||
      payload?.transactionStatus ||
      payload?.event ||
      payload?.type
  ).toUpperCase();

const readStatusCode = (
  payload,
  httpStatus = 0
) => {
  const value =
    payload?.status_code ??
    payload?.statusCode ??
    payload?.code ??
    payload?.status ??
    httpStatus;

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : httpStatus;
};

const classifySquadResponse = (
  payload,
  httpStatus = 0
) => {
  const statusCode = readStatusCode(
    payload,
    httpStatus
  );

  const statusText =
    readStatusText(payload);

  const success =
    payload?.success === true;

  if (
    statusCode === 412 ||
    statusText.includes("REVERSED") ||
    statusText.includes("REVERSAL")
  ) {
    return "REVERSED";
  }

  if (
    statusCode === 424 ||
    statusText.includes("PENDING") ||
    statusText.includes("PROCESSING") ||
    statusText.includes("TIMEOUT") ||
    statusText.includes(
      "IN PROGRESS"
    )
  ) {
    return "PENDING";
  }

  if (
    httpStatus >= 200 &&
    httpStatus < 300 &&
    (
      success ||
      statusText.includes("SUCCESS") ||
      statusText.includes(
        "COMPLETED"
      )
    )
  ) {
    return "SUCCESSFUL";
  }

  if (
    [
      400,
      401,
      403,
      404,
      409,
      422,
    ].includes(statusCode) ||
    statusText.includes("FAILED") ||
    statusText.includes("FAILURE") ||
    statusText.includes("DECLINED") ||
    statusText.includes("REJECTED") ||
    statusText.includes("ERROR")
  ) {
    return "FAILED";
  }

  if (
    httpStatus >= 500 ||
    httpStatus === 408
  ) {
    return "PENDING";
  }

  return "PENDING";
};

const extractProviderReference = (
  payload
) =>
  normalizeText(
    payload?.data
      ?.nip_transaction_reference ||
      payload?.data
        ?.nipTransactionReference ||
      payload?.data?.session_id ||
      payload?.data?.sessionId ||
      payload?.data?.reference ||
      payload
        ?.nip_transaction_reference ||
      payload?.session_id ||
      payload?.reference
  );

const extractProviderTransactionId = (
  payload
) =>
  normalizeText(
    payload?.data?.transaction_id ||
      payload?.data?.transactionId ||
      payload?.data?.id ||
      payload?.transaction_id ||
      payload?.transactionId ||
      payload?.id
  );

const extractTransactionReference = (
  payload
) =>
  normalizeText(
    payload?.data
      ?.transaction_reference ||
      payload?.data
        ?.transactionReference ||
      payload?.transaction_reference ||
      payload?.transactionReference ||
      payload?.reference
  );

const findBank = (bankCode) =>
  SQUAD_BANKS.find(
    (bank) =>
      bank.code === bankCode
  ) || null;

const lookupAccountWithSquad =
  async ({
    bankCode,
    accountNumber,
    config,
  }) => {
    const response = await axios.post(
      `${config.baseUrl}/payout/account/lookup`,
      {
        bank_code: bankCode,
        account_number:
          accountNumber,
      },
      {
        headers: squadHeaders(
          config.secretKey
        ),
        timeout: 45000,
        validateStatus: () => true,
      }
    );

    const payload =
      getPayload(response);

    const accountName =
      normalizeText(
        payload?.data?.account_name ||
          payload?.data?.accountName
      );

    const returnedAccountNumber =
      normalizeDigits(
        payload?.data
          ?.account_number ||
          payload?.data
            ?.accountNumber ||
          accountNumber
      );

    const requestSucceeded =
      response.status >= 200 &&
      response.status < 300 &&
      payload?.success === true;

    if (
      !requestSucceeded ||
      !accountName ||
      returnedAccountNumber !==
        accountNumber
    ) {
      const error = new Error(
        getMessage(
          payload,
          "Unable to verify the bank account."
        )
      );

      error.httpStatus =
        response.status >= 400
          ? response.status
          : 400;

      error.providerResponse =
        payload;

      throw error;
    }

    return {
      accountName,
      accountNumber:
        returnedAccountNumber,
      providerResponse: payload,
    };
  };

const createTransferRecords =
  async ({
    userId,
    bank,
    accountNumber,
    accountName,
    narration,
    amount,
    transferFee,
    totalDebit,
    reference,
  }) => {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const customer =
        await User.findOneAndUpdate(
          {
            _id: userId,
            status: "ACTIVE",
            walletBalance: {
              $gte: totalDebit,
            },
          },
          {
            $inc: {
              walletBalance:
                -totalDebit,
              totalTransactions: 1,
            },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

      if (!customer) {
        const error = new Error(
          "Insufficient wallet balance."
        );

        error.code =
          "INSUFFICIENT_BALANCE";

        throw error;
      }

      const createdTransactions =
        await Transaction.create(
          [
            {
              reference,
              customerId:
                customer._id,
              agentId:
                customer.agentId ||
                null,
              stateManagerId:
                customer.stateManagerId ||
                null,
              zonalManagerId:
                customer.zonalManagerId ||
                null,
              serviceType:
                "BANK_TRANSFER",
              provider: "SQUAD",
              amount: totalDebit,
              status: "PENDING",
              providerResponse: {
                transferType:
                  "BANK_TRANSFER",
                amount,
                transferFee,
                totalDebit,
                bankCode:
                  bank.code,
                bankName:
                  bank.name,
                accountNumber,
                accountName,
                narration,
              },
            },
          ],
          { session }
        );

      const transaction =
        createdTransactions[0];

      const createdRecords =
        await BankTransfer.create(
          [
            {
              sender:
                customer._id,
              transactionId:
                transaction._id,
              reference,
              provider: "SQUAD",
              bankCode:
                bank.code,
              bankName:
                bank.name,
              accountNumber,
              accountName,
              narration,
              amount,
              transferFee,
              totalDebit,
              currency: "NGN",
              status: "PENDING",
              walletBalanceAfterDebit:
                customer.walletBalance,
            },
          ],
          { session }
        );

      const record =
        createdRecords[0];

      await session.commitTransaction();

      return {
        customer,
        transaction,
        record,
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  };
  const refundBankTransfer =
  async ({
    bankTransferId,
    reason,
    providerPayload,
  }) => {
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const record =
        await BankTransfer.findOne({
          _id: bankTransferId,
          refundProcessed: false,
          status: {
            $ne: "SUCCESSFUL",
          },
        }).session(session);

      if (!record) {
        await session.abortTransaction();
        return null;
      }

      const user =
        await User.findByIdAndUpdate(
          record.sender,
          {
            $inc: {
              walletBalance:
                record.totalDebit,
            },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

      if (!user) {
        throw new Error(
          "Unable to refund the customer wallet."
        );
      }

      record.status = "REFUNDED";
      record.refundProcessed = true;
      record.refundedAmount =
        record.totalDebit;
      record.walletBalanceAfterRefund =
        user.walletBalance;
      record.refundedAt = new Date();
      record.failedAt =
        record.failedAt || new Date();
      record.failureReason =
        normalizeText(reason);
      record.providerResponse =
        providerPayload ||
        record.providerResponse;

      await record.save({ session });

      if (record.transactionId) {
        await Transaction.findByIdAndUpdate(
          record.transactionId,
          {
            status: "REFUNDED",
            providerResponse: {
              bankTransferId:
                record._id,
              transferType:
                "BANK_TRANSFER",
              bankCode:
                record.bankCode,
              bankName:
                record.bankName,
              accountNumber:
                record.accountNumber,
              accountName:
                record.accountName,
              amount:
                record.amount,
              transferFee:
                record.transferFee,
              totalDebit:
                record.totalDebit,
              refundReason:
                record.failureReason,
              refundedAmount:
                record.totalDebit,
              refundedAt:
                record.refundedAt,
              squad:
                providerPayload ||
                null,
            },
          },
          { session }
        );
      }

      await session.commitTransaction();

      return {
        record,
        user,
      };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }

      throw error;
    } finally {
      await session.endSession();
    }
  };

const markSuccessful =
  async ({
    record,
    providerPayload,
  }) => {
    if (
      record.status === "REFUNDED" ||
      record.refundProcessed
    ) {
      return record;
    }

    record.status = "SUCCESSFUL";
    record.completedAt = new Date();

    record.providerReference =
      extractProviderReference(
        providerPayload
      ) ||
      record.providerReference;

    record.providerTransactionId =
      extractProviderTransactionId(
        providerPayload
      ) ||
      record.providerTransactionId;

    record.providerResponse =
      providerPayload;

    await record.save();

    if (record.transactionId) {
      await Transaction.findByIdAndUpdate(
        record.transactionId,
        {
          status: "SUCCESSFUL",
          providerResponse: {
            bankTransferId:
              record._id,
            transferType:
              "BANK_TRANSFER",
            bankCode:
              record.bankCode,
            bankName:
              record.bankName,
            accountNumber:
              record.accountNumber,
            accountName:
              record.accountName,
            narration:
              record.narration,
            amount:
              record.amount,
            transferFee:
              record.transferFee,
            totalDebit:
              record.totalDebit,
            squad:
              providerPayload,
          },
        }
      );
    }

    return record;
  };

const markProcessing =
  async ({
    record,
    providerPayload,
  }) => {
    if (
      [
        "SUCCESSFUL",
        "REFUNDED",
      ].includes(record.status)
    ) {
      return record;
    }

    record.status = "PROCESSING";

    record.providerReference =
      extractProviderReference(
        providerPayload
      ) ||
      record.providerReference;

    record.providerTransactionId =
      extractProviderTransactionId(
        providerPayload
      ) ||
      record.providerTransactionId;

    record.providerResponse =
      providerPayload;

    await record.save();

    if (record.transactionId) {
      await Transaction.findByIdAndUpdate(
        record.transactionId,
        {
          status: "PENDING",
          providerResponse: {
            bankTransferId:
              record._id,
            transferType:
              "BANK_TRANSFER",
            bankCode:
              record.bankCode,
            bankName:
              record.bankName,
            accountNumber:
              record.accountNumber,
            accountName:
              record.accountName,
            amount:
              record.amount,
            transferFee:
              record.transferFee,
            totalDebit:
              record.totalDebit,
            squad:
              providerPayload,
          },
        }
      );
    }

    return record;
  };

exports.getBanks = async (
  req,
  res
) => {
  return res.status(200).json({
    success: true,
    message:
      "Banks retrieved successfully.",
    banks: SQUAD_BANKS,
  });
};

exports.resolveBankAccount =
  async (req, res) => {
    try {
      const config = getConfig();

      if (!config.valid) {
        return res.status(503).json({
          success: false,
          message:
            "Squad transfer credentials are not configured.",
        });
      }

      const bankCode =
        normalizeBankCode(
          req.body.bankCode
        );

      const accountNumber =
        normalizeDigits(
          req.body.accountNumber
        );

      const bank =
        findBank(bankCode);

      if (!bank) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid bank.",
        });
      }

      if (
        !/^\d{10}$/.test(
          accountNumber
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid 10-digit account number.",
        });
      }

      const lookup =
        await lookupAccountWithSquad({
          bankCode,
          accountNumber,
          config,
        });

      return res.status(200).json({
        success: true,
        message:
          "Account verified successfully.",
        data: {
          bankCode,
          bankName: bank.name,
          accountNumber:
            lookup.accountNumber,
          accountName:
            lookup.accountName,
        },
      });
    } catch (error) {
      console.error(
        "SQUAD ACCOUNT LOOKUP ERROR:",
        {
          message: error.message,
          providerResponse:
            error.providerResponse,
        }
      );

      return res
        .status(
          error.httpStatus || 500
        )
        .json({
          success: false,
          message:
            error.message ||
            "Unable to verify the bank account.",
        });
    }
  };

exports.initiateBankTransfer =
  async (req, res) => {
    let record = null;
    let customer = null;

    try {
      const config = getConfig();

      if (!config.valid) {
        return res.status(503).json({
          success: false,
          message:
            "Squad transfer credentials are not configured.",
        });
      }

      if (!isTransferEnabled()) {
        return res.status(503).json({
          success: false,
          code:
            "BANK_TRANSFER_DISABLED",
          message:
            "Bank Transfer is temporarily disabled while final testing is being completed.",
        });
      }

      const userId =
        getLoggedInUserId(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const bankCode =
        normalizeBankCode(
          req.body.bankCode
        );

      const accountNumber =
        normalizeDigits(
          req.body.accountNumber
        );

      const amount =
        parseMoney(req.body.amount);

      const pin =
        normalizeDigits(req.body.pin);

      const narration =
        normalizeText(
          req.body.narration
        ) ||
        "ServicePay bank transfer";

      const bank =
        findBank(bankCode);

      if (!bank) {
        return res.status(400).json({
          success: false,
          message:
            "Select a valid bank.",
        });
      }

      if (
        !/^\d{10}$/.test(
          accountNumber
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Enter a valid 10-digit account number.",
        });
      }

      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          message:
            "Enter your valid 4-digit transaction PIN.",
        });
      }

      if (
        amount <
          config.minTransfer ||
        amount >
          config.maxTransfer
      ) {
        return res.status(400).json({
          success: false,
          message:
            `Transfer amount must be between ₦${config.minTransfer.toFixed(
              2
            )} and ₦${config.maxTransfer.toFixed(
              2
            )}.`,
        });
      }

      if (
        narration.length > 100
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Narration must not exceed 100 characters.",
        });
      }

      const userWithPin =
        await User.findById(
          userId
        ).select(
          "+transactionPin transactionPinSet"
        );

      if (!userWithPin) {
        return res.status(404).json({
          success: false,
          message:
            "Customer account was not found.",
        });
      }

      if (
        userWithPin.status !==
        "ACTIVE"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account is not active.",
        });
      }

      if (
        !userWithPin.transactionPinSet ||
        !userWithPin.transactionPin
      ) {
        return res.status(400).json({
          success: false,
          code:
            "TRANSACTION_PIN_NOT_SET",
          message:
            "Please create your transaction PIN before making a bank transfer.",
        });
      }

      const pinIsCorrect =
        await userWithPin.compareTransactionPin(
          pin
        );

      if (!pinIsCorrect) {
        return res.status(401).json({
          success: false,
          code:
            "INCORRECT_TRANSACTION_PIN",
          message:
            "Incorrect transaction PIN.",
        });
      }

      const lookup =
        await lookupAccountWithSquad({
          bankCode,
          accountNumber,
          config,
        });

      const totalDebit =
        Math.round(
          (
            amount +
            config.transferFee +
            Number.EPSILON
          ) * 100
        ) / 100;

      const reference =
        generateReference(
          config.merchantId
        );

      const created =
        await createTransferRecords({
          userId,
          bank,
          accountNumber,
          accountName:
            lookup.accountName,
          narration,
          amount,
          transferFee:
            config.transferFee,
          totalDebit,
          reference,
        });

      customer =
        created.customer;

      record =
        created.record;

      record.providerResponse = {
        lookup:
          lookup.providerResponse,
      };

      await record.save();

      const response =
        await axios.post(
          `${config.baseUrl}/payout/transfer`,
          {
            remark: narration,
            bank_code: bankCode,
            currency_id: "NGN",
            amount: String(
              Math.round(
                amount * 100
              )
            ),
            account_number:
              accountNumber,
            transaction_reference:
              reference,
            account_name:
              lookup.accountName,
          },
          {
            headers: squadHeaders(
              config.secretKey
            ),
            timeout: 60000,
            validateStatus: () =>
              true,
          }
        );

      const payload =
        getPayload(response);

      const outcome =
        classifySquadResponse(
          payload,
          response.status
        );

      if (
        outcome ===
        "SUCCESSFUL"
      ) {
        await markSuccessful({
          record,
          providerPayload:
            payload,
        });

        return res
          .status(200)
          .json({
            success: true,
            message:
              "Bank transfer completed successfully.",
            data: {
              reference,
              status:
                "SUCCESSFUL",
              amount,
              transferFee:
                config.transferFee,
              totalDebit,
              walletBalance:
                customer.walletBalance,
              beneficiary: {
                bankCode,
                bankName:
                  bank.name,
                accountNumber,
                accountName:
                  lookup.accountName,
              },
            },
          });
      }

      if (
        outcome === "PENDING"
      ) {
        await markProcessing({
          record,
          providerPayload:
            payload,
        });

        return res
          .status(202)
          .json({
            success: true,
            message:
              "Your bank transfer is processing. Do not retry it. Check the status shortly.",
            data: {
              reference,
              status:
                "PROCESSING",
              amount,
              transferFee:
                config.transferFee,
              totalDebit,
              walletBalance:
                customer.walletBalance,
              beneficiary: {
                bankCode,
                bankName:
                  bank.name,
                accountNumber,
                accountName:
                  lookup.accountName,
              },
            },
          });
      }

      const refund =
        await refundBankTransfer({
          bankTransferId:
            record._id,
          reason: getMessage(
            payload,
            outcome === "REVERSED"
              ? "The transfer was reversed."
              : "The transfer failed."
          ),
          providerPayload:
            payload,
        });

      return res.status(400).json({
        success: false,
        message:
          "Bank transfer failed. Your wallet has been refunded.",
        reference,
        status: "REFUNDED",
        walletBalance:
          refund?.user
            ?.walletBalance ??
          customer.walletBalance,
        refundedAmount:
          totalDebit,
      });
    } catch (error) {
      console.error(
        "BANK TRANSFER ERROR:",
        {
          message: error.message,
          response:
            error.response?.data,
          code: error.code,
        }
      );

      if (record?._id) {
        try {
          const refund =
            await refundBankTransfer({
              bankTransferId:
                record._id,
              reason:
                error.message ||
                "Bank transfer failed.",
              providerPayload:
                error.response?.data ||
                {
                  message:
                    error.message,
                },
            });

          return res
            .status(500)
            .json({
              success: false,
              message:
                "Bank transfer failed. Your wallet has been refunded.",
              reference:
                record.reference,
              status:
                "REFUNDED",
              walletBalance:
                refund?.user
                  ?.walletBalance ??
                customer
                  ?.walletBalance ??
                0,
              refundedAmount:
                record.totalDebit,
            });
        } catch (
          refundError
        ) {
          console.error(
            "BANK TRANSFER REFUND ERROR:",
            refundError
          );
        }
      }

      if (
        error.code ===
        "INSUFFICIENT_BALANCE"
      ) {
        const user =
          await User.findById(
            getLoggedInUserId(req)
          ).select(
            "walletBalance"
          );

        return res.status(400).json({
          success: false,
          message:
            "Insufficient wallet balance.",
          walletBalance:
            user?.walletBalance || 0,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          "Bank transfer could not be completed.",
        error: error.message,
      });
    }
  };
  exports.requeryBankTransfer =
  async (req, res) => {
    try {
      const config = getConfig();

      if (!config.valid) {
        return res.status(503).json({
          success: false,
          message:
            "Squad transfer credentials are not configured.",
        });
      }

      const userId =
        getLoggedInUserId(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const reference =
        normalizeText(
          req.params.reference ||
            req.body.reference
        );

      if (!reference) {
        return res.status(400).json({
          success: false,
          message:
            "Transfer reference is required.",
        });
      }

      const record =
        await BankTransfer.findOne({
          sender: userId,
          reference,
        });

      if (!record) {
        return res.status(404).json({
          success: false,
          message:
            "Bank transfer record was not found.",
        });
      }

      if (
        [
          "SUCCESSFUL",
          "REFUNDED",
        ].includes(record.status)
      ) {
        const user =
          await User.findById(
            userId
          ).select("walletBalance");

        return res.status(200).json({
          success: true,
          message:
            "Bank transfer status retrieved successfully.",
          data: {
            reference:
              record.reference,
            status: record.status,
            amount: record.amount,
            transferFee:
              record.transferFee,
            totalDebit:
              record.totalDebit,
            walletBalance:
              user?.walletBalance ||
              0,
            beneficiary: {
              bankCode:
                record.bankCode,
              bankName:
                record.bankName,
              accountNumber:
                record.accountNumber,
              accountName:
                record.accountName,
            },
          },
        });
      }

      const response =
        await axios.post(
          `${config.baseUrl}/payout/requery`,
          {
            transaction_reference:
              reference,
          },
          {
            headers: squadHeaders(
              config.secretKey
            ),
            timeout: 45000,
            validateStatus: () =>
              true,
          }
        );

      const payload =
        getPayload(response);

      const outcome =
        classifySquadResponse(
          payload,
          response.status
        );

      if (
        outcome ===
        "SUCCESSFUL"
      ) {
        await markSuccessful({
          record,
          providerPayload:
            payload,
        });
      } else if (
        outcome === "FAILED" ||
        outcome === "REVERSED"
      ) {
        await refundBankTransfer({
          bankTransferId:
            record._id,
          reason: getMessage(
            payload,
            "The bank transfer failed or was reversed."
          ),
          providerPayload:
            payload,
        });
      } else {
        await markProcessing({
          record,
          providerPayload:
            payload,
        });
      }

      const refreshed =
        await BankTransfer.findById(
          record._id
        );

      const user =
        await User.findById(
          userId
        ).select("walletBalance");

      return res.status(200).json({
        success: true,
        message:
          "Bank transfer status retrieved successfully.",
        data: {
          reference:
            refreshed.reference,
          status:
            refreshed.status,
          amount:
            refreshed.amount,
          transferFee:
            refreshed.transferFee,
          totalDebit:
            refreshed.totalDebit,
          walletBalance:
            user?.walletBalance ||
            0,
          beneficiary: {
            bankCode:
              refreshed.bankCode,
            bankName:
              refreshed.bankName,
            accountNumber:
              refreshed.accountNumber,
            accountName:
              refreshed.accountName,
          },
        },
      });
    } catch (error) {
      console.error(
        "BANK TRANSFER REQUERY ERROR:",
        {
          message: error.message,
          response:
            error.response?.data,
        }
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to retrieve bank transfer status.",
      });
    }
  };

exports.getBankTransferHistory =
  async (req, res) => {
    try {
      const userId =
        getLoggedInUserId(req);

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized.",
        });
      }

      const records =
        await BankTransfer.find({
          sender: userId,
        })
          .sort({
            createdAt: -1,
          })
          .limit(50)
          .lean();

      return res.status(200).json({
        success: true,
        message:
          "Bank transfer history retrieved successfully.",
        records,
      });
    } catch (error) {
      console.error(
        "BANK TRANSFER HISTORY ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to retrieve bank transfer history.",
      });
    }
  };

const verifyWebhookSignature = ({
  rawBody,
  suppliedSignature,
  secret,
}) => {
  if (
    !rawBody ||
    !suppliedSignature ||
    !secret
  ) {
    return false;
  }

  const bodyBuffer =
    Buffer.isBuffer(rawBody)
      ? rawBody
      : Buffer.from(
          String(rawBody)
        );

  const expected = crypto
    .createHmac(
      "sha512",
      secret
    )
    .update(bodyBuffer)
    .digest("hex")
    .toLowerCase();

  const supplied = String(
    suppliedSignature
  )
    .trim()
    .toLowerCase();

  if (
    !/^[a-f0-9]+$/.test(
      supplied
    )
  ) {
    return false;
  }

  const expectedBuffer =
    Buffer.from(
      expected,
      "utf8"
    );

  const suppliedBuffer =
    Buffer.from(
      supplied,
      "utf8"
    );

  if (
    expectedBuffer.length !==
    suppliedBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    suppliedBuffer
  );
};

exports.squadWebhook =
  async (req, res) => {
    try {
      const config = getConfig();

      if (
        !config.webhookSecret
      ) {
        console.error(
          "SQUAD WEBHOOK ERROR: Webhook secret is missing."
        );

        return res.status(503).json({
          success: false,
          message:
            "Webhook secret is not configured.",
        });
      }

      const suppliedSignature =
        req.headers[
          "x-squad-encrypted-body"
        ];

      const validSignature =
        verifyWebhookSignature({
          rawBody: req.rawBody,
          suppliedSignature,
          secret:
            config.webhookSecret,
        });

      if (!validSignature) {
        console.error(
          "SQUAD WEBHOOK ERROR: Invalid signature."
        );

        return res.status(401).json({
          success: false,
          message:
            "Invalid webhook signature.",
        });
      }

      const payload =
        req.body || {};

      const reference =
        extractTransactionReference(
          payload
        );

      const providerReference =
        extractProviderReference(
          payload
        );

      const providerTransactionId =
        extractProviderTransactionId(
          payload
        );

      const clauses = [];

      if (reference) {
        clauses.push({
          reference,
        });
      }

      if (providerReference) {
        clauses.push({
          providerReference,
        });
      }

      if (
        providerTransactionId
      ) {
        clauses.push({
          providerTransactionId,
        });
      }

      if (
        clauses.length === 0
      ) {
        return res.status(200).json({
          success: true,
          message:
            "Webhook received without a transfer reference.",
        });
      }

      const record =
        await BankTransfer.findOne({
          $or: clauses,
        });

      if (!record) {
        return res.status(200).json({
          success: true,
          message:
            "Webhook received. Transfer record was not found.",
        });
      }

      record.webhookResponse =
        payload;

      await record.save();

      const outcome =
        classifySquadResponse(
          payload,
          200
        );

      if (
        outcome ===
        "SUCCESSFUL"
      ) {
        if (
          record.status !==
            "SUCCESSFUL" &&
          record.status !==
            "REFUNDED"
        ) {
          await markSuccessful({
            record,
            providerPayload:
              payload,
          });
        }
      } else if (
        outcome === "FAILED" ||
        outcome === "REVERSED"
      ) {
        if (
          record.status !==
            "SUCCESSFUL" &&
          !record.refundProcessed
        ) {
          await refundBankTransfer({
            bankTransferId:
              record._id,
            reason: getMessage(
              payload,
              "The bank transfer failed or was reversed."
            ),
            providerPayload:
              payload,
          });
        }
      } else if (
        ![
          "SUCCESSFUL",
          "REFUNDED",
        ].includes(record.status)
      ) {
        await markProcessing({
          record,
          providerPayload:
            payload,
        });
      }

      return res.status(200).json({
        success: true,
        message:
          "Webhook processed.",
      });
    } catch (error) {
      console.error(
        "SQUAD WEBHOOK ERROR:",
        {
          message: error.message,
          stack: error.stack,
        }
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to process webhook.",
      });
    }
  };