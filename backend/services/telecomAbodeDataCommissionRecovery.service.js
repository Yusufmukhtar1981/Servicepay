const crypto = require("crypto");
const mongoose = require("mongoose");

const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const { buildTelecomAbodeDataCommissionRecords } = require("./commission.service");

const EFFECT_PATH = "providerResponse.dataSuccessEffects.commission";
const EFFECT_LEASE_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1000;
const EXISTING_COMMISSION_ERROR = "EXISTING_DATA_COMMISSION_UNVERIFIED";

const safeErrorCode = (error) =>
  typeof error?.code === "string"
    ? error.code.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "DATA_COMMISSION_ERROR"
    : "DATA_COMMISSION_ERROR";

const retryDelay = (attempts) =>
  Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(attempts, 10)));

const createTelecomAbodeDataCommissionRecoveryService = ({
  transactionModel = Transaction,
  userModel = User,
  commissionModel = Commission,
  productCommissionModel = ProductCommission,
  buildCommissionRecords = buildTelecomAbodeDataCommissionRecords,
  startSession = () => mongoose.startSession(),
  afterCommissionRecord = async () => {},
  leaseMs = EFFECT_LEASE_MS,
  now = () => new Date(),
} = {}) => {
  const claimEffect = async (transactionId, leaseId, claimedAt) =>
    transactionModel.findOneAndUpdate(
      {
        _id: transactionId,
        provider: "TELECOM_ABODE",
        serviceType: "DATA",
        status: "SUCCESSFUL",
        [`${EFFECT_PATH}.key`]: { $type: "string" },
        $or: [
          {
            [`${EFFECT_PATH}.status`]: "PENDING",
            [`${EFFECT_PATH}.nextAttemptAt`]: { $lte: claimedAt },
            $or: [
              { [`${EFFECT_PATH}.leaseUntil`]: null },
              { [`${EFFECT_PATH}.leaseUntil`]: { $lte: claimedAt } },
            ],
          },
          {
            [`${EFFECT_PATH}.status`]: "RUNNING",
            [`${EFFECT_PATH}.leaseUntil`]: { $lte: claimedAt },
          },
        ],
      },
      {
        $set: {
          [`${EFFECT_PATH}.status`]: "RUNNING",
          [`${EFFECT_PATH}.leaseId`]: leaseId,
          [`${EFFECT_PATH}.leaseUntil`]: new Date(claimedAt.getTime() + leaseMs),
        },
        $inc: { [`${EFFECT_PATH}.attempts`]: 1 },
      },
      { new: true },
    ).lean();

  const releaseForRetry = async ({ claimed, leaseId, error, blocked = false }) => {
    const attempts =
      Number(claimed.providerResponse?.dataSuccessEffects?.commission?.attempts) || 1;
    await transactionModel.updateOne(
      {
        _id: claimed._id,
        provider: "TELECOM_ABODE",
        serviceType: "DATA",
        status: "SUCCESSFUL",
        [`${EFFECT_PATH}.status`]: "RUNNING",
        [`${EFFECT_PATH}.leaseId`]: leaseId,
      },
      {
        $set: {
          [`${EFFECT_PATH}.status`]: blocked ? "BLOCKED" : "PENDING",
          [`${EFFECT_PATH}.nextAttemptAt`]: new Date(
            now().getTime() + retryDelay(attempts),
          ),
          [`${EFFECT_PATH}.lastErrorCode`]: safeErrorCode(error),
          [`${EFFECT_PATH}.leaseId`]: "",
          [`${EFFECT_PATH}.leaseUntil`]: null,
        },
      },
    );
  };

  const processTelecomAbodeDataCommissionEffect = async (transactionId) => {
    await Promise.all([
      commissionModel.init(),
      productCommissionModel.init(),
    ]);
    const claimedAt = now();
    const leaseId = `${process.pid}-${crypto.randomUUID()}`;
    const claimed = await claimEffect(transactionId, leaseId, claimedAt);
    if (!claimed) {
      const existing = await transactionModel.findOne({
        _id: transactionId,
        provider: "TELECOM_ABODE",
        serviceType: "DATA",
        status: "SUCCESSFUL",
      })
        .select(`${EFFECT_PATH}.status`)
        .lean();
      const status = existing?.providerResponse?.dataSuccessEffects?.commission?.status;
      return {
        status: status === "COMPLETED"
          ? "ALREADY_COMPLETED"
          : status === "BLOCKED"
            ? "BLOCKED"
            : status || "NOT_CLAIMED",
      };
    }

    let session = null;
    try {
      session = await startSession();
      await session.withTransaction(async () => {
        const transaction = await transactionModel.findOne({
          _id: claimed._id,
          reference: claimed.reference,
          provider: "TELECOM_ABODE",
          serviceType: "DATA",
          status: "SUCCESSFUL",
          [`${EFFECT_PATH}.key`]:
            claimed.providerResponse.dataSuccessEffects.commission.key,
          [`${EFFECT_PATH}.status`]: "RUNNING",
          [`${EFFECT_PATH}.leaseId`]: leaseId,
        })
          .session(session)
          .lean();
        if (!transaction) {
          const leaseError = new Error("Telecom Abode DATA commission recovery lease was lost.");
          leaseError.code = "DATA_COMMISSION_LEASE_LOST";
          throw leaseError;
        }

        const existingCommission = await commissionModel.findOne({
          transactionId: transaction._id,
          serviceType: "DATA",
        })
          .session(session)
          .lean();
        if (existingCommission) {
          const existingError = new Error(
            "An unverified DATA commission exists without this effect's completion record.",
          );
          existingError.code = EXISTING_COMMISSION_ERROR;
          throw existingError;
        }

        const customer = await userModel.findById(transaction.customerId)
          .select("_id agentId stateManagerId zonalManagerId")
          .session(session)
          .lean();
        if (!customer) {
          const customerError = new Error("Telecom Abode DATA commission customer was not found.");
          customerError.code = "DATA_COMMISSION_CUSTOMER_NOT_FOUND";
          throw customerError;
        }

        const effect = transaction.providerResponse?.dataSuccessEffects?.commission;
        const plan = await buildCommissionRecords({
          transaction,
          customer,
          session,
          metadata: {
            network: transaction.providerResponse?.network || null,
            phone: transaction.phone,
            planCode: transaction.providerResponse?.planCode || null,
            amount: transaction.amount,
            reference: transaction.reference,
            telecomAbodeDataEffectKey: effect.key,
          },
        });

        for (const record of plan.records) {
          if (effect.createdAt) record.availableAt = effect.createdAt;
          const [saved] = await commissionModel.create([record], { session });
          await afterCommissionRecord({
            record: saved,
            transaction,
            session,
          });
          const beneficiaryId = record.beneficiaryId;
          const commissionAmount = Number(record.commissionAmount);
          if (
            beneficiaryId &&
            commissionAmount > 0 &&
            record.status === "AVAILABLE"
          ) {
            const beneficiary = await userModel.findByIdAndUpdate(
              beneficiaryId,
              {
                $inc: {
                  walletBalance: commissionAmount,
                  commissionBalance: commissionAmount,
                },
              },
              { new: true, runValidators: true, session },
            );
            if (!beneficiary) {
              const beneficiaryError = new Error(
                "Telecom Abode DATA commission beneficiary account was not found.",
              );
              beneficiaryError.code = "DATA_COMMISSION_BENEFICIARY_NOT_FOUND";
              throw beneficiaryError;
            }
          }
        }

        const completed = await transactionModel.updateOne(
          {
            _id: transaction._id,
            status: "SUCCESSFUL",
            [`${EFFECT_PATH}.key`]: effect.key,
            [`${EFFECT_PATH}.status`]: "RUNNING",
            [`${EFFECT_PATH}.leaseId`]: leaseId,
          },
          {
            $set: {
              [`${EFFECT_PATH}.status`]: "COMPLETED",
              [`${EFFECT_PATH}.completedAt`]: now(),
              [`${EFFECT_PATH}.lastErrorCode`]: "",
            },
            $unset: {
              [`${EFFECT_PATH}.leaseId`]: "",
              [`${EFFECT_PATH}.leaseUntil`]: "",
            },
          },
          { session },
        );
        if (completed.modifiedCount !== 1) {
          const completionError = new Error(
            "Telecom Abode DATA commission effect completion was not persisted.",
          );
          completionError.code = "DATA_COMMISSION_COMPLETION_NOT_PERSISTED";
          throw completionError;
        }
      });
      return { status: "COMPLETED" };
    } catch (error) {
      const blocked = safeErrorCode(error) === EXISTING_COMMISSION_ERROR;
      await releaseForRetry({ claimed, leaseId, error, blocked });
      return {
        status: blocked ? "BLOCKED" : "RETRY_PENDING",
        errorCode: safeErrorCode(error),
      };
    } finally {
      await session?.endSession();
    }
  };

  const processPendingTelecomAbodeDataCommissions = async (limit = 50) => {
    const currentTime = now();
    const pending = await transactionModel.find({
      provider: "TELECOM_ABODE",
      serviceType: "DATA",
      status: "SUCCESSFUL",
      [`${EFFECT_PATH}.key`]: { $type: "string" },
      $or: [
        {
          [`${EFFECT_PATH}.status`]: "PENDING",
          [`${EFFECT_PATH}.nextAttemptAt`]: { $lte: currentTime },
        },
        {
          [`${EFFECT_PATH}.status`]: "RUNNING",
          [`${EFFECT_PATH}.leaseUntil`]: { $lte: currentTime },
        },
      ],
    })
      .sort({ createdAt: 1, _id: 1 })
      .limit(Math.min(Number(limit) || 50, 200))
      .select("_id")
      .lean();
    return Promise.all(
      pending.map(({ _id }) => processTelecomAbodeDataCommissionEffect(_id)),
    );
  };

  return {
    processTelecomAbodeDataCommissionEffect,
    processPendingTelecomAbodeDataCommissions,
  };
};

const defaultService = createTelecomAbodeDataCommissionRecoveryService();
let workerTimer = null;

const startTelecomAbodeDataCommissionRecoveryWorker = ({ intervalMs = 5000 } = {}) => {
  if (
    workerTimer ||
    process.env.NODE_ENV === "test" ||
    process.argv.includes("--test")
  ) {
    return workerTimer;
  }
  workerTimer = setInterval(() => {
    defaultService.processPendingTelecomAbodeDataCommissions(50).catch((error) => {
      console.error("TELECOM ABODE DATA COMMISSION RECOVERY ERROR:", {
        code: safeErrorCode(error),
      });
    });
  }, intervalMs);
  workerTimer.unref?.();
  return workerTimer;
};

module.exports = {
  createTelecomAbodeDataCommissionRecoveryService,
  processTelecomAbodeDataCommissionEffect:
    defaultService.processTelecomAbodeDataCommissionEffect,
  processPendingTelecomAbodeDataCommissions:
    defaultService.processPendingTelecomAbodeDataCommissions,
  startTelecomAbodeDataCommissionRecoveryWorker,
  safeErrorCode,
};