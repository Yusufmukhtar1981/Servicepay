const mongoose = require('mongoose');
const { sendEmail } = require('./email.service');
const { baseTemplate } = require('../templates/emailTemplates');

const CAMPAIGN_ID = 'all-services-live-20260814';

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const validEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || '').trim()
  );

const startCustomerBroadcast = async () => {
  try {
    if (!mongoose.connection.db) {
      console.log('[BROADCAST] Database not ready');
      return;
    }

    const db = mongoose.connection.db;
    const campaigns = db.collection('emailbroadcasts');

    const existing = await campaigns.findOne({
      campaignId: CAMPAIGN_ID,
      status: 'COMPLETED',
    });

    if (existing) {
      console.log(
        `[BROADCAST] ${CAMPAIGN_ID} already completed — skipped`
      );
      return;
    }

    const lock = await campaigns.findOneAndUpdate(
      { campaignId: CAMPAIGN_ID },
      {
        $setOnInsert: {
          campaignId: CAMPAIGN_ID,
          createdAt: new Date(),
          sent: 0,
          failed: 0,
        },
        $set: {
          status: 'RUNNING',
          startedAt: new Date(),
        },
      },
      {
        upsert: true,
        returnDocument: 'after',
      }
    );

    console.log(
      `[BROADCAST] Starting ${CAMPAIGN_ID}`
    );

    const users = await db
      .collection('users')
      .find({
        email: {
          $exists: true,
          $nin: [null, ''],
        },
        role: 'CUSTOMER',
      })
      .project({
        email: 1,
        fullName: 1,
        name: 1,
      })
      .toArray();

    const unique = new Map();

    for (const user of users) {
      const email = String(
        user.email || ''
      )
        .trim()
        .toLowerCase();

      if (
        validEmail(email) &&
        !unique.has(email)
      ) {
        unique.set(email, user);
      }
    }

    console.log(
      `[BROADCAST] ${unique.size} unique customer emails found`
    );

    let sent = 0;
    let failed = 0;

    for (const [email, user] of unique) {
      const alreadySent =
        await campaigns.findOne({
          campaignId: CAMPAIGN_ID,
          sentEmails: email,
        });

      if (alreadySent) {
        continue;
      }

      const name =
        user.fullName ||
        user.name ||
        'Customer';

      const html = baseTemplate({
        title: 'ServicePay Services Are Now Live',
        greeting: `Dear ${name}`,
        message:
          'We are pleased to inform you that ServicePay services are now live and available for use. You can now enjoy convenient access to Airtime, Data, Electricity Bill Payment, Cable TV, ServicePay Transfers, NIN Verification, Wallet Services, Delivery Services, and other available ServicePay solutions — all from one platform. Our goal is to make everyday services simple, fast, secure, and reliable. We sincerely appreciate your trust and support as we continue to improve ServicePay and introduce more innovative solutions for you.',
        buttonText: 'Open ServicePay',
        buttonUrl: 'https://servicepay.ng',
        footerMessage:
          'Thank you for choosing ServicePay. One Platform, Many Solutions. For support or enquiries, please contact our customer support team.',
      });

      const result = await sendEmail({
        to: email,
        subject:
          'ServicePay Services Are Now Live',
        html,
      });

      if (result.success) {
        sent += 1;

        await campaigns.updateOne(
          { campaignId: CAMPAIGN_ID },
          {
            $addToSet: {
              sentEmails: email,
            },
            $set: {
              sent,
              failed,
              updatedAt: new Date(),
            },
          }
        );

        console.log(
          `[BROADCAST] Sent ${sent}/${unique.size}: ${email}`
        );
      } else {
        failed += 1;

        await campaigns.updateOne(
          { campaignId: CAMPAIGN_ID },
          {
            $set: {
              sent,
              failed,
              updatedAt: new Date(),
            },
          }
        );

        console.error(
          `[BROADCAST] Failed: ${email}`,
          result.error || result.reason || ''
        );
      }

      /* Gentle pacing for provider/API protection */
      await sleep(700);
    }

    await campaigns.updateOne(
      { campaignId: CAMPAIGN_ID },
      {
        $set: {
          status: 'COMPLETED',
          sent,
          failed,
          completedAt: new Date(),
        },
      }
    );

    console.log(
      `✅ SERVICEPAY CUSTOMER BROADCAST COMPLETED — SENT: ${sent}, FAILED: ${failed}`
    );
  } catch (error) {
    console.error(
      '[BROADCAST] Fatal error:',
      error
    );

    try {
      if (mongoose.connection.db) {
        await mongoose.connection.db
          .collection('emailbroadcasts')
          .updateOne(
            { campaignId: CAMPAIGN_ID },
            {
              $set: {
                status: 'FAILED',
                error: error.message,
                updatedAt: new Date(),
              },
            },
            { upsert: true }
          );
      }
    } catch (_) {}
  }
};

module.exports = {
  startCustomerBroadcast,
};
