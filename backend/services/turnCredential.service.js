// TURN credentials are fetched on demand and retained in memory only until
// shortly before Twilio expires them. No account/auth credentials are read,
// logged, or stored by this service.
let cached = null;
let connectorFactory = null;
const MAX_SERVERS = 5;
const MAX_URLS = 5;
const clean = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : "";

const normalizeIceServers = (servers) => (Array.isArray(servers) ? servers : [])
  .slice(0, MAX_SERVERS)
  .map((server) => {
    const rawUrls = Array.isArray(server?.urls) ? server.urls : [server?.urls ?? server?.url];
    const urls = rawUrls.map((url) => clean(url)).filter((url) => /^(stun|turns?):/i.test(url)).slice(0, MAX_URLS);
    if (!urls.length) return null;
    const value = { urls: urls.length === 1 ? urls[0] : urls };
    const username = clean(server?.username);
    const credential = clean(server?.credential);
    if (username) value.username = username;
    if (credential) value.credential = credential;
    return value;
  }).filter(Boolean);

const staticConfig = () => {
  const stun = String(process.env.CALL_STUN_URLS || "stun:stun.l.google.com:19302").split(",").map((v) => clean(v)).filter(Boolean);
  const turns = String(process.env.CALL_TURN_URLS || "").split(",").map((v) => clean(v)).filter(Boolean);
  const username = clean(process.env.CALL_TURN_USERNAME);
  const credential = clean(process.env.CALL_TURN_CREDENTIAL);
  if (process.env.NODE_ENV === "production" && (!turns.length || !username || !credential)) return null;
  const servers = normalizeIceServers([...stun.map((urls) => ({ urls })), ...(turns.length ? [{ urls: turns, username, credential }] : [])]);
  return servers.length ? servers : null;
};

async function connectorIceServers() {
  if (cached && cached.expiresAt > Date.now()) return cached.iceServers;
  const timeout = Number(process.env.CALL_TWILIO_TIMEOUT_MS) || 5000;
  let timer;
  try {
    const create = connectorFactory || (() => {
      // CommonJS require is supported by the installed connectors SDK.
      const { ReplitConnectors } = require("@replit/connectors-sdk");
      return new ReplitConnectors();
    });
    const connectors = create();
    const accountResponse = await Promise.race([
      connectors.proxy("twilio", "/2010-04-01/Accounts.json?PageSize=1", { method: "GET" }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Twilio connector timed out")), timeout); }),
    ]);
    clearTimeout(timer);
    const accounts = await accountResponse.json();
    const sid = clean(accounts?.accounts?.[0]?.sid, 64);
    if (!/^AC[a-f0-9]{32}$/i.test(sid)) throw new Error("Twilio account is unavailable");
    const tokenResponse = await Promise.race([
      connectors.proxy("twilio", `/2010-04-01/Accounts/${sid}/Tokens.json`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "Ttl=3600" }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Twilio connector timed out")), timeout); }),
    ]);
    clearTimeout(timer);
    const token = await tokenResponse.json();
    const iceServers = normalizeIceServers(token?.ice_servers);
    if (!iceServers.length) throw new Error("Twilio returned no ICE servers");
    const ttlSeconds = Math.min(3600, Math.max(60, Number(token?.ttl) || 3600));
    cached = { iceServers, expiresAt: Date.now() + Math.max(1, ttlSeconds - 30) * 1000 };
    return iceServers;
  } catch (_) {
    if (timer) clearTimeout(timer);
    return null;
  }
}

async function getCallConfig() {
  const iceServers = await connectorIceServers() || staticConfig();
  return iceServers
    ? { callingAvailable: true, reason: "", iceServers }
    : { callingAvailable: false, reason: "Calling is unavailable because TURN connectivity is not configured.", iceServers: [] };
}
// Test-only injection avoids network access; production code does not use it.
function __setConnectorFactory(factory) { connectorFactory = factory; cached = null; }
function __resetForTests() { cached = null; connectorFactory = null; }
module.exports = { getCallConfig, normalizeIceServers, __setConnectorFactory, __resetForTests };