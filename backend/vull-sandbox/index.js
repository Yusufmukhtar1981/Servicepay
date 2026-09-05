const mongoose = require("mongoose");
const { config } = require("./config");
const { createModels, initializeModels } = require("./models");
const { app } = require("./app");
async function start() {
  const cfg = config();
  const connection = mongoose.createConnection(cfg.mongoUri);
  await connection.asPromise();
  const models = await initializeModels(createModels(connection));
  const server = app(models, cfg).listen(cfg.port, () => console.log(`VULL sandbox listening on port ${cfg.port}`));
  const close = async () => { server.close(); await connection.close(); };
  process.once("SIGTERM", close); process.once("SIGINT", close);
}
if (require.main === module) start().catch(error => { console.error(`VULL sandbox startup failed: ${error.message}`); process.exitCode = 1; });
module.exports = { start };