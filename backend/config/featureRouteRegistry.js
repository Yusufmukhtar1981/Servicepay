/*
 * Customer feature controls are bound to routes here, rather than being
 * scattered through individual routers and the global middleware.  Only
 * mutating routes are listed.  Reads, authentication, provider callbacks,
 * webhooks, and ledger/requery callbacks must remain available even when a
 * customer feature is disabled.
 */
const MUTATING_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

const FEATURE_ROUTE_REGISTRY = Object.freeze([
  { key: "airtime", methods: ["POST"], paths: ["/api/clubkonnect/airtime", "/api/partner/airtime", "/api/airtime"] },
  { key: "data", methods: ["POST"], paths: ["/api/clubkonnect/data", "/api/partner/data", "/api/data"] },
  {
    key: "electricity",
    methods: ["POST"],
    patterns: [
      /^\/api\/electricity\/pay$/,
      /^\/api\/electricity\/verify-meter$/,
    ],
  },
  { key: "cableTv", methods: ["POST"], paths: ["/api/clubkonnect/cable", "/api/cable"] },
  { key: "examPin", methods: ["POST"], paths: ["/api/clubkonnect/exam", "/api/exam"] },
  { key: "ninVerification", methods: ["POST"], patterns: [/^\/api\/id-verification\/nin$/] },
  { key: "bvnVerification", methods: ["POST"], patterns: [/^\/api\/id-verification\/bvn$/] },
  { key: "walletFunding", methods: ["POST"], paths: ["/api/paystack/initialize"] },
  { key: "servicepayTransfer", methods: ["POST"], paths: ["/api/transfer/servicepay"] },
  { key: "bankTransfer", methods: ["POST"], patterns: [/^\/api\/transfer\/bank$/] },
  { key: "withdrawal", methods: ["POST"], paths: ["/api/withdrawals/request"] },
  {
    key: "wallet",
    methods: MUTATING_METHODS,
    patterns: [
      /^\/api\/wallet\/(?:fund|debit)$/,
      /^\/api\/business-wallet\/(?:fund|to-personal|transfer|withdrawals)(?:\/|$)/,
    ],
  },
  { key: "marketplace", methods: ["POST"], patterns: [/^\/api\/marketplace\/orders$/] },
  {
    key: "storePosting",
    methods: ["POST"],
    patterns: [
      /^\/api\/marketplace$/,
      /^\/api\/marketplace\/products(?:\/image)?$/,
      /^\/api\/marketplace\/merchant\/register$/,
    ],
  },
  {
    key: "storePosting",
    methods: ["PATCH", "DELETE"],
    patterns: [/^\/api\/marketplace\/products\/[^/]+$/],
  },
  {
    key: "organizations",
    methods: ["POST"],
    patterns: [
      /^\/api\/organizations$/,
      /^\/api\/organizations\/[^/]+\/(?:submit|apply|staff)$/,
      /^\/api\/organizations\/[^/]+\/payments$/,
      /^\/api\/organizations\/[^/]+\/annual-payment$/,
      /^\/api\/organizations\/[^/]+\/fee-assignments\/[^/]+\/pay$/,
    ],
  },
  {
    key: "organizationWithdrawals",
    methods: ["POST"],
    patterns: [
      /^\/api\/organizations\/[^/]+\/withdrawals$/,
      /^\/api\/organizations\/[^/]+\/withdrawals\/[^/]+\/approve$/,
    ],
  },
  {
    key: "programSponsor",
    methods: ["POST"],
    patterns: [
      /^\/api\/empowerment\/programs\/[^/]+\/disbursements$/,
      /^\/api\/empowerment\/programs\/[^/]+\/bulk-disbursement$/,
      /^\/api\/empowerment\/programs\/[^/]+\/beneficiaries\/[^/]+\/pay$/,
      /^\/api\/empowerment\/programs\/[^/]+\/beneficiaries\/[^/]+\/disbursement$/,
    ],
  },
  // Applications belong to the Empowerment product, not sponsorship
  // disbursement controls; this is the sole owner for the apply mutation.
  {
    key: "empowerment",
    methods: ["POST"],
    patterns: [/^\/api\/empowerment\/programs\/[^/]+\/apply$/],
  },
  {
    key: "delivery",
    methods: ["POST"],
    patterns: [
      /^\/api\/delivery$/,
      /^\/api\/delivery\/pay\/[^/]+$/,
      /^\/api\/logistics\/interstate\/quote$/,
      /^\/api\/logistics\/interstate\/shipments$/,
      /^\/api\/logistics\/interstate\/shipments\/[^/]+\/pay(?:-adjustment)?$/,
      /^\/api\/logistics\/interstate\/[^/]+\/pay$/,
    ],
  },
  { key: "transport", methods: MUTATING_METHODS, paths: ["/api/logistics/transport"] },
  { key: "kekeNapep", methods: ["POST"], patterns: [/^\/api\/keke-rides$/] },
  {
    key: "amana",
    methods: ["POST"],
    patterns: [
      /^\/api\/amana$/,
      /^\/api\/amana\/[^/]+\/pay$/,
    ],
  },
  { key: "aiSupport", methods: ["POST", "DELETE"], paths: ["/api/ai-support/chat", "/api/ai-support/history"] },
  {
    key: "servicepayCall",
    methods: ["POST"],
    patterns: [
      /^\/api\/calls$/,
      /^\/api\/calls\/[^/]+\/(?:accept|decline|cancel|end)$/,
    ],
  },
  { key: "referral", methods: MUTATING_METHODS, paths: ["/api/referral", "/api/referrals"] },
  { key: "groupWallet", methods: ["POST"], patterns: [/^\/api\/servicepay-features\/groups$/, /^\/api\/servicepay-features\/groups\/[^/]+\/(?:members|contribute)$/] },
  { key: "requestMoney", methods: ["POST"], patterns: [/^\/api\/servicepay-features\/money-requests$/, /^\/api\/servicepay-features\/money-requests\/[^/]+\/(?:pay|decline)$/] },
  { key: "payByLink", methods: ["POST"], patterns: [/^\/api\/servicepay-features\/payment-links$/, /^\/api\/servicepay-features\/payment-links\/[^/]+\/pay$/] },
  { key: "qrPay", methods: ["POST"], patterns: [/^\/api\/qr\/(?:pay|checkout)$/] },
  {
    key: "solar",
    methods: ["POST"],
    patterns: [
      /^\/api\/solar\/applications$/,
      /^\/api\/solar\/applications\/[^/]+\/(?:pay-deposit|payments)$/,
      /^\/api\/solar\/finance\/[^/]+\/pay$/,
    ],
  },
  {
    key: "phoneFinancing",
    methods: ["POST"],
    patterns: [
      /^\/api\/phone-financing\/applications$/,
      /^\/api\/phone-financing\/applications\/[^/]+\/(?:deposit|pay-deposit)$/,
      /^\/api\/phone-financing\/finance\/[^/]+\/(?:payments|pay)$/,
    ],
  },
  {
    key: "cards",
    methods: ["POST"],
    patterns: [
      /^\/api\/cards\/physical\/request$/,
      /^\/api\/cards\/virtual\/request$/,
    ],
  },
  {
    key: "notifications",
    methods: ["POST"],
    patterns: [
      /^\/api\/notifications\/(?:send|broadcast)$/,
    ],
  },
]);

const cleanPath = (req) => {
  const path = String(req?.originalUrl || req?.url || "")
    .split("?")[0]
    .toLowerCase();
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
};

const bindingMatches = (binding, path, method) =>
  binding.methods.includes(method) &&
  !(binding.excludePatterns || []).some((pattern) => pattern.test(path)) &&
  (
    (binding.paths || []).some((prefix) =>
      path === prefix
    ) ||
    (binding.patterns || []).some((pattern) => pattern.test(path))
  );

const featureBindingsForRequest = (req) => {
  const method = String(req?.method || "").toUpperCase();
  if (!MUTATING_METHODS.includes(method)) return [];
  const path = cleanPath(req);
  if (path.includes("/webhook") || path.includes("/callback")) return [];
  return FEATURE_ROUTE_REGISTRY
    .filter((binding) => bindingMatches(binding, path, method))
    .map((binding) => binding.key);
};

module.exports = {
  MUTATING_METHODS,
  FEATURE_ROUTE_REGISTRY,
  featureBindingsForRequest,
};