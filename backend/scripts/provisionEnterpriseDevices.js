// Never imported by startup, post-merge setup, routes or workers.
// Default: no connection, no writes. Production requires separate owner approval.
const mongoose = require("mongoose");
const { models, readiness, provisionNewCollections } = require("../services/deviceProvisioning.service");
async function main() {
  const apply = process.argv.includes("--apply-approved-new-collections");
  const plan = Object.values(models()).map((Model) => ({
    collection: Model.collection.name,
    indexes: Model.schema.indexes().map(([key, options]) => ({ key, ...options })),
  }));
  if (!apply) {
    console.log(JSON.stringify({ mode: "offline-plan-only", newCollections: plan,
      warning: "No database was connected. Explicit owner approval, capacity and backup checks are required before production provisioning." }, null, 2));
    return;
  }
  if (process.env.SERVICEPAY_ENTERPRISE_PROVISIONING_APPROVAL !== "CREATE_NEW_ENTERPRISE_COLLECTIONS_ONLY" ||
      !process.env.SERVICEPAY_ENTERPRISE_PROVISION_URI) {
    throw new Error("Explicit approval marker and dedicated provisioning URI are required. Ambient MONGODB_URI is never used.");
  }
  const connection = await mongoose.createConnection(process.env.SERVICEPAY_ENTERPRISE_PROVISION_URI, {
    autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000,
  }).asPromise();
  try {
    try { await readiness(connection); console.log("Already provisioned and verified; no writes were made."); return; }
    catch (error) { if (error.code !== "DEVICE_PROVISIONING_REQUIRED") throw error; }
    // Refuses existing target collections. No syncIndexes, drops, backfills or repair.
    await provisionNewCollections(connection);
    console.log("Approved new Enterprise Devices collections and indexes are ready.");
  } finally { await connection.close(); }
}
if (require.main === module) main().catch(() => {
  console.error("Enterprise Devices provisioning stopped. No existing collections or indexes were modified. Check prerequisites privately; do not log connection credentials.");
  process.exitCode = 1;
});
module.exports = { main };
