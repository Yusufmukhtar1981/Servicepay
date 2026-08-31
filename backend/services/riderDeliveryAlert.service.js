const RiderDeviceToken = require("../models/riderDeviceToken.model");
const DeliveryAlertDispatch = require("../models/deliveryAlertDispatch.model");

const DELIVERY_ASSIGNMENT_CHANNEL_ID =
  "servicepay_delivery_assignments_v2";
const DELIVERY_ASSIGNMENT_SOUND = "servicepay_delivery_order";
const FIREBASE_PROJECT_ID = "servicepay-68b17";

let firebaseInitializationAttempted = false;
let firebaseUnavailableReason = null;
let firebaseAdmin = null;

const parseServiceAccount = (source) => {
  const raw = String(source || "").trim();
  if (!raw) return null;

  const candidates = [raw];
  try {
    candidates.push(Buffer.from(raw, "base64").toString("utf8").trim());
  } catch (_) {
    // The direct JSON representation is still attempted below.
  }

  for (const candidate of candidates) {
    try {
      let parsed = JSON.parse(candidate);
      if (typeof parsed === "string") parsed = JSON.parse(parsed);
      if (parsed && typeof parsed === "object") {
        return {
          ...parsed,
          private_key: String(parsed.private_key || "").replace(/\\n/g, "\n"),
        };
      }
    } catch (_) {
      // Try the next supported representation.
    }
  }

  return null;
};

const firebaseConfiguration = () => {
  const source = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!source) {
    return {
      source: null,
      reason: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured",
    };
  }

  const serviceAccount = parseServiceAccount(source);
  if (
    !serviceAccount?.project_id ||
    !serviceAccount?.client_email ||
    !serviceAccount?.private_key
  ) {
    return {
      source: null,
      reason: "FIREBASE_SERVICE_ACCOUNT_JSON is invalid",
    };
  }
  if (serviceAccount.project_id !== FIREBASE_PROJECT_ID) {
    return {
      source: null,
      reason: "Firebase project does not match the ServicePay Android app",
    };
  }

  return { source: serviceAccount, reason: null };
};

const logFirebaseConfigurationStatus = () => {
  const messaging = firebaseMessaging();
  if (!messaging) {
    console.warn(
      `[PUSH] Rider delivery alerts unavailable: ${firebaseUnavailableReason}.`
    );
    return false;
  }

  console.log(
    `[PUSH] Firebase Admin initialized (project=${FIREBASE_PROJECT_ID}).`
  );
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

const firebaseDiagnosticStatus = () => ({
  available: Boolean(firebaseMessaging()),
  projectId: FIREBASE_PROJECT_ID,
  reason: firebaseUnavailableReason,
});

const tokenSuffix = (token) => String(token || "").slice(-8);
const safeRiderId = (riderId) => String(riderId || "").slice(-24);
const safeLocation = (value) => String(value || "").trim().slice(0, 180);
const deliveryAlertData = ({
  type,
  delivery,
  assignmentEventId,
}) => {
  const pickupLocation = safeLocation(delivery.pickupAddress);
  const dropoffLocation = safeLocation(delivery.deliveryAddress);
  const deliveryReference = String(delivery.trackingNumber || "")
    .trim()
    .slice(0, 80);

  return {
    type,
    event: type,
    title:
      type === "DELIVERY_ASSIGNED"
        ? "Delivery Assigned"
        : "Delivery Assignment Cancelled",
    body:
      deliveryReference
        ? `Delivery ${deliveryReference} is ready. Tap to view details.`
        : "A delivery is ready. Tap to view details.",
    orderId: String(delivery._id),
    deliveryId: String(delivery._id),
    deliveryReference,
    pickupLocation,
    dropoffLocation,
    assignedAt: delivery.assignedAt
      ? new Date(delivery.assignedAt).toISOString()
      : "",
    assignmentEventId: String(assignmentEventId),
    notificationChannelId: DELIVERY_ASSIGNMENT_CHANNEL_ID,
    notificationSound: DELIVERY_ASSIGNMENT_SOUND,
  };
};

const invalidTokenIds = (responses, devices) => responses.reduce((ids, result, index) => {
  const code = result.error?.code;
  if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
    ids.push(devices[index]._id);
  }
  return ids;
}, []);

const retryableFirebaseCode = (code) =>
  [
    "messaging/internal-error",
    "messaging/server-unavailable",
    "messaging/unknown-error",
  ].includes(code);

