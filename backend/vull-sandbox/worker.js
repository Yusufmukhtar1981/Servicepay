const mongoose = require("mongoose");
const { config } = require("./config");
const { createModels, initializeModels } = require("./models");
const { deliveryWorker } = require("./services/webhookDelivery");

const delay = (milliseconds, signal) => new Promise(resolve => {
  if (signal?.aborted) return resolve();
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

async function pollLoop({
  processPending,
  pollIntervalMs = 1000,
  signal,
  sleep = delay,
  onError = () => {},
  maxConsecutiveErrors = 3,
}) {
  let consecutiveErrors = 0;
  while (!signal?.aborted) {
    try {
      await processPending();
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      onError(error);
      if (consecutiveErrors >= maxConsecutiveErrors) throw error;
    }
    if (!signal?.aborted) await sleep(pollIntervalMs, signal);
  }
}

async function runWorker({
  env = process.env,
  connectionFactory = uri => mongoose.createConnection(uri),
  signal,
} = {}) {
  const cfg = config(env);
  const connection = connectionFactory(cfg.mongoUri);
  await connection.asPromise();
  const models = await initializeModels(createModels(connection));
  const worker = deliveryWorker(models, cfg);
  console.log("VULL sandbox webhook worker started.");
  try {
    await pollLoop({
      processPending: async () => {
        await worker.processPending();
        await models.WorkerState.findOneAndUpdate(
          { name: "webhook-delivery" },
          { $set: { heartbeatAt: new Date() }, $setOnInsert: { environment: "SANDBOX", name: "webhook-delivery" } },
          { upsert: true, new: true }
        );
      },
      pollIntervalMs: cfg.workerPollIntervalMs,
      signal,
      onError: error => console.error(`VULL sandbox webhook worker polling failed: ${error.message}`),
    });
  } finally {
    await connection.close();
  }
}

if (require.main === module) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  runWorker({ signal: controller.signal }).catch(error => {
    console.error(`VULL sandbox worker failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runWorker, pollLoop, delay };