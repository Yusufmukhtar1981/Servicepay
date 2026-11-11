"use strict";
const { MarketingRecord } = require("../models/marketingRecord.model");
const Role = require("../models/role.model");
const { STAFF_PERMISSION_VALUES } = require("../config/staffPermissions");

// Explicit additive migration only. Never called by application startup.
// Roll back a release by removing its route/navigation, not by dropping records.
async function migrate(db) {
  const present = await db.listCollections({ name: "marketingrecords" }, { nameOnly: true }).hasNext();
  if (!present) {
    try { await db.createCollection("marketingrecords"); }
    catch (error) { if (error.code !== 48) throw error; }
  }
  const collection = db.collection("marketingrecords");
  const before = await collection.listIndexes().toArray();
  const definitions = MarketingRecord.schema.indexes();
  // Preflight all definitions before writing any index. Do not repair/drop an
  // incompatible existing index or overwrite an existing role.
  for (const [key, options] of definitions) {
    const same = before.find(index => JSON.stringify(index.key) === JSON.stringify(key));
    if (same && (!!same.unique !== !!options.unique ||
        JSON.stringify(same.partialFilterExpression || {}) !== JSON.stringify(options.partialFilterExpression || {}))) {
      throw new Error("Marketing index conflicts with existing schema; manual review required.");
    }
  }
  const names = [];
  for (const [key, options] of definitions) names.push(await collection.createIndex(key, options));
  const headPermissions = STAFF_PERMISSION_VALUES.filter(p => p.startsWith("marketing.") &&
    !["marketing.budgets.approve", "marketing.targets.manage"].includes(p));
  const templates = [
    { name: "HEAD_OF_MARKETING", displayName: "Head of Marketing", hierarchyLevel: 60,
      permissions: headPermissions },
    { name: "MARKETING_OFFICER", displayName: "Marketing Officer", hierarchyLevel: 20,
      permissions: ["marketing.view", "marketing.reports.manage", "marketing.content.manage", "marketing.budgets.submit"] },
  ];
  for (const template of templates) {
    const document = new Role({ ...template, department: "MARKETING", scopeType: "GLOBAL",
      status: "ACTIVE", isSystemRole: true }).toObject();
    const existing = await db.collection("roles").findOne({ name: template.name });
    if (existing) {
      if (existing.department !== "MARKETING" || existing.status !== "ACTIVE" ||
          (existing.permissions || []).some(p => !p.startsWith("marketing."))) {
        throw new Error("Existing marketing role requires review; it was not overwritten.");
      }
      continue;
    }
    document.createdAt = document.updatedAt = new Date();
    await db.collection("roles").updateOne({ name: template.name }, { $setOnInsert: document }, { upsert: true });
  }
  return { createdCollection: !present, indexes: names, roleNames: templates.map(t => t.name) };
}
module.exports = { migrate };
