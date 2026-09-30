const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Delivery = require("../models/delivery.model");
const DeliveryCoverage = require("../models/deliveryCoverage.model");
const Transaction = require("../models/transaction.model");
const RiderWalletLedger = require("../models/riderWalletLedger.model");
const deliveryController = require("../controllers/delivery.controller");
const adminController = require("../controllers/admin.controller");
const riderDeliveryController = require("../controllers/riderDelivery.controller");
const { creditRiderCommissionIfEligible } = require("../services/riderCommission.service");
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
  RiderWalletLedger,
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

const createRider = async () => {
  sequence += 1;
  return User.create({
    fullName: `Delivery Rider ${sequence}`,
    phone: `080700${String(sequence).padStart(5, "0")}`,
    email: `rider-${sequence}@example.test`,
    password: "Password123!",
    role: "DELIVERY_RIDER",
    status: "ACTIVE",
  });
};

const createUnpaidDelivery = async ({
  customer,
  deliveryFee,
  trackingNumber,
  status = "PENDING",
  paymentStatus = "UNPAID",
  pricingType = "CUSTOM",
  assignedRiderId = null,
}) => Delivery.create({
  customerId: customer._id,
  trackingNumber,
  pickupAddress: "12 Pickup Road, Kano",
  deliveryAddress: "7 Receiver Close, Kano",
  senderName: customer.fullName,
  senderPhone: customer.phone,
  receiverName: "Delivery Receiver",
  receiverPhone: "08030000002",
  packageName: "Documents",
  deliveryFee,
  pricingType,
  paymentStatus,
  status,
  assignedRiderId,
});

const createDeliveryPaymentTransaction = ({
  customer,
  delivery,
  amount = delivery.deliveryFee,
  status = "SUCCESSFUL",
  deliveryId = delivery._id,
  reference = `DELIVERY-PAYMENT-${delivery._id}`,
}) => Transaction.create({
  reference,
  customerId: customer._id,
  serviceType: "DELIVERY",
  provider: "SERVICEPAY_LOGISTICS",
  amount,
  status,
  providerResponse: { deliveryId },
});

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
    assert.equal(savedDelivery.deliveryFee, 2000);
    assert.equal(savedDelivery.pricingType, "STANDARD");
    assert.equal(savedDelivery.riderCommissionAmount, 600);
    assert.equal(savedDelivery.servicepayProfit, 1400);
    assert.equal(savedDelivery.paymentStatus, "PAID");
    assert.equal(
      savedDelivery.receiverName,
      "Receiver Customer"
    );

    const updatedCustomer =
      await User.findById(customer._id).lean();

    assert.equal(updatedCustomer.walletBalance, 3000);
    assert.equal(
      await Transaction.countDocuments({
        customerId: customer._id,
        serviceType: "DELIVERY",
        amount: 2000,
      }),
      1
    );
    const deliveryTransaction = await Transaction.findOne({
      customerId: customer._id,
      serviceType: "DELIVERY",
    }).lean();
    assert.equal(deliveryTransaction.amount, 2000);
    assert.equal(deliveryTransaction.servicepayProfit, 1400);
    assert.equal(deliveryTransaction.providerResponse.riderShare, 600);
    assert.equal(deliveryTransaction.providerResponse.servicepayShare, 1400);
    assert.equal(
      deliveryTransaction.providerResponse.riderShare +
        deliveryTransaction.providerResponse.servicepayShare,
      deliveryTransaction.amount
    );
  }
);

