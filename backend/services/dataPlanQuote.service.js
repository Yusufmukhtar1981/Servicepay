const crypto = require("crypto");

const QUOTE_LIFETIME_MS = 15 * 60 * 1000;

const signingKey = () => {
  if (!process.env.JWT_SECRET) {
    throw new Error("DATA plan quotes require the server signing secret.");
  }
  return crypto.createHmac("sha256", process.env.JWT_SECRET)
    .update("servicepay:data-plan-quote:v1")
    .digest();
};

const planIdentity = (plan) => ({
  planId: String(plan.code),
  networkId: plan.networkId == null ? null : Number(plan.networkId),
  providerPlanId: plan.providerPlanId == null ? null : Number(plan.providerPlanId),
  name: String(plan.name || ""),
  size: String(plan.datasize || ""),
  type: String(plan.type || ""),
  duration: String(plan.day || ""),
});

const issueDataPlanQuote = ({ customerId, provider, network, plan, price, now = Date.now() }) => {
  if (!customerId || !Number.isFinite(price) || price <= 0 || !plan?.code) {
    throw new Error("Cannot quote an incomplete DATA product.");
  }
  const payload = {
    version: 1,
    customerId: String(customerId),
    provider,
    network,
    ...planIdentity(plan),
    price,
    issuedAt: now,
    expiresAt: now + QUOTE_LIFETIME_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const verifyDataPlanQuote = (token, { customerId, provider, network, plan, price, now = Date.now() }) => {
  if (typeof token !== "string" || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return false;
  }
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", signingKey()).update(body).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (signature !== expected.toString("base64url") ||
      supplied.length !== expected.length ||
      !crypto.timingSafeEqual(supplied, expected)) {
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (_) {
    return false;
  }
  const identity = planIdentity(plan);
  return payload?.version === 1 &&
    payload.customerId === String(customerId) &&
    payload.provider === provider &&
    payload.network === network &&
    payload.price === price &&
    Number.isSafeInteger(payload.issuedAt) &&
    Number.isSafeInteger(payload.expiresAt) &&
    payload.issuedAt <= now + 30_000 &&
    payload.expiresAt > now &&
    payload.expiresAt - payload.issuedAt === QUOTE_LIFETIME_MS &&
    Object.entries(identity).every(([field, value]) => payload[field] === value);
};

module.exports = { issueDataPlanQuote, verifyDataPlanQuote };