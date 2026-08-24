const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../models/user.model");
const AppSettings = require("../models/appSettings.model");
const AISupportConversation = require(
  "../models/aiSupportConversation.model"
);
const AISupportRateLimit = require(
  "../models/aiSupportRateLimit.model"
);
const {
  chat,
  getHistory,
  deleteHistory,
} = require("../controllers/aiSupport.controller");
const {
  SECURITY_WARNING,
  createSupportReply,
} = require("../services/aiSupport.service");
const {
  MAX_MESSAGES_PER_WINDOW,
  aiSupportCustomerOnly,
  createAiSupportRateLimit,
} = require("../middleware/aiSupportRateLimit.middleware");

let mongo;
let userSequence = 0;

const databaseModels = [
  User,
  AppSettings,
  AISupportConversation,
  AISupportRateLimit,
];

const request = ({
  user,
  body = {},
}) => ({
  user,
  body,
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

const createUser = async () => {
  userSequence += 1;

  return User.create({
    fullName: `AI Support Test User ${userSequence}`,
    phone: `0805000${String(userSequence).padStart(5, "0")}`,
    email: `ai-support-${userSequence}@example.com`,
    password: "password123",
    role: "CUSTOMER",
    status: "ACTIVE",
  });
};

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), {
    dbName: "ai-support-tests",
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

test("authenticated customer chat saves a safe fallback reply", async () => {
  const user = await createUser();
  const response = await call(chat, {
    user,
    body: {
      message: "How does ServicePay Empowerment work?",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.match(response.body.reply, /discover available programs/i);
  assert.equal(response.body.escalationRecommended, false);
  assert.ok(response.body.conversationId);

  const conversation = await AISupportConversation.findOne({
    userId: user._id,
  }).lean();
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[0].role, "USER");
  assert.equal(conversation.messages[1].role, "ASSISTANT");
});

test("chat rejects an unauthenticated request", async () => {
  const response = await call(chat, {
    user: null,
    body: { message: "Hello" },
  });

  assert.equal(response.status, 401);
  assert.equal(response.body.success, false);
});

test("chat rejects an empty message", async () => {
  const user = await createUser();
  const response = await call(chat, {
    user,
    body: { message: "   " },
  });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /enter a message/i);
});

test("chat never stores sensitive credentials, including natural-language bypasses", async () => {
  const user = await createUser();

  for (const sensitiveMessage of [
    "My transaction PIN is 1234",
    "Here is my password hunter2",
    "PIN 5678",
    "OTP: 123456",
    "My BVN 12345678901",
  ]) {
    const response = await call(chat, {
      user,
      body: { message: sensitiveMessage },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.reply, SECURITY_WARNING);
  }

  const conversation = await AISupportConversation.findOne({
    userId: user._id,
  }).lean();
  const savedMessages = conversation.messages.map((item) => item.message);

  for (const secret of [
    "1234",
    "hunter2",
    "5678",
    "123456",
    "12345678901",
  ]) {
    assert.equal(
      savedMessages.some((message) => message.includes(secret)),
      false
    );
  }
  assert.deepEqual(
    savedMessages,
    Array(5).fill(SECURITY_WARNING),
  );
});

test("history returns only the authenticated customer's messages", async () => {
  const firstUser = await createUser();
  const secondUser = await createUser();

  await call(chat, {
    user: firstUser,
    body: { message: "How does withdrawal work?" },
  });

  const ownHistory = await call(getHistory, { user: firstUser });
  const otherHistory = await call(getHistory, { user: secondUser });

  assert.equal(ownHistory.status, 200);
  assert.equal(ownHistory.body.messages.length, 2);
  assert.equal(otherHistory.status, 200);
  assert.deepEqual(otherHistory.body.messages, []);
});

test("history deletion only clears the current customer's chat", async () => {
  const firstUser = await createUser();
  const secondUser = await createUser();

  await call(chat, {
    user: firstUser,
    body: { message: "How does withdrawal work?" },
  });
  await call(chat, {
    user: secondUser,
    body: { message: "How does withdrawal work?" },
  });

  const deletion = await call(deleteHistory, { user: firstUser });
  assert.equal(deletion.status, 200);

  const firstConversation = await AISupportConversation.findOne({
    userId: firstUser._id,
  });
  const secondConversation = await AISupportConversation.findOne({
    userId: secondUser._id,
  });

  assert.equal(firstConversation, null);
  assert.equal(secondConversation.messages.length, 2);
});

test("provider failure falls back to the ServicePay knowledge base", async () => {
  const result = await createSupportReply({
    message: "Data successful but not received",
    provider: async () => {
      throw new Error("provider unavailable");
    },
  });

  assert.equal(result.source, "fallback");
  assert.match(result.reply, /contact ServicePay Support/i);
  assert.equal(result.escalationRecommended, true);
});

test("unsafe provider output is rejected in favour of the knowledge base", async () => {
  const result = await createSupportReply({
    message: "How does withdrawal work?",
    provider: async () =>
      "Your withdrawal has been approved. Please share your transaction PIN.",
  });

  assert.equal(result.source, "fallback");
  assert.match(result.reply, /withdrawal is a request flow/i);
});

test("customer-only middleware denies staff accounts", () => {
  const result = {};
  aiSupportCustomerOnly(
    { user: { role: "STAFF" } },
    {
      status(code) {
        result.status = code;
        return this;
      },
      json(payload) {
        result.body = payload;
        return this;
      },
    },
    () => {
      result.nextCalled = true;
    }
  );

  assert.equal(result.status, 403);
  assert.equal(result.nextCalled, undefined);
  assert.match(result.body.message, /customer accounts/i);
});

test("AI Support rate limiting applies per authenticated customer", async () => {
  const makeResponse = () => {
    const result = {};
    return {
      result,
      res: {
        status(code) {
          result.status = code;
          return this;
        },
        json(payload) {
          result.body = payload;
          return this;
        },
        set(name, value) {
          result.headers = {
            ...(result.headers || {}),
            [name]: value,
          };
          return this;
        },
      },
    };
  };

  const user = await createUser();
  const middleware = createAiSupportRateLimit();

  for (let index = 0; index < MAX_MESSAGES_PER_WINDOW; index += 1) {
    const { result, res } = makeResponse();
    await middleware(
      { user },
      res,
      () => {
        result.nextCalled = true;
      }
    );
    assert.equal(result.nextCalled, true);
  }

  const { result, res } = makeResponse();
  await middleware(
    { user },
    res,
    () => {
      result.nextCalled = true;
    }
  );

  assert.equal(result.nextCalled, undefined);
  assert.equal(result.status, 429);
  assert.match(result.body.message, /too many AI Support messages/i);
  assert.ok(result.headers['Retry-After']);
});