test("Delivery debits use spendable balance and never consume held funds", async () => {
  const heldCreateCustomer = await createCustomer({ walletBalance: 10000 });
  heldCreateCustomer.walletHeldBalance = 4000;
  await heldCreateCustomer.save();
  const heldCreate = await call(deliveryController.createDelivery, {
    user: heldCreateCustomer,
    body: {
      idempotencyKey: "delivery-standard-held-create-exact",
      pickupAddress: "12 Pickup Road, Kano",
      deliveryAddress: "7 Receiver Close, Kano",
      senderName: "Sender",
      senderPhone: "08030000001",
      receiverName: "Receiver",
      receiverPhone: "08030000002",
    },
  });
  assert.equal(heldCreate.status, 201, JSON.stringify(heldCreate.body));
  const heldCreateWallet = await User.findById(heldCreateCustomer._id).lean();
  assert.equal(heldCreateWallet.walletBalance, 8000);
  assert.equal(heldCreateWallet.walletHeldBalance, 4000);

  const insufficientCreateCustomer = await createCustomer({ walletBalance: 10000 });
  insufficientCreateCustomer.walletHeldBalance = 8001;
  await insufficientCreateCustomer.save();
  const insufficientCreate = await call(deliveryController.createDelivery, {
    user: insufficientCreateCustomer,
    body: {
      idempotencyKey: "delivery-standard-held-create-insufficient",
      pickupAddress: "12 Pickup Road, Kano",
      deliveryAddress: "7 Receiver Close, Kano",
      senderName: "Sender",
      senderPhone: "08030000001",
      receiverName: "Receiver",
      receiverPhone: "08030000002",
    },
  });
  assert.equal(insufficientCreate.status, 400);
  assert.equal(insufficientCreate.body.spendableBalance, 1999);
  const unchangedCreateWallet = await User.findById(insufficientCreateCustomer._id).lean();
  assert.equal(unchangedCreateWallet.walletBalance, 10000);
  assert.equal(unchangedCreateWallet.walletHeldBalance, 8001);
  assert.equal(await Delivery.countDocuments({ customerId: insufficientCreateCustomer._id }), 0);
  assert.equal(await Transaction.countDocuments({ customerId: insufficientCreateCustomer._id }), 0);

  const exactCustomer = await createCustomer({ walletBalance: 10000 });
  exactCustomer.walletHeldBalance = 4000;
  await exactCustomer.save();
  const exactDelivery = await createUnpaidDelivery({
    customer: exactCustomer,
    deliveryFee: 6000,
    trackingNumber: "SP-DELIVERY-HELD-EXACT",
  });
  const exactPayment = await call(deliveryController.payDeliveryFee, {
    user: exactCustomer,
    params: { id: String(exactDelivery._id) },
  });
  assert.equal(exactPayment.status, 200, JSON.stringify(exactPayment.body));
  const exactWallet = await User.findById(exactCustomer._id).lean();
  assert.equal(exactWallet.walletBalance, 4000);
  assert.equal(exactWallet.walletHeldBalance, 4000);
  assert.equal(exactPayment.body.transaction.amount, 6000);
  const exactRetry = await call(deliveryController.payDeliveryFee, {
    user: exactCustomer,
    params: { id: String(exactDelivery._id) },
  });
  assert.equal(exactRetry.status, 400);
  assert.match(exactRetry.body.message, /already been paid/i);
  assert.equal((await User.findById(exactCustomer._id)).walletBalance, 4000);
  assert.equal(await Transaction.countDocuments({ customerId: exactCustomer._id }), 1);

  const insufficientCustomer = await createCustomer({ walletBalance: 10000 });
  insufficientCustomer.walletHeldBalance = 4000;
  await insufficientCustomer.save();
  const insufficientDelivery = await createUnpaidDelivery({
    customer: insufficientCustomer,
    deliveryFee: 6001,
    trackingNumber: "SP-DELIVERY-HELD-INSUFFICIENT",
  });
  const insufficientPayment = await call(deliveryController.payDeliveryFee, {
    user: insufficientCustomer,
    params: { id: String(insufficientDelivery._id) },
  });
  assert.equal(insufficientPayment.status, 400);
  assert.equal(insufficientPayment.body.code, "INSUFFICIENT_SPENDABLE_BALANCE");
  assert.equal(insufficientPayment.body.spendableBalance, 6000);
  const unchangedInsufficientWallet = await User.findById(insufficientCustomer._id).lean();
  assert.equal(unchangedInsufficientWallet.walletBalance, 10000);
  assert.equal(unchangedInsufficientWallet.walletHeldBalance, 4000);
  assert.equal((await Delivery.findById(insufficientDelivery._id)).paymentStatus, "UNPAID");
  assert.equal(await Transaction.countDocuments({ customerId: insufficientCustomer._id }), 0);

  const fullyHeldCustomer = await createCustomer({ walletBalance: 10000 });
  fullyHeldCustomer.walletHeldBalance = 10000;
  await fullyHeldCustomer.save();
  const fullyHeldDelivery = await createUnpaidDelivery({
    customer: fullyHeldCustomer,
    deliveryFee: 1,
    trackingNumber: "SP-DELIVERY-FULLY-HELD",
  });
  const fullyHeldPayment = await call(deliveryController.payDeliveryFee, {
    user: fullyHeldCustomer,
    params: { id: String(fullyHeldDelivery._id) },
  });
  assert.equal(fullyHeldPayment.status, 400);
  assert.equal(fullyHeldPayment.body.code, "INSUFFICIENT_SPENDABLE_BALANCE");
  const unchangedFullyHeldWallet = await User.findById(fullyHeldCustomer._id).lean();
  assert.equal(unchangedFullyHeldWallet.walletBalance, 10000);
  assert.equal(unchangedFullyHeldWallet.walletHeldBalance, 10000);
  assert.equal((await Delivery.findById(fullyHeldDelivery._id)).paymentStatus, "UNPAID");

  const zeroHoldCustomer = await createCustomer({ walletBalance: 10000 });
  zeroHoldCustomer.walletHeldBalance = 0;
  await zeroHoldCustomer.save();
  const zeroHoldDelivery = await createUnpaidDelivery({
    customer: zeroHoldCustomer,
    deliveryFee: 10000,
    trackingNumber: "SP-DELIVERY-ZERO-HOLD",
  });
  const zeroHoldPayment = await call(deliveryController.payDeliveryFee, {
    user: zeroHoldCustomer,
    params: { id: String(zeroHoldDelivery._id) },
  });
  assert.equal(zeroHoldPayment.status, 200, JSON.stringify(zeroHoldPayment.body));
  const zeroHoldWallet = await User.findById(zeroHoldCustomer._id).lean();
  assert.equal(zeroHoldWallet.walletBalance, 0);
  assert.equal(zeroHoldWallet.walletHeldBalance, 0);
  assert.equal(zeroHoldPayment.body.transaction.amount, 10000);
});

