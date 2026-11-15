// Explicit additive provisioning only. Never imported by normal startup.
// Default invocation is READ ONLY; production changes require a separate
// approval and --apply-approved --database=<exact existing database>.
const mongoose = require("mongoose");
const Entry = require("../models/cashbackEntry.model");

async function provision(db, { apply = false } = {}) {
  const name = Entry.collection.name;
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (exists) {
    const indexes = await db.collection(name).indexes();
    if (!indexes.some(i => i.name === "_id_" && i.key?._id === 1)) throw new Error("Existing cashback safeguards conflict; stopping.");
    return { ready: true, created: false, collection: name };
  }
  if (!apply) return { ready: false, approvalRequired: true, collection: name };
  await db.createCollection(name);
  // Mongo's _id uniqueness is the financial idempotency safeguard. This
  // secondary index is only for bounded customer-history reads.
  await db.collection(name).createIndex({ user: 1, createdAt: -1 }, { name: "user_1_createdAt_-1" });
  return { ready: true, created: true, collection: name };
}
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2), apply = args.includes("--apply-approved");
    const expectedDb = args.find(a => a.startsWith("--database="))?.slice(11);
    if (!expectedDb) throw new Error("Specify the exact target database; no connection attempted.");
    await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false, autoCreate: false });
    if (mongoose.connection.db.databaseName !== expectedDb) throw new Error("Database identity mismatch; no changes made.");
    console.log(JSON.stringify(await provision(mongoose.connection.db, { apply })));
  })().catch(() => { console.error("Cashback provisioning stopped safely. No existing collection was altered."); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}
module.exports = { provision };
