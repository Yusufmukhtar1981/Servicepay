const crypto = require("node:crypto");
const express = require("express");
const { auth, equal, envScope } = require("./middleware/auth");
const { SandboxMockProvider } = require("./services/mockProvider");
const { signature } = require("./services/webhookDelivery");
const {
  executeIdempotent,
  hashRequest,
  IdempotencyError,
} = require("./services/idempotentOperation");

const reference = prefix =>
  `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
const publicDocument = document =>
  document?.toObject ? document.toObject() : document;
const validAmount = value => Number.isSafeInteger(value) && value > 0;

function app(
  models,
  cfg,
  provider = new SandboxMockProvider(),
  _worker,
  options = {}
) {
  const api = express();
  api.use(express.json({
    verify: (req, _res, buffer) => {
      req.rawBody = buffer;
    },
  }));

  const liveness = (_req, res) => {
    res.json({ status: "ok", environment: "SANDBOX" });
  };

  const readiness = async (_req, res) => {
    try {
      const database = models.Credential.db;
      if (database.readyState !== 1) throw new Error("database is not connected");
      await database.db.admin().ping();
      const workerState = await models.WorkerState.findOne({ name: "webhook-delivery" }).lean();
      const heartbeatAge = workerState?.heartbeatAt ? Date.now() - new Date(workerState.heartbeatAt).getTime() : Infinity;
      if (heartbeatAge > cfg.workerHeartbeatMaxAgeMs) throw new Error("webhook worker heartbeat is stale");
      res.json({ status: "ok", environment: "SANDBOX", database: "ready", webhookWorker: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable", environment: "SANDBOX" });
    }
  };

  api.get("/v1/live", liveness);
  api.get("/v1/health", readiness);
  api.get("/", readiness);

  api.use("/v1", auth(models, cfg));
  api.use("/v1", (req, res, next) => {
    const scope = req.path.startsWith("/refund")
      ? "refund:write"
      : req.path.startsWith("/subscription")
        ? "subscription:write"
        : req.path.startsWith("/reconciliation")
          ? "reconciliation:read"
          : req.method === "GET"
            ? "checkout:read"
            : "checkout:write";
    if (!req.vullCredential.scopes.includes(scope)) {
      return res.status(403).json({
        code: "SCOPE_REQUIRED",
        message: `Missing scope: ${scope}`,
      });
    }
    next();
  });

  async function createOutbox(session, credentialId, type, data) {
    const eventId = reference("evt");
    const rawBody = Buffer.from(JSON.stringify({
      environment: "SANDBOX",
      type,
      data,
    }));
    const [event] = await models.Webhook.create([{
      ...envScope,
      eventId,
      credentialId,
      type,
      rawBody,
      status: "PENDING",
    }], { session });
    return event.eventId;
  }

  async function execute(req, operation, keyOverride) {
    return executeIdempotent({
      models,
      credentialId: req.vullCredential._id,
      key: keyOverride || String(req.get("Idempotency-Key") || "").trim(),
      requestHash: hashRequest(req.method, req.path, req.body),
      operation,
      failpoints: options.failpoints || {},
    });
  }

  function sendResult(res, result) {
    if (result.replayed) res.set("Idempotent-Replay", "true");
    return res.status(result.statusCode).json(result.response);
  }

  const createCheckout = async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const {
          amountMinor,
          currency = "NGN",
          scenario = "success",
        } = req.body;
        if (!validAmount(amountMinor)) {
          return {
            statusCode: 400,
            response: {
              code: "INVALID_AMOUNT",
              message: "amountMinor must be a positive integer.",
            },
          };
        }
        if (currency !== "NGN") {
          return {
            statusCode: 400,
            response: {
              code: "UNSUPPORTED_CURRENCY",
              message: "Only NGN is supported in sandbox.",
            },
          };
        }
        let outcome;
        try {
          outcome = provider.checkout(scenario);
        } catch (error) {
          return {
            statusCode: error.statusCode === 502 ? 502 : 400,
            response: {
              code: error.statusCode === 502
                ? "SANDBOX_PROVIDER_ERROR"
                : "UNKNOWN_SCENARIO",
              message: error.statusCode === 502
                ? "The deterministic sandbox provider returned an error."
                : "Unknown sandbox scenario.",
            },
          };
        }

        const [transaction] = await models.Transaction.create([{
          ...envScope,
          credentialId: req.vullCredential._id,
          reference: reference("chk"),
          amountMinor,
          currency,
          scenario,
          status: outcome.status,
          refundable: outcome.status === "SUCCEEDED",
        }], { session });

        const outboxEventIds = [];
        if (outcome.status === "SUCCEEDED") {
          const wallet = await models.Wallet.findOneAndUpdate(
            { ...envScope, credentialId: req.vullCredential._id },
            { $inc: { balanceMinor: amountMinor } },
            { returnDocument: "after", session }
          );
          if (!wallet) throw new Error("wallet_missing");
          await models.Ledger.create([{
            ...envScope,
            walletId: wallet._id,
            transactionId: transaction._id,
            direction: "CREDIT",
            amountMinor,
            openingBalanceMinor: wallet.balanceMinor - amountMinor,
            closingBalanceMinor: wallet.balanceMinor,
            reference: transaction.reference,
            idempotencyKey: `checkout:${transaction.reference}`,
          }], { session });
          outboxEventIds.push(await createOutbox(
            session,
            req.vullCredential._id,
            "checkout.succeeded",
            { reference: transaction.reference, amountMinor }
          ));
        }
        return {
          statusCode: 201,
          response: {
            environment: "SANDBOX",
            checkout: publicDocument(transaction),
          },
          outboxEventIds,
        };
      });
      return sendResult(res, result);
    } catch (error) {
      next(error);
    }
  };

  api.post("/v1/checkouts", createCheckout);
  api.post("/v1/payments", createCheckout);

  async function list(model, credentialId, req, field) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { ...envScope, credentialId };
    const [items, total] = await Promise.all([
      model.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      model.countDocuments(filter),
    ]);
    return { environment: "SANDBOX", [field]: items, page, limit, total };
  }
  api.get("/v1/checkouts", async (req, res) =>
    res.json(await list(models.Transaction, req.vullCredential._id, req, "checkouts")));
  api.get("/v1/payments", async (req, res) =>
    res.json(await list(models.Transaction, req.vullCredential._id, req, "payments")));

  const getCheckout = async (req, res) => {
    const transaction = await models.Transaction.findOne({
      ...envScope,
      credentialId: req.vullCredential._id,
      reference: req.params.reference,
    });
    return transaction
      ? res.json({ environment: "SANDBOX", checkout: transaction })
      : res.status(404).json({ code: "NOT_FOUND", message: "Checkout not found." });
  };
  api.get("/v1/checkouts/:reference", getCheckout);
  api.get("/v1/payments/:reference", getCheckout);
  api.post("/v1/checkouts/:reference/verify", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const transaction = await models.Transaction.findOne({
          ...envScope,
          credentialId: req.vullCredential._id,
          reference: req.params.reference,
        }).session(session);
        return transaction
          ? { statusCode: 200, response: { environment: "SANDBOX", checkout: publicDocument(transaction) } }
          : { statusCode: 404, response: { code: "NOT_FOUND", message: "Checkout not found." } };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });

  api.post("/v1/refunds", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const transaction = await models.Transaction.findOneAndUpdate(
          {
            ...envScope,
            credentialId: req.vullCredential._id,
            reference: req.body.checkoutReference,
            status: "SUCCEEDED",
            refundable: true,
          },
          { $set: { refundable: false } },
          { returnDocument: "after", session }
        );
        if (!transaction) {
          return {
            statusCode: 409,
            response: {
              code: "NOT_REFUNDABLE",
              message: "Checkout is not refundable.",
            },
          };
        }
        const wallet = await models.Wallet.findOneAndUpdate(
          {
            ...envScope,
            credentialId: req.vullCredential._id,
            balanceMinor: { $gte: transaction.amountMinor },
          },
          { $inc: { balanceMinor: -transaction.amountMinor } },
          { returnDocument: "after", session }
        );
        if (!wallet) throw new Error("insufficient_reversal_balance");
        const [refund] = await models.Refund.create([{
          ...envScope,
          credentialId: req.vullCredential._id,
          transactionId: transaction._id,
          reference: reference("rfd"),
          amountMinor: transaction.amountMinor,
          status: "SUCCEEDED",
        }], { session });
        await models.Ledger.create([{
          ...envScope,
          walletId: wallet._id,
          transactionId: transaction._id,
          direction: "DEBIT",
          amountMinor: transaction.amountMinor,
          openingBalanceMinor: wallet.balanceMinor + transaction.amountMinor,
          closingBalanceMinor: wallet.balanceMinor,
          reference: refund.reference,
          reversalOf: transaction._id,
          idempotencyKey: `refund:${refund.reference}`,
        }], { session });
        const eventId = await createOutbox(
          session,
          req.vullCredential._id,
          "refund.succeeded",
          { reference: refund.reference }
        );
        return {
          statusCode: 201,
          response: {
            environment: "SANDBOX",
            refund: publicDocument(refund),
          },
          outboxEventIds: [eventId],
        };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });
  api.get("/v1/refunds", async (req, res) =>
    res.json(await list(models.Refund, req.vullCredential._id, req, "refunds")));
  api.get("/v1/refunds/:reference", async (req, res) => {
    const refund = await models.Refund.findOne({
      ...envScope,
      credentialId: req.vullCredential._id,
      reference: req.params.reference,
    });
    return refund
      ? res.json({ environment: "SANDBOX", refund })
      : res.status(404).json({ code: "NOT_FOUND", message: "Refund not found." });
  });

  api.post("/v1/subscriptions", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        if (!validAmount(req.body.amountMinor)) {
          return {
            statusCode: 400,
            response: { code: "INVALID_AMOUNT", message: "amountMinor must be a positive integer." },
          };
        }
        const [subscription] = await models.Subscription.create([{
          ...envScope,
          credentialId: req.vullCredential._id,
          reference: reference("sub"),
          amountMinor: req.body.amountMinor,
          status: "ACTIVE",
        }], { session });
        return {
          statusCode: 201,
          response: { environment: "SANDBOX", subscription: publicDocument(subscription) },
        };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });
  api.get("/v1/subscriptions", async (req, res) =>
    res.json(await list(models.Subscription, req.vullCredential._id, req, "subscriptions")));
  api.get("/v1/subscriptions/:reference", async (req, res) => {
    const subscription = await models.Subscription.findOne({
      ...envScope,
      credentialId: req.vullCredential._id,
      reference: req.params.reference,
    });
    return subscription
      ? res.json({ environment: "SANDBOX", subscription })
      : res.status(404).json({ code: "NOT_FOUND", message: "Subscription not found." });
  });
  api.post("/v1/subscriptions/:reference/cancel", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const subscription = await models.Subscription.findOneAndUpdate(
          {
            ...envScope,
            credentialId: req.vullCredential._id,
            reference: req.params.reference,
          },
          { $set: { status: "CANCELED" } },
          { returnDocument: "after", session }
        );
        return subscription
          ? { statusCode: 200, response: { environment: "SANDBOX", subscription: publicDocument(subscription) } }
          : { statusCode: 404, response: { code: "NOT_FOUND", message: "Subscription not found." } };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });
  api.post("/v1/subscriptions/:reference/renew", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const subscription = await models.Subscription.findOneAndUpdate(
          {
            ...envScope,
            credentialId: req.vullCredential._id,
            reference: req.params.reference,
            status: "ACTIVE",
          },
          { $inc: { renewals: 1 } },
          { returnDocument: "after", session }
        );
        if (!subscription) {
          return {
            statusCode: 409,
            response: { code: "SUBSCRIPTION_INACTIVE", message: "Subscription is not active." },
          };
        }
        const [transaction] = await models.Transaction.create([{
          ...envScope,
          credentialId: req.vullCredential._id,
          reference: reference("renew"),
          amountMinor: subscription.amountMinor,
          currency: "NGN",
          scenario: "success",
          status: "BILLED",
          kind: "SUBSCRIPTION_RENEWAL",
        }], { session });
        const wallet = await models.Wallet.findOneAndUpdate(
          { ...envScope, credentialId: req.vullCredential._id },
          { $inc: { balanceMinor: subscription.amountMinor } },
          { returnDocument: "after", session }
        );
        if (!wallet) throw new Error("wallet_missing");
        await models.Ledger.create([{
          ...envScope,
          walletId: wallet._id,
          transactionId: transaction._id,
          direction: "CREDIT",
          amountMinor: subscription.amountMinor,
          openingBalanceMinor: wallet.balanceMinor - subscription.amountMinor,
          closingBalanceMinor: wallet.balanceMinor,
          reference: transaction.reference,
          idempotencyKey: `renew:${transaction.reference}`,
        }], { session });
        const eventId = await createOutbox(
          session,
          req.vullCredential._id,
          "subscription.renewed",
          {
            subscriptionReference: subscription.reference,
            reference: transaction.reference,
            amountMinor: subscription.amountMinor,
          }
        );
        return {
          statusCode: 200,
          response: {
            environment: "SANDBOX",
            subscription: publicDocument(subscription),
            transaction: publicDocument(transaction),
          },
          outboxEventIds: [eventId],
        };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });

  api.post("/v1/reconciliations", async (req, res, next) => {
    try {
      const result = await execute(req, async session => {
        const filter = {
          ...envScope,
          credentialId: req.vullCredential._id,
        };
        const report = {
          transactions: await models.Transaction.countDocuments(filter).session(session),
          renewals: await models.Transaction.countDocuments({
            ...filter,
            kind: "SUBSCRIPTION_RENEWAL",
          }).session(session),
          refunds: await models.Refund.countDocuments(filter).session(session),
        };
        const [reconciliation] = await models.Reconciliation.create([{
          ...filter,
          reference: reference("rec"),
          status: "COMPLETE",
          report,
        }], { session });
        return {
          statusCode: 201,
          response: {
            environment: "SANDBOX",
            reconciliation: publicDocument(reconciliation),
          },
        };
      });
      sendResult(res, result);
    } catch (error) { next(error); }
  });
  api.get("/v1/reconciliations", async (req, res) =>
    res.json(await list(models.Reconciliation, req.vullCredential._id, req, "reconciliations")));
  const getReconciliation = async (req, res) => {
    const reconciliation = await models.Reconciliation.findOne({
      ...envScope,
      credentialId: req.vullCredential._id,
      reference: req.params.reference,
    });
    return reconciliation
      ? res.json({ environment: "SANDBOX", reconciliation })
      : res.status(404).json({ code: "NOT_FOUND", message: "Reconciliation not found." });
  };
  api.get("/v1/reconciliations/:reference", getReconciliation);
  api.get("/v1/reconciliations/:reference/report", getReconciliation);

  api.post("/v1/inbound/events", async (req, res, next) => {
    const eventId = String(req.get("X-VULL-Event-ID") || "");
    const timestamp = String(req.get("X-VULL-Timestamp") || "");
    const timestampNumber = Number(timestamp);
    const receivedSignature = String(req.get("X-VULL-Signature") || "");
    const expected = signature(
      cfg.webhookSecret,
      timestamp,
      eventId,
      req.rawBody
    );
    if (
      req.get("X-VULL-Environment") !== "SANDBOX" ||
      !eventId ||
      !Number.isSafeInteger(timestampNumber) ||
      timestampNumber <= 0 ||
      Math.abs(Date.now() / 1000 - timestampNumber) > 300 ||
      !equal(receivedSignature, expected)
    ) {
      return res.status(401).json({
        code: "INVALID_WEBHOOK",
        message: "Invalid sandbox webhook.",
      });
    }
    try {
      const result = await execute(req, async session => {
        await models.Webhook.create([{
          ...envScope,
          eventId,
          credentialId: req.vullCredential._id,
          received: true,
          status: "RECEIVED",
          type: "INBOUND",
          rawBody: req.rawBody,
        }], { session });
        return {
          statusCode: 202,
          response: { environment: "SANDBOX", accepted: true },
        };
      }, `inbound:${eventId}`);
      sendResult(res, result);
    } catch (error) { next(error); }
  });

  api.use((error, _req, res, _next) => {
    if (error instanceof IdempotencyError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
      });
    }
    return res.status(500).json({
      code: "SANDBOX_INTERNAL_ERROR",
      message: "The sandbox operation could not be completed.",
    });
  });
  return api;
}

module.exports = { app };