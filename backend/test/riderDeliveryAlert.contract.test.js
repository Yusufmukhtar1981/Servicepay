const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const Delivery = require("../models/delivery.model");
const RiderDeviceToken = require("../models/riderDeviceToken.model");
const DeliveryAlertDispatch = require("../models/deliveryAlertDispatch.model");
const alerts = require("../services/riderDeliveryAlert.service");

test("device registrations are privately owned and tokens are globally unique", () => {
  const token = RiderDeviceToken.schema.path("token");
  assert.equal(token.options.unique, true);
  assert.equal(token.options.select, false);
  assert.equal(RiderDeviceToken.schema.path("riderId").options.required, true);
});

test("deliveries persist a distinct assignment event identifier", () => {
  assert.equal(Delivery.schema.path("assignmentEventId").instance, "String");
  const indexes = DeliveryAlertDispatch.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    fields.assignmentEventId === 1 &&
    fields.type === 1 &&
    fields.riderId === 1 &&
    options.unique
  ));
});

test("assignment payload contains the Android ringing and deep-link contract", () => {
  const data = alerts.deliveryAlertData({
    type: "DELIVERY_ASSIGNED",
    delivery: {
      _id: "delivery-id",
      trackingNumber: "SP-42",
      pickupAddress: "1 Pickup Way",
      deliveryAddress: "2 Dropoff Way",
      assignedAt: new Date("2026-08-30T12:00:00.000Z"),
    },
    assignmentEventId: "assignment-42",
  });

  assert.deepEqual(data, {
    type: "DELIVERY_ASSIGNED",
    event: "DELIVERY_ASSIGNED",
    title: "Delivery Assigned",
    body: "Delivery SP-42 is ready. Tap to view details.",
    orderId: "delivery-id",
    deliveryId: "delivery-id",
    deliveryReference: "SP-42",
    pickupLocation: "1 Pickup Way",
    dropoffLocation: "2 Dropoff Way",
    assignedAt: "2026-08-30T12:00:00.000Z",
    assignmentEventId: "assignment-42",
    notificationChannelId: "servicepay_delivery_assignments_v2",
    notificationSound: "servicepay_delivery_order",
  });
});

test("only transient Firebase failures are retried", () => {
  assert.equal(alerts.retryableFirebaseCode("messaging/internal-error"), true);
  assert.equal(
    alerts.retryableFirebaseCode("messaging/server-unavailable"),
    true
  );
  assert.equal(
    alerts.retryableFirebaseCode("messaging/invalid-registration-token"),
    false
  );
});

test("a transient whole-call Firebase failure is retried once", async () => {
  let calls = 0;
  const messaging = {
    sendEachForMulticast: async () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error("temporarily unavailable");
        error.code = "messaging/server-unavailable";
        throw error;
      }
      return {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
    },
  };

  const result = await alerts.sendMulticastWithRetry({
    messaging,
    message: { tokens: ["token"], data: {} },
    delay: async () => {},
  });

  assert.equal(calls, 2);
  assert.equal(result.successCount, 1);
});

test("offline riders are skipped before any dispatch persistence", async () => {
  const result = await alerts.sendAssignmentAlertIfOnline({
    rider: { _id: "rider-id", availabilityStatus: "OFFLINE" },
    delivery: { _id: "delivery-id", assignmentEventId: "event-id" },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "rider-offline");
});

test("a duplicate assignment dispatch claim is idempotently skipped", async () => {
  const originalCreate = DeliveryAlertDispatch.create;
  DeliveryAlertDispatch.create = async () => {
    const error = new Error("duplicate");
    error.code = 11000;
    throw error;
  };
  try {
    const result = await alerts.sendDeliveryAlert({
      type: "DELIVERY_ASSIGNED",
      riderId: "rider-id",
      delivery: { _id: "delivery-id" },
      assignmentEventId: "event-id",
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already-dispatched");
  } finally {
    DeliveryAlertDispatch.create = originalCreate;
  }
});

test("delivery push failures are returned safely rather than thrown", async () => {
  const originalCreate = DeliveryAlertDispatch.create;
  const originalFind = RiderDeviceToken.find;
  const originalUpdate = DeliveryAlertDispatch.updateOne;
  DeliveryAlertDispatch.create = async () => ({ _id: "claim-id" });
  RiderDeviceToken.find = () => ({
    select: () => ({
      lean: async () => {
        throw new Error("device lookup unavailable");
      },
    }),
  });
  DeliveryAlertDispatch.updateOne = async () => {
    throw new Error("dispatch bookkeeping unavailable");
  };
  try {
    const result = await alerts.sendDeliveryAlert({
      type: "DELIVERY_ASSIGNED",
      riderId: "rider-id",
      delivery: { _id: "delivery-id" },
      assignmentEventId: "event-id",
    });
    assert.equal(result.failed, true);
    assert.equal(result.sent, false);
  } finally {
    DeliveryAlertDispatch.create = originalCreate;
    RiderDeviceToken.find = originalFind;
    DeliveryAlertDispatch.updateOne = originalUpdate;
  }
});

test("invalid or expired multicast registrations are selected for deactivation", () => {
  const ids = alerts.invalidTokenIds(
    [
      { success: true },
      { error: { code: "messaging/registration-token-not-registered" } },
      { error: { code: "messaging/invalid-registration-token" } },
      { error: { code: "messaging/internal-error" } },
    ],
    [{ _id: "ok" }, { _id: "expired" }, { _id: "invalid" }, { _id: "retry" }]
  );
  assert.deepEqual(ids, ["expired", "invalid"]);
});

test("Rider alert service loads when the optional Firebase SDK is unavailable", () => {
  const servicePath = path.resolve(
    __dirname,
    "../services/riderDeliveryAlert.service.js"
  );
  const script = `
    const Module = require("node:module");
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      if (request === "firebase-admin") {
        throw new Error("firebase-admin unavailable");
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    require(${JSON.stringify(servicePath)});
  `;
  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
});

test("missing Firebase credentials produce a safe non-fatal warning", () => {
  const originalValue = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const originalWarn = console.warn;
  const warnings = [];

  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(alerts.logFirebaseConfigurationStatus(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Rider delivery alerts unavailable/);
    assert.match(warnings[0], /not configured/);
  } finally {
    console.warn = originalWarn;
    if (originalValue === undefined) {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalValue;
    }
  }
});