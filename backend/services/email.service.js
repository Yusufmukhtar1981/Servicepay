const nodemailer = require('nodemailer');

const {
  welcomeEmail,
  transactionEmail,
  walletEmail,
  kycEmail,
  withdrawalEmail,
  empowermentEmail,
  securityEmail,
} = require('../templates/emailTemplates');

let transporter = null;

const emailEnabled = () =>
  Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );

const getTransporter = () => {
  if (!emailEnabled()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure:
        String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    });
  }

  return transporter;
};

const sendEmail = async ({
  to,
  subject,
  html,
  text,
}) => {
  try {
    if (!to) {
      console.log('[EMAIL] Skipped: recipient email missing');
      return {
        success: false,
        skipped: true,
        reason: 'RECIPIENT_MISSING',
      };
    }

    const mailer = getTransporter();

    if (!mailer) {
      console.log(
        `[EMAIL] Skipped for ${to}: SMTP environment variables are not configured`
      );

      return {
        success: false,
        skipped: true,
        reason: 'SMTP_NOT_CONFIGURED',
      };
    }

    const fromName =
      process.env.SMTP_FROM_NAME || 'ServicePay';

    const fromEmail =
      process.env.SMTP_FROM_EMAIL ||
      process.env.SMTP_USER;

    const info = await mailer.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text,
      html,
      replyTo:
        process.env.SMTP_REPLY_TO ||
        process.env.SMTP_FROM_EMAIL ||
        process.env.SMTP_USER,
    });

    console.log(
      `[EMAIL] Sent successfully to ${to}: ${info.messageId}`
    );

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error) {
    console.error('[EMAIL] Send failed:', error.message);

    return {
      success: false,
      error: error.message,
    };
  }
};

const sendWelcomeEmail = async ({
  email,
  name,
}) => {
  const content = welcomeEmail({ name });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendTransactionEmail = async ({
  email,
  name,
  type,
  amount,
  reference,
  status,
  date,
}) => {
  const content = transactionEmail({
    name,
    type,
    amount,
    reference,
    status,
    date,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendWalletEmail = async ({
  email,
  name,
  type,
  amount,
  balance,
  reference,
  status,
}) => {
  const content = walletEmail({
    name,
    type,
    amount,
    balance,
    reference,
    status,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendKycEmail = async ({
  email,
  name,
  tier,
  status,
  reason,
}) => {
  const content = kycEmail({
    name,
    tier,
    status,
    reason,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendWithdrawalEmail = async ({
  email,
  name,
  amount,
  reference,
  status,
  reason,
}) => {
  const content = withdrawalEmail({
    name,
    amount,
    reference,
    status,
    reason,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendEmpowermentEmail = async ({
  email,
  name,
  programName,
  amount,
  reference,
  status,
  message,
}) => {
  const content = empowermentEmail({
    name,
    programName,
    amount,
    reference,
    status,
    message,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const sendSecurityEmail = async ({
  email,
  name,
  action,
  date,
}) => {
  const content = securityEmail({
    name,
    action,
    date,
  });

  return sendEmail({
    to: email,
    ...content,
  });
};

const verifyEmailConnection = async () => {
  try {
    const mailer = getTransporter();

    if (!mailer) {
      return {
        success: false,
        reason: 'SMTP_NOT_CONFIGURED',
      };
    }

    await mailer.verify();

    console.log('[EMAIL] SMTP connection verified');

    return {
      success: true,
    };
  } catch (error) {
    console.error(
      '[EMAIL] SMTP verification failed:',
      error.message
    );

    return {
      success: false,
      error: error.message,
    };
  }
};

module.exports = {
  emailEnabled,
  sendEmail,
  sendWelcomeEmail,
  sendTransactionEmail,
  sendWalletEmail,
  sendKycEmail,
  sendWithdrawalEmail,
  sendEmpowermentEmail,
  sendSecurityEmail,
  verifyEmailConnection,
};
