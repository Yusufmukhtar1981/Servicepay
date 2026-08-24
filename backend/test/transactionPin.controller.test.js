const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const AdminAuditLog = require("../models/adminAuditLog.model");
const TransactionPinResetRateLimit = require(
  "../models/transactionPinResetRateLimit.model"
);
const {
  getTransactionPinStatus,
  verifyTransactionPin,
  createTransactionPin,
  resetTransactionPin,
} = require("../controllers/transactionPin.controller");
const {
  MAX_ATTEMPTS_PER_WINDOW,
  createTransactionPinResetRateLimit,
} = require(
  "../middleware/transactionPinResetRateLimit.middleware"
);

let mongo;
let userSequence = 0;

const databaseModels = [
  User,
  AdminAuditLog,
  TransactionPinResetRateLimit,
];

const request = ({
  user,
  body = {},
  headers = {},
}) => ({
  user,
  body,
  headers,
  method: "POST",
  originalUrl: "/api/transaction-pin/reset",
  path: "/api/transaction-pin/reset",
  ip: "127.0.0.1",
  get(name) {
    return headers[name.toLowerCase()];
  },
});

const call = async (handler, options) => {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };

  await handler(request(options), res);
  return result;
};

const createUser = async ({
  role = "CUSTOMER",
  transactionPin,
} = {}) => {
  userSequence += 1;

  return User.create({
    fullName: `Transaction PIN Test User ${userSequence}`,
    phone: `0806000${String(userSequence).padStart(5, "0")}`,
    email: `transaction-pin-${userSequence}@example.com`,
    password: "Password123!",
    role,
    status: "ACTIVE",
    transactionPin,
  });
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });
  await mongoose.connect(mongo.getUri(), {
    dbName: "transaction-pin-tests",
  });
  await Promise.all(databaseModels.map((model) => model.init()));
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongo) {
    await mongo.stop();
  }
});

test.beforeEach(async () => {
  await Promise.all(
    databaseModels.map((model) => model.collection.deleteMany({}))
  );
});

test("authenticated customer resets PIN and old PIN stops working", async () => {
  const user = await createUser({ transactionPin: "2468" });

  const reset = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });

  assert.equal(reset.status, 200);
  assert.equal(reset.body.success, true);
  assert.equal(
    reset.body.message,
    "Transaction PIN reset successfully."
  );
  assert.equal(reset.body.transactionPinSet, true);

  const oldPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2468" },
  });
  assert.equal(oldPin.status, 401);

  const newPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2580" },
  });
  assert.equal(newPin.status, 200);

  const persisted = await User.findById(user._id).select(
    "+transactionPin transactionPinSet"
  );
  assert.notEqual(persisted.transactionPin, "2580");
  assert.equal(persisted.transactionPinSet, true);

  const auditLog = await AdminAuditLog.findOne({
    actorId: user._id,
    action: "TRANSACTION_PIN_RESET",
  }).lean();
  assert.ok(auditLog);
  assert.equal(auditLog.status, "SUCCESSFUL");
  assert.equal(auditLog.newData.transactionPinSet, true);
  assert.equal(JSON.stringify(auditLog).includes("2580"), false);
});

test("reset rejects mismatched and non-4-digit PINs", async () => {
  const user = await createUser({ transactionPin: "2468" });

  const mismatch = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "1357",
    },
  });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.message, /do not match/i);

  const invalid = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "Password123!",
      newPin: "123",
      confirmPin: "123",
    },
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.message, /exactly 4 digits/i);
});

test("reset rejects weak PINs using the existing PIN policy", async () => {
  const user = await createUser({ transactionPin: "2468" });

  const response = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "Password123!",
      newPin: "1234",
      confirmPin: "1234",
    },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /predictable/i);
});

