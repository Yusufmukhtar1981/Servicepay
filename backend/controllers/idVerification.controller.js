const axios = require("axios");
const crypto = require("crypto");
const mongoose = require("mongoose");

const IdVerification = require(
  "../models/idVerification.model"
);

const User = require(
  "../models/user.model"
);

const Transaction = require(
  "../models/transaction.model"
);

const PREMBLY_BASE_URL =
  process.env.PREMBLY_BASE_URL ||
  "https://api.prembly.com";

const verificationFees = {
  NIN: 500,
  BVN: 500,
  DRIVER_LICENSE: 700,
  PASSPORT: 700,
  VOTER_CARD: 700,
};

const supportedIdTypes =
  Object.keys(verificationFees);

const connectedIdTypes = [
  "NIN",
];

const generateVerificationReference = () => {
  return `IDV-${Date.now()}-${crypto
    .randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
};

const maskIdNumber = (
  idNumber
) => {
  const value = String(
    idNumber || ""
  ).trim();

  if (value.length <= 4) {
    return "****";
  }

  return `${"*".repeat(
    value.length - 4
  )}${value.slice(-4)}`;
};

const getPremblyRequest = (
  idType,
  idNumber
) => {
  switch (idType) {
    case "NIN":
      return {
        url:
          `${PREMBLY_BASE_URL}/verification/vnin`,

        body: {
          number_nin: idNumber,
        },
      };

    default:
      return null;
  }
};

const getPremblyHeaders = () => {
  const headers = {
    "Content-Type":
      "application/json",

    Accept:
      "application/json",

    "x-api-key":
      process.env.PREMBLY_SECRET_KEY,
  };

  /*
   * Some Prembly products require App ID.
   * Add it only when configured.
   */
  if (
    process.env.PREMBLY_APP_ID
  ) {
    headers["app-id"] =
      process.env.PREMBLY_APP_ID;
  }

  return headers;
};

const getProviderMessage = (
  providerData
) => {
  return (
    providerData?.detail ||
    providerData?.message ||
    providerData?.error ||
    providerData?.response_message ||
    providerData?.responseMessage ||
    "ID verification failed."
  );
};

const getResultData = (
  providerData
) => {
  if (
    providerData?.data &&
    typeof providerData.data ===
      "object" &&
    !Array.isArray(
      providerData.data
    )
  ) {
    return providerData.data;
  }

  if (
    providerData?.verification &&
    typeof providerData.verification ===
      "object" &&
    !Array.isArray(
      providerData.verification
    )
  ) {
    return providerData.verification;
  }

  return {};
};

const verificationWasSuccessful = (
  statusCode,
  providerData
) => {
  if (
    statusCode < 200 ||
    statusCode >= 300
  ) {
    return false;
  }

  if (
    providerData?.status === false ||
    providerData?.success === false
  ) {
    return false;
  }

  const responseCode =
    providerData?.response_code ??
    providerData?.responseCode ??
    providerData?.code;

  if (
    responseCode !== undefined &&
    responseCode !== null
  ) {
    const cleanCode =
      String(responseCode)
        .trim()
        .toUpperCase();

    const successfulCodes = [
      "00",
      "200",
      "SUCCESS",
      "SUCCESSFUL",
    ];

    if (
      !successfulCodes.includes(
        cleanCode
      )
    ) {
      return false;
    }
  }

  const verificationStatus =
    providerData?.verification
      ?.status ||
    providerData?.verification
      ?.verification_status;

  if (verificationStatus) {
    const cleanStatus =
      String(verificationStatus)
        .trim()
        .toUpperCase();

    if (
      [
        "FAILED",
        "FAILURE",
        "NOT_VERIFIED",
        "DECLINED",
      ].includes(cleanStatus)
    ) {
      return false;
    }
  }

  return Boolean(
    providerData?.status === true ||
      providerData?.success === true ||
      providerData?.data ||
      providerData?.verification
  );
};

const firstValue = (
  object,
  keys
) => {
  for (const key of keys) {
    const value =
      object?.[key];

    if (
      value === undefined ||
      value === null
    ) {
      continue;
    }

    const text =
      String(value).trim();

    if (
      text &&
      text.toLowerCase() !==
        "null"
    ) {
      return text;
    }
  }

  return "";
};

const extractIdentityResult = (
  providerData
) => {
  const resultData =
    getResultData(providerData);

  const firstName =
    firstValue(
      resultData,
      [
        "firstName",
        "firstname",
        "first_name",
        "first_name_on_nin",
      ]
    );

  const middleName =
    firstValue(
      resultData,
      [
        "middleName",
        "middlename",
        "middle_name",
      ]
    );

  const lastName =
    firstValue(
      resultData,
      [
        "lastName",
        "lastname",
        "last_name",
        "surname",
      ]
    );

  const combinedName = [
    firstName,
    middleName,
    lastName,
  ]
    .filter(Boolean)
    .join(" ");

  const fullName =
    firstValue(
      resultData,
      [
        "fullName",
        "full_name",
        "name",
      ]
    ) ||
    combinedName ||
    "Verified identity";

  const dateOfBirth =
    firstValue(
      resultData,
      [
        "dateOfBirth",
        "date_of_birth",
        "birthdate",
        "dob",
      ]
    );

  const gender =
    firstValue(
      resultData,
      [
        "gender",
        "sex",
      ]
    );

  const phone =
    firstValue(
      resultData,
      [
        "phoneNumber",
        "phone_number",
        "phone",
        "mobile",
      ]
    );

  const photo =
    firstValue(
      resultData,
      [
        "photo",
        "image",
        "base64Image",
        "photo_base64",
      ]
    );

  const address =
    firstValue(
      resultData,
      [
        "address",
        "residence_address",
        "residential_address",
      ]
    );

  return {
    fullName,
    firstName,
    middleName,
    lastName,
    dateOfBirth,
    gender,
    phone,
    photo,
    address,
  };
};

const extractProviderReference = (
  providerData
) => {
  return (
    firstValue(
      providerData?.verification ||
        {},
      [
        "reference",
        "reference_id",
        "transaction_reference",
      ]
    ) ||
    firstValue(
      providerData,
      [
        "reference",
        "reference_id",
        "transaction_reference",
        "transactionReference",
      ]
    )
  );
};

exports.verifyId = async (
  req,
  res
) => {
  let verificationRecord = null;

  try {
    const idType = String(
      req.body?.idType || ""
    )
      .trim()
      .toUpperCase();

    const idNumber = String(
      req.body?.idNumber || ""
    ).trim();

    const consent =
      req.body?.consent === true ||
      req.body?.consent ===
        "true";

    if (
      !idType ||
      !idNumber
    ) {
      return res.status(400).json({
        success: false,
        message:
          "ID type and ID number are required.",
      });
    }

    if (
      !supportedIdTypes.includes(
        idType
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Unsupported ID type.",
      });
    }

    if (!consent) {
      return res.status(400).json({
        success: false,
        message:
          "Consent is required before verification.",
      });
    }

    if (
      (
        idType === "NIN" ||
        idType === "BVN"
      ) &&
      !/^\d{11}$/.test(
        idNumber
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          `${idType} must be exactly 11 digits.`,
      });
    }

    if (
      !connectedIdTypes.includes(
        idType
      )
    ) {
      return res.status(503).json({
        success: false,
        code:
          "ID_TYPE_NOT_CONNECTED",

        message:
          `${idType} verification is coming soon. No money was deducted.`,
      });
    }

    if (
      !process.env
        .PREMBLY_SECRET_KEY
    ) {
      return res.status(503).json({
        success: false,
        message:
          "Prembly Secret Key is not configured on the server.",
      });
    }

    const userId =
      req.user?._id ||
      req.user?.id ||
      req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message:
          "Authentication failed. Please log in again.",
      });
    }

    const user =
      await User.findById(
        userId
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        message:
          "User account was not found.",
      });
    }

    const userStatus =
      String(
        user.status || ""
      )
        .trim()
        .toUpperCase();

    if (
      userStatus !== "ACTIVE"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Your account is not active.",
      });
    }

    const fee =
      verificationFees[idType];

    if (
      Number(
        user.walletBalance || 0
      ) < fee
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Insufficient wallet balance.",
        data: {
          walletBalance: Number(
            user.walletBalance || 0
          ),
          requiredAmount: fee,
        },
      });
    }

    const premblyRequest =
      getPremblyRequest(
        idType,
        idNumber
      );

    if (!premblyRequest) {
      return res.status(503).json({
        success: false,
        message:
          `${idType} verification is not connected. No money was deducted.`,
      });
    }

    /*
     * Create a pending verification record.
     * The complete ID number remains only in
     * the protected database record.
     */
    verificationRecord =
      await IdVerification.create({
        user: user._id,
        idType,
        idNumber,
        amountCharged: 0,
        consent: true,
        status: "PENDING",
        provider: "PREMBLY",
        providerReference: "",
        verificationData: {
          maskedIdNumber:
            maskIdNumber(
              idNumber
            ),
        },
        providerResponse: {},
        errorMessage: "",
      });

    const premblyResponse =
      await axios.post(
        premblyRequest.url,
        premblyRequest.body,
        {
          headers:
            getPremblyHeaders(),

          timeout: 60000,

          validateStatus:
            () => true,
        }
      );

    const providerData =
      premblyResponse.data &&
      typeof premblyResponse.data ===
        "object"
        ? premblyResponse.data
        : {
            rawResponse:
              String(
                premblyResponse.data ||
                  ""
              ),
          };

    const successful =
      verificationWasSuccessful(
        premblyResponse.status,
        providerData
      );

    if (!successful) {
      const failureMessage =
        getProviderMessage(
          providerData
        );

      verificationRecord.status =
        "FAILED";

      verificationRecord.providerResponse =
        providerData;

      verificationRecord.errorMessage =
        failureMessage;

      await verificationRecord.save();

      return res.status(
        premblyResponse.status >=
            400 &&
          premblyResponse.status <
            500
          ? premblyResponse.status
          : 400
      ).json({
        success: false,
        message:
          `${failureMessage} No money was deducted.`,
      });
    }

    const identityResult =
      extractIdentityResult(
        providerData
      );

    const providerReference =
      extractProviderReference(
        providerData
      );

    const transactionReference =
      providerReference ||
      generateVerificationReference();

    /*
     * Wallet debit, verification update and
     * transaction history are committed together.
     */
    const session =
      await mongoose.startSession();

    try {
      session.startTransaction();

      const updatedUser =
        await User.findOneAndUpdate(
          {
            _id: user._id,
            status: "ACTIVE",
            walletBalance: {
              $gte: fee,
            },
          },
          {
            $inc: {
              walletBalance: -fee,
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
        throw new Error(
          "Your wallet balance changed and is no longer sufficient. No money was deducted."
        );
      }

      const verificationData = {
        ...identityResult,

        maskedIdNumber:
          maskIdNumber(
            idNumber
          ),

        status:
          "Verified",
      };

      const updatedVerification =
        await IdVerification.findByIdAndUpdate(
          verificationRecord._id,
          {
            $set: {
              status:
                "SUCCESS",

              amountCharged:
                fee,

              provider:
                "PREMBLY",

              providerReference:
                transactionReference,

              verificationData,

              providerResponse:
                providerData,

              errorMessage:
                "",
            },
          },
          {
            new: true,
            session,
            runValidators: true,
          }
        );

      if (!updatedVerification) {
        throw new Error(
          "Unable to save the verification result."
        );
      }

      const transactions =
        await Transaction.create(
          [
            {
              reference:
                transactionReference,

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
                "ID_VERIFICATION",

              provider:
                "PREMBLY",

              phone:
                identityResult.phone ||
                updatedUser.phone ||
                null,

              amount:
                fee,

              status:
                "SUCCESSFUL",

              providerResponse: {
                verificationId:
                  updatedVerification._id,

                idType,

                maskedIdNumber:
                  verificationData
                    .maskedIdNumber,

                fullName:
                  identityResult
                    .fullName,

                dateOfBirth:
                  identityResult
                    .dateOfBirth,

                gender:
                  identityResult
                    .gender,

                phone:
                  identityResult
                    .phone,

                address:
                  identityResult
                    .address,

                providerReference:
                  transactionReference,

                narration:
                  `${idType} identity verification`,

                walletBalanceAfter:
                  updatedUser
                    .walletBalance,

                status:
                  "Verified",

                receiptTitle:
                  "ServicePay ID Verification Receipt",
              },
            },
          ],
          {
            session,
          }
        );

      const savedTransaction =
        transactions[0];

      await session.commitTransaction();

      verificationRecord =
        updatedVerification;

      return res.status(200).json({
        success: true,
        message:
          "ID verified successfully.",

        verification: {
          id:
            updatedVerification._id,

          transactionId:
            savedTransaction._id,

          idType,

          fullName:
            identityResult.fullName,

          firstName:
            identityResult.firstName,

          middleName:
            identityResult.middleName,

          lastName:
            identityResult.lastName,

          dateOfBirth:
            identityResult.dateOfBirth,

          gender:
            identityResult.gender,

          phone:
            identityResult.phone,

          address:
            identityResult.address,

          photo:
            identityResult.photo,

          maskedIdNumber:
            verificationData
              .maskedIdNumber,

          status:
            "Verified",

          amountCharged:
            fee,

          walletBalance:
            updatedUser
              .walletBalance,

          reference:
            transactionReference,

          createdAt:
            updatedVerification
              .createdAt,
        },

        data: {
          verification: {
            id:
              updatedVerification._id,

            transactionId:
              savedTransaction._id,

            idType,

            fullName:
              identityResult.fullName,

            dateOfBirth:
              identityResult
                .dateOfBirth,

            gender:
              identityResult.gender,

            phone:
              identityResult.phone,

            address:
              identityResult.address,

            photo:
              identityResult.photo,

            maskedIdNumber:
              verificationData
                .maskedIdNumber,

            status:
              "Verified",

            amountCharged:
              fee,

            walletBalance:
              updatedUser
                .walletBalance,

            reference:
              transactionReference,

            createdAt:
              updatedVerification
                .createdAt,
          },
        },
      });
    } catch (transactionError) {
      if (
        session.inTransaction()
      ) {
        await session.abortTransaction();
      }

      /*
       * Prembly verification succeeded, but
       * no wallet debit was committed.
       */
      verificationRecord.status =
        "FAILED";

      verificationRecord.amountCharged =
        0;

      verificationRecord.providerReference =
        transactionReference;

      verificationRecord.providerResponse =
        providerData;

      verificationRecord.errorMessage =
        transactionError.message;

      await verificationRecord
        .save()
        .catch(() => {});

      return res.status(400).json({
        success: false,
        message:
          transactionError.message ||
          "Unable to complete billing. No money was deducted.",
      });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error(
      "Prembly ID verification error:",
      error.response?.data ||
        error.message
    );

    if (
      verificationRecord &&
      verificationRecord.status ===
        "PENDING"
    ) {
      verificationRecord.status =
        "FAILED";

      verificationRecord.amountCharged =
        0;

      verificationRecord.errorMessage =
        error.response?.data
          ?.message ||
        error.message ||
        "Verification failed.";

      verificationRecord.providerResponse =
        error.response?.data ||
        {};

      await verificationRecord
        .save()
        .catch(() => {});
    }

    return res.status(500).json({
      success: false,
      message:
        "Unable to complete ID verification. No money was deducted.",
    });
  }
};