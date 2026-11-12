const { Resend } = require('resend');

const {
  welcomeEmail,
  transactionEmail,
  walletEmail,
  kycEmail,
  withdrawalEmail,
  empowermentEmail,
  securityEmail,
} = require('../templates/emailTemplates');

let resendClient = null;

const emailEnabled = () =>
  Boolean(process.env.RESEND_API_KEY);

const getResend = () => {
  if (!emailEnabled()) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }

  return resendClient;
};

const sendEmail = async ({
  to,
  subject,
  html,
  text,
  idempotencyKey,
  sensitive = false,
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

    const resend = getResend();

    if (!resend) {
      console.log(sensitive
        ? JSON.stringify({ event: "email.delivery.failed", provider: "RESEND", category: "RESEND_NOT_CONFIGURED" })
        : `[EMAIL] Skipped for ${to}: RESEND_API_KEY is not configured`);

      return {
        success: false,
        skipped: true,
        reason: 'RESEND_NOT_CONFIGURED',
      };
    }

    const fromName =
      process.env.EMAIL_FROM_NAME ||
      process.env.SMTP_FROM_NAME ||
      'ServicePay';

    const fromEmail =
      process.env.EMAIL_FROM_ADDRESS ||
      process.env.SMTP_FROM_EMAIL ||
      'support@servicepay.ng';

    const replyTo =
      process.env.EMAIL_REPLY_TO ||
      process.env.SMTP_REPLY_TO ||
      'support@servicepay.ng';

    const payload = {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html,
      replyTo,
    };

    if (text) {
      payload.text = text;
    }

    const { data, error } =
      await resend.emails.send(
        payload,
        idempotencyKey
          ? { idempotencyKey }
          : undefined
      );

    if (error) {
      const category = ({
        validation_error: "PROVIDER_VALIDATION_FAILED", missing_required_field: "PROVIDER_VALIDATION_FAILED",
        invalid_api_key: "AUTHENTICATION_FAILED", restricted_api_key: "AUTHORIZATION_FAILED",
        rate_limit_exceeded: "RATE_LIMITED", daily_quota_exceeded: "QUOTA_EXCEEDED",
        monthly_quota_exceeded: "QUOTA_EXCEEDED",
      })[error.name] || "PROVIDER_REJECTED";
      if (sensitive) console.error(JSON.stringify({
        event: "email.delivery.failed", provider: "RESEND", category,
      }));
      else console.error('[EMAIL] Resend send failed:', error);

      return {
        success: false,
        reason: category,
        error: sensitive ? category :
          error.message ||
          JSON.stringify(error),
      };
    }

    if (sensitive && !data?.id) return { success: false, reason: "PROVIDER_ACK_MISSING" };
    if (sensitive) console.log(JSON.stringify({
      event: "password_reset.email.accepted", provider: "RESEND",
      messageId: /^[a-f0-9-]{36}$/i.test(data.id) ? data.id : "REDACTED",
    }));
    else console.log(`[EMAIL] Sent successfully to ${to}: ${data?.id || 'NO_ID'}`);

    return {
      success: true,
      messageId: data?.id || null,
    };
  } catch (error) {
    if (sensitive) console.error(JSON.stringify({
      event: "email.delivery.failed", provider: "RESEND", category: "TRANSPORT_FAILED",
    }));
    else console.error('[EMAIL] Send failed:', error.message);

    return {
      success: false,
      reason: "TRANSPORT_FAILED",
      error: sensitive ? "TRANSPORT_FAILED" : error.message,
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
  direction,
  amount,
  reference,
  status,
  date,
  balance,
  counterparty,
  provider,
  serviceDetails,
  message,
  idempotencyKey,
}) => {
  const content = transactionEmail({
    name,
    type,
    direction,
    amount,
    reference,
    status,
    date,
    balance,
    counterparty,
    provider,
    serviceDetails,
    message,
  });

  return sendEmail({
    to: email,
    idempotencyKey,
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
  if (!emailEnabled()) {
    return {
      success: false,
      reason: 'RESEND_NOT_CONFIGURED',
    };
  }

  return {
    success: true,
    provider: 'RESEND',
  };
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
