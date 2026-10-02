const {
  createClubkonnectAirtimeLifecycleService,
} = require("./clubkonnectAirtimeLifecycle.service");

let timer = null;
let running = false;
const startClubkonnectAirtimeRecoveryWorker = () => {
  if (timer) return timer;
  const lifecycle = createClubkonnectAirtimeLifecycleService();
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Only recover durable accounting intents. Never send/requery paid requests.
      await lifecycle.processPendingCommissions(25);
    } catch (_error) {
      console.error("AIRTIME ACCOUNTING RECOVERY DEFERRED:", { code: "AIRTIME_RECOVERY_UNAVAILABLE" });
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, 15000);
  timer.unref?.();
  void tick();
  return timer;
};

module.exports = { startClubkonnectAirtimeRecoveryWorker };