const test = require("node:test");
const assert = require("node:assert/strict");
const connectDB = require("../config/db");

test("MongoDB startup fails clearly when MONGODB_URI is missing", async () => {
  const originalMongoUri = process.env.MONGODB_URI;

  try {
    delete process.env.MONGODB_URI;
    await assert.rejects(
      connectDB(),
      {
        message: "Required MongoDB environment variable is missing: MONGODB_URI",
      },
    );
  } finally {
    if (originalMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoUri;
    }
  }
});

test("MongoDB startup rejects a blank MONGODB_URI before connecting", async () => {
  const originalMongoUri = process.env.MONGODB_URI;

  try {
    process.env.MONGODB_URI = "   ";
    await assert.rejects(
      connectDB(),
      {
        message: "Required MongoDB environment variable is missing: MONGODB_URI",
      },
    );
  } finally {
    if (originalMongoUri === undefined) {
      delete process.env.MONGODB_URI;
    } else {
      process.env.MONGODB_URI = originalMongoUri;
    }
  }
});