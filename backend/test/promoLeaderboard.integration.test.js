const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const announcementRoutes = require("../routes/announcements.routes");
const User = require("../models/user.model");
const Role = require("../models/role.model");
const KycProfile = require("../models/kycProfile.model");
const Announcement = require("../models/announcement.model");
const AnnouncementCampaignWinner = require("../models/announcementCampaignWinner.model");
const Transaction = require("../models/transaction.model");

let mongo;
let server;
let base;
let seq = 0;
const models = [User, Role, KycProfile, Announcement, AnnouncementCampaignWinner, Transaction];

const user = async (role = "CUSTOMER", extra = {}) => {
  seq += 1;
  return User.create({
    fullName: `${role} ${seq}`,
    phone: `080${String(seq).padStart(8, "0")}`,
    email: `${role.toLowerCase()}${seq}@promo.test`,
    password: "Passw0rd!",
    role,
    status: "ACTIVE",
    isStaff: role !== "CUSTOMER",
    ...extra,
  });
};

const token = (actor) => jwt.sign(
  { id: String(actor._id), authTokenVersion: Number(actor.authTokenVersion || 0) },
  process.env.JWT_SECRET,
  { noTimestamp: true },
);

const get = async (path, actor) => {
  const response = await fetch(`${base}${path}`, {
    headers: { Accept: "application/json", ...(actor ? { Authorization: `Bearer ${token(actor)}` } : {}) },
  });
  return { status: response.status, body: await response.json() };
};

let headOffice;
let campaign;

test.before(async () => {
  process.env.JWT_SECRET = "promo-leaderboard-release-test";
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mongo.getUri(), { dbName: "promo-leaderboard-release-tests" });
  await Promise.all(models.map((model) => model.init()));
  const app = express();
  app.use(express.json());
  app.use("/api/announcements", announcementRoutes);
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.once("error", reject);
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await mongoose.disconnect();
  await mongo.stop();
});

test.beforeEach(async () => {
  await Promise.all(models.map((model) => model.collection.deleteMany({})));
  seq = 0;
  headOffice = await user("HEAD_OFFICE");
  campaign = await Announcement.create({
    title: "Release promo",
    message: "Tracked",
    campaignTrackingEnabled: true,
    campaignStatus: "ACTIVE",
    audience: "ALL",
    qualifyingTransactionCount: 2,
    qualifyingTransactionValue: 2,
    eligibleTransactionTypes: ["AIRTIME"],
    eligibilityStartAt: new Date("2024-01-01"),
    eligibilityEndAt: new Date("2024-02-01"),
  });
});

const transaction = (customerId, reference, amount, extra = {}) => Transaction.create({
  customerId,
  reference,
  serviceType: "AIRTIME",
  status: "SUCCESSFUL",
  amount,
  createdAt: new Date("2024-01-15"),
  ...extra,
});