test("Admin payment edits cannot forge payment evidence or reopen paid deliveries", async () => {
  const customer = await createCustomer();
  const created = await call(deliveryController.createDelivery, {
    user: customer,
    body: {
      idempotencyKey: "delivery-paid-status-locked",
      pickupAddress: "12 Pickup Road, Kano",
      deliveryAddress: "7 Receiver Close, Kano",
      senderName: "Sender",
      senderPhone: "08030000001",
      receiverName: "Receiver",
      receiverPhone: "08030000002",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const deliveryId = String(created.body.delivery._id);

  const paidEdit = await call(adminController.updateDeliveryPrice, {
    params: { id: deliveryId },
    body: { deliveryFee: 2000, adminNote: "Verified delivery details." },
  });
  assert.equal(paidEdit.status, 200, JSON.stringify(paidEdit.body));
  assert.equal((await Delivery.findById(deliveryId)).paymentStatus, "PAID");
  assert.equal((await Delivery.findById(deliveryId)).adminNote, "Verified delivery details.");

  const paidToUnpaid = await call(deliveryController.updatePaymentStatus, {
    params: { id: deliveryId },
    body: { paymentStatus: "UNPAID" },
  });
  assert.equal(paidToUnpaid.status, 409);
  assert.equal(paidToUnpaid.body.code, "DELIVERY_PAYMENT_STATUS_REQUIRES_LEDGER");
  assert.equal((await Delivery.findById(deliveryId)).paymentStatus, "PAID");

  const paidReprice = await call(adminController.updateDeliveryPrice, {
    params: { id: deliveryId },
    body: { deliveryFee: 2300 },
  });
  assert.equal(paidReprice.status, 400);
  assert.equal(paidReprice.body.code, "PAID_DELIVERY_PRICE_LOCKED");
  assert.equal((await Delivery.findById(deliveryId)).deliveryFee, 2000);

  const secondPayment = await call(deliveryController.payDeliveryFee, {
    user: customer,
    params: { id: deliveryId },
  });
  assert.equal(secondPayment.status, 400);
  assert.match(secondPayment.body.message, /already been paid/i);
  assert.equal((await User.findById(customer._id)).walletBalance, 3000);
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 1);

  const unpaidCustomer = await createCustomer();
  const unpaidDelivery = await createUnpaidDelivery({
    customer: unpaidCustomer,
    deliveryFee: 1500,
    trackingNumber: "SP-DELIVERY-UNPAID-ADMIN-LOCK",
  });
  for (const paymentStatus of ["PAID", "REFUNDED"]) {
    const directToggle = await call(deliveryController.updatePaymentStatus, {
      params: { id: String(unpaidDelivery._id) },
      body: { paymentStatus },
    });
    assert.equal(directToggle.status, 409);
    const priceToggle = await call(adminController.updateDeliveryPrice, {
      params: { id: String(unpaidDelivery._id) },
      body: { deliveryFee: 1500, paymentStatus },
    });
    assert.equal(priceToggle.status, 409);
  }
  assert.equal((await Delivery.findById(unpaidDelivery._id)).paymentStatus, "UNPAID");
  assert.equal((await User.findById(unpaidCustomer._id)).walletBalance, 5000);
  assert.equal(await Transaction.countDocuments({ customerId: unpaidCustomer._id }), 0);

  const legacyPayment = await call(deliveryController.payDeliveryFee, {
    user: unpaidCustomer,
    params: { id: String(unpaidDelivery._id) },
  });
  assert.equal(legacyPayment.status, 200, JSON.stringify(legacyPayment.body));
  const preservedLegacyDelivery = await Delivery.findById(unpaidDelivery._id).lean();
  assert.equal(preservedLegacyDelivery.deliveryFee, 1500);
  assert.equal(preservedLegacyDelivery.pricingType, "CUSTOM");
  assert.equal(preservedLegacyDelivery.riderCommissionAmount, 600);
  assert.equal(preservedLegacyDelivery.servicepayProfit, 900);
  assert.equal(legacyPayment.body.transaction.amount, 1500);
  assert.equal(legacyPayment.body.transaction.servicepayProfit, 900);
  assert.equal(legacyPayment.body.transaction.providerResponse.riderShare, 600);
  assert.equal(legacyPayment.body.transaction.providerResponse.servicepayShare, 900);
  assert.equal((await User.findById(unpaidCustomer._id)).walletBalance, 3500);
});

test("fee edits lose deterministically to payment in both Admin fee setters", async () => {
  const raceCases = [
    {
      handler: adminController.updateDeliveryPrice,
      newFee: 2400,
      body: (newFee) => ({ deliveryFee: newFee }),
      trackingNumber: "SP-DELIVERY-ADMIN-PRICE-RACE",
    },
    {
      handler: deliveryController.setDeliveryFee,
      newFee: 1500,
      body: () => ({}),
      trackingNumber: "SP-DELIVERY-LEGACY-PRICE-RACE",
    },
  ];

  for (const raceCase of raceCases) {
    const customer = await createCustomer();
    const originalFee = raceCase.newFee === 1500 ? 1200 : 1800;
    const delivery = await createUnpaidDelivery({
      customer,
      deliveryFee: originalFee,
      trackingNumber: raceCase.trackingNumber,
    });
    const originalFindOneAndUpdate = Delivery.findOneAndUpdate;
    let signalWriteReached;
    let releaseWrite;
    let paused = false;
    const writeReached = new Promise((resolve) => {
      signalWriteReached = resolve;
    });
    const writeGate = new Promise((resolve) => {
      releaseWrite = resolve;
    });

    Delivery.findOneAndUpdate = function (filter, update, options) {
      const isTargetFeeEdit = !paused &&
        filter?.paymentStatus === "UNPAID" &&
        Number(update?.$set?.deliveryFee) === raceCase.newFee;
      if (isTargetFeeEdit) {
        paused = true;
        signalWriteReached();
        return writeGate.then(() =>
          originalFindOneAndUpdate.call(this, filter, update, options)
        );
      }
      return originalFindOneAndUpdate.call(this, filter, update, options);
    };

    let adminEdit;
    try {
      adminEdit = call(raceCase.handler, {
        params: { id: String(delivery._id) },
        body: raceCase.body(raceCase.newFee),
      });
      await writeReached;
      const paid = await call(deliveryController.payDeliveryFee, {
        user: customer,
        params: { id: String(delivery._id) },
      });
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      releaseWrite();
      const edit = await adminEdit;
      assert.ok([400, 409].includes(edit.status), JSON.stringify(edit.body));
      const finalDelivery = await Delivery.findById(delivery._id).lean();
      assert.equal(finalDelivery.paymentStatus, "PAID");
      assert.equal(finalDelivery.deliveryFee, originalFee);
      assert.equal((await User.findById(customer._id)).walletBalance, 5000 - originalFee);
      const transactions = await Transaction.find({
        customerId: customer._id,
        serviceType: "DELIVERY",
      }).lean();
      assert.equal(transactions.length, 1);
      assert.equal(transactions[0].amount, originalFee);
      assert.equal(transactions[0].status, "SUCCESSFUL");
    } finally {
      releaseWrite();
      Delivery.findOneAndUpdate = originalFindOneAndUpdate;
    }
  }
});

test("unpaid completed delivery cannot credit a Rider or create payment evidence", async () => {
  const customer = await createCustomer();
  const rider = await createRider();
  const delivery = await createUnpaidDelivery({
    customer,
    deliveryFee: 2000,
    trackingNumber: "SP-DELIVERY-UNPAID-COMMISSION",
    status: "DELIVERED",
    pricingType: "STANDARD",
    assignedRiderId: rider._id,
  });

  const result = await creditRiderCommissionIfEligible({
    deliveryId: delivery._id,
    riderId: rider._id,
  });
  assert.equal(result.credited, false);
  assert.equal(result.reason, "DELIVERY_NOT_PAID");
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 0);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: rider._id }), 0);
  const unchangedRider = await User.findById(rider._id).lean();
  assert.equal(unchangedRider.totalRiderEarnings, 0);
  assert.equal(unchangedRider.pendingRiderSettlement, 0);
  assert.equal((await Delivery.findById(delivery._id)).riderCommissionCredited, false);
});