const sendMulticastWithRetry = async ({
  messaging,
  message,
  delay = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) => {
  try {
    return await messaging.sendEachForMulticast(message);
  } catch (error) {
    if (!retryableFirebaseCode(error?.code)) throw error;
    await delay(250);
    return messaging.sendEachForMulticast(message);
  }
};

const updateDispatchSafely = async (dispatchId, values) => {
  try {
    await DeliveryAlertDispatch.updateOne(
      { _id: dispatchId },
      { ...values, completedAt: new Date() }
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
      console.warn(
        `[PUSH] Rider assignment skipped rider=${safeRiderId(riderId)} ` +
          "online=true activeTokens=0 outcome=no-active-devices."
      );
      await updateDispatchSafely(dispatch._id, {
        status: "SKIPPED",
        lastError: "no-active-devices",
      });
      return {
        sent: false,
        skipped: true,
        reason: "no-active-devices",
        activeTokenCount: 0,
      };
    }
    const messaging = firebaseMessaging();
    if (!messaging) {
      console.warn(
        `[PUSH] Rider assignment skipped rider=${safeRiderId(riderId)} ` +
          `online=true activeTokens=${tokens.length} outcome=firebase-unavailable ` +
          `reason=${firebaseUnavailableReason}.`
      );
      await updateDispatchSafely(dispatch._id, {
        status: "SKIPPED",
        lastError: firebaseUnavailableReason,
      });
      return {
        sent: false,
        skipped: true,
        reason: firebaseUnavailableReason,
        activeTokenCount: tokens.length,
      };
    }
    const data = deliveryAlertData({
      type,
      delivery,
      assignmentEventId,
    });
    const android = {
      priority: "high",
      ttl: 5 * 60 * 1000,
      collapseKey: `delivery-${String(delivery._id)}`,
    };
    const response = await sendMulticastWithRetry({
      messaging,
      message: {
      tokens: tokens.map((device) => device.token),
      data,
      android,
      },
    });
    const finalResponses = [...response.responses];
    const retryIndexes = finalResponses.reduce((indexes, result, index) => {
      if (!result.success && retryableFirebaseCode(result.error?.code)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
    if (retryIndexes.length) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const retry = await sendMulticastWithRetry({
        messaging,
        message: {
          tokens: retryIndexes.map((index) => tokens[index].token),
          data,
          android,
        },
      });
      retryIndexes.forEach((originalIndex, retryIndex) => {
        finalResponses[originalIndex] = retry.responses[retryIndex];
      });
    }
    const successCount = finalResponses.filter((result) => result.success).length;
    const failureCount = finalResponses.length - successCount;
    const invalidIds = invalidTokenIds(finalResponses, tokens);
    if (invalidIds.length) await RiderDeviceToken.updateMany({ _id: { $in: invalidIds } }, { $set: { active: false } });
    const sent = successCount > 0;
    await updateDispatchSafely(dispatch._id, {
      status: sent ? "SENT" : "FAILED",
      successCount,
      failureCount,
      lastError: sent ? "" : "firebase-provider-rejected",
    });
    console.log(
      `[PUSH] Rider assignment rider=${safeRiderId(riderId)} online=true ` +
        `activeTokens=${tokens.length} outcome=${sent ? "accepted" : "rejected"} ` +
        `success=${successCount} failure=${failureCount}.`
    );
    return {
      sent,
      providerAccepted: sent,
      successes: successCount,
      failures: failureCount,
      activeTokenCount: tokens.length,
    };
  } catch (error) {
    console.error(
      `[PUSH] Rider assignment failed rider=${safeRiderId(riderId)} ` +
        `outcome=dispatch-exception reason=${error?.code || error?.name || "unknown"}.`
    );
    await updateDispatchSafely(dispatch._id, {
      status: "FAILED",
      lastError: "dispatch-exception",
    });
    return { sent: false, failed: true };
  }
};

const sendAssignmentAlertIfOnline = async ({ rider, delivery }) => {
  if (rider?.availabilityStatus !== "ONLINE") {
    console.warn(
      `[PUSH] Rider assignment skipped rider=${safeRiderId(rider?._id)} ` +
        "online=false activeTokens=unknown outcome=rider-offline."
    );
    return { sent: false, skipped: true, reason: "rider-offline" };
  }
  return sendDeliveryAlert({
    type: "DELIVERY_ASSIGNED",
    riderId: rider._id,
    delivery,
    assignmentEventId: delivery.assignmentEventId,
  });
};

const sendRiderDiagnosticAlert = async ({ rider }) => {
  const riderId = rider?._id;
  if (rider?.availabilityStatus !== "ONLINE") {
    return {
      sent: false,
      skipped: true,
      reason: "rider-offline",
      activeTokenCount: 0,
    };
  }

  const devices = await RiderDeviceToken.find({ riderId, active: true })
    .select("+token")
    .lean();
  if (!devices.length) {
    return {
      sent: false,
      skipped: true,
      reason: "no-active-devices",
      activeTokenCount: 0,
    };
  }

  const messaging = firebaseMessaging();
  if (!messaging) {
    return {
      sent: false,
      skipped: true,
      reason: firebaseUnavailableReason,
      activeTokenCount: devices.length,
    };
  }

  const diagnosticId = `diagnostic-${Date.now()}`;
  const response = await sendMulticastWithRetry({
    messaging,
    message: {
      tokens: devices.map((device) => device.token),
      data: {
        type: "DELIVERY_ASSIGNED",
        event: "DELIVERY_ASSIGNED",
        title: "Delivery Alert Test",
        body: "ServicePay delivery ringing diagnostic.",
        orderId: diagnosticId,
        deliveryId: diagnosticId,
        deliveryReference: "DIAGNOSTIC",
        pickupLocation: "ServicePay test pickup",
        dropoffLocation: "ServicePay test destination",
        assignedAt: new Date().toISOString(),
        assignmentEventId: diagnosticId,
        notificationChannelId: DELIVERY_ASSIGNMENT_CHANNEL_ID,
        notificationSound: DELIVERY_ASSIGNMENT_SOUND,
        diagnostic: "true",
      },
      android: {
        priority: "high",
        ttl: 5 * 60 * 1000,
        collapseKey: diagnosticId,
      },
    },
  });

  const finalResponses = [...response.responses];
  const retryIndexes = finalResponses.reduce((indexes, result, index) => {
    if (!result.success && retryableFirebaseCode(result.error?.code)) {
      indexes.push(index);
    }
    return indexes;
  }, []);
  if (retryIndexes.length) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const retry = await sendMulticastWithRetry({
      messaging,
      message: {
        tokens: retryIndexes.map((index) => devices[index].token),
        data: {
          type: "DELIVERY_ASSIGNED",
          event: "DELIVERY_ASSIGNED",
          title: "Delivery Alert Test",
          body: "ServicePay delivery ringing diagnostic.",
          orderId: diagnosticId,
          deliveryId: diagnosticId,
          deliveryReference: "DIAGNOSTIC",
          pickupLocation: "ServicePay test pickup",
          dropoffLocation: "ServicePay test destination",
          assignedAt: new Date().toISOString(),
          assignmentEventId: diagnosticId,
          notificationChannelId: DELIVERY_ASSIGNMENT_CHANNEL_ID,
          notificationSound: DELIVERY_ASSIGNMENT_SOUND,
          diagnostic: "true",
        },
        android: {
          priority: "high",
          ttl: 5 * 60 * 1000,
          collapseKey: diagnosticId,
        },
      },
    });
    retryIndexes.forEach((originalIndex, retryIndex) => {
      finalResponses[originalIndex] = retry.responses[retryIndex];
    });
  }

  const successCount = finalResponses.filter((result) => result.success).length;
  const failureCount = finalResponses.length - successCount;
  const invalidIds = invalidTokenIds(finalResponses, devices);
  if (invalidIds.length) {
    await RiderDeviceToken.updateMany(
      { _id: { $in: invalidIds } },
      { $set: { active: false } }
    );
  }

  const result = {
    sent: successCount > 0,
    providerAccepted: successCount > 0,
    successes: successCount,
    failures: failureCount,
    activeTokenCount: devices.length,
    reason: successCount > 0 ? null : "firebase-provider-rejected",
  };
  console.log(
    `[PUSH] Rider diagnostic rider=${safeRiderId(riderId)} online=true ` +
      `activeTokens=${devices.length} outcome=${result.sent ? "accepted" : "rejected"} ` +
      `success=${result.successes} failure=${result.failures}.`
  );
  return result;
};

const sendAssignmentCancellation = async ({ riderId, delivery, assignmentEventId }) =>
  sendDeliveryAlert({ type: "DELIVERY_ASSIGNMENT_CANCELLED", riderId, delivery, assignmentEventId });

module.exports = {
  sendDeliveryAlert,
  sendAssignmentAlertIfOnline,
  sendRiderDiagnosticAlert,
  sendAssignmentCancellation,
  invalidTokenIds,
  deliveryAlertData,
  DELIVERY_ASSIGNMENT_CHANNEL_ID,
  DELIVERY_ASSIGNMENT_SOUND,
  retryableFirebaseCode,
  sendMulticastWithRetry,
  logFirebaseConfigurationStatus,
  firebaseDiagnosticStatus,
  tokenSuffix,
  FIREBASE_PROJECT_ID,
};