const RiderDeviceToken = require("../models/riderDeviceToken.model");
const DeliveryAlertDispatch = require("../models/deliveryAlertDispatch.model");

let firebaseInitializationAttempted = false;
let firebaseUnavailableReason = null;
let firebaseAdmin = null;

const firebaseConfiguration = () => {
  const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!source) {
    return {
      source: null,
      reason: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured",
    };
  }

  try {
    const serviceAccount = JSON.parse(source);
    if (
      !serviceAccount.project_id ||
      !serviceAccount.client_email ||
      !serviceAccount.private_key
    ) {
      return {
        source: null,
        reason: "FIREBASE_SERVICE_ACCOUNT_JSON is invalid",
      };
    }

    return { source: serviceAccount, reason: null };
  } catch (_) {
    return {
      source: null,
      reason: "FIREBASE_SERVICE_ACCOUNT_JSON is invalid",
    };
  }
};

const logFirebaseConfigurationStatus = () => {
  const configuration = firebaseConfiguration();
  if (configuration.reason) {
    console.warn(
      `[PUSH] Rider delivery alerts unavailable: ${configuration.reason}.`
    );
    return false;
  }

  console.log("[PUSH] Rider delivery alerts configured.");
  return true;
};

const firebaseMessaging = () => {
  if (!firebaseInitializationAttempted) {
    firebaseInitializationAttempted = true;
    const configuration = firebaseConfiguration();
    if (configuration.reason) {
      firebaseUnavailableReason = configuration.reason;
    } else {
      try {
        // Load Firebase only when a push is actually needed so API startup never
        // depends on the optional notification SDK or its production secret.
        firebaseAdmin = require("firebase-admin");
        if (!firebaseAdmin.apps.length) {
          firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(configuration.source),
          });
        }
      } catch (_) {
        firebaseUnavailableReason = "Firebase SDK is unavailable";
      }
    }
  }
  return firebaseUnavailableReason ? null : firebaseAdmin.messaging();
};

const safeLocation = (value) => String(value || "").trim().slice(0, 500);
const invalidTokenIds = (responses, devices) => responses.reduce((ids, result, index) => {
  const code = result.error?.code;
  if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
    ids.push(devices[index]._id);
  }
  return ids;
}, []);

const updateDispatchSafely = async (dispatchId, status) => {
  try {
    await DeliveryAlertDispatch.updateOne(
      { _id: dispatchId },
      { status, completedAt: new Date() }
    );
  } catch (_) {
    // Dispatch bookkeeping must never affect the persisted delivery operation.
  }
};

const sendDeliveryAlert = async ({ type, riderId, delivery, assignmentEventId }) => {
  let dispatch;
  try {
    dispatch = await DeliveryAlertDispatch.create({
      assignmentEventId,
      type,
      riderId,
    });
  } catch (error) {
    if (error?.code === 11000) return { sent: false, skipped: true, reason: "already-dispatched" };
    return { sent: false, skipped: true, reason: "dispatch-unavailable" };
  }

  try {
    const tokens = await RiderDeviceToken.find({ riderId, active: true })
      .select("+token")
      .lean();
    if (!tokens.length) {
      await updateDispatchSafely(dispatch._id, "SKIPPED");
      return { sent: false, skipped: true, reason: "no-active-devices" };
    }
    const messaging = firebaseMessaging();
    if (!messaging) {
      await updateDispatchSafely(dispatch._id, "SKIPPED");
      return { sent: false, skipped: true, reason: firebaseUnavailableReason };
    }
    const data = {
      type,
      orderId: String(delivery._id),
      deliveryReference: String(delivery.trackingNumber || ""),
      pickupLocation: safeLocation(delivery.pickupAddress),
      dropoffLocation: safeLocation(delivery.deliveryAddress),
      assignedAt: delivery.assignedAt ? new Date(delivery.assignedAt).toISOString() : "",
      assignmentEventId: String(assignmentEventId),
    };
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((device) => device.token),
      data,
      android: {
        priority: "high",
        ttl: 60 * 1000,
        collapseKey: `delivery-${String(delivery._id)}`,
      },
    });
    const invalidIds = invalidTokenIds(response.responses, tokens);
    if (invalidIds.length) await RiderDeviceToken.updateMany({ _id: { $in: invalidIds } }, { $set: { active: false } });
    await updateDispatchSafely(dispatch._id, "SENT");
    return { sent: response.successCount > 0, failures: response.failureCount };
  } catch (_) {
    await updateDispatchSafely(dispatch._id, "FAILED");
    return { sent: false, failed: true };
  }
};

const sendAssignmentAlertIfOnline = async ({ rider, delivery }) => {
  if (rider?.availabilityStatus !== "ONLINE") return { sent: false, skipped: true, reason: "rider-offline" };
  return sendDeliveryAlert({
    type: "DELIVERY_ASSIGNED",
    riderId: rider._id,
    delivery,
    assignmentEventId: delivery.assignmentEventId,
  });
};

const sendAssignmentCancellation = async ({ riderId, delivery, assignmentEventId }) =>
  sendDeliveryAlert({ type: "DELIVERY_ASSIGNMENT_CANCELLED", riderId, delivery, assignmentEventId });

module.exports = {
  sendDeliveryAlert,
  sendAssignmentAlertIfOnline,
  sendAssignmentCancellation,
  invalidTokenIds,
  logFirebaseConfigurationStatus,
};