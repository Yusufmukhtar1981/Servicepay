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
}) {
  while (!signal?.aborted) {
    try {
      await processPending();
    } catch (error) {
      onError(error);
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
  try {
    await pollLoop({
      processPending: () => worker.processPending(),
      pollIntervalMs: cfg.workerPollIntervalMs,
      signal,
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