const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
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
  changeTransactionPin,
  resetTransactionPin,
} = require("../controllers/transactionPin.controller");
const {
  registerUser,
  changePassword,
  loginUser,
  resetPassword,
} = require("../controllers/auth.controller");
const {
  MAX_ATTEMPTS_PER_WINDOW,
  createTransactionPinResetRateLimit,
} = require(
  "../middleware/transactionPinResetRateLimit.middleware"
);
const { requireTransactionPin } = require("../middleware/transactionPin.middleware");
const { protect } = require("../middleware/auth.middleware");

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

const callWithResponse = async (handler, req) => {
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
  await handler(req, res);
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

test("registration persists a bcrypt transaction PIN that verifies immediately", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "transaction-pin-test-secret";
  userSequence += 1;
  const response = await callWithResponse(registerUser, {
    body: {
      fullName: "Registered PIN Customer",
      phone: `0817000${String(userSequence).padStart(5, "0")}`,
      email: `registered-pin-${userSequence}@example.com`,
      password: "Password123!",
      transactionPIN: "2580",
      confirmTransactionPin: "2580",
      acceptTerms: true,
      nin: "12345678901",
    },
  });
  assert.equal(response.status, 201);
  const user = await User.findOne({ email: `registered-pin-${userSequence}@example.com` })
    .select("+transactionPin");
  assert.ok(user.transactionPin.startsWith("$2"));
  assert.notEqual(user.transactionPin, "2580");
  const verified = await call(verifyTransactionPin, { user, body: { pin: "2580" } });
  assert.equal(verified.status, 200);
});

test("stale transactionPinSet is repaired and does not block create", async () => {
  const user = await createUser();
  await User.updateOne({ _id: user._id }, { $set: { transactionPinSet: true } });
  const status = await call(getTransactionPinStatus, { user });
  assert.equal(status.status, 200);
  assert.equal(status.body.transactionPinSet, false);
  const created = await call(createTransactionPin, {
    user,
    body: { pin: "2580", confirmPin: "2580" },
  });
  assert.equal(created.status, 201);
  const stored = await User.findById(user._id).select("+transactionPin transactionPinSet");
  assert.equal(stored.transactionPinSet, true);
  assert.ok(stored.transactionPin.startsWith("$2"));
});

test("successful legacy plaintext PIN verification migrates it to bcrypt", async () => {
  userSequence += 1;
  const raw = {
    _id: new mongoose.Types.ObjectId(),
    fullName: "Legacy PIN Customer",
    phone: `0818000${String(userSequence).padStart(5, "0")}`,
    email: `legacy-pin-${userSequence}@example.com`,
    password: "Password123!",
    transactionPin: "1357",
    transactionPinSet: true,
    role: "CUSTOMER",
    status: "ACTIVE",
  };
  await User.collection.insertOne(raw);
  const response = await call(verifyTransactionPin, {
    user: { _id: raw._id },
    body: { pin: "1357" },
  });
  assert.equal(response.status, 200);
  const stored = await User.findById(raw._id).select("+transactionPin");
  assert.ok(stored.transactionPin.startsWith("$2"));
});

test("PIN change rejects old PIN after replacing it", async () => {
  const user = await createUser({ transactionPin: "2468" });
  const changed = await call(changeTransactionPin, {
    user,
    body: { currentPin: "2468", newPin: "2580", confirmNewPin: "2580" },
  });
  assert.equal(changed.status, 200);
  assert.equal((await call(verifyTransactionPin, { user, body: { pin: "2468" } })).status, 401);
  assert.equal((await call(verifyTransactionPin, { user, body: { pin: "2580" } })).status, 200);
});

test("password-authenticated reset recovers a stale missing PIN", async () => {
  const user = await createUser();
  await User.updateOne({ _id: user._id }, { $set: { transactionPinSet: true } });
  const reset = await call(resetTransactionPin, {
    user,
    body: { currentPassword: "Password123!", newPin: "2580", confirmPin: "2580" },
  });
  assert.equal(reset.status, 200);
  assert.equal((await call(verifyTransactionPin, { user, body: { pin: "2580" } })).status, 200);
});