test("Delivery commission calculation preserves legacy, configured, standard, and fixed modes", () => {
  const legacy = new Delivery({
    deliveryFee: 1500,
    pricingType: "CUSTOM",
    riderCommissionType: "PERCENTAGE",
    riderCommissionValue: 35,
  });
  const legacySplit = legacy.calculateCommission();
  assert.equal(legacySplit.riderCommissionAmount, 600);
  assert.equal(legacySplit.servicepayProfit, 900);

  const configured = new Delivery({
    deliveryFee: 2000,
    pricingType: "CUSTOM",
    riderCommissionType: "PERCENTAGE",
    riderCommissionValue: 35,
    riderCommissionPercentageConfigured: true,
  });
  const configuredSplit = configured.calculateCommission();
  assert.equal(configuredSplit.riderCommissionAmount, 700);
  assert.equal(configuredSplit.servicepayProfit, 1300);

  const standard = new Delivery({
    deliveryFee: 2000,
    pricingType: "STANDARD",
    riderCommissionType: "PERCENTAGE",
    riderCommissionValue: 35,
    riderCommissionPercentageConfigured: true,
  });
  const standardSplit = standard.calculateCommission();
  assert.equal(standardSplit.riderCommissionAmount, 600);
  assert.equal(standardSplit.servicepayProfit, 1400);

  const fixed = new Delivery({
    deliveryFee: 2000,
    pricingType: "CUSTOM",
    riderCommissionType: "FIXED",
    riderCommissionValue: 333,
    riderCommissionPercentageConfigured: true,
  });
  const fixedSplit = fixed.calculateCommission();
  assert.equal(fixedSplit.riderCommissionAmount, 333);
  assert.equal(fixedSplit.servicepayProfit, 1667);
});

