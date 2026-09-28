const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const DeliveryCoverage = require("../models/deliveryCoverage.model");
const Transaction = require("../models/transaction.model");
const deliveryController = require("../controllers/delivery.controller");
const riderDeliveryController = require("../controllers/riderDelivery.controller");
const deliveryRoutes = require("../routes/delivery.routes");
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
  branchId = new mongoose.Types.ObjectId(),
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
    branchId,
  });
};

const call = async (
  handler,
  {
    user = null,
    body = {},
    params = {},
    query = {},
    deliveryCoverage = null,
  } = {}
) => {
  const result = {};
  const req = {
    user,
    body,
    params,
    query,
    deliveryCoverage,
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
          idempotencyKey: "delivery-idempotency-create-one",
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
  "delivery and wallet transaction inherit the authenticated customer branch",
  async () => {
    const customerBranchId = new mongoose.Types.ObjectId();
    const forgedBranchId = new mongoose.Types.ObjectId();
    const customer = await createCustomer({
      branchId: customerBranchId,
    });

    const result = await call(deliveryController.createDelivery, {
      user: customer,
      body: {
        idempotencyKey: "delivery-idempotency-branch-test",
        // This must be ignored: customers cannot choose delivery tenancy.
        branchId: forgedBranchId,
        pickupAddress: "12 Pickup Road, Kano",
        deliveryAddress: "7 Receiver Close, Kano",
        senderName: "Pickup Customer",
        senderPhone: "08030000001",
        receiverName: "Receiver Customer",
        receiverPhone: "08030000002",
      },
    });

    assert.equal(result.status, 201, JSON.stringify(result.body));
    const delivery = await Delivery.findById(result.body.delivery._id).lean();
    const transaction = await Transaction.findById(result.body.transaction._id).lean();
    assert.equal(String(delivery.branchId), String(customerBranchId));
    assert.equal(String(transaction.branchId), String(customerBranchId));
    assert.notEqual(String(delivery.branchId), String(forgedBranchId));
  }
);

test("branchless customers cannot be charged for an order no rider can claim", async () => {
  const customer = await createCustomer({ branchId: null });
  const response = await call(deliveryController.createDelivery, {
    user: customer,
    body: {
      idempotencyKey: "branchless-delivery-request-test",
      pickupAddress: "Pickup Road", deliveryAddress: "Receiver Road",
      senderName: "Sender", senderPhone: "08010000001",
      receiverName: "Receiver", receiverPhone: "08010000002",
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "DELIVERY_RIDER_UNAVAILABLE");
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
  assert.equal(await Delivery.countDocuments({ customerId: customer._id }), 0);
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 0);
});

test("a verified state rider can find and claim a branchless customer's paid delivery", async () => {
  const customer = await createCustomer({ branchId: null });
  const rider = await User.create({
    fullName: "Kano Verified Rider", phone: "080777700003",
    email: "kano-rider@example.test", password: "Password123!",
    role: "DELIVERY_RIDER", status: "ACTIVE",
    riderVerificationStatus: "VERIFIED", availabilityStatus: "ONLINE",
    riderState: "Kano",
  });
  const created = await call(deliveryController.createDelivery, {
    user: customer,
    deliveryCoverage: { pickupStateCode: "KANO", deliveryStateCode: "KANO" },
    body: {
      idempotencyKey: "branchless-kano-rider-order",
      pickupState: "KANO", deliveryState: "KANO",
      pickupAddress: "Pickup Road", deliveryAddress: "Receiver Road",
      senderName: "Sender", senderPhone: "08010000001",
      receiverName: "Receiver", receiverPhone: "08010000002",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.delivery.branchId, null);
  const jobs = await call(riderDeliveryController.getRiderDeliveries, {
    user: rider, query: {},
  });
  assert.equal(jobs.status, 200, JSON.stringify(jobs.body));
  assert.ok(jobs.body.data.availableDeliveries.some(
    (order) => String(order._id) === String(created.body.delivery._id),
  ));
  const accepted = await call(riderDeliveryController.acceptRiderDelivery, {
    user: rider, params: { id: String(created.body.delivery._id) },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal((await Delivery.findById(created.body.delivery._id)).status, "ACCEPTED");
});

test("delivery details and manager lists are limited to the current downline", async () => {
  const stateManager = await User.create({
    fullName: "Delivery State Manager", phone: "080777700001",
    email: "delivery-manager@example.test", password: "Password123!",
    role: "STATE_MANAGER", status: "ACTIVE",
  });
  const ownCustomer = await createCustomer();
  const otherCustomer = await createCustomer();
  await User.updateOne({ _id: ownCustomer._id }, { $set: { stateManagerId: stateManager._id } });
  const base = {
    pickupAddress: "Pickup Road", deliveryAddress: "Receiver Road",
    senderName: "Sender", senderPhone: "08010000001",
    receiverName: "Receiver", receiverPhone: "08010000002",
  };
  const own = await call(deliveryController.createDelivery, {
    user: ownCustomer, body: { ...base, idempotencyKey: "manager-own-delivery-order" },
  });
  const other = await call(deliveryController.createDelivery, {
    user: otherCustomer, body: { ...base, idempotencyKey: "manager-other-delivery-order" },
  });
  assert.equal(own.status, 201);
  assert.equal(other.status, 201);
  const list = await call(deliveryController.getAllDeliveries, {
    user: stateManager,
  });
  assert.equal(list.status, 200);
  assert.equal(list.body.count, 1);
  assert.equal(String(list.body.deliveries[0].customerId._id), String(ownCustomer._id));
  const denied = await call(deliveryController.getDeliveryById, {
    user: stateManager, params: { id: other.body.delivery._id },
  });
  assert.equal(denied.status, 403);
  const customerDenied = await call(deliveryController.getDeliveryById, {
    user: ownCustomer, params: { id: other.body.delivery._id },
  });
  assert.equal(customerDenied.status, 403);
});

test("customer access to global delivery lists and staff mutation routes is denied", async () => {
  for (const path of ["/", "/fee/:id", "/payment/:id", "/status/:id"]) {
    const method = path === "/" ? "get" : "put";
    const route = deliveryRoutes.stack.find((layer) =>
      layer.route?.path === path && layer.route.methods[method])?.route;
    assert.ok(route, `missing route ${path}`);
    const guard = route.stack[1].handle;
    const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    let admitted = false;
    await guard({ user: { role: "CUSTOMER" } }, response, () => { admitted = true; });
    assert.equal(response.code, 403, `unprotected ${path}`);
    assert.equal(admitted, false);
  }
});

test(
  "customer delivery cancellation remains limited to the delivery owner",
  async () => {
    const owner = await createCustomer();
    const otherCustomer = await createCustomer();
    const delivery = await Delivery.create({
      customerId: owner._id,
      trackingNumber: "SP-OWNER-ONLY-DELIVERY",
      pickupAddress: "12 Pickup Road, Kano",
      deliveryAddress: "7 Receiver Close, Kano",
      senderName: owner.fullName,
      senderPhone: owner.phone,
      receiverName: "Receiver Customer",
      receiverPhone: "08030000002",
      packageName: "Documents",
      paymentStatus: "UNPAID",
      status: "PENDING",
    });

    const foreignAttempt = await call(deliveryController.cancelDelivery, {
      user: otherCustomer,
      params: { id: String(delivery._id) },
    });
    assert.equal(foreignAttempt.status, 404);
    assert.equal((await Delivery.findById(delivery._id)).status, "PENDING");

    const ownerAttempt = await call(deliveryController.cancelDelivery, {
      user: owner,
      params: { id: String(delivery._id) },
    });
    assert.equal(ownerAttempt.status, 200, JSON.stringify(ownerAttempt.body));
    assert.equal((await Delivery.findById(delivery._id)).status, "CANCELLED");
  }
);

test("delivery idempotency replays one paid order without a second debit", async () => {
  const customer = await createCustomer();
  const body = {
    idempotencyKey: "delivery-idempotency-retry-one",
    pickupAddress: "12 Pickup Road, Kano",
    deliveryAddress: "7 Receiver Close, Kano",
    senderName: "Pickup Customer",
    senderPhone: "08030000001",
    receiverName: "Receiver Customer",
    receiverPhone: "08030000002",
    packageDescription: "Documents",
  };
  const first = await call(deliveryController.createDelivery, { user: customer, body });
  const retry = await call(deliveryController.createDelivery, { user: customer, body });

  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(retry.body.duplicate, true);
  assert.equal(String(retry.body.delivery._id), String(first.body.delivery._id));
  assert.equal(await Delivery.countDocuments({ customerId: customer._id }), 1);
  const history = await call(deliveryController.getMyDeliveries, { user: customer });
  assert.equal(history.body.deliveries[0].idempotencyKey, body.idempotencyKey);
  assert.equal(
    await Transaction.countDocuments({
      customerId: customer._id,
      serviceType: "DELIVERY",
      amount: 1500,
    }),
    1
  );
  assert.equal((await User.findById(customer._id)).walletBalance, 3500);

  const conflict = await call(deliveryController.createDelivery, {
    user: customer,
    body: { ...body, deliveryAddress: "A different destination." },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "DELIVERY_IDEMPOTENCY_KEY_REUSED");
  assert.equal((await User.findById(customer._id)).walletBalance, 3500);
});

test("concurrent delivery retries debit the customer wallet only once", async () => {
  const customer = await createCustomer();
  const body = {
    idempotencyKey: "delivery-idempotency-race-one",
    pickupAddress: "12 Pickup Road, Kano",
    deliveryAddress: "7 Receiver Close, Kano",
    senderName: "Pickup Customer",
    senderPhone: "08030000001",
    receiverName: "Receiver Customer",
    receiverPhone: "08030000002",
  };
  const results = await Promise.all([
    call(deliveryController.createDelivery, { user: customer, body }),
    call(deliveryController.createDelivery, { user: customer, body }),
  ]);

  assert.ok(results.every((result) => [201, 200].includes(result.status)), JSON.stringify(results));
  assert.equal(await Delivery.countDocuments({ customerId: customer._id }), 1);
  assert.equal(
    await Transaction.countDocuments({
      customerId: customer._id,
      serviceType: "DELIVERY",
      amount: 1500,
    }),
    1
  );
  assert.equal((await User.findById(customer._id)).walletBalance, 3500);
});

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