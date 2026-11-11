"use strict";
const { Record, range, fail } = require("./marketing.service");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

// Funding, transfers, reversals and rewards are not marketing conversions.
const QUALIFYING_SERVICES = ["DATA", "AIRTIME", "ELECTRICITY", "CABLE", "EXAM_PIN",
  "DELIVERY", "ID_VERIFICATION", "INTERSTATE_LOGISTICS", "EDUPAY"];
async function overview(query, now = new Date()) {
  const dates = range(query, now);
  const [recordedCohort, referredCustomers, newRegistrations] = await Promise.all([
    Record.find({ kind: "attribution", status: "CONFIRMED", createdAt: dates })
      .select("customerId campaignId officerId data.source createdAt").limit(10001).lean(),
    User.find({ role: "CUSTOMER", createdAt: dates, referredBy: { $type: "objectId" } })
      .select("_id createdAt").limit(10001).lean(),
    User.countDocuments({ role: "CUSTOMER", createdAt: dates }).maxTimeMS(15000),
  ]);
  if (referredCustomers.length > 10000) throw fail("Narrow the referral reporting period.", 422);
  // Existing immutable registration referral relationships are the authority.
  // Do not rewrite User/referral records or double-count an evidenced campaign.
  const previouslyAttributed = await Record.find({ kind: "attribution", status: "CONFIRMED",
    customerId: { $in: referredCustomers.map(c => c._id) } }).select("customerId").lean();
  const recordedIds = new Set(previouslyAttributed.map(r => String(r.customerId)));
  const cohort = [...recordedCohort, ...referredCustomers.filter(c => !recordedIds.has(String(c._id)))
    .map(c => ({ customerId: c._id, createdAt: c.createdAt, data: { source: "REFERRAL" } }))];
  if (cohort.length > 10000) throw fail("Narrow the date range; this report exceeds 10,000 attributed customers.", 422);
  const ids = cohort.map(r => r.customerId);
  const [customers, transactions, campaigns, expenses, budgetTotals, staff, taskTotals, targets,
    outputs, social, partnerships, contributionRecords, paidExpenses] = await Promise.all([
    User.find({ _id: { $in: ids }, role: "CUSTOMER" }).select("_id createdAt state lga").lean(),
    Transaction.aggregate([
      { $match: { customerId: { $in: ids }, status: "SUCCESSFUL",
        serviceType: { $in: QUALIFYING_SERVICES },
        reversalTransactionId: null, reversalReference: { $in: ["", null] } } },
      { $group: { _id: "$customerId", firstAt: { $min: "$createdAt" }, lastAt: { $max: "$createdAt" },
        days: { $addToSet: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } } } } },
    ]).option({ maxTimeMS: 15000 }),
    Record.find({ kind: "campaign" }).select("title status data").limit(1001).lean(),
    Record.aggregate([
      { $match: { kind: "expense", status: { $in: ["APPROVED", "PAID"] }, createdAt: dates } },
      { $group: { _id: "$campaignId", total: { $sum: "$data.amountNaira" } } },
    ]),
    Record.aggregate([
      { $match: { kind: "budget", status: "APPROVED", createdAt: dates } },
      { $group: { _id: null, total: { $sum: "$data.amountNaira" } } },
    ]),
    User.find({ isStaff: true, department: "MARKETING" }).select("_id fullName status").limit(1001).lean(),
    Record.aggregate([
      { $match: { kind: "task", status: "COMPLETED", updatedAt: dates } },
      { $group: { _id: "$officerId", total: { $sum: 1 } } },
    ]),
    Record.find({ kind: "target", status: "ACTIVE" }).select("officerId data").limit(1001).lean(),
    Record.aggregate([
      { $match: { kind: { $in: ["report", "content", "attendance"] }, createdAt: dates } },
      { $group: { _id: { kind: "$kind", officerId: { $ifNull: ["$officerId", "$createdBy"] }, status: "$status" },
        total: { $sum: 1 } } },
    ]),
    Record.aggregate([
      { $match: { kind: "social", status: "REPORTED", createdAt: dates } },
      { $group: { _id: "$data.channel", reach: { $sum: "$data.reach" }, impressions: { $sum: "$data.impressions" },
        engagements: { $sum: "$data.engagements" }, reportCount: { $sum: 1 } } },
    ]),
    Record.find({ kind: "partnership" }).select("title status campaignId").limit(1001).lean(),
    Record.find({ kind: "contribution", status: "APPROVED", createdAt: dates }).select("campaignId data").limit(1001).lean(),
    Record.aggregate([
      { $match: { kind: "expense", status: "PAID",
        "data.paidAt": { $gte: dates.$gte.toISOString(), $lt: dates.$lt.toISOString() } } },
      { $group: { _id: "$campaignId", total: { $sum: "$data.amountNaira" } } },
    ]),
  ]);
  if ([campaigns, staff, targets, partnerships, contributionRecords].some(items => items.length > 1000)) throw fail("Marketing reporting capacity exceeded; narrow the reporting scope.", 422);
  const contributionTransactions = await Transaction.find({
    _id: { $in: contributionRecords.map(r => r.data.transactionId) },
    status: "SUCCESSFUL", createdAt: dates, serviceType: { $in: QUALIFYING_SERVICES },
    reversalTransactionId: null, reversalReference: { $in: ["", null] },
  }).select("_id customerId servicepayProfit").lean();
  const contributionById = new Map(contributionTransactions.map(t => [String(t._id), t]));
  const contributionLinks = await Record.find({ kind: "attribution", status: "CONFIRMED",
    customerId: { $in: contributionTransactions.map(t => t.customerId) } })
    .select("customerId campaignId").lean();
  const confirmedCampaign = new Map(contributionLinks.map(r => [String(r.customerId), String(r.campaignId)]));
  const contributionByCampaign = new Map();
  for (const r of contributionRecords) {
    const t = contributionById.get(r.data.transactionId);
    if (!t || t.servicepayProfit !== r.data.observedContributionNaira || !(t.servicepayProfit > 0) ||
        confirmedCampaign.get(String(t.customerId)) !== String(r.campaignId)) continue;
    const key = String(r.campaignId);
    contributionByCampaign.set(key, (contributionByCampaign.get(key) || 0) + t.servicepayProfit);
  }
  const paidByCampaign = new Map(paidExpenses.map(e => [String(e._id), e.total]));
  const roiFor = (contribution, spend) => contribution != null && spend > 0 ? (contribution - spend) / spend * 100 : null;
  const customerById = new Map(customers.map(c => [String(c._id), c]));
  const transactionById = new Map(transactions.map(t => [String(t._id), t]));
  const spendByCampaign = new Map(expenses.map(e => [String(e._id), e.total]));
  const activeSince = new Date(now.getTime() - 30 * 86400000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const converted = t => t && t.firstAt >= dates.$gte && t.firstAt < dates.$lt;
  const campaignRows = campaigns.map(c => {
    const attributed = cohort.filter(a => String(a.campaignId) === String(c._id) && customerById.has(String(a.customerId)));
    const spend = spendByCampaign.get(String(c._id)) || 0;
    const contribution = contributionByCampaign.get(String(c._id)) ?? null;
    const paid = paidByCampaign.get(String(c._id)) || 0;
    return { id: c._id, title: c.title, status: c.status, channel: c.data.channel || null,
      startsAt: c.data.startsAt, endsAt: c.data.endsAt, plannedBudgetNaira: c.data.budgetNaira ?? null,
      acquired: attributed.length,
      firstTransactions: attributed.filter(a => converted(transactionById.get(String(a.customerId)))).length,
      expenditureNaira: spend, cacNaira: attributed.length ? spend / attributed.length : null,
      verifiedContributionNaira: contribution, verifiedSpendNaira: paid, roi: roiFor(contribution, paid) };
  });
  const geo = new Map();
  for (const c of customers) {
    const state = c.state || "Not recorded", city = c.lga || "Not recorded";
    const key = JSON.stringify([state, city]);
    const current = geo.get(key) || { state, city, acquired: 0 };
    current.acquired++; geo.set(key, current);
  }
  const officers = staff.map(s => {
    const acquired = cohort.filter(a => String(a.officerId) === String(s._id) && customerById.has(String(a.customerId))).length;
    const completedTasks = taskTotals.find(t => String(t._id) === String(s._id))?.total || 0;
    const firstTransactions = cohort.filter(a => String(a.officerId) === String(s._id) &&
      customerById.has(String(a.customerId)) && converted(transactionById.get(String(a.customerId)))).length;
    const outputCount = (kind, statuses) => outputs.filter(o => String(o._id.officerId) === String(s._id) &&
      o._id.kind === kind && statuses.includes(o._id.status)).reduce((n, o) => n + o.total, 0);
    const actuals = { ACQUISITIONS: acquired, FIRST_TRANSACTIONS: firstTransactions, TASKS: completedTasks,
      REPORTS: outputCount("report", ["SUBMITTED", "APPROVED"]),
      CONTENT: outputCount("content", ["PUBLISHED"]), ATTENDANCE: outputCount("attendance", ["REPORTED"]) };
    const matchingTargets = targets.filter(t => String(t.officerId) === String(s._id) &&
      new Date(t.data.startsAt) >= dates.$gte &&
      new Date(t.data.endsAt) <= dates.$lt);
    const scorecard = Object.entries(actuals).map(([metric, actual]) => {
      const value = matchingTargets.filter(t => t.data.metric === metric).reduce((n, t) => n + t.data.value, 0);
      return { metric, actual, target: value || null, achievementPercent: value ? actual / value * 100 : null };
    });
    const scored = scorecard.filter(t => t.achievementPercent != null);
    const scorePercent = scored.length ? scored.reduce((n, t) => n + Math.min(100, t.achievementPercent), 0) / scored.length : null;
    const acquisitionTarget = scorecard[0];
    return { id: s._id, name: s.fullName, acquired, completedTasks, firstTransactions,
      submittedReports: actuals.REPORTS, publishedContent: actuals.CONTENT, attendance: actuals.ATTENDANCE,
      targetValue: acquisitionTarget.target, achievementPercent: acquisitionTarget.achievementPercent,
      scorecard, scorePercent };
  }).sort((a, b) => (b.scorePercent ?? -1) - (a.scorePercent ?? -1) || b.acquired - a.acquired);
  const firstCount = customers.filter(c => converted(transactionById.get(String(c._id)))).length;
  const acquired = customers.length, expenditureNaira = expenses.reduce((sum, e) => sum + e.total, 0);
  const retained = customers.filter(c => (transactionById.get(String(c._id))?.days.length || 0) >= 2).length;
  const referredIds = new Set(referredCustomers.map(c => String(c._id)));
  const referralFirst = customers.filter(c => referredIds.has(String(c._id)) && converted(transactionById.get(String(c._id)))).length;
  const contributions = [...contributionByCampaign.values()];
  const verifiedContributionNaira = contributions.length ? contributions.reduce((n, v) => n + v, 0) : null;
  const verifiedSpendNaira = paidExpenses.reduce((sum, e) => sum + e.total, 0);
  const series = [];
  for (let day = new Date(Date.UTC(dates.$gte.getUTCFullYear(), dates.$gte.getUTCMonth(), dates.$gte.getUTCDate()));
    day < dates.$lt; day = new Date(+day + 86400000)) {
    const date = day.toISOString().slice(0, 10);
    series.push({ date, acquired: cohort.filter(r => customerById.has(String(r.customerId)) &&
      new Date(r.createdAt).toISOString().slice(0, 10) === date).length,
      firstTransactions: transactions.filter(t => converted(t) && t.firstAt.toISOString().slice(0, 10) === date).length });
  }
  return {
    period: { from: dates.$gte, to: dates.$lt, timeZone: "UTC" },
    metrics: {
      totalCustomersAcquired: acquired, newRegistrations,
      newCustomersToday: customers.filter(c => c.createdAt >= today && c.createdAt <= now).length,
      activeCustomers: customers.filter(c => transactionById.get(String(c._id))?.lastAt >= activeSince).length,
      firstTimeTransactingCustomers: firstCount,
      activeCampaigns: campaigns.filter(c => c.status === "ACTIVE").length,
      marketingStaff: staff.filter(s => s.status === "ACTIVE").length,
      conversionRate: customers.length ? firstCount / customers.length * 100 : 0,
      expenditureNaira, cacNaira: acquired ? expenditureNaira / acquired : null,
      approvedBudgetNaira: budgetTotals[0]?.total || 0,
      retainedCustomers: retained, retentionRate: acquired ? retained / acquired * 100 : 0,
      verifiedContributionNaira, verifiedSpendNaira, roi: roiFor(verifiedContributionNaira, verifiedSpendNaira),
    }, campaigns: campaignRows, geography: [...geo.values()], officers, series,
    referrals: { registrations: referredCustomers.length, firstTransactions: referralFirst,
      conversionRate: referredCustomers.length ? referralFirst / referredCustomers.length * 100 : 0 },
    social: social.map(s => ({ channel: s._id, reach: s.reach, impressions: s.impressions,
      engagements: s.engagements, reportCount: s.reportCount })),
    partnerships: partnerships.map(p => {
      const campaign = campaignRows.find(c => String(c.id) === String(p.campaignId));
      return { id: p._id, title: p.title, status: p.status, campaignId: p.campaignId,
        acquired: campaign?.acquired ?? null, firstTransactions: campaign?.firstTransactions ?? null };
    }),
    limitations: [
      "Acquisition cohort: evidence-confirmed attribution recorded during the period plus new customers with existing referral relationships who have no prior confirmed attribution. Not all registrations.",
      "Campaign attribution is evidence-confirmed; referral sources use existing registration relationships. Automatic UTM capture and social publishing are not connected.",
      "Active means a qualifying successful service transaction in the last 30 days; retention means transactions on at least two UTC dates.",
      "First conversion uses the earliest successful qualifying service transaction, excluding funding, transfers, refunds and rewards.",
      "Expenditure and CAC use approved expense allocations, not wallet deductions or proof of external payment.",
      "ROI uses only independently Head Office-approved, campaign-linked recorded ServicePay contribution and Head Office-evidenced PAID expenses, within this period. It is not a comprehensive audited profit statement. Missing evidence means unavailable.",
      "Contributions are rechecked against current successful, unreversed transaction records; gross purchase value is never revenue. No financial records are modified.",
      "Location uses current customer state/LGA; LGA is not a verified city.",
      "Officer score is the equal-weighted mean of configured metric achievements capped at 100%; targets must lie fully within this period. Missing targets mean unavailable, not zero.",
      "Social values are evidence-backed manual reports and may overlap audiences; partnership outcomes refer to linked campaigns, not independently proven incremental impact.",
    ],
  };
}
module.exports = { overview, QUALIFYING_SERVICES };
