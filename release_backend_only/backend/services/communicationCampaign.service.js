const Campaign = require("../models/communicationCampaign.model");
const Recipient = require("../models/communicationRecipient.model");
const Notification = require("../models/notification.model");
const { sendEmail } = require("./email.service");
const { baseTemplate } = require("../templates/emailTemplates");

const CHUNK_SIZE = 50;
const activeCampaigns = new Map();

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

const updateCampaignCounts = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId).select("recipientCount status");
  if (!campaign) return null;
  const counts = await Recipient.aggregate([
    { $match: { campaignId } },
    { $group: { _id: "$outcome", count: { $sum: 1 } } },
  ]);
  const values = Object.fromEntries(counts.map((item) => [item._id, item.count]));
  const recipientTotal = counts.reduce((total, item) => total + item.count, 0);
  const unfinished = (values.PENDING || 0) + (values.PROCESSING || 0);
  const update = {
    sentCount: values.SENT || 0,
    deliveredCount: values.DELIVERED || 0,
    failedCount: values.FAILED || 0,
    skippedCount: values.SKIPPED || 0,
  };
  if (recipientTotal !== campaign.recipientCount) {
    update.status = "PROCESSING";
    update.completedAt = null;
    console.error(
      `[COMMUNICATIONS] Campaign ${campaignId} remains PROCESSING: recipient snapshot count ${recipientTotal} does not match expected ${campaign.recipientCount}. It can be recovered after repairing the snapshot.`
    );
  } else if (!unfinished) {
    update.status = update.failedCount ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
    update.completedAt = new Date();
  }
  return Campaign.findByIdAndUpdate(campaignId, { $set: update }, { returnDocument: "after" });
};

const processRecipient = async (campaign, recipient) => {
  try {
    if (campaign.channel === "EMAIL") {
      const email = String(recipient.email || "").trim().toLowerCase();
      const result = validEmail(email)
        ? await sendEmail({
          to: email,
          subject: campaign.subject,
          text: campaign.message,
          html: baseTemplate({
            title: campaign.subject,
            greeting: "Hello Customer",
            message: campaign.message,
          }),
          idempotencyKey: `communications-${campaign._id}-${recipient.recipientKey}`,
        })
        : { skipped: true, reason: "RECIPIENT_MISSING" };
      const outcome = result.success ? "SENT" : result.skipped ? "SKIPPED" : "FAILED";
      await Recipient.updateOne(
        { _id: recipient._id, outcome: "PROCESSING" },
        { $set: { outcome, providerMessageId: result.messageId || null, error: result.error || result.reason || null } }
      );
      return;
    }

    await Notification.findOneAndUpdate(
      { userId: recipient.userId, referenceId: campaign._id, referenceType: "COMMUNICATION_CAMPAIGN" },
      {
        $setOnInsert: {
          userId: recipient.userId,
          title: campaign.title,
          message: campaign.message,
          type: "GENERAL",
          referenceId: campaign._id,
          referenceType: "COMMUNICATION_CAMPAIGN",
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );
    await Recipient.updateOne({ _id: recipient._id, outcome: "PROCESSING" }, { $set: { outcome: "DELIVERED", error: null } });
  } catch (error) {
    await Recipient.updateOne(
      { _id: recipient._id, outcome: "PROCESSING" },
      { $set: { outcome: "FAILED", error: String(error.message || error).slice(0, 1000) } }
    );
  }
};

const processCampaign = async (campaignId) => {
  const key = String(campaignId);
  if (activeCampaigns.has(key)) return activeCampaigns.get(key);
  const work = (async () => {
    // A previous in-process worker can have stopped after claiming a row.
    // This is safe here because the per-process campaign lock is already held.
    await Recipient.updateMany({ campaignId, outcome: "PROCESSING" }, { $set: { outcome: "PENDING" } });
    let campaign = await Campaign.findById(campaignId);
    if (!campaign || campaign.status !== "PROCESSING") return;
    while (campaign) {
      const pending = await Recipient.find({ campaignId, outcome: "PENDING" }).sort({ _id: 1 }).limit(CHUNK_SIZE);
      if (!pending.length) break;
      const claimed = [];
      for (const recipient of pending) {
        const claim = await Recipient.findOneAndUpdate(
          { _id: recipient._id, outcome: "PENDING" },
          { $set: { outcome: "PROCESSING" } },
          { returnDocument: "after" }
        );
        if (claim) claimed.push(claim);
      }
      await Promise.all(claimed.map((recipient) => processRecipient(campaign, recipient)));
      campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status !== "PROCESSING") break;
    }
    await updateCampaignCounts(campaignId);
  })();
  activeCampaigns.set(key, work);
  try {
    return await work;
  } finally {
    activeCampaigns.delete(key);
  }
};

const scheduleCampaign = (campaignId) => {
  setImmediate(() => processCampaign(campaignId).catch((error) => console.error("[COMMUNICATIONS] Campaign processing failed:", error.message)));
};

const resumePendingCampaigns = async () => {
  await Recipient.updateMany({ outcome: "PROCESSING" }, { $set: { outcome: "PENDING" } });
  const campaigns = await Campaign.find({ status: "PROCESSING" }).select("_id").lean();
  campaigns.forEach((campaign) => scheduleCampaign(campaign._id));
  return campaigns.length;
};

module.exports = { CHUNK_SIZE, processCampaign, scheduleCampaign, resumePendingCampaigns, updateCampaignCounts };