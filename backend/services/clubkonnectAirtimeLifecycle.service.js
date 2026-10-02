const crypto = require("crypto");
const mongoose = require("mongoose");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const LedgerEntry = require("../models/ledgerEntry.model");
const Commission = require("../models/commission.model");
const ProductCommission = require("../models/productCommission.model");
const { postDebit, reverseLedgerEntry } = require("./ledger.service");
const {
  createClubKonnectAirtimeProvider,
} = require("./clubkonnectAirtimeProvider.service");

const NETWORK_CODES = Object.freeze({
  MTN: "01",
  GLO: "02",
  "9MOBILE": "03",
  ETISALAT: "03",
  AIRTEL: "04",
  "01": "01",
  "02": "02",
  "03": "03",
  "04": "04",
});
const REQUEST_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const COMMISSION_LEASE_MS = 60_000;

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toCents = (value) => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())
  ) {
    return null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 50) return null;
  const cents = Math.round((amount + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
};

const normalizePhone = (value) => {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("234") && phone.length === 13) {
    phone = `0${phone.slice(3)}`;
  }
  return phone.length === 11 && phone.startsWith("0") ? phone : null;
};

const normalizeNetwork = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return NETWORK_CODES[normalized] || null;
};

const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const sameDigest = (left, right) => {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    !/^[a-f0-9]{64}$/i.test(left) ||
    !/^[a-f0-9]{64}$/i.test(right)
  ) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(left, "hex"),
    Buffer.from(right, "hex"),
  );
};

