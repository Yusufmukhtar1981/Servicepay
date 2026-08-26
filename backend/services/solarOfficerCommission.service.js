const mongoose = require("mongoose");

const SolarAssignment = require("../models/solarAssignment.model");
const SolarOfficerCommission = require("../models/solarOfficerCommission.model");
const SolarOfficerWallet = require("../models/solarOfficerWallet.model");
const SolarPayment = require("../models/solarPayment.model");

const roundMoney = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? Math.round((amount + Number.EPSILON) * 100) / 100
    : 0;
};

const objectId = (value) => {
  const raw = value && value._id ? value._id : value;
  return mongoose.Types.ObjectId.isValid(raw)
    ? new mongoose.Types.ObjectId(raw)
    : null;
};

const commissionTypeDetails = {
  SOLAR_SALE_2_PERCENT: { percentage: 2, status: "AVAILABLE" },
  SOLAR_DEPOSIT_5_PERCENT: { percentage: 5, status: "AVAILABLE" },
};

const createSolarOfficerCommission = async ({
  application,
  payment = null,
  type,
  officer: requestedOfficer = null,
  session,
}) => {
  const details = commissionTypeDetails[type];
  const applicationId = objectId(application?._id || application);
  if (!details || !applicationId) {
    throw new Error("A valid Solar application and commission type are required.");
  }

  const assignment = requestedOfficer
    ? null
    : await SolarAssignment.findOne({
        application: applicationId,
        status: "ACTIVE",
      }).session(session || null);
  const officerId = objectId(requestedOfficer || assignment?.officer);
  if (!officerId) {
    return { created: false, record: null, reason: "APPLICATION_UNASSIGNED" };
  }

  const customerId = objectId(application.customer);
  const paymentId = objectId(payment?._id || payment);
  const sourceKey =
    type === "SOLAR_DEPOSIT_5_PERCENT"
      ? `${type}:${String(applicationId)}:COMPLETED`
      : `${type}:${String(applicationId)}:DELIVERY`;
  let sourceAmount =
    application.approvalSnapshot?.approvedPrice ||
    application.packageSnapshot?.financedPrice ||
    application.packageSnapshot?.cashPrice;
  if (type === "SOLAR_DEPOSIT_5_PERCENT") {
    const depositTotals = await SolarPayment.aggregate([
      {
        $match: {
          application: applicationId,
          type: "DEPOSIT",
        },
      },
      { $group: { _id: null, amount: { $sum: "$amount" } } },
    ]).session(session || null);
    sourceAmount = depositTotals[0]?.amount || 0;
  }
  const baseAmount = roundMoney(sourceAmount);
  const commissionAmount = roundMoney((baseAmount * details.percentage) / 100);
  if (!customerId || baseAmount <= 0 || commissionAmount <= 0) {
    throw new Error("Solar commission source amount must be greater than zero.");
  }

  const existing = await SolarOfficerCommission.findOne({ sourceKey }).session(
    session || null
  );
  if (existing) return { created: false, record: existing };

  let record;
  try {
    [record] = await SolarOfficerCommission.create(
      [
        {
          officer: officerId,
          customer: customerId,
          application: applicationId,
          payment: paymentId,
          commissionType: type,
          sourceKey,
          baseAmount,
          percentage: details.percentage,
          commissionAmount,
          status: details.status,
          availableAt: new Date(),
          metadata: {
            authoritativePrice:
              application.approvalSnapshot?.approvedPrice ||
              application.packageSnapshot?.financedPrice ||
              application.packageSnapshot?.cashPrice ||
            null,
          },
        },
      ],
      { session }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    record = await SolarOfficerCommission.findOne({ sourceKey }).session(
      session || null
    );
    return { created: false, record };
  }

  const increment =
    record.status === "PENDING"
      ? { pendingBalance: commissionAmount, totalEarned: commissionAmount }
      : { availableBalance: commissionAmount, totalEarned: commissionAmount };
  await SolarOfficerWallet.findOneAndUpdate(
    { officer: officerId },
    { $inc: increment, $setOnInsert: { officer: officerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true, session }
  );

  return { created: true, record };
};

const reverseSolarOfficerCommission = async ({
  sourceKey,
  reason = "Qualifying Solar event was reversed.",
  session,
}) => {
  const original = await SolarOfficerCommission.findOne({
    sourceKey,
    status: { $in: ["PENDING", "AVAILABLE"] },
    lockedAmount: 0,
    paidAmount: 0,
  }).session(session || null);
  if (!original) return null;
  const commission = await SolarOfficerCommission.findOneAndUpdate(
    {
      _id: original._id,
      status: original.status,
      lockedAmount: 0,
      paidAmount: 0,
    },
    {
      $set: {
        status: "REVERSED",
        reversedAt: new Date(),
        "metadata.reversalReason": reason,
      },
    },
    { new: true, session }
  );
  if (!commission) return null;

  const amount = roundMoney(commission.commissionAmount);
  const walletUpdate =
    original.status === "AVAILABLE" && amount > 0
      ? { $inc: { availableBalance: -amount, totalEarned: -amount } }
      : { $inc: { pendingBalance: -amount, totalEarned: -amount } };
  await SolarOfficerWallet.updateOne(
    { officer: commission.officer },
    walletUpdate,
    { session }
  );
  return commission;
};

module.exports = {
  createSolarOfficerCommission,
  reverseSolarOfficerCommission,
  roundMoney,
};