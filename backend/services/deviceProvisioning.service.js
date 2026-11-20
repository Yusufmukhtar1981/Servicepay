const { DeviceError } = require("./deviceValidation.service");
function models(connection) {
  return {
    Device: require("../models/enterpriseDevice.model")(connection),
    Assignment: require("../models/deviceAssignment.model")(connection),
    Audit: require("../models/deviceAuditLog.model")(connection),
  };
}
const canonical = (obj) => JSON.stringify(obj, Object.keys(obj || {}).sort());
async function readiness(connection) {
  for (const Model of Object.values(models(connection))) {
    let actual;
    try { actual = await Model.collection.listIndexes().toArray(); }
    catch (error) { if (error.code === 26) throw new DeviceError("Enterprise Devices needs explicitly approved collection/index provisioning.", 503, "DEVICE_PROVISIONING_REQUIRED"); throw error; }
    for (const [key, options] of Model.schema.indexes()) {
      const found = actual.find((entry) => entry.name === options.name);
      if (!found || canonical(found.key) !== canonical(key) || !!found.unique !== !!options.unique ||
          JSON.stringify(found.partialFilterExpression || {}) !== JSON.stringify(options.partialFilterExpression || {})) {
        throw new DeviceError("Enterprise Devices index prerequisites are not ready; no maintenance was run.", 503, "DEVICE_PROVISIONING_REQUIRED");
      }
    }
  }
  const hello = await connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") throw new DeviceError("Enterprise Devices requires MongoDB transactions.", 503, "DEVICE_TRANSACTIONS_REQUIRED");
}
// Deliberately NOT called during startup. Call only against approved databases.
async function provisionNewCollections(connection) {
  for (const Model of Object.values(models(connection))) {
    const existing = await connection.db.listCollections({ name: Model.collection.name }).toArray();
    if (existing.length) throw new DeviceError("Provisioning requires a separately reviewed plan when a target collection already exists.", 409);
  }
  for (const Model of Object.values(models(connection))) {
    await connection.db.createCollection(Model.collection.name);
    await Model.createIndexes();
  }
  await readiness(connection);
}
module.exports = { models, readiness, provisionNewCollections };