test("Admin-approved CUSTOM 35 percent split flows through charge and Rider credit", async () => {
  const customer = await createCustomer();
  const rider = await createRider();
  const delivery = await createUnpaidDelivery({
    customer,
    deliveryFee: 2000,
    trackingNumber: "SP-DELIVERY-CUSTOM-35-PCT",
    assignedRiderId: rider._id,
  });

  const configured = await call(adminController.updateDeliveryPrice, {
    params: { id: String(delivery._id) },
    body: {
      deliveryFee: 2000,
      riderCommissionType: "PERCENTAGE",
      riderCommissionValue: 35,
    },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const configuredDelivery = await Delivery.findById(delivery._id).lean();
  assert.equal(configuredDelivery.pricingType, "CUSTOM");
  assert.equal(configuredDelivery.riderCommissionPercentageConfigured, true);
  assert.equal(configuredDelivery.riderCommissionAmount, 700);
  assert.equal(configuredDelivery.servicepayProfit, 1300);
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 0);

  const payment = await call(deliveryController.payDeliveryFee, {
    user: customer,
    params: { id: String(delivery._id) },
  });
  assert.equal(payment.status, 200, JSON.stringify(payment.body));
  assert.equal(payment.body.transaction.amount, 2000);
  assert.equal(payment.body.transaction.servicepayProfit, 1300);
  assert.equal(payment.body.transaction.providerResponse.riderShare, 700);
  assert.equal(payment.body.transaction.providerResponse.servicepayShare, 1300);
  assert.equal((await User.findById(customer._id)).walletBalance, 3000);

  await Delivery.updateOne(
    { _id: delivery._id },
    { $set: { status: "DELIVERED" } }
  );
  const credited = await creditRiderCommissionIfEligible({
    deliveryId: delivery._id,
    riderId: rider._id,
  });
  assert.equal(credited.credited, true);
  assert.equal(credited.amount, 700);
  assert.equal(credited.servicepayProfit, 1300);
  assert.equal((await User.findById(rider._id)).totalRiderEarnings, 700);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: rider._id }), 1);
});

