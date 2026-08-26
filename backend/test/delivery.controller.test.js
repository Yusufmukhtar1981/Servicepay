const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const DeliveryCoverage = require("../models/deliveryCoverage.model");
const Transaction = require("../models/transaction.model");
const deliveryController = require("../controllers/delivery.controller");
const {
  validateDeliveryCoverage,
} = require("../controllers/deliveryCoverage.controller");

let mongo;
let sequence = 0;

const models = [
  User,
  Delivery,
  DeliveryCoverage,
  Transaction,
];

const createCustomer = async ({
  walletBalance = 5000,
} = {}) => {
  sequence += 1;

  return User.create({
    fullName: `Delivery Customer ${sequence}`,
    phone: `080600${String(sequence).padStart(5, "0")}`,
    email: `delivery-${sequence}@example.test`,
    password: "Password123!",
    role: "CUSTOMER",
    status: "ACTIVE",
    walletBalance,
  });
};

const call = async (
  handler,
  {
    user = null,
    body = {},
  } = {}
) => {
  const result = {};
  const req = {
    user,
    body,
  };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.status ??= 200;
      result.body = payload;
      return this;
    },
  };

  await handler(req, res);
  return result;
};

test.before(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
    },
  });

  await mongoose.connect(mongo.getUri(), {
    dbName: "delivery-controller-tests",
  });

  await Promise.all(
    models.map((model) => model.init())
  );
});

test.after(async () => {
  await mongoose.disconnect();

  if (mongo) {
    await mongo.stop();
  }
});

test.beforeEach(async () => {
  await Promise.all(
    models.map((model) =>
      model.collection.deleteMany({})
    )
  );
});

test(
  "simplified delivery request succeeds without states, weight, or package name",
  async () => {
    const customer = await createCustomer();

    const result = await call(
      deliveryController.createDelivery,
      {
        user: customer,
        body: {
          pickupAddress: "12 Pickup Road, Kano",
          deliveryAddress: "7 Receiver Close, Kano",
          senderName: "Pickup Customer",
          senderPhone: "08030000001",
          receiverName: "Receiver Customer",
          receiverPhone: "08030000002",
          packageDescription:
            "Handle the documents with care.",
        },
      }
    );

    assert.equal(result.status, 201);

    const savedDelivery =
      await Delivery.findOne({
        customerId: customer._id,
      }).lean();

    assert.ok(savedDelivery);
    assert.equal(savedDelivery.pickupState, null);
    assert.equal(savedDelivery.deliveryState, null);
    assert.equal(
      savedDelivery.packageName,
      "Delivery item"
    );
    assert.equal(savedDelivery.packageWeight, 0);
    assert.equal(
      savedDelivery.packageDescription,
      "Handle the documents with care."
    );
    assert.equal(savedDelivery.deliveryFee, 1500);
    assert.equal(savedDelivery.paymentStatus, "PAID");
    assert.equal(
      savedDelivery.receiverName,
      "Receiver Customer"
    );

    const updatedCustomer =
      await User.findById(customer._id).lean();

    assert.equal(updatedCustomer.walletBalance, 3500);
    assert.equal(
      await Transaction.countDocuments({
        customerId: customer._id,
        serviceType: "DELIVERY",
        amount: 1500,
      }),
      1
    );
  }
);

test(
  "coverage middleware bypasses requests with no states",
  async () => {
    let nextCalled = false;
    const req = {
      body: {
        pickupAddress: "Pickup address",
        deliveryAddress: "Receiver address",
      },
    };
    const res = {
      status() {
        assert.fail(
          "State-free requests should not be rejected by coverage validation."
        );
      },
    };

    await validateDeliveryCoverage(
      req,
      res,
      () => {
        nextCalled = true;
      }
    );

    assert.equal(nextCalled, true);
    assert.equal(req.deliveryCoverage, undefined);
  }
);

test(
  "legacy state-aware requests still require both valid states",
  async () => {
    const result = {};
    const req = {
      body: {
        pickupState: "KANO",
      },
    };
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

    await validateDeliveryCoverage(
      req,
      res,
      () => {
        assert.fail(
          "An incomplete legacy state request must not bypass coverage validation."
        );
      }
    );

    assert.equal(result.status, 400);
    assert.equal(
      result.body.code,
      "INVALID_DELIVERY_STATE"
    );
  }
);