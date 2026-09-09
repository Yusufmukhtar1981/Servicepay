const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const https = require("node:https");
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;
const LEASE_MS = 30_000;
const equal = (a, b) => { const x = Buffer.from(String(a || "")); const y = Buffer.from(String(b || "")); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
const signature = (secret, timestamp, eventId, rawBody) => `sha256=${crypto.createHmac("sha256", secret).update(`${timestamp}.${eventId}.`).update(rawBody).digest("hex")}`;
function isPublicAddress(address) {
  const value = String(address).toLowerCase();
  if (value.startsWith("::ffff:")) {
    return isPublicAddress(value.slice("::ffff:".length));
  }
  if (value.includes(":")) {
    return !(/^(::|::1$|fe[89ab]|fe[c-f]|fc|fd|ff|2001:db8)/.test(value));
  }
  const parts = value.split(".").map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) && parts[0] > 0 && parts[0] < 224 &&
    parts[0] !== 10 && parts[0] !== 127 && !(parts[0] === 169 && parts[1] === 254) &&
    !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) &&
    !(parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) && !(parts[0] === 192 && (parts[1] === 0 || parts[1] === 168 || parts[1] === 2)) &&
    !(parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || (parts[1] === 51 && parts[2] === 100))) &&
    !(parts[0] === 203 && parts[1] === 0 && parts[2] === 113);
}
async function assertSafeCallback(value, nodeEnv, resolver = dns.lookup) {
  let url; try { url = new URL(value); } catch { throw new Error("callbackUrl must be a valid HTTPS URL."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("callbackUrl must be HTTPS without credentials.");
  if (nodeEnv === "test" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.vullResolvedAddress = url.hostname === "::1" ? "::1" : "127.0.0.1";
    return url;
  }
  const records = await resolver(url.hostname, { all: true });
  if (!records.length || records.some(record => !isPublicAddress(record.address))) throw new Error("callbackUrl host is not public.");
  url.vullResolvedAddress = records[0].address;
  return url;
}
function deliveryWorker(models, cfg, transport, resolver = dns.lookup) {
  const send = transport || ((url, headers, body, address) => new Promise((resolve, reject) => {
    const request = https.request(url, { method: "POST", headers, lookup: (_host, _options, callback) => callback(null, address, address.includes(":") ? 6 : 4) }, response => { response.resume(); resolve(response.statusCode); });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error("webhook delivery timed out");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.on("error", reject); request.end(body);
  }));
  async function deliver(event, now = new Date()) {
    const credential = await models.Credential.findOne({ environment: "SANDBOX", _id: event.credentialId });
    if (!credential?.callbackUrl) {
      await models.Webhook.updateOne(
        { environment: "SANDBOX", _id: event._id, leaseToken: event.leaseToken },
        { $set: { status: "DELIVERED", deliveredAt: now, leaseToken: null, leasedUntil: null } }
      );
      return;
    }
    const timestamp = String(Math.floor(now.getTime() / 1000));
    try {
      const url = await assertSafeCallback(credential.callbackUrl, cfg.nodeEnv, resolver);
      const status = await send(url, { "content-type": "application/json", "X-VULL-Event-ID": event.eventId, "X-VULL-Timestamp": timestamp, "X-VULL-Signature": signature(cfg.webhookSecret, timestamp, event.eventId, event.rawBody), "X-VULL-Environment": "SANDBOX" }, event.rawBody, url.vullResolvedAddress);
      const attempts = event.attempts + 1;
      const update = status >= 200 && status < 300
        ? { status: "DELIVERED", attempts, lastStatusCode: status, deliveredAt: now }
        : { status: attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY", attempts, lastStatusCode: status, nextAttemptAt: new Date(now.getTime() + 1000 * 2 ** (attempts - 1)) };
      await models.Webhook.updateOne(
        { environment: "SANDBOX", _id: event._id, leaseToken: event.leaseToken },
        { $set: { ...update, leaseToken: null, leasedUntil: null } }
      );
    } catch (error) {
      const attempts = event.attempts + 1;
      await models.Webhook.updateOne(
        { environment: "SANDBOX", _id: event._id, leaseToken: event.leaseToken },
        { $set: { status: attempts >= MAX_ATTEMPTS ? "FAILED" : "RETRY", attempts, lastErrorCode: "DELIVERY_FAILED", nextAttemptAt: new Date(now.getTime() + 1000 * 2 ** (attempts - 1)), leaseToken: null, leasedUntil: null } }
      );
    }
  }
  async function claimNext(now) {
    const leaseToken = crypto.randomUUID();
    return models.Webhook.findOneAndUpdate(
      {
        environment: "SANDBOX",
        status: { $in: ["PENDING", "RETRY"] },
        nextAttemptAt: { $lte: now },
        attempts: { $lt: MAX_ATTEMPTS },
        $or: [{ leasedUntil: null }, { leasedUntil: { $lte: now } }],
      },
      {
        $set: {
          leaseToken,
          leasedUntil: new Date(now.getTime() + LEASE_MS),
        },
      },
      { returnDocument: "after", sort: { nextAttemptAt: 1 } }
    );
  }
  async function processPending(now = new Date()) {
    while (true) {
      const event = await claimNext(now);
      if (!event) break;
      await deliver(event, now);
    }
  }
  return { deliver, claimNext, processPending, signature };
}
module.exports = {
  assertSafeCallback,
  deliveryWorker,
  signature,
  equal,
  isPublicAddress,
  MAX_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  LEASE_MS,
};