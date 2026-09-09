const crypto = require("node:crypto");

class IdempotencyError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function hashRequest(method, path, body) {
  return crypto
    .createHash("sha256")
    .update(`${method}:${path}:${JSON.stringify(body || {})}`)
    .digest("hex");
}

const sleep = milliseconds =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

async function findWinner(models, filter, requestHash) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const existing = await models.Idempotency.findOne(filter).lean();
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new IdempotencyError(
          "IDEMPOTENCY_MISMATCH",
          "Idempotency key was already used for a different request.",
          409
        );
      }
      if (existing.state === "COMPLETE") {
        return {
          statusCode: existing.statusCode,
          response: existing.response,
          replayed: true,
          outboxEventIds: existing.outboxEventIds || [],
        };
      }
    }
    await sleep(10 * 2 ** attempt);
  }
  throw new IdempotencyError(
    "IDEMPOTENCY_IN_PROGRESS",
    "An identical request is still in progress.",
    409
  );
}

async function executeIdempotent({
  models,
  credentialId,
  key,
  requestHash,
  operation,
  failpoints = {},
}) {
  if (!key) {
    throw new IdempotencyError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Idempotency-Key is required.",
      400
    );
  }

  const filter = {
    environment: "SANDBOX",
    credentialId,
    key,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const session = await models.Idempotency.db.startSession();
    try {
      session.startTransaction();
      await models.Idempotency.create(
        [{
          ...filter,
          requestHash,
          state: "PROCESSING",
          outboxEventIds: [],
        }],
        { session }
      );

      const result = await operation(session);
      if (failpoints.afterOperation) {
        await failpoints.afterOperation({ session, result });
      }

      const statusCode = result.statusCode;
      const response = result.response;
      const outboxEventIds = result.outboxEventIds || [];
      await models.Idempotency.updateOne(
        filter,
        {
          $set: {
            state: "COMPLETE",
            statusCode,
            response,
            outboxEventIds,
          },
        },
        { session }
      );

      if (failpoints.beforeCommit) {
        await failpoints.beforeCommit({ session, result });
      }
      await session.commitTransaction();
      return { statusCode, response, outboxEventIds, replayed: false };
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      if (error instanceof IdempotencyError) throw error;
      if (error?.code === 11000) {
        return findWinner(models, filter, requestHash);
      }
      if (
        error?.hasErrorLabel?.("TransientTransactionError") &&
        attempt < 4
      ) {
        await sleep(10 * 2 ** attempt);
        continue;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  return findWinner(models, filter, requestHash);
}

module.exports = {
  executeIdempotent,
  hashRequest,
  IdempotencyError,
};