test("leaderboard is authenticated, Head Office-only, and kobo-safe", async () => {
  assert.equal((await get("/api/announcements/admin/promo-leaderboard")).status, 401);
  const role = await Role.create({
    name: "PROMO_VIEWER",
    displayName: "Promo viewer",
    department: "CUSTOMER_SUPPORT",
    permissions: ["announcements.participants.view"],
  });
  const staff = await user("STAFF", { staffRoleId: role._id });
  assert.equal((await get("/api/announcements/admin/promo-leaderboard", staff)).status, 403);
  const customer = await user();
  await transaction(customer._id, "release-kobo-1", 1.005);
  await transaction(customer._id, "release-kobo-2", 0.995);
  const response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}`, headOffice);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.summary.activeParticipants, 1);
  assert.equal(response.body.data.summary.totalEligibleTransactionValue, 2);
  assert.equal(response.body.data.participants[0].totalEligibleTransactionValue, 2);
  assert.equal(response.body.data.participants[0].name, customer.fullName);
  assert.equal(response.body.data.participants[0].phone.includes(customer.phone), false);
  assert.equal(response.body.data.summary.rewardsPaid, 0);
});

test("ordering, filters, bounded detail, exclusions, and inactive campaigns", async () => {
  const qualified = await user();
  const almost = await user();
  const overTarget = await user();
  const excluded = await user();
  await transaction(qualified._id, "release-q-1", 1);
  await transaction(qualified._id, "release-q-2", 1);
  await transaction(almost._id, "release-a-1", 0.8);
  await transaction(almost._id, "release-a-2", 0.8);
  await transaction(overTarget._id, "release-over", 3, { createdAt: new Date("2024-01-14") });
  await transaction(overTarget._id, "release-over-2", 3, { createdAt: new Date("2024-01-14T00:01:00Z") });
  await transaction(excluded._id, "release-r-1", 1, { reversalReference: "REV" });
  await AnnouncementCampaignWinner.create({
    announcementId: campaign._id,
    customerId: qualified._id,
    markedBy: headOffice._id,
  });
  let response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}&limit=1`, headOffice);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.participants[0].status, "Reward Pending");
  assert.equal(response.body.data.participants[0].rank, 1);
  assert.equal(response.body.data.participants[0].remainingValue, 0);
  assert.equal(response.body.data.topParticipants[0].customerId.toString(), qualified._id.toString());
  response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}&status=ALMOST_QUALIFIED`, headOffice);
  assert.equal(response.body.data.summary.activeParticipants, 1);
  assert.equal(response.body.data.summary.almostQualified, 1);
  assert.equal(response.body.data.participants[0].remainingValue, 0.4);
  response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}&limit=10`, headOffice);
  assert.equal(response.body.data.participants[0].customerId.toString(), qualified._id.toString());
  assert.equal(response.body.data.participants[1].customerId.toString(), overTarget._id.toString());
  assert.equal(response.body.data.participants[1].remainingValue, 0);
  const detail = await get(`/api/announcements/admin/promo-leaderboard/${qualified._id}?campaignId=${campaign._id}&limit=1`, headOffice);
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.data.eligibleTransactions.length, 1);
  const detailPageTwo = await get(`/api/announcements/admin/promo-leaderboard/${qualified._id}?campaignId=${campaign._id}&page=2&limit=1`, headOffice);
  assert.equal(detailPageTwo.status, 200, JSON.stringify(detailPageTwo.body));
  assert.equal(detailPageTwo.body.data.eligibleTransactions.length, 1);
  assert.notEqual(
    detail.body.data.eligibleTransactions[0].id,
    detailPageTwo.body.data.eligibleTransactions[0].id,
  );
  assert.equal(JSON.stringify(detail.body).includes("reference"), false);
  const inactive = await Announcement.create({
    title: "Ended",
    message: "Ended",
    campaignTrackingEnabled: true,
    campaignStatus: "ENDED",
    eligibleTransactionTypes: ["AIRTIME"],
  });
  await transaction(excluded._id, "release-inactive", 2);
  response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${inactive._id}`, headOffice);
  assert.equal(response.status, 200);
  assert.equal(response.body.data.summary.activeParticipants, 0);
});

test("audience selection and KYC modes exclude non-matches", async () => {
  const selected = await user();
  const other = await user();
  const verified = await user();
  const pending = await user();
  await KycProfile.create([
    { user: verified._id, status: "VERIFIED" },
    { user: pending._id, status: "UNDER_REVIEW" },
  ]);
  for (const [customer, suffix] of [[selected, "s"], [other, "o"], [verified, "v"], [pending, "p"]]) {
    await transaction(customer._id, `release-${suffix}`, 2);
  }
  await Announcement.updateOne({ _id: campaign._id }, {
    $set: { audience: "SELECTED_CUSTOMERS", selectedCustomerIds: [selected._id] },
  });
  let response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}`, headOffice);
  assert.deepEqual(response.body.data.participants.map((row) => String(row.customerId)), [String(selected._id)]);
  await Announcement.updateOne({ _id: campaign._id }, { $set: { audience: "KYC_VERIFIED" } });
  response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}`, headOffice);
  assert.deepEqual(response.body.data.participants.map((row) => String(row.customerId)), [String(verified._id)]);
  await Announcement.updateOne({ _id: campaign._id }, { $set: { audience: "KYC_PENDING" } });
  response = await get(`/api/announcements/admin/promo-leaderboard?campaignId=${campaign._id}`, headOffice);
  assert.deepEqual(response.body.data.participants.map((row) => String(row.customerId)), [String(pending._id)]);
});