const buildReference = () =>
  `AIR-${Date.now()}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

const buildError = (message, status = 400, code = "AIRTIME_INVALID_REQUEST") => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const isDuplicateKey = (error) => error?.code === 11000;

const safeEvidence = (providerResult) => {
  const evidence = providerResult?.body || providerResult?.evidence;
  return {
    source: providerResult?.source || "UNKNOWN",
    reasonCode:
      String(providerResult?.reasonCode || "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 64) || "UNKNOWN",
    httpStatus: Number.isInteger(providerResult?.httpStatus)
      ? providerResult.httpStatus
      : null,
    statusCode: evidence?.statusCode || "",
    orderStatus: evidence?.orderStatus || "",
    orderId: evidence?.orderId || providerResult?.providerOrderId || "",
    requestId: evidence?.requestId || providerResult?.requestId || "",
    amountCharged:
      typeof providerResult?.providerCost === "number" &&
      Number.isFinite(providerResult.providerCost)
        ? providerResult.providerCost
        : typeof evidence?.amountCharged === "number" &&
            Number.isFinite(evidence.amountCharged) &&
            providerResult?.source !== "INITIAL_REQUEST"
          ? evidence.amountCharged
        : null,
    outcome: providerResult?.outcome || "UNKNOWN",
    authoritative: providerResult?.authoritative === true,
  };
};

const createClubKonnectAirtimeLifecycleService = ({
  provider = createClubKonnectAirtimeProvider(),
  providerName = "CLUBKONNECT",
  normalizePurchaseNetwork = normalizeNetwork,
  normalizePurchasePhone = normalizePhone,
  preparePurchase = async purchase => purchase,
  verifyAdmission = async () => {},
  models = {},
  ledger = {},
  now = () => new Date(),
  makeReference = buildReference,
  onCommissionRecoveryError = () => {},
} = {}) => {
  const UserModel = models.User || User;
  const TransactionModel = models.Transaction || Transaction;
  const CommissionModel = models.Commission || Commission;
  const ProductCommissionModel = models.ProductCommission || ProductCommission;
  const postDebitEntry = ledger.postDebit || postDebit;
  const reverseEntry = ledger.reverseLedgerEntry || reverseLedgerEntry;

  const findByIdInSession = (Model, id, session) =>
    Model.findById(id).session(session);

  const requireVersionOneDebitCustody = async (transaction, session) => {
    const lifecycle = transaction.providerResponse?.airtimeLifecycle;
    if (lifecycle?.version !== 1 || !transaction.debitLedgerEntryId) {
      throw buildError(
        "Airtime reconciliation is restricted to version 1 transactions with a persisted debit.",
        409,
        "AIRTIME_LIFECYCLE_NOT_RECONCILABLE",
      );
    }
    const debit = await findByIdInSession(
      LedgerEntry,
      transaction.debitLedgerEntryId,
      session,
    );
    if (
      !debit ||
      debit.direction !== "DEBIT" ||
      debit.status !== "POSTED" ||
      String(debit.transactionId) !== String(transaction._id) ||
      String(debit.user) !== String(transaction.customerId) ||
      debit.service !== "AIRTIME" ||
      debit.reference !== transaction.reference ||
      debit.idempotencyKey !== `AIRTIME:${transaction.reference}:DEBIT` ||
      roundMoney(debit.amount) !== roundMoney(transaction.amount)
    ) {
      throw buildError(
        "Airtime debit-ledger custody could not be verified.",
        409,
        "AIRTIME_DEBIT_CUSTODY_MISMATCH",
      );
    }
    return debit;
  };

  const findExistingRequest = async (customerId, key, session = null) => {
    let query = TransactionModel.findOne({
      customerId,
      serviceType: "AIRTIME",
      idempotencyKey: key,
    });
    if (session) query = query.session(session);
    return query;
  };

  const validatePurchase = ({
    customerId,
    network,
    phone,
    amount,
    idempotencyKey,
  }) => {
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      throw buildError("A valid customer account is required.", 401);
    }
    if (typeof idempotencyKey !== "string" || !REQUEST_KEY_PATTERN.test(idempotencyKey)) {
      throw buildError(
        "A valid Idempotency-Key header is required for Airtime purchases.",
        400,
        "AIRTIME_IDEMPOTENCY_KEY_REQUIRED",
      );
    }

    const networkCode = normalizePurchaseNetwork(network);
    if (!networkCode) {
      throw buildError("Select MTN, Glo, Airtel or 9mobile.");
    }
    const phoneNumber = normalizePurchasePhone(phone);
    if (!phoneNumber) {
      throw buildError("Enter a valid Nigerian phone number.");
    }
    const amountCents = toCents(amount);
    if (amountCents === null) {
      throw buildError("Airtime amount must be at least ₦50 with at most two decimal places.");
    }
    const requestKey = digest(idempotencyKey);
    const requestFingerprint = digest(
      JSON.stringify([networkCode, phoneNumber, amountCents]),
    );
    return {
      customerId: new mongoose.Types.ObjectId(customerId),
      networkCode,
      phoneNumber,
      amountCents,
      amount: amountCents / 100,
      requestKey,
      requestFingerprint,
    };
  };

  const assertRequestMatches = (existing, fingerprint) => {
    if (
      !sameDigest(
        existing?.providerResponse?.airtimeLifecycle?.requestFingerprint,
        fingerprint,
      )
    ) {
      throw buildError(
        "Idempotency-Key was already used with different Airtime purchase details.",
        409,
        "AIRTIME_IDEMPOTENCY_CONFLICT",
      );
    }
  };

  const admissionResult = async (transaction, created, customerId) => {
    const customer = await UserModel.findById(customerId).select("walletBalance");
    return {
      created,
      transaction,
      walletBalance: customer ? Number(customer.walletBalance) : null,
    };
  };

  const admitPurchase = async (input) => {
    const purchase = validatePurchase(input);
    const existing = await findExistingRequest(
      purchase.customerId,
      purchase.requestKey,
    );
    if (existing) {
      assertRequestMatches(existing, purchase.requestFingerprint);
      return admissionResult(existing, false, purchase.customerId);
    }

    // Keep both generated values stable across MongoDB transient transaction retries.
    const reference = makeReference();
    Object.assign(purchase, await preparePurchase(purchase, input, reference));
    const transactionId = new mongoose.Types.ObjectId();
    const createdAt = now();
    let session;
    try {
      session = await mongoose.startSession();
      const result = await session.withTransaction(async () => {
        const duplicate = await findExistingRequest(
          purchase.customerId,
          purchase.requestKey,
          session,
        );
        if (duplicate) {
          assertRequestMatches(duplicate, purchase.requestFingerprint);
          return admissionResult(duplicate, false, purchase.customerId);
        }

        const customer = await findByIdInSession(
          UserModel,
          purchase.customerId,
          session,
        ).select("_id status walletBalance agentId stateManagerId zonalManagerId");
        if (!customer) {
          throw buildError("Customer account was not found.", 404, "CUSTOMER_NOT_FOUND");
        }
        if (customer.status !== "ACTIVE") {
          throw buildError("This account is not active.", 403, "ACCOUNT_NOT_ACTIVE");
        }

        await verifyAdmission(purchase, session);
        const debitAmount = purchase.customerAmount ?? purchase.amount;
        if (
          !Number.isFinite(Number(customer.walletBalance)) ||
          Number(customer.walletBalance) < debitAmount
        ) {
          throw buildError(
            "Insufficient wallet balance.",
            400,
            "INSUFFICIENT_WALLET_BALANCE",
          );
        }

        const [transaction] = await TransactionModel.create(
          [
            {
              _id: transactionId,
              reference,
              customerId: customer._id,
              agentId: customer.agentId || null,
              stateManagerId: customer.stateManagerId || null,
              zonalManagerId: customer.zonalManagerId || null,
              serviceType: "AIRTIME",
              provider: providerName,
              phone: purchase.phoneNumber,
              amount: debitAmount,
              status: "PENDING",
              providerStatus: "UNKNOWN",
              providerRequestId: reference,
              providerReference: "",
              idempotencyKey: purchase.requestKey,
              dispatchStatus: "READY",
              dispatchClaimedAt: null,
              dispatchStartedAt: null,
              providerResponse: {
                ...(purchase.providerIntent ? { telecomAbodePurchaseIntent: purchase.providerIntent } : {}),
                airtimeLifecycle: {
                  version: 1,
                  requestFingerprint: purchase.requestFingerprint,
                  network: purchase.networkCode,
                  faceValue: purchase.amount,
                },
              },
              createdAt,
              updatedAt: createdAt,
            },
          ],
          { session },
        );

        const debitedCustomer = await UserModel.findOneAndUpdate(
          {
            _id: customer._id,
            status: "ACTIVE",
            walletBalance: { $gte: debitAmount },
          },
          {
            $inc: {
              walletBalance: -debitAmount,
              totalTransactions: 1,
            },
          },
          { returnDocument: "after", session, runValidators: true },
        );
        if (!debitedCustomer) {
          throw buildError(
            "Insufficient wallet balance.",
            400,
            "INSUFFICIENT_WALLET_BALANCE",
          );
        }

        const closingBalance = roundMoney(debitedCustomer.walletBalance);
        const openingBalance = roundMoney(closingBalance + debitAmount);
        const debit = await postDebitEntry({
          userId: customer._id,
          amount: debitAmount,
          openingBalance,
          closingBalance,
          service: "AIRTIME",
          reference,
          idempotencyKey: `AIRTIME:${reference}:DEBIT`,
          transactionId: transaction._id,
          narration: `Airtime purchase to ${purchase.phoneNumber}`,
          metadata: {
            network: purchase.networkCode,
            provider: providerName,
          },
          session,
        });
        if (!debit?.entry?._id || debit.duplicate) {
          throw new Error("Airtime debit ledger entry was not created exactly once.");
        }

        transaction.debitLedgerEntryId = debit.entry._id;
        transaction.dispatchStatus = "READY";
        await transaction.save({ session });
        return {
          created: true,
          transaction,
          walletBalance: Number(debitedCustomer.walletBalance),
        };
      });
      return result;
    } catch (error) {
      if (isDuplicateKey(error)) {
        const duplicate = await findExistingRequest(
          purchase.customerId,
          purchase.requestKey,
        );
        if (duplicate) {
          assertRequestMatches(duplicate, purchase.requestFingerprint);
          return admissionResult(duplicate, false, purchase.customerId);
        }
      }
      throw error;
    } finally {
      if (session) await session.endSession();
    }
  };

  const claimDispatch = async (transactionId) =>
    TransactionModel.findOneAndUpdate(
      {
        _id: transactionId,
        serviceType: "AIRTIME",
        provider: providerName,
        "providerResponse.airtimeLifecycle.version": 1,
        status: "PENDING",
        dispatchStatus: "READY",
        dispatchStartedAt: null,
        debitLedgerEntryId: { $ne: null },
      },
      {
        $set: {
          dispatchStatus: "CLAIMED",
          dispatchClaimedAt: now(),
        },
      },
      { returnDocument: "after" },
    );

  const markDispatchStarted = async (transactionId) =>
    TransactionModel.findOneAndUpdate(
      {
        _id: transactionId,
        serviceType: "AIRTIME",
        provider: providerName,
        "providerResponse.airtimeLifecycle.version": 1,
        status: "PENDING",
        dispatchStatus: "CLAIMED",
        dispatchStartedAt: null,
      },
      {
        $set: {
          dispatchStatus: "SENDING",
          dispatchStartedAt: now(),
        },
      },
      { returnDocument: "after" },
    );

  const terminalEvidenceConflict = (transaction) => ({
    ...transaction.toObject(),
    evidenceDisposition: "TERMINAL_CONFLICT",
  });

  const confirmsSuccess = (result, safe) => result?.outcome === "SUCCESS" &&
    result.authoritative === true && safe.httpStatus === 200 &&
    (providerName === "TELECOM_ABODE"
      ? safe.reasonCode === "CORRELATED_PROVIDER_SUCCESS"
      : safe.statusCode === "200" && safe.orderStatus === "ORDER_COMPLETED");

  const writeProviderResult = async (transactionId, providerResult) => {
    const source = providerResult?.source;
    if (!["INITIAL_REQUEST", "STATUS_QUERY", "CALLBACK_QUERY"].includes(source)) {
      throw buildError("Untrusted Airtime provider evidence was rejected.", 400, "AIRTIME_UNTRUSTED_EVIDENCE");
    }
    if (!["SUCCESS", "FAILED", "PENDING", "UNKNOWN"].includes(providerResult?.outcome)) {
      throw buildError("Airtime provider evidence has an unsupported outcome.", 400, "AIRTIME_INVALID_PROVIDER_OUTCOME");
    }

    const session = await mongoose.startSession();
    try {
      return await session.withTransaction(async () => {
        const transaction = await TransactionModel.findOne({
          _id: transactionId,
          serviceType: "AIRTIME",
          provider: providerName,
        }).session(session);
        if (!transaction) {
          throw buildError("Airtime transaction was not found.", 404, "AIRTIME_TRANSACTION_NOT_FOUND");
        }
        await requireVersionOneDebitCustody(transaction, session);
        if (source === "INITIAL_REQUEST" && !transaction.dispatchStartedAt) {
          throw buildError(
            "Airtime initial-request evidence has no persisted dispatch claim.",
            409,
            "AIRTIME_DISPATCH_CUSTODY_MISMATCH",
          );
        }
        if (!["PENDING", "SUCCESSFUL"].includes(transaction.status)) {
          return transaction;
        }

        const safe = safeEvidence(providerResult);
        if (
          safe.requestId &&
          safe.requestId !== String(transaction.providerRequestId || transaction.reference)
        ) {
          safe.reasonCode = "PROVIDER_CORRELATION_MISMATCH";
          safe.orderId = "";
          safe.amountCharged = null;
          safe.statusCode = "";
          safe.orderStatus = "";
          safe.httpStatus = null;
          safe.source = providerResult.source;
          safe.outcome = "UNKNOWN";
        }

        const currentOrderId = String(transaction.providerReference || "");
        if (
          ["STATUS_QUERY", "CALLBACK_QUERY"].includes(providerResult.source) &&
          currentOrderId &&
          safe.orderId !== currentOrderId
        ) {
          safe.reasonCode = "PROVIDER_ORDER_ID_MISMATCH";
          safe.amountCharged = null;
          safe.statusCode = "";
          safe.orderStatus = "";
          safe.outcome = "UNKNOWN";
        }

        const providerMetadata = {
          source: safe.source,
          reasonCode: safe.reasonCode,
          httpStatus: safe.httpStatus,
          statusCode: safe.statusCode,
          orderStatus: safe.orderStatus,
          orderId: safe.orderId,
          requestId: safe.requestId,
          amountCharged: safe.amountCharged,
          receivedAt: now(),
        };

        if (transaction.status === "SUCCESSFUL") {
          const recovery =
            transaction.providerResponse?.airtimeCommissionRecovery || {};
          const prior = transaction.providerResponse?.airtimeLifecycle || {};
          if (providerResult.source === "INITIAL_REQUEST") return transaction;
          if (recovery.status === "COMPLETE") {
            const duplicateTerminalSuccess =
              providerResult.outcome === "SUCCESS" &&
              providerResult.authoritative === true &&
              safe.outcome === "SUCCESS" &&
              safe.httpStatus === 200 &&
              confirmsSuccess(providerResult, safe) &&
              safe.requestId === String(transaction.providerRequestId || transaction.reference) &&
              safe.amountCharged === prior.amountCharged &&
              safe.orderId === String(prior.orderId || "");
            return duplicateTerminalSuccess
              ? transaction
              : terminalEvidenceConflict(transaction);
          }

          if (
            providerResult.outcome === "UNKNOWN" ||
            providerResult.outcome === "PENDING" ||
            providerResult.authoritative !== true
          ) {
            return transaction;
          }
          if (
            providerResult.outcome !== "SUCCESS" ||
            safe.outcome !== "SUCCESS" ||
            safe.httpStatus !== 200 ||
            !confirmsSuccess(providerResult, safe) ||
            (safe.requestId !== String(transaction.providerRequestId || transaction.reference) &&
              !(safe.requestId === "" && transaction.providerReference &&
                safe.orderId === String(transaction.providerReference)))
          ) {
            return terminalEvidenceConflict(transaction);
          }

          const priorCost =
            typeof prior.amountCharged === "number" ? prior.amountCharged : null;
          if (
            priorCost !== null &&
            priorCost !== safe.amountCharged
          ) {
            return terminalEvidenceConflict(transaction);
          }
          if (safe.amountCharged === null) return transaction;
          if (
            safe.amountCharged < 0.01 ||
            safe.amountCharged > Number(transaction.amount)
          ) {
            return terminalEvidenceConflict(transaction);
          }
          if (!["PENDING", "BLOCKED", "RUNNING"].includes(recovery.status)) {
            return transaction;
          }
          if (
            priorCost === safe.amountCharged &&
            recovery.status !== "BLOCKED"
          ) {
            return transaction;
          }

          transaction.providerResponse = {
            ...transaction.providerResponse,
            airtimeLifecycle: {
              ...prior,
              ...providerMetadata,
              amountCharged: safe.amountCharged,
            },
            airtimeCommissionRecovery: {
              ...recovery,
              status: "PENDING",
              nextAttemptAt: now(),
              leaseUntil: null,
              lastErrorCode: "",
            },
          };
          if (safe.orderId) transaction.providerReference = safe.orderId;
          await transaction.save({ session });
          return transaction;
        }

        if (
          transaction.status === "PENDING" &&
          providerResult.outcome === "SUCCESS" &&
          providerResult.authoritative === true &&
          safe.outcome !== "UNKNOWN" &&
          confirmsSuccess(providerResult, safe) &&
          (safe.requestId === String(transaction.providerRequestId || transaction.reference) ||
            Boolean(safe.orderId))
        ) {
          const charged = safe.amountCharged;
          if (
            charged !== null &&
            (charged < 0.01 || charged > Number(transaction.amount))
          ) {
            transaction.dispatchStatus = "UNKNOWN";
            transaction.providerStatus = "INVALID_AMOUNT_CHARGED";
            transaction.providerResponse = {
              ...transaction.providerResponse,
              airtimeLifecycle: {
                ...transaction.providerResponse?.airtimeLifecycle,
                ...providerMetadata,
              },
            };
            await transaction.save({ session });
            return transaction;
          }

          transaction.status = "SUCCESSFUL";
          transaction.dispatchStatus = "SUCCEEDED";
          transaction.providerStatus = providerName === "TELECOM_ABODE" ? "SUCCESS" : "ORDER_COMPLETED";
          if (safe.orderId) transaction.providerReference = safe.orderId;
          transaction.providerResponse = {
            ...transaction.providerResponse,
            airtimeLifecycle: {
              ...transaction.providerResponse?.airtimeLifecycle,
              ...providerMetadata,
            },
            airtimeCommissionRecovery: {
              status: providerName === "TELECOM_ABODE" && charged === null ? "BLOCKED" : "PENDING",
              attempts: 0,
              nextAttemptAt: now(),
              leaseUntil: null,
              lastErrorCode: "",
            },
            ...(providerName === "TELECOM_ABODE" ? { financialAccounting: {
              customerSellingPrice: Number(transaction.amount),
              providerCost: charged,
              servicePayGrossProfit: charged === null ? null : roundMoney(Number(transaction.amount) - charged),
              commission: null,
              netServicePayRevenue: null,
              status: charged === null ? "AWAITING_PROVIDER_COST" : "PENDING",
            }} : {}),
          };
          await transaction.save({ session });
          return transaction;
        }

        if (
          providerResult.outcome === "FAILED" &&
          transaction.status === "PENDING" &&
          providerResult.authoritative === true &&
          providerName === "CLUBKONNECT" &&
          ["500", "501"].includes(safe.statusCode) &&
          safe.orderStatus === "ORDER_CANCELLED"
        ) {
          return refundAndFail(transaction, providerMetadata, session);
        }

        transaction.dispatchStatus = "UNKNOWN";
        transaction.providerStatus =
          safe.orderStatus || safe.reasonCode || "UNKNOWN";
        if (safe.orderId) transaction.providerReference = safe.orderId;
        transaction.providerResponse = {
          ...transaction.providerResponse,
          airtimeLifecycle: {
            ...transaction.providerResponse?.airtimeLifecycle,
            ...providerMetadata,
            outcome:
              providerResult.outcome === "PENDING" ? "PENDING" : "UNKNOWN",
          },
        };
        await transaction.save({ session });
        return transaction;
      });
    } finally {
      await session.endSession();
    }
  };

  const refundAndFail = async (transaction, providerMetadata, session) => {
    const debitEntry = transaction.debitLedgerEntryId
      ? await findByIdInSession(
          LedgerEntry,
          transaction.debitLedgerEntryId,
          session,
        )
      : null;
    if (!debitEntry || debitEntry.direction !== "DEBIT") {
      throw new Error("Cannot refund Airtime without its canonical debit ledger entry.");
    }

    const user = await findByIdInSession(UserModel, transaction.customerId, session);
    if (!user) throw new Error("Cannot refund Airtime because the customer account is missing.");
    const openingBalance = roundMoney(user.walletBalance);
    const closingBalance = roundMoney(openingBalance + transaction.amount);
    const credited = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $inc: { walletBalance: transaction.amount } },
      { returnDocument: "after", session, runValidators: true },
    );
    if (!credited) throw new Error("Airtime refund wallet credit failed.");

    const reversal = await reverseEntry({
      originalEntryId: debitEntry._id,
      openingBalance,
      closingBalance,
      idempotencyKey: `AIRTIME:${transaction.reference}:REFUND`,
      narration: `Refund of Airtime purchase ${transaction.reference}`,
      metadata: {
        reason: "DOCUMENTED_PROVIDER_ORDER_CANCELLED",
        providerCode: providerMetadata.statusCode,
      },
      session,
    });
    if (!reversal?.entry?._id || reversal.duplicate) {
      throw new Error("Airtime refund ledger reversal was not created exactly once.");
    }

    transaction.status = "FAILED";
    transaction.dispatchStatus = "REFUNDED";
    transaction.providerStatus = "ORDER_CANCELLED";
    transaction.reversalLedgerEntryId = reversal.entry._id;
    transaction.providerResponse = {
      airtimeLifecycle: {
        ...transaction.providerResponse?.airtimeLifecycle,
        ...providerMetadata,
      },
    };
    await transaction.save({ session });
    return transaction;
  };

  const executePurchase = async (input) => {
    const admitted = await admitPurchase(input);
    if (!admitted.created) {
      return {
        ...admitted,
        dispatched: false,
      };
    }

    const claim = await claimDispatch(admitted.transaction._id);
    if (!claim) {
      return {
        created: true,
        dispatched: false,
        transaction: await TransactionModel.findById(admitted.transaction._id),
      };
    }

    // Persist this transition before the network call. No timeout/crash path
    // returns the dispatch to READY; retries can only perform status lookups.
    const sending = await markDispatchStarted(claim._id);
    if (!sending) {
      return {
        created: true,
        dispatched: false,
        transaction: await TransactionModel.findById(claim._id),
      };
    }

    let providerResult;
    try {
      const purchaseProviderRequest =
        provider.purchase || provider.submitAirtime;
      providerResult = await purchaseProviderRequest.call(provider, {
        network: sending.providerResponse?.airtimeLifecycle?.network || normalizePurchaseNetwork(input.network),
        phone: normalizePurchasePhone(input.phone),
        amount: Number(sending.providerResponse?.airtimeLifecycle?.faceValue ?? sending.amount),
        requestId: sending.providerRequestId || sending.reference,
      });
      if (providerResult.authoritative === true && !provider.isVerifiedEvidence?.(providerResult))
        throw buildError("Unverified provider evidence.", 503, "AIRTIME_UNTRUSTED_EVIDENCE");
    } catch (_error) {
      providerResult = {
        source: "INITIAL_REQUEST",
        outcome: "UNKNOWN",
        reasonCode: "PROVIDER_TRANSPORT_UNCERTAIN",
        evidence: null,
      };
    }
    const transaction = await writeProviderResult(sending._id, providerResult);
    return {
      created: true,
      dispatched: true,
      transaction,
    };
  };

  const settle = async ({ transactionId, evidence, source }) => {
    if (
      typeof provider.isVerifiedEvidence !== "function" ||
      !provider.isVerifiedEvidence(evidence)
    ) {
      throw buildError(
        "Unverified Airtime callback/request data cannot settle a transaction.",
        400,
        "AIRTIME_UNTRUSTED_EVIDENCE",
      );
    }
    const evidenceSource = evidence.source;
    const settlementSource = source || evidenceSource;
    const trustedSourcePair =
      settlementSource === evidenceSource ||
      (settlementSource === "CALLBACK_QUERY" &&
        evidenceSource === "STATUS_QUERY");
    if (
      !trustedSourcePair ||
      !["INITIAL_REQUEST", "STATUS_QUERY", "CALLBACK_QUERY"].includes(
        settlementSource,
      )
    ) {
      throw buildError(
        "Airtime settlement source does not match verified provider evidence.",
        400,
        "AIRTIME_UNTRUSTED_EVIDENCE",
      );
    }
    return writeProviderResult(transactionId, {
      ...evidence,
      source: settlementSource,
    });
  };

  const markUnknown = async (transactionId, evidence = {}) =>
    writeProviderResult(transactionId, {
      ...(evidence && typeof evidence === "object" ? evidence : {}),
      source: evidence?.source || "INITIAL_REQUEST",
      outcome: "UNKNOWN",
      authoritative: false,
      reasonCode: evidence?.reasonCode || "PROVIDER_OUTCOME_UNCERTAIN",
      providerCost: null,
      body: evidence?.body || null,
    });

  /*
   * This operation makes one authenticated provider status query and never
   * replays the paid purchase request. Expose only to a trusted reconciliation
   * path; customer request replays are intentionally read-only.
   */
  const reconcilePendingPurchase = async ({
    transactionId,
    source = "STATUS_QUERY",
  }) => {
    if (!["STATUS_QUERY", "CALLBACK_QUERY"].includes(source)) {
      throw buildError("Airtime reconciliation requires an authenticated provider query.", 400, "AIRTIME_INVALID_QUERY_SOURCE");
    }
    const transaction = await TransactionModel.findOne({
      _id: transactionId,
      provider: providerName,
      serviceType: "AIRTIME",
      status: { $in: ["PENDING", "SUCCESSFUL"] },
    });
    if (!transaction) {
      throw buildError("A pending ClubKonnect Airtime transaction was not found.", 404, "AIRTIME_TRANSACTION_NOT_PENDING");
    }
    await requireVersionOneDebitCustody(transaction);
    if (!transaction.dispatchStartedAt) {
      throw buildError(
        "Airtime status lookup requires a persisted dispatch claim.",
        409,
        "AIRTIME_DISPATCH_CUSTODY_MISMATCH",
      );
    }
    const commissionState =
      transaction.providerResponse?.airtimeCommissionRecovery?.status;
    if (
      transaction.status === "SUCCESSFUL" &&
      (commissionState === "COMPLETE" ||
        !["PENDING", "BLOCKED"].includes(commissionState))
    ) {
      return transaction;
    }
    const queryProviderStatus = provider.query || provider.queryAirtime;
    const providerResult = await queryProviderStatus.call(provider, {
      requestId: transaction.providerRequestId || transaction.reference,
      orderId: transaction.providerReference || "",
    });
    if (
      typeof provider.isVerifiedEvidence !== "function" ||
      !provider.isVerifiedEvidence(providerResult) ||
      providerResult.source !== "STATUS_QUERY"
    ) {
      throw buildError(
        "Airtime status lookup returned unverified provider evidence.",
        400,
        "AIRTIME_UNTRUSTED_EVIDENCE",
      );
    }
    return writeProviderResult(transaction._id, {
      ...providerResult,
      source,
    });
  };

  const validateCommissionPlan = async (transaction, session) => {
    const metadata = transaction.providerResponse?.airtimeLifecycle;
    const charged = metadata?.amountCharged;
    const sale = Number(transaction.amount);
    if (
      typeof charged !== "number" ||
      !Number.isFinite(charged) ||
      charged < 0.01 ||
      charged > sale
    ) {
      const error = new Error("A valid authenticated provider charge was not recorded.");
      error.code = "AIRTIME_COMMISSION_INVALID_PROVIDER_COST";
      throw error;
    }

    const setting = await ProductCommissionModel.findOne({
      serviceType: "AIRTIME",
      productCode: "AIRTIME",
      isActive: true,
    }).session(session);
    if (!setting) {
      const error = new Error("No active Airtime commission setting was found.");
      error.code = "AIRTIME_COMMISSION_SETTING_MISSING";
      throw error;
    }

    const providerCost = roundMoney(charged);
    const netProfit = roundMoney(sale - providerCost);
    const configured = {
      agent: roundMoney(setting.agentCommission || 0),
      state: roundMoney(setting.stateCommission || 0),
      zonal: roundMoney(setting.zonalCommission || 0),
    };
    if (
      Object.values(configured).some(
        (amount) => !Number.isFinite(amount) || amount < 0,
      )
    ) {
      const error = new Error("The Airtime commission setting contains invalid amounts.");
      error.code = "AIRTIME_COMMISSION_SETTING_INVALID";
      throw error;
    }
    const configuredTotal = roundMoney(
      configured.agent + configured.state + configured.zonal,
    );
    if (configuredTotal > netProfit) {
      const error = new Error("Configured Airtime commissions exceed actual provider margin.");
      error.code = "AIRTIME_COMMISSION_EXCEEDS_PROFIT";
      throw error;
    }

    const plan = [
      {
        role: "AGENT",
        beneficiaryId: transaction.agentId || null,
        amount: transaction.agentId ? configured.agent : 0,
      },
      {
        role: "STATE_MANAGER",
        beneficiaryId: transaction.stateManagerId || null,
        amount: transaction.stateManagerId ? configured.state : 0,
      },
      {
        role: "ZONAL_MANAGER",
        beneficiaryId: transaction.zonalManagerId || null,
        amount: transaction.zonalManagerId ? configured.zonal : 0,
      },
    ].filter((item) => item.amount > 0);
    const payableManagerTotal = roundMoney(
      plan.reduce((total, item) => total + item.amount, 0),
    );
    const headOffice = roundMoney(netProfit - payableManagerTotal);
    if (headOffice > 0) {
      plan.unshift({
        role: "HEAD_OFFICE",
        beneficiaryId: null,
        amount: headOffice,
      });
    }
    return { setting, providerCost, netProfit, configured, plan };
  };

  const processCommissionRecovery = async (transactionId) => {
    const leaseNow = now();
    const claimed = await TransactionModel.findOneAndUpdate(
      {
        _id: transactionId,
        serviceType: "AIRTIME",
        provider: providerName,
        "providerResponse.airtimeLifecycle.version": 1,
        status: "SUCCESSFUL",
        "providerResponse.airtimeCommissionRecovery.status": {
          $in: ["PENDING", "RUNNING"],
        },
        "providerResponse.airtimeCommissionRecovery.nextAttemptAt": {
          $lte: leaseNow,
        },
        $or: [
          { "providerResponse.airtimeCommissionRecovery.leaseUntil": null },
          {
            "providerResponse.airtimeCommissionRecovery.leaseUntil": {
              $lte: leaseNow,
            },
          },
        ],
      },
      {
        $set: {
          "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
          "providerResponse.airtimeCommissionRecovery.leaseUntil": new Date(
            leaseNow.getTime() + COMMISSION_LEASE_MS,
          ),
        },
        $inc: { "providerResponse.airtimeCommissionRecovery.attempts": 1 },
      },
      { returnDocument: "after" },
    );
    if (!claimed) return { claimed: false };

    const session = await mongoose.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const transaction = await TransactionModel.findOne({
          _id: claimed._id,
          serviceType: "AIRTIME",
          provider: providerName,
          status: "SUCCESSFUL",
          "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
        }).session(session);
        if (!transaction) return { completed: false, lostLease: true };

        let commissionPlan;
        try {
          commissionPlan = await validateCommissionPlan(transaction, session);
        } catch (error) {
          await TransactionModel.updateOne(
            { _id: transaction._id, status: "SUCCESSFUL" },
            {
              $set: {
                "providerResponse.airtimeCommissionRecovery.status": "BLOCKED",
                "providerResponse.airtimeCommissionRecovery.leaseUntil": null,
                "providerResponse.airtimeCommissionRecovery.lastErrorCode":
                  error.code || "AIRTIME_COMMISSION_VALIDATION_FAILED",
                "providerResponse.airtimeCommissionRecovery.lastErrorAt": now(),
              },
            },
            { session },
          );
          return { completed: false, blocked: true, errorCode: error.code };
        }

        if (commissionPlan.netProfit > 0 && commissionPlan.plan.length) {
          const existing = await CommissionModel.find({
            transactionId: transaction._id,
            serviceType: "AIRTIME",
          }).session(session);
          if (existing.length) {
            await TransactionModel.updateOne(
              { _id: transaction._id, status: "SUCCESSFUL" },
              {
                $set: {
                  "providerResponse.airtimeCommissionRecovery.status": "BLOCKED",
                  "providerResponse.airtimeCommissionRecovery.leaseUntil": null,
                  "providerResponse.airtimeCommissionRecovery.lastErrorCode":
                    "AIRTIME_COMMISSION_RECORD_ALREADY_EXISTS",
                  "providerResponse.airtimeCommissionRecovery.lastErrorAt": now(),
                },
              },
              { session },
            );
            return {
              completed: false,
              blocked: true,
              errorCode: "AIRTIME_COMMISSION_RECORD_ALREADY_EXISTS",
            };
          }
        }

        const recoveryMetadata = {
          airtimeReference: transaction.reference,
          providerRequestId: transaction.providerRequestId || transaction.reference,
          providerOrderId: transaction.providerReference || "",
          providerStatusCode:
            transaction.providerResponse.airtimeLifecycle.statusCode,
          actualProviderCost: commissionPlan.providerCost,
          actualNetProfit: commissionPlan.netProfit,
          commissionSettingId: commissionPlan.setting._id,
        };
        const records = commissionPlan.plan.map((item) => ({
          transactionId: transaction._id,
          customerId: transaction.customerId,
          beneficiaryId: item.beneficiaryId,
          beneficiaryRole: item.role,
          serviceType: "AIRTIME",
          transactionReference: transaction.reference,
          transactionAmount: Number(transaction.amount),
          providerCost: commissionPlan.providerCost,
          netProfit: commissionPlan.netProfit,
          commissionRate: 0,
          commissionAmount: item.amount,
          status: "AVAILABLE",
          description: "Airtime purchase commission",
          availableAt: now(),
          metadata: {
            ...recoveryMetadata,
            productCode: "AIRTIME",
            productName: commissionPlan.setting.productName,
            commissionType: "FIXED_AMOUNT",
          },
        }));

        if (records.length) {
          await CommissionModel.create(records, { session, ordered: true });
          for (const record of records) {
            if (!record.beneficiaryId || record.commissionAmount <= 0) continue;
            const credited = await UserModel.updateOne(
              { _id: record.beneficiaryId },
              {
                $inc: {
                  walletBalance: record.commissionAmount,
                  commissionBalance: record.commissionAmount,
                },
              },
              { session },
            );
            if (credited.matchedCount !== 1) {
              throw new Error("Airtime commission beneficiary account was not found.");
            }
          }
        }

        const completed = await TransactionModel.updateOne(
          {
            _id: transaction._id,
            status: "SUCCESSFUL",
            "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
          },
          {
            $set: {
              "providerResponse.airtimeCommissionRecovery.status": "COMPLETE",
              "providerResponse.airtimeCommissionRecovery.leaseUntil": null,
              "providerResponse.airtimeCommissionRecovery.completedAt": now(),
              "providerResponse.airtimeCommissionRecovery.lastErrorCode": "",
            },
          },
          { session },
        );
        if (completed.matchedCount !== 1) {
          throw new Error("Airtime commission recovery state changed during settlement.");
        }
        return {
          completed: true,
          totalCommission: roundMoney(
            records.reduce((total, record) => total + record.commissionAmount, 0),
          ),
          commissionCount: records.length,
        };
      });
      return { claimed: true, ...result };
    } catch (_error) {
      try {
        onCommissionRecoveryError(_error);
      } catch (_telemetryError) {
        // Diagnostic hooks must not alter retryable financial effects.
      }
      await TransactionModel.updateOne(
        {
          _id: claimed._id,
          "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
        },
        {
          $set: {
            "providerResponse.airtimeCommissionRecovery.status": "PENDING",
            "providerResponse.airtimeCommissionRecovery.nextAttemptAt": new Date(
              now().getTime() + 60_000,
            ),
            "providerResponse.airtimeCommissionRecovery.leaseUntil": null,
            "providerResponse.airtimeCommissionRecovery.lastErrorCode":
              "AIRTIME_COMMISSION_SETTLEMENT_RETRYABLE",
            "providerResponse.airtimeCommissionRecovery.lastErrorAt": now(),
          },
        },
      );
      return {
        claimed: true,
        completed: false,
        retryable: true,
        failureCode:
          typeof _error?.code === "string"
            ? _error.code
            : Number.isInteger(_error?.code)
              ? String(_error.code)
              : String(_error?.name || "UNKNOWN_ERROR")
                  .replace(/[^A-Za-z0-9_-]/g, "")
                  .slice(0, 64),
        errorCode: "AIRTIME_COMMISSION_SETTLEMENT_RETRYABLE",
      };
    } finally {
      await session.endSession();
    }
  };

  const processPendingCommissions = async (limit = 50) => {
    const requestedLimit = Number.isInteger(Number(limit)) ? Number(limit) : 50;
    if (requestedLimit <= 0) return { scanned: 0, results: [] };
    const boundedLimit = Math.min(100, requestedLimit);
    const candidates = await TransactionModel.find({
      serviceType: "AIRTIME",
      provider: providerName,
      "providerResponse.airtimeLifecycle.version": 1,
      status: "SUCCESSFUL",
      "providerResponse.airtimeCommissionRecovery.status": {
        $in: ["PENDING", "RUNNING"],
      },
      "providerResponse.airtimeCommissionRecovery.nextAttemptAt": {
        $lte: now(),
      },
      $or: [
        { "providerResponse.airtimeCommissionRecovery.status": "PENDING" },
        {
          "providerResponse.airtimeCommissionRecovery.status": "RUNNING",
          "providerResponse.airtimeCommissionRecovery.leaseUntil": {
            $lte: now(),
          },
        },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(boundedLimit)
      .select("_id");
    const results = [];
    for (const candidate of candidates) {
      results.push(await processCommissionRecovery(candidate._id));
    }
    return {
      scanned: candidates.length,
      results,
    };
  };

  return {
    admitPurchase,
    executePurchase,
    reconcilePendingPurchase,
    claimDispatch,
    markDispatchStarted,
    markUnknown,
    settle,
    processCommissionEffect: processCommissionRecovery,
    processPendingCommissions,
    processCommissionRecovery,
  };
};

module.exports = {
  createClubkonnectAirtimeLifecycleService:
    createClubKonnectAirtimeLifecycleService,
  createClubKonnectAirtimeLifecycleService,
  normalizeNetwork,
  normalizePhone,
  toCents,
  validateRequestKeyPattern: (key) =>
    typeof key === "string" && REQUEST_KEY_PATTERN.test(key),
};