test("legacy fee setter no-ops on a same-fee STANDARD delivery", async () => {
  const customer = await createCustomer();
  const delivery = await createUnpaidDelivery({
    customer,
    deliveryFee: 1500,
    trackingNumber: "SP-DELIVERY-STANDARD-SETTER-NOOP",
    pricingType: "STANDARD",
  });
  delivery.riderCommissionValue = 30;
  await delivery.save();
  const beforeSetter = await Delivery.findById(delivery._id).lean();

  const setFee = await call(deliveryController.setDeliveryFee, {
    params: { id: String(delivery._id) },
  });
  assert.equal(setFee.status, 200, JSON.stringify(setFee.body));
  const afterSetter = await Delivery.findById(delivery._id).lean();
  assert.equal(afterSetter.deliveryFee, 1500);
  assert.equal(afterSetter.pricingType, "STANDARD");
  assert.equal(afterSetter.riderCommissionPercentageConfigured, false);
  assert.equal(afterSetter.updatedAt.getTime(), beforeSetter.updatedAt.getTime());
  assert.equal(afterSetter.riderCommissionAmount, beforeSetter.riderCommissionAmount);
  assert.equal(afterSetter.servicepayProfit, beforeSetter.servicepayProfit);
  assert.equal(afterSetter.commissionCalculatedAt, null);
  assert.equal((await User.findById(customer._id)).walletBalance, 5000);
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 0);

  const payment = await call(deliveryController.payDeliveryFee, {
    user: customer,
    params: { id: String(delivery._id) },
  });
  assert.equal(payment.status, 200, JSON.stringify(payment.body));
  assert.equal(payment.body.transaction.amount, 1500);
  assert.equal(payment.body.transaction.providerResponse.riderShare, 450);
  assert.equal(payment.body.transaction.providerResponse.servicepayShare, 1050);
  assert.equal((await User.findById(customer._id)).walletBalance, 3500);
  assert.equal(await Transaction.countDocuments({ customerId: customer._id }), 1);
});

