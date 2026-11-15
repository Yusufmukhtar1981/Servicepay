const Entry = require("../models/cashbackEntry.model");
const User = require("../models/user.model");
const { fail, creditPayload, yearMonth } = require("./customerExperiencePolicy");

async function ready() {
  // No implicit collection creation during a customer request or startup.
  const list = await Entry.db.db.listCollections({ name: Entry.collection.name }, { nameOnly: true }).toArray();
  if (!list.length) throw fail("Cashback storage awaits approved provisioning. No funds were changed.", 503);
  const indexes = await Entry.collection.indexes();
  if (!indexes.some(i => i.name === "_id_" && i.key?._id === 1)) throw fail("Cashback uniqueness safeguard is unavailable.", 503);
}
async function credit({ customerId, actor, body, key }) {
  const payload = creditPayload(body, actor._id, key);
  await ready();
  const customer = await User.findOne({ _id: customerId, role: "CUSTOMER" }).select("_id").lean();
  if (!customer) throw fail("Customer not found.", 404);
  const compare = old => {
    if (String(old.user) !== String(customerId) || old.amountMinor !== payload.amountMinor ||
      old.description !== payload.description) throw fail("This request key was already used for different credit details.", 409);
    return { entry: old, duplicate: true };
  };
  const old = await Entry.findById(payload._id).lean();
  if (old) return compare(old);
  try {
    const entry = await Entry.create({ ...payload, user: customerId, actor: actor._id,
      actorRole: actor.role, reference: `CB-${payload._id.toUpperCase()}` });
    return { entry: entry.toObject(), duplicate: false };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await Entry.findById(payload._id).lean();
    if (!existing) throw fail("Credit outcome is uncertain. Retry the same request key only.", 503);
    return compare(existing);
  }
}
async function totals(filter, now) {
  const { month, year } = yearMonth(now);
  const [r] = await Entry.aggregate([{ $match: filter }, { $group: {
    _id: null, totalMinor: { $sum: "$amountMinor" }, total: { $sum: 1 },
    monthMinor: { $sum: { $cond: [{ $gte: ["$createdAt", month] }, "$amountMinor", 0] } },
    yearMinor: { $sum: { $cond: [{ $gte: ["$createdAt", year] }, "$amountMinor", 0] } },
  } }]);
  const result = r || { totalMinor: 0, total: 0, monthMinor: 0, yearMinor: 0 };
  for (const key of ["totalMinor", "monthMinor", "yearMinor"]) {
    if (!Number.isSafeInteger(result[key])) throw fail("Cashback total exceeds the safely supported display range.", 503);
  }
  delete result._id;
  return result;
}
function project(entry) {
  return { reference: entry.reference, amountMinor: entry.amountMinor,
    description: entry.description, createdAt: entry.createdAt, status: entry.status,
    customerId: entry.user, actorId: entry.actor };
}
module.exports = { ready, credit, totals, project };
