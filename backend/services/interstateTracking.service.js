const crypto = require("crypto");
const Shipment = require("../models/interstateShipment.model");
const User = require("../models/user.model");
const email = require("./email.service");

const trackingNumber = () => `SP-INT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const statusLabel = (value) => ({
  RECEIVED_AT_ORIGIN_HUB: "Received at ServicePay", PICKUP_ASSIGNED: "Rider assigned",
  PICKED_UP: "Picked up", VERIFIED_AT_ORIGIN_HUB: "Verified at origin office",
  READY_FOR_INTERSTATE_DISPATCH: "Ready for dispatch", IN_TRANSIT: "In transit",
  ARRIVED_AT_DESTINATION_HUB: "Arrived at destination", DESTINATION_HUB_VERIFIED: "Verified at destination",
  OUT_FOR_DELIVERY: "Out for delivery", READY_FOR_COLLECTION: "Ready for collection",
  DELIVERY_ATTEMPTED: "Delivery attempted", DELIVERED: "Delivered", CANCELLED: "Cancelled",
}[value] || String(value || "").replaceAll("_", " ").toLowerCase());

const receiptHtml = (s) => {
  const rows = {
    "Order Reference": s.orderReference || String(s._id),
    "Customer / Sender": s.sender?.name,
    "Sender Phone": s.sender?.phone,
    "Receiver": s.receiver?.name,
    "Receiver Phone": s.receiver?.phone,
    "Origin": [s.sender?.state, s.sender?.lga, s.sender?.address].filter(Boolean).join(", "),
    "Destination": [s.receiver?.state, s.receiver?.lga, s.receiver?.address].filter(Boolean).join(", "),
    "Parcel Description": s.parcel?.description,
    "Delivery Charge": `NGN ${Number(s.quote?.total || 0).toFixed(2)}`,
    "Payment Status": s.paymentStatus,
    "Shipment Status": statusLabel(s.status),
    "Date / Time": new Date(s.createdAt).toISOString(),
    "ServicePay Office / Branch": s.officeName || String(s.originBranchId),
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ServicePay Interstate Receipt</title><style>body{font:16px Arial,sans-serif;max-width:750px;margin:40px auto;padding:24px;color:#17372b}h1{font-size:24px}h2{font-size:28px;border:2px solid #087644;padding:20px;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}th{width:35%}.actions{margin-top:28px}button{padding:12px}@media print{.actions{display:none}body{margin:0}}</style></head><body><h1>SERVICEPAY INTERSTATE LOGISTICS</h1><p>Customer receipt — keep this tracking number</p><h2>${escapeHtml(s.trackingNumber)}</h2><table>${Object.entries(rows).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</table><p>Track your shipment through ServicePay Interstate Logistics using the tracking number above.</p><div class="actions"><button onclick="window.print()">PRINT RECEIPT / SAVE AS PDF</button></div></body></html>`;
};

const attemptEmail = async (id, send = email.sendEmail) => {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const s = await Shipment.findOneAndUpdate({
    ...(id ? { _id: id } : {}),
    $or: [
      { "trackingEmail.status": { $in: ["PENDING", "RETRY"] }, "trackingEmail.nextAttemptAt": { $lte: now } },
      { "trackingEmail.status": "SENDING", "trackingEmail.leaseUntil": { $lte: now } },
    ],
  }, {
    $set: { "trackingEmail.status": "SENDING", "trackingEmail.leaseToken": leaseToken, "trackingEmail.leaseUntil": new Date(Date.now() + 5 * 60000) },
    $inc: { "trackingEmail.attempts": 1 },
  }, { new: true });
  if (!s) return false;
  let result;
  try {
    const text = `Your parcel has been received/registered by ServicePay.\nTracking Number: ${s.trackingNumber}\nOrigin: ${s.sender.state}\nDestination: ${s.receiver.state}\nReceiver: ${s.receiver.name}\nDate: ${new Date(s.createdAt).toISOString()}\nCurrent status: ${statusLabel(s.status)}\nOpen ServicePay > Interstate Logistics > Track and enter ${s.trackingNumber}.`;
    result = await send({
      to: s.trackingEmail.recipient,
      subject: `Your Servicepay Interstate Shipment – ${s.trackingNumber}`,
      text, html: `<div style="font:16px Arial"><h1>ServicePay Interstate Logistics</h1><p style="white-space:pre-line">${escapeHtml(text)}</p></div>`,
      idempotencyKey: `interstate-registration-${s._id}`,
    });
  } catch (_) { result = { success: false, reason: "EMAIL_SEND_FAILED" }; }
  const success = result?.success === true;
  await Shipment.updateOne({ _id: s._id, "trackingEmail.leaseToken": leaseToken }, {
    $set: {
      "trackingEmail.status": success ? "SENT" : "RETRY",
      ...(success ? { "trackingEmail.sentAt": new Date() } : {
        "trackingEmail.lastError": String(result?.reason || "EMAIL_SEND_FAILED").slice(0, 120),
        "trackingEmail.nextAttemptAt": new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(6, s.trackingEmail.attempts))),
      }),
    },
    $unset: { "trackingEmail.leaseToken": 1, "trackingEmail.leaseUntil": 1 },
  });
  return success;
};
const startWorker = () => {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { for (let i = 0; i < 10; i++) if (!await attemptEmail()) break; }
    catch (_) { /* Stored leases and RETRY records are recovered on the next tick. */ }
    finally { busy = false; }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  void tick();
  return timer;
};
const migrateTracking = async () => {
  const collection = Shipment.collection;
  // Never replace or rewrite an existing nonempty tracking number.
  await collection.createIndex({ trackingNumber: 1 }, {
    unique: true, name: "trackingNumber_string_unique",
    partialFilterExpression: { trackingNumber: { $type: "string", $gt: "" } },
  });
  await collection.createIndex({ officeIdempotencyKey: 1 }, { unique: true, name: "officeIdempotencyKey_string_unique", partialFilterExpression: { officeIdempotencyKey: { $type: "string" } } });
  await collection.createIndex({ assignedRiderId: 1, status: 1, createdAt: -1 });
  await collection.createIndex({ "trackingEmail.status": 1, "trackingEmail.nextAttemptAt": 1 });
  const missing = { $or: [{ trackingNumber: { $exists: false } }, { trackingNumber: null }, { trackingNumber: "" }] };
  const cursor = collection.find(missing, { projection: { _id: 1, customerId: 1, sender: 1 } });
  for await (const row of cursor) {
    let recipient = row.sender?.email;
    if (!recipient && row.customerId) recipient = (await User.findById(row.customerId).select("email").lean())?.email;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await collection.updateOne({ _id: row._id, ...missing }, { $set: {
          trackingNumber: trackingNumber(),
          orderType: "INTERSTATE",
          trackingEmail: { recipient, status: recipient ? "PENDING" : "MISSING_EMAIL", attempts: 0, nextAttemptAt: new Date() },
        } });
        break;
      } catch (error) { if (error.code !== 11000 || attempt === 3) throw error; }
    }
  }
};
module.exports = { trackingNumber, receiptHtml, statusLabel, attemptEmail, startWorker, migrateTracking };