test("reset rejects unauthenticated and non-customer accounts", async () => {
  const unauthenticated = await call(resetTransactionPin, {
    user: null,
    body: {
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });
  assert.equal(unauthenticated.status, 401);

  const staff = await createUser({
    role: "STAFF",
    transactionPin: "2468",
  });
  const staffResponse = await call(resetTransactionPin, {
    user: staff,
    body: {
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });
  assert.equal(staffResponse.status, 403);
});

test("wrong password rejects reset and preserves the existing PIN", async () => {
  const user = await createUser({ transactionPin: "2468" });

  const response = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "WrongPassword123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });

  assert.equal(response.status, 401);
  assert.match(response.body.message, /password is incorrect/i);

  const oldPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2468" },
  });
  assert.equal(oldPin.status, 200);

  const newPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2580" },
  });
  assert.equal(newPin.status, 401);
});

test("audit write failure rolls back the PIN reset", async () => {
  const user = await createUser({ transactionPin: "2468" });
  const originalCreate = AdminAuditLog.create;
  AdminAuditLog.create = async () => {
    throw new Error("audit storage unavailable");
  };

  try {
    const response = await call(resetTransactionPin, {
      user,
      body: {
        currentPassword: "Password123!",
        newPin: "2580",
        confirmPin: "2580",
      },
    });

    assert.equal(response.status, 500);
    assert.match(response.body.message, /unable to reset/i);
  } finally {
    AdminAuditLog.create = originalCreate;
  }

  const oldPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2468" },
  });
  assert.equal(oldPin.status, 200);

  const newPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2580" },
  });
  assert.equal(newPin.status, 401);
});

test("reset always uses the authenticated customer and cannot target another customer", async () => {
  const firstUser = await createUser({ transactionPin: "2468" });
  const secondUser = await createUser({ transactionPin: "1357" });

  const response = await call(resetTransactionPin, {
    user: firstUser,
    body: {
      userId: secondUser._id,
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });
  assert.equal(response.status, 200);

  const firstNewPin = await call(verifyTransactionPin, {
    user: firstUser,
    body: { pin: "2580" },
  });
  assert.equal(firstNewPin.status, 200);

  const secondOldPin = await call(verifyTransactionPin, {
    user: secondUser,
    body: { pin: "1357" },
  });
  assert.equal(secondOldPin.status, 200);
});

test("customer without a PIN is directed to the existing create flow", async () => {
  const user = await createUser();

  const response = await call(resetTransactionPin, {
    user,
    body: {
      currentPassword: "Password123!",
      newPin: "2580",
      confirmPin: "2580",
    },
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TRANSACTION_PIN_NOT_SET");
  assert.match(response.body.message, /create your transaction PIN/i);

  const status = await call(getTransactionPinStatus, { user });
  assert.equal(status.status, 200);
  assert.equal(status.body.transactionPinSet, false);

  const create = await call(createTransactionPin, {
    user,
    body: {
      pin: "2580",
      confirmPin: "2580",
    },
  });
  assert.equal(create.status, 201);

  const createdPin = await call(verifyTransactionPin, {
    user,
    body: { pin: "2580" },
  });
  assert.equal(createdPin.status, 200);
});

test("reset rate limiting blocks repeated password confirmation attempts", async () => {
  const user = await createUser({ transactionPin: "2468" });
  const limiter = createTransactionPinResetRateLimit();

  const makeResponse = () => {
    const result = {};
    return {
      result,
      response: {
        set(name, value) {
          result.headers = {
            ...(result.headers || {}),
            [name]: value,
          };
          return this;
        },
        status(code) {
          result.status = code;
          return this;
        },
        json(payload) {
          result.body = payload;
          return this;
        },
      },
    };
  };

  for (
    let index = 0;
    index < MAX_ATTEMPTS_PER_WINDOW;
    index += 1
  ) {
    const { result, response } = makeResponse();
    await limiter({ user }, response, () => {
      result.nextCalled = true;
    });
    assert.equal(result.nextCalled, true);
  }

  const { result, response } = makeResponse();
  await limiter({ user }, response, () => {
    result.nextCalled = true;
  });

  assert.equal(result.nextCalled, undefined);
  assert.equal(result.status, 429);
  assert.equal(
    result.body.code,
    "TRANSACTION_PIN_RESET_RATE_LIMITED"
  );
  assert.ok(result.headers["Retry-After"]);
});