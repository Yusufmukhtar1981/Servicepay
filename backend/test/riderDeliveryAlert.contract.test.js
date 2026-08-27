const test = require("node:test");
const assert = require("node:assert/strict");

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