test("Rider commission needs matching successful payment and credits standard/legacy split once", async () => {
  const standardCustomer = await createCustomer();
  const standardRider = await createRider();
  const standardDelivery = await createUnpaidDelivery({
    customer: standardCustomer,
    deliveryFee: 2000,
    trackingNumber: "SP-DELIVERY-PAID-STANDARD-COMMISSION",
    status: "DELIVERED",
    paymentStatus: "PAID",
    pricingType: "STANDARD",
    assignedRiderId: standardRider._id,
  });
  await createDeliveryPaymentTransaction({
    customer: standardCustomer,
    delivery: standardDelivery,
    amount: 1999,
  });

  const mismatchedPayment = await creditRiderCommissionIfEligible({
    deliveryId: standardDelivery._id,
    riderId: standardRider._id,
  });
  assert.equal(mismatchedPayment.credited, false);
  assert.equal(mismatchedPayment.reason, "DELIVERY_PAYMENT_TRANSACTION_NOT_FOUND");
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: standardRider._id }), 0);

  await createDeliveryPaymentTransaction({
    customer: standardCustomer,
    delivery: standardDelivery,
    amount: 2000,
    reference: `DELIVERY-PAYMENT-MATCHED-${standardDelivery._id}`,
  });
  const firstCredit = await creditRiderCommissionIfEligible({
    deliveryId: standardDelivery._id,
    riderId: standardRider._id,
  });
  assert.equal(firstCredit.credited, true);
  assert.equal(firstCredit.amount, 600);
  assert.equal(firstCredit.servicepayProfit, 1400);
  const duplicateCredit = await creditRiderCommissionIfEligible({
    deliveryId: standardDelivery._id,
    riderId: standardRider._id,
  });
  assert.equal(duplicateCredit.credited, false);
  assert.equal(duplicateCredit.reason, "ALREADY_CREDITED");
  assert.equal(duplicateCredit.amount, 600);
  const creditedStandardRider = await User.findById(standardRider._id).lean();
  assert.equal(creditedStandardRider.totalRiderEarnings, 600);
  assert.equal(creditedStandardRider.pendingRiderSettlement, 600);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: standardRider._id }), 1);
  const creditedStandardDelivery = await Delivery.findById(standardDelivery._id).lean();
  assert.equal(creditedStandardDelivery.riderCommissionAmount, 600);
  assert.equal(creditedStandardDelivery.servicepayProfit, 1400);

  const legacyCustomer = await createCustomer();
  const legacyRider = await createRider();
  const legacyDelivery = await createUnpaidDelivery({
    customer: legacyCustomer,
    deliveryFee: 1500,
    trackingNumber: "SP-DELIVERY-PAID-LEGACY-COMMISSION",
    status: "DELIVERED",
    paymentStatus: "PAID",
    pricingType: "CUSTOM",
    assignedRiderId: legacyRider._id,
  });
  await createDeliveryPaymentTransaction({
    customer: legacyCustomer,
    delivery: legacyDelivery,
  });
  const legacyCredit = await creditRiderCommissionIfEligible({
    deliveryId: legacyDelivery._id,
    riderId: legacyRider._id,
  });
  assert.equal(legacyCredit.credited, true);
  assert.equal(legacyCredit.amount, 600);
  assert.equal(legacyCredit.servicepayProfit, 900);
  const creditedLegacyRider = await User.findById(legacyRider._id).lean();
  assert.equal(creditedLegacyRider.totalRiderEarnings, 600);
  assert.equal(await RiderWalletLedger.countDocuments({ riderId: legacyRider._id }), 1);
});

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
      amount: 2000,
    }),
    1
  );
  assert.equal((await User.findById(customer._id)).walletBalance, 3000);

  const conflict = await call(deliveryController.createDelivery, {
    user: customer,
    body: { ...body, deliveryAddress: "A different destination." },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "DELIVERY_IDEMPOTENCY_KEY_REUSED");
  assert.equal((await User.findById(customer._id)).walletBalance, 3000);
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
      amount: 2000,
    }),
    1
  );
  assert.equal((await User.findById(customer._id)).walletBalance, 3000);
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