test("password change enforces strong policy and old login fails after a successful change", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "transaction-pin-test-secret";
  const user = await createUser();
  const weak = await callWithResponse(changePassword, {
    user,
    body: { currentPassword: "Password123!", newPassword: "weakpass", confirmPassword: "weakpass" },
  });
  assert.equal(weak.status, 400);
  const changed = await callWithResponse(changePassword, {
    user,
    body: { currentPassword: "Password123!", newPassword: "Changed123!", confirmPassword: "Changed123!" },
  });
  assert.equal(changed.status, 200);
  const oldLogin = await callWithResponse(loginUser, {
    body: { email: user.email, password: "Password123!" }, headers: {}, ip: "127.0.0.1",
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await callWithResponse(loginUser, {
    body: { email: user.email, password: "Changed123!" }, headers: {}, ip: "127.0.0.1",
  });
  assert.equal(newLogin.status, 200);
});

test("PIN failures persist, correct verification clears them, and lockout is enforced", async () => {
  const user = await createUser({ transactionPin: "2468" });
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await call(verifyTransactionPin, { user, body: { pin: "9999" } })).status, 401);
  }
  assert.equal((await call(verifyTransactionPin, { user, body: { pin: "2468" } })).status, 200);
  const cleared = await User.findById(user._id)
    .select("+transactionPinFailedAttempts +transactionPinLockedUntil");
  assert.equal(cleared.transactionPinFailedAttempts, 0);
  assert.equal(cleared.transactionPinLockedUntil, null);
  for (let index = 0; index < 5; index += 1) {
    await call(verifyTransactionPin, { user, body: { pin: "9999" } });
  }
  const locked = await call(verifyTransactionPin, { user, body: { pin: "2468" } });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, "TRANSACTION_PIN_LOCKED");
});

test("four wrong PINs followed by a correct fifth attempt succeeds and clears state", async () => {
  const user = await createUser({ transactionPin: "2468" });
  for (let index = 0; index < 4; index += 1) {
    const wrong = await call(verifyTransactionPin, { user, body: { pin: `90${index}9` } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, "INCORRECT_TRANSACTION_PIN");
  }
  assert.equal((await call(verifyTransactionPin, { user, body: { pin: "2468" } })).status, 200);
  const stored = await User.findById(user._id)
    .select("+transactionPinFailedAttempts +transactionPinLockedUntil");
  assert.equal(stored.transactionPinFailedAttempts, 0);
  assert.equal(stored.transactionPinLockedUntil, null);
});

test("fifth wrong PIN is evaluated then immediately locks subsequent attempts", async () => {
  const user = await createUser({ transactionPin: "2468" });
  for (let index = 0; index < 5; index += 1) {
    const wrong = await call(verifyTransactionPin, { user, body: { pin: `80${index}9` } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, "INCORRECT_TRANSACTION_PIN");
  }
  const locked = await call(verifyTransactionPin, { user, body: { pin: "2468" } });
  assert.equal(locked.status, 429);
  assert.equal(locked.body.code, "TRANSACTION_PIN_LOCKED");
});

test("parallel PIN guesses fail closed once admission threshold is contested", async () => {
  const user = await createUser({ transactionPin: "2468" });
  const responses = await Promise.all(
    ["0001", "0002", "0003", "0004", "0005", "2468"].map((pin) =>
      call(verifyTransactionPin, { user, body: { pin } })
    )
  );
  assert.equal(responses.some((response) => response.status === 200), false);
  assert.equal(
    responses.some((response) => response.status === 429 &&
      response.body.code === "TRANSACTION_PIN_LOCKED"),
    true
  );
});

test("PIN middleware accepts pin alias and removes both aliases", async () => {
  const user = await createUser({ transactionPin: "2468" });
  const req = request({ user, body: { pin: "2468", transactionPin: undefined } });
  const result = {};
  await requireTransactionPin(req, {
    status(code) { result.status = code; return this; },
    json(body) { result.body = body; return this; },
  }, () => { result.next = true; });
  assert.equal(result.next, true);
  assert.equal(req.body.pin, undefined);
  assert.equal(req.body.transactionPin, undefined);
});

test("password change revokes old JWT and returns a valid replacement token", async () => {
  process.env.JWT_SECRET = "transaction-pin-test-secret";
  const user = await createUser();
  const oldToken = jwt.sign(
    { id: user._id, iat: Math.floor(Date.now() / 1000) - 2 },
    process.env.JWT_SECRET
  );
  const changed = await callWithResponse(changePassword, {
    user,
    body: { currentPassword: "Password123!", newPassword: "Changed123!", confirmPassword: "Changed123!" },
  });
  assert.equal(changed.status, 200);
  assert.ok(changed.body.token);
  const check = async (token) => {
    const result = {};
    await protect({ headers: { authorization: `Bearer ${token}` } }, {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    }, () => { result.next = true; });
    return result;
  };
  assert.equal((await check(oldToken)).status, 401);
  assert.equal((await check(changed.body.token)).next, true);
});

test("password reset returns a replacement token", async () => {
  process.env.JWT_SECRET = "transaction-pin-test-secret";
  const user = await createUser();
  const rawToken = "reset-token-for-test";
  await User.updateOne({ _id: user._id }, {
    $set: {
      passwordResetToken: crypto.createHash("sha256").update(rawToken).digest("hex"),
      passwordResetExpires: new Date(Date.now() + 60000),
    },
  });
  const response = await callWithResponse(resetPassword, {
    body: { token: rawToken, newPassword: "Reset123!", confirmPassword: "Reset123!" },
  });
  assert.equal(response.status, 200);
  assert.ok(response.body.token);
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