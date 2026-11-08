// Read-only classification. Never interprets age as provider/settlement evidence.
const { summary } = require("./pendingResolution.service");
let timer, snapshot = { healthy: false, checkedAt: null, notice: "Monitoring has not completed its first check." };
async function check() {
  try {
    const data = await summary();
    snapshot = { healthy: true, checkedAt: new Date(), totalPending: data.totalPending,
      requiresAttention: data.above1Hour,
      categories: { RECENT: data.below5Minutes, DELAYED: data.above5Minutes - data.above30Minutes,
        LONG_STANDING: data.above30Minutes - data.above1Hour, ATTENTION: data.above1Hour },
      notice: "Read-only monitoring; no statuses, balances or historical requests are changed." };
  } catch (_) {
    snapshot = { ...snapshot, healthy: false, notice: "Monitoring could not refresh. Live list requests still fail explicitly if unavailable." };
  }
  return snapshot;
}
function start() {
  if (timer || process.env.NODE_ENV === "test" || process.argv.includes("--test")) return timer;
  check();
  timer = setInterval(check, 60000); timer.unref?.();
  return timer;
}
module.exports = { start, check, status: () => ({ ...snapshot }) };
