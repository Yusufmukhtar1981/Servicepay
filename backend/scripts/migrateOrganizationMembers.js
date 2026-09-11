const mongoose = require("mongoose");
const models = require("../models/organizations.models");

const INDEX_NAME = "organization_membership_number_unique";
const NUMBER_FILTER = { membershipNumber: { $type: "string", $gt: "" } };

const formatNumber = (code, year, sequence) =>
  `${code}/${year}/${String(sequence).padStart(5, "0")}`;

function isRealNumber(value) {
  return typeof value === "string" && value.trim() !== "";
}

async function removeObsoleteIndexes(collection) {
  const indexes = await collection.listIndexes().toArray();
  for (const index of [...indexes]) {
    if (index.name === "_id_" || index.name === INDEX_NAME) continue;
    const keys = Object.keys(index.key || {});
    if (!keys.includes("membershipNumber")) continue;
    // These are the two indexes emitted by the old schema. Inspect both name
    // and exact key shape; never remove a similarly-prefixed/custom index.
    const exactLegacyName = ["membershipNumber_1", "organization_1_membershipNumber_1"].includes(index.name);
    const exactLegacyKey = (keys.length === 1 && keys[0] === "membershipNumber" && index.key.membershipNumber === 1) ||
      (keys.length === 2 && keys.includes("organization") && keys.includes("membershipNumber") &&
        index.key.organization === 1 && index.key.membershipNumber === 1);
    if (exactLegacyName && exactLegacyKey) {
      await collection.dropIndex(index.name);
    }
  }
}

async function createMembershipIndex(collection) {
  await collection.createIndex(
    { organization: 1, membershipNumber: 1 },
    { name: INDEX_NAME, unique: true, partialFilterExpression: NUMBER_FILTER }
  );
}

async function ensureMemberIdentityIndex(collection) {
  const indexes = await collection.listIndexes().toArray();
  const existing = indexes.find((index) =>
    JSON.stringify(index.key) === JSON.stringify({ organization: 1, user: 1 }) &&
    index.unique === true
  );
  if (existing) return existing.name;
  return collection.createIndex(
    { organization: 1, user: 1 },
    { name: "organization_user_unique", unique: true }
  );
}

async function duplicateMembershipNumbers(collection) {
  const rows = await collection.find({ membershipNumber: NUMBER_FILTER.membershipNumber }).toArray();
  const seen = new Map();
  for (const row of rows) {
    if (!isRealNumber(row.membershipNumber)) continue;
    const key = `${String(row.organization)}\u0000${row.membershipNumber}`;
    const members = seen.get(key) || [];
    members.push(row._id);
    seen.set(key, members);
  }
  return [...seen.entries()].filter(([, members]) => members.length > 1);
}

async function reconcileSequences(organizations, collection) {
  let updated = 0;
  for (const org of await organizations.find({}).toArray()) {
    const code = String(org.code || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!code) continue;
    const rows = await collection.find({
      organization: org._id,
      membershipNumber: { $type: "string", $regex: new RegExp(`^${code}/\\d{4}/(\\d+)$`) },
    }).toArray();
    const max = rows.reduce((value, row) => Math.max(value, Number(String(row.membershipNumber).match(/\/(\d+)$/)?.[1] || 0)), 0);
    if (max > Number(org.membershipNumberSequence || 0)) {
      const result = await organizations.updateOne({ _id: org._id }, { $max: { membershipNumberSequence: max } });
      updated += result.modifiedCount || 0;
    }
  }
  return updated;
}

async function migrateOrganizationMembers({ db = mongoose.connection.db } = {}) {
  if (!db) throw new Error("Organization member migration requires a connected database.");
  const collection = db.collection("organizationmembers");
  const organizations = db.collection("organizations");

  // Clean legacy null/empty values first. This is deliberately an unset, not
  // a delete, so no membership or organization can be lost.
  const unsetResult = await collection.updateMany(
    { $or: [{ membershipNumber: null }, { membershipNumber: "" }, { membershipNumber: { $type: "string", $regex: /^\s+$/ } }] },
    { $unset: { membershipNumber: "" } }
  );
  const sequenceUpdates = await reconcileSequences(organizations, collection);

  const activeMissing = await collection.find({
    status: "ACTIVE",
    $or: [{ membershipNumber: { $exists: false } }, { membershipNumber: null }, { membershipNumber: "" }],
  }).toArray();
  let activeBackfilled = 0;
  for (const member of activeMissing) {
    const org = await organizations.findOneAndUpdate(
      { _id: member.organization },
      { $inc: { membershipNumberSequence: 1 } },
      { returnDocument: "after" }
    );
    if (!org) throw new Error(`Organization missing for member ${member._id}.`);
    const currentOrg = org.value || org;
    const year = new Date().getFullYear();
    const number = formatNumber(currentOrg.code, year, currentOrg.membershipNumberSequence);
    const backfillResult = await collection.updateOne(
      { _id: member._id, status: "ACTIVE", $or: [{ membershipNumber: { $exists: false } }, { membershipNumber: null }, { membershipNumber: "" }] },
      { $set: { membershipNumber: number, year } }
    );
    activeBackfilled += backfillResult.modifiedCount || 0;
  }

  const duplicates = await duplicateMembershipNumbers(collection);
  if (duplicates.length) {
    throw new Error(`Duplicate organization membership numbers detected (${duplicates.length} groups).`);
  }

  const cards = db.collection("organizationmembershipcards");
  const active = await collection.find({ status: "ACTIVE", membershipNumber: NUMBER_FILTER.membershipNumber }).toArray();
  let cardsCreated = 0;
  for (const member of active) {
    const org = await organizations.findOne({ _id: member.organization });
    if (!org || !isRealNumber(member.membershipNumber)) continue;
    const cardResult = await cards.updateOne(
      { member: member._id },
      { $setOnInsert: { organization: org._id, member: member._id, cardNumber: `${org.code}-${member.membershipNumber.replace(/\//g, "-")}`, active: true } },
      { upsert: true }
    );
    cardsCreated += cardResult.upsertedCount || 0;
  }

  // The old same-key unique index must be removed first or MongoDB returns
  // IndexOptionsConflict. createIndex intentionally propagates failures.
  await removeObsoleteIndexes(collection);
  // Existing real duplicate numbers are data corruption and startup must fail
  // loudly; a failed create leaves startup blocked and is recoverable on rerun.
  await createMembershipIndex(collection);
  await ensureMemberIdentityIndex(collection);
  return { unset: unsetResult.modifiedCount || 0, sequenceUpdates, activeBackfilled, cardsCreated, index: INDEX_NAME };
}

module.exports = migrateOrganizationMembers;
module.exports.INDEX_NAME = INDEX_NAME;
module.exports.NUMBER_FILTER = NUMBER_FILTER;
module.exports.formatNumber = formatNumber;
module.exports.isRealNumber = isRealNumber;
module.exports.removeObsoleteIndexes = removeObsoleteIndexes;
module.exports.createMembershipIndex = createMembershipIndex;
module.exports.ensureMemberIdentityIndex = ensureMemberIdentityIndex;
module.exports.migrateOrganizationMembers = migrateOrganizationMembers;
module.exports.duplicateMembershipNumbers = duplicateMembershipNumbers;
module.exports.reconcileSequences = reconcileSequences;