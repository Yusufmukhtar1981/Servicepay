const crypto = require("node:crypto");
const { URL } = require("node:url");

const LIVE_DB_VARIABLES = ["MONGODB_URI", "DATABASE_URL", "MONGO_URL", "PRODUCTION_MONGODB_URI"];
function safeMongoIdentity(uri) {
  const parsed = new URL(uri);
  return { host: parsed.hostname.toLowerCase(), database: parsed.pathname.replace(/^\//, "").toLowerCase() };
}
function fingerprint(identity) {
  return crypto.createHash("sha256").update(`${identity.host}/${identity.database}`).digest("hex");
}
function csv(value) { return String(value || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean); }
function integer(value, name, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}
function config(env = process.env) {
  if (env.VULL_ENV !== "sandbox") throw new Error("VULL_ENV must be exactly sandbox.");
  const inherited = LIVE_DB_VARIABLES.find(name => String(env[name] || "").trim());
  if (inherited) throw new Error(`Sandbox deployment must not inherit ${inherited}.`);
  const uri = String(env.VULL_SANDBOX_MONGODB_URI || "").trim();
  const allowedHosts = csv(env.VULL_SANDBOX_MONGO_ALLOWED_HOSTS);
  const expectedDatabase = String(env.VULL_SANDBOX_MONGO_DATABASE || "").trim().toLowerCase();
  const fingerprints = csv(env.VULL_PRODUCTION_MONGO_FINGERPRINTS);
  if (!uri || !allowedHosts.length || !expectedDatabase || !fingerprints.length) throw new Error("Sandbox Mongo URI, allowed hosts, database, and production fingerprints are required.");
  let identity; try { identity = safeMongoIdentity(uri); } catch { throw new Error("VULL_SANDBOX_MONGODB_URI is invalid."); }
  if (!allowedHosts.includes(identity.host)) throw new Error("Sandbox Mongo hostname is not allowlisted.");
  if (identity.database !== expectedDatabase) throw new Error("Sandbox Mongo database does not match VULL_SANDBOX_MONGO_DATABASE.");
  if (!/(sandbox|test)/i.test(identity.database)) throw new Error("Sandbox Mongo database name must contain sandbox or test.");
  if (fingerprints.includes(fingerprint(identity))) throw new Error("Sandbox Mongo target matches a production fingerprint.");
  const authPepper = String(env.VULL_SANDBOX_AUTH_PEPPER || "");
  const webhookSecret = String(env.VULL_SANDBOX_WEBHOOK_SIGNING_SECRET || "");
  if (!authPepper || !webhookSecret) throw new Error("Sandbox auth pepper and webhook signing secret are required.");
  const workerPollIntervalMs = integer(env.VULL_SANDBOX_WORKER_POLL_INTERVAL_MS || 1000, "VULL_SANDBOX_WORKER_POLL_INTERVAL_MS", { minimum: 100, maximum: 60_000 });
  const port = integer(env.PORT || env.VULL_SANDBOX_PORT || 3003, "PORT", { minimum: 1, maximum: 65_535 });
  const initialBalanceMinor = integer(env.VULL_SANDBOX_INITIAL_BALANCE_MINOR || 10_000_000, "VULL_SANDBOX_INITIAL_BALANCE_MINOR", { minimum: 0, maximum: 100_000_000 });
  const workerHeartbeatMaxAgeMs = Math.max(15_000, workerPollIntervalMs * 3);
  return { mongoUri: uri, authPepper, webhookSecret, port, nodeEnv: env.NODE_ENV || "development", workerPollIntervalMs, workerHeartbeatMaxAgeMs, initialBalanceMinor };
}
module.exports = { config, safeMongoIdentity, fingerprint, LIVE_DB_VARIABLES };