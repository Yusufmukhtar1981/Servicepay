// Twilio Network Traversal Service credentials are ephemeral. This module only
// retains normalized ICE servers in memory until shortly before their token TTL
// expires; it never logs or stores the Twilio account/auth secrets.
const MAX_SERVERS = 5;
const MAX_URLS = 5;
const TOKEN_TTL_SECONDS = 3600;
const SAFETY_MARGIN_SECONDS = 30;
let cached = null;
let fetchImplementation = (...args) => fetch(...args);
let now = () => Date.now();

const clean = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : "";
const normalizeIceServers = (servers) => (Array.isArray(servers) ? servers : [])
  .slice(0, MAX_SERVERS)
  .map((server) => {
    const source = Array.isArray(server?.urls) ? server.urls : [server?.urls ?? server?.url];
    const urls = source.map((url) => clean(url)).filter((url) => /^(stun|turns?):/i.test(url)).slice(0, MAX_URLS);
    if (!urls.length) return null;
    const normalized = { urls: urls.length === 1 ? urls[0] : urls };
    const username = clean(server?.username);
    const credential = clean(server?.credential);
    if (username) normalized.username = username;
    if (credential) normalized.credential = credential;
    return normalized;
  })
  .filter(Boolean);
const hasCredentialedTurn = (servers) => servers.some((server) => {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some((url) => /^turns?:/i.test(url)) &&
    Boolean(clean(server.username)) && Boolean(clean(server.credential));
});

async function getCallConfig() {
  if (cached && cached.expiresAt > now()) return { callingAvailable: true, reason: "", iceServers: cached.iceServers };
  const accountSid = clean(process.env.TWILIO_ACCOUNT_SID, 128);
  const authToken = clean(process.env.TWILIO_AUTH_TOKEN, 256);
  if (!accountSid || !authToken) {
    return { callingAvailable: false, reason: "Calling is unavailable because TURN credentials are not configured.", iceServers: [] };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(1_000, Number(process.env.CALL_TWILIO_TIMEOUT_MS) || 5_000)));
  try {
    const authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`, "utf8").toString("base64")}`;
    const response = await fetchImplementation(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Tokens.json`,
      {
        method: "POST",
        headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Ttl: String(TOKEN_TTL_SECONDS) }).toString(),
        signal: controller.signal,
      }
    );
    if (!response?.ok) throw new Error("Twilio token request failed");
    const token = await response.json();
    const iceServers = normalizeIceServers(token?.ice_servers);
    // STUN alone cannot relay production media. A Twilio token is usable only
    // when it includes a credentialed TURN/TURNS server.
    if (!iceServers.length || !hasCredentialedTurn(iceServers)) throw new Error("Twilio token response has no credentialed TURN server");
    const suppliedTtl = Number(token?.ttl);
    const ttl = Number.isFinite(suppliedTtl) ? Math.min(TOKEN_TTL_SECONDS, Math.max(0, suppliedTtl)) : TOKEN_TTL_SECONDS;
    // Do not cache at/below the margin: caching it even briefly could outlive
    // the provider-issued credential.
    if (ttl > SAFETY_MARGIN_SECONDS) {
      cached = { iceServers, expiresAt: now() + (ttl - SAFETY_MARGIN_SECONDS) * 1000 };
    }
    return { callingAvailable: true, reason: "", iceServers };
  } catch (_) {
    return { callingAvailable: false, reason: "Calling is temporarily unavailable because TURN credentials could not be generated.", iceServers: [] };
  } finally {
    clearTimeout(timeout);
  }
}

function __setFetchForTests(value) { fetchImplementation = value; cached = null; }
function __setNowForTests(value) { now = value; cached = null; }
function __resetForTests() { cached = null; fetchImplementation = (...args) => fetch(...args); now = () => Date.now(); }
module.exports = { getCallConfig, normalizeIceServers, hasCredentialedTurn, __setFetchForTests, __setNowForTests, __resetForTests, TOKEN_TTL_SECONDS, SAFETY_MARGIN